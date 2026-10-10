// All observations and counts come from the CSV URLs in the JSON specs.
// Numeric constants below control layout only.

let australiaBoundaryPromise;

async function fetchJSON(url) {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`${url}: HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
        throw new Error(data.error.message || "The data service returned an error.");
    }

    return data;
}

function signedRingArea(ring) {
    let area = 0;

    for (let i = 0; i < ring.length - 1; i++) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[i + 1];

        area += x1 * y2 - x2 * y1;
    }

    return area / 2;
}

function pointInsideRing(point, ring) {
    const [x, y] = point;
    let inside = false;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];

        if (
            (yi > y) !== (yj > y) &&
            x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
        ) {
            inside = !inside;
        }
    }

    return inside;
}

function convertABSBoundaries(data) {
    const features = [];

    for (const feature of data.features || []) {
        const attributes = feature.attributes || {};
        const code = String(attributes.STATE_CODE_2026 || "");
        const rings = feature.geometry?.rings;

        if (!/^[1-8]$/.test(code) || !Array.isArray(rings)) {
            continue;
        }

        // Geographic limits and minimum ring area control map detail only.
        // All boundary coordinates come directly from the ABS service.
        const outerRings = rings.filter(ring =>
            signedRingArea(ring) <= -0.001 &&
            ring.every(([longitude, latitude]) =>
                longitude >= 112 && longitude <= 154 &&
                latitude >= -44 && latitude <= -9
            )
        );

        const polygons = outerRings.map(ring => [ring]);

        // Preserve substantial holes, including ACT within NSW.
        // ABS exterior rings are clockwise; interior rings are anticlockwise.
        for (const ring of rings) {
            if (signedRingArea(ring) < 0.001) {
                continue;
            }

            let parentIndex = -1;
            let parentArea = Infinity;

            for (let i = 0; i < outerRings.length; i++) {
                const area = Math.abs(signedRingArea(outerRings[i]));

                if (area < parentArea && pointInsideRing(ring[0], outerRings[i])) {
                    parentIndex = i;
                    parentArea = area;
                }
            }

            if (parentIndex >= 0) {
                polygons[parentIndex].push(ring);
            }
        }

        if (polygons.length > 0) {
            features.push({
                type: "Feature",
                properties: {
                    state_code_2026: code,
                    state_name_2026: attributes.STATE_NAME_2026
                },
                geometry: {
                    type: "MultiPolygon",
                    coordinates: polygons
                }
            });
        }
    }

    return features;
}

function hasRequiredBoundaries(features) {
    if (!Array.isArray(features)) {
        return false;
    }

    const codes = new Set(
        features
            .filter(feature => feature.type === "Feature" && feature.geometry)
            .map(feature => String(feature.properties?.state_code_2026))
    );

    return Array.from({length: 8}, (_, index) => String(index + 1))
        .every(code => codes.has(code));
}

async function loadAustraliaBoundaries() {
    if (!australiaBoundaryPromise) {
        australiaBoundaryPromise = (async () => {
            try {
                const local = await fetchJSON("data/australia_states_2026.geojson");

                if (hasRequiredBoundaries(local.features)) {
                    return local.features;
                }
            } catch (error) {
                console.info("Local map boundaries unavailable; loading ABS boundaries.");
            }

            const parameters = new URLSearchParams({
                where: "1=1",
                outFields: "STATE_CODE_2026,STATE_NAME_2026",
                returnGeometry: "true",
                outSR: "4326",
                maxAllowableOffset: "0.025",
                geometryPrecision: "4",
                f: "json"
            });

            const url =
                "https://geo.abs.gov.au/arcgis/rest/services/" +
                "ASGS2026/STE/MapServer/1/query?" + parameters;

            const source = await fetchJSON(url);
            const features = convertABSBoundaries(source);

            if (!hasRequiredBoundaries(features)) {
                throw new Error("The ABS boundary response did not contain all eight mapped jurisdictions.");
            }

            return features;
        })();
    }

    return australiaBoundaryPromise;
}

function wrapText(text, maxWidth, font) {
    const context = document.createElement("canvas").getContext("2d");

    context.font = font;

    const lines = [];
    let line = "";

    for (const word of String(text).split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;

        if (line && context.measureText(candidate).width > maxWidth) {
            lines.push(line);
            line = word;
        } else {
            line = candidate;
        }
    }

    if (line) {
        lines.push(line);
    }

    return lines;
}

async function mountChart(id, path) {
    const element = document.getElementById(id);
    const isMap = ["chart8", "chart9", "chart10"].includes(id);
    const response = await fetch(path);

    if (!response.ok) {
        throw new Error(`${path}: HTTP ${response.status}`);
    }

    const original = await response.json();

    if (isMap) {
        element.textContent = "Loading map…";

        const mapData = original.data?.find(data => data.name === "map");

        if (!mapData) {
            throw new Error(`${id} is missing its map dataset.`);
        }

        mapData.values = await loadAustraliaBoundaries();

        // Supply verified geometry directly so a missing local file cannot
        // silently leave Vega with an empty map dataset.
        delete mapData.url;
        delete mapData.format;
    }

    let currentEmbed;
    let lastWidth = -1;
    let timer;
    const taxonControl = id === "chart10"
        ? document.getElementById("chart10-taxon")
        : null;

    if (taxonControl) {
        taxonControl.addEventListener("change", () => {
            if (currentEmbed) {
                currentEmbed.view
                    .signal("selectedTaxon", taxonControl.value || null)
                    .runAsync()
                    .catch(error => console.error("Error selecting a taxon:", error));
            }
        });
    }

    async function render() {
        const width = Math.floor(element.clientWidth);

        if (width <= 0 || width === lastWidth) {
            return;
        }

        lastWidth = width;

        const spec = structuredClone(original);
        const isVega = spec.$schema?.includes("/vega/");

        if (isVega) {
            spec.width = width;

            const heightScale = id === "chart5" ? 2 : 1;

            spec.height = Math.round(
                (width < 560 ? 580 : 430) * heightScale
            );

            if (id === "chart6") {
                spec.height = width < 600 ? 740 : 650;
            }

            if (id === "chart7") {
                spec.height = width < 600 ? 620 : 580;
            }

            if (id === "chart8") {
                spec.height = width < 600 ? (width < 400 ? 660 : 780) : 610;
            }

            if (id === "chart9") {
                spec.height = width < 600 ? (width < 400 ? 760 : 850) : 650;
            }

            if (id === "chart10") {
                spec.height = width < 800
                    ? Math.round(Math.max(300, Math.min(460, width * 0.75 + 100)) + 550)
                    : 650;

                const selection = spec.signals.find(signal => signal.name === "selectedTaxon");

                if (selection && taxonControl) {
                    selection.value = taxonControl.value || null;
                }
            }

            spec.autosize = {
                type: isMap ? "none" : "fit-x",
                contains: "padding",
                resize: true
            };
        } else if (id !== "chart1") {
            spec.width = width;

            spec.autosize = {
                type: "fit-x",
                contains: "padding",
                resize: true
            };
        }

        if ((id === "chart2" || id === "chart3") && spec.title) {
            const titleWidth = Math.max(100, width - 20);

            spec.title.text = wrapText(
                spec.title.text,
                titleWidth,
                '700 20px "Source Serif 4"'
            );

            spec.title.subtitle = [spec.title.subtitle]
                .flat()
                .flatMap(text =>
                    wrapText(
                        text,
                        titleWidth,
                        '13px "Source Sans 3"'
                    )
                );
        }

        if (id === "chart2") {
            spec.resolve = {
                scale: {
                    radius: "independent"
                }
            };

            const factor = Math.min(
                1,
                Math.max(0.1, (width - 10) / 430)
            );

            spec.height = 430 * factor;

            for (const layer of spec.layer) {
                for (const key of [
                    "innerRadius",
                    "radius",
                    "radiusOffset"
                ]) {
                    if (typeof layer.mark[key] === "number") {
                        layer.mark[key] *= factor;
                    }
                }

                const scale = layer.encoding?.radius?.scale;

                if (scale?.range) {
                    scale.range = scale.range.map(
                        value => value * factor
                    );
                }
            }
        }

        if (currentEmbed) {
            currentEmbed.finalize();
        }

        const result = await vegaEmbed(element, spec, {
            actions: true,
            renderer: "svg",
            mode: isVega ? "vega" : "vega-lite"
        });

        currentEmbed = result;

        if (taxonControl) {
            const selected = result.view.signal("selectedTaxon");
            const options = [new Option("All taxa", "")];

            for (const taxon of result.view.data("multi_taxa")) {
                options.push(new Option(taxon.display_name, taxon.taxon_id));
            }

            taxonControl.replaceChildren(...options);
            taxonControl.value = selected || "";

            result.view.addSignalListener("selectedTaxon", (name, value) => {
                taxonControl.value = value || "";
            });
        }
    }

    await render();

    const observer = new ResizeObserver(() => {
        clearTimeout(timer);

        timer = setTimeout(() => {
            render().catch(error => {
                console.error(`Error resizing ${id}:`, error);
            });
        }, 150);
    });

    observer.observe(element);
}

async function initialiseCharts() {
    await document.fonts.ready;

    const charts = [
        ["chart1", "specs/chart1_waffle.json"],
        ["chart2", "specs/chart2_seasonal.json"],
        ["chart3", "specs/chart3_heatmap.json"],
        ["chart4", "specs/chart4_month_distribution.json"],
        ["chart5", "specs/chart5_conservation_treemap.json"],
        ["chart6", "specs/chart6_conservation_alluvial.json"],
        ["chart7", "specs/chart7_conservation_upset.json"],
        ["chart8", "specs/chart8_conservation_choropleth.json"],
        ["chart9", "specs/chart9_conservation_symbols.json"],
        ["chart10", "specs/chart10_conservation_connections.json"]
    ];

    await Promise.all(
        charts.map(async ([id, path]) => {
            try {
                await mountChart(id, path);
            } catch (error) {
                console.error(`Error loading ${id}:`, error);

                const element = document.getElementById(id);

                if (element) {
                    element.textContent = ["chart8", "chart9", "chart10"].includes(id)
                        ? `${id.replace("chart", "Chart ")} could not load: ${error.message}`
                        : "This chart could not load. Check the JSON and CSV paths.";
                }
            }
        })
    );
}

initialiseCharts();