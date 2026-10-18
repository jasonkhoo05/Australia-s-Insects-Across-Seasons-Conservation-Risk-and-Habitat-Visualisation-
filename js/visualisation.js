// All observations and counts come from the CSV URLs in the JSON specs.
// Annotation figures are calculated from the datasets loaded by each chart.
// Constants identify comparison groups, analytic thresholds, or layout settings.

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

const annotationCharts = new Set([
    "chart2", "chart3", "chart6", "chart7", "chart8",
    "chart9", "chart10", "chart11", "chart12"
]);

const annotationColour = "#A85D2A";
const annotationCSVs = new Map();

async function loadAnnotationRows(url) {
    if (!annotationCSVs.has(url)) {
        annotationCSVs.set(url, fetch(url).then(async response => {
            if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
            return vega.read(await response.text(), {type: "csv"});
        }));
    }

    return annotationCSVs.get(url);
}

const numberLabel = value => Number(value).toLocaleString("en-AU");
const percentLabel = value => `${Math.round(value * 100)}%`;

const listLabel = values => new Intl.ListFormat("en-AU", {
    style: "long",
    type: "conjunction"
}).format(values);

const jurisdictionsOf = row => String(row.jurisdictions || "")
    .split("|").map(value => value.trim()).filter(Boolean);

function installAnnotationStyles() {
    if (document.getElementById("chart-annotation-styles")) return;

    const style = document.createElement("style");
    style.id = "chart-annotation-styles";

    style.textContent = `
        .chart-insight {
            box-sizing: border-box;
            margin: 18px 0 22px;
            padding: 14px 18px;
            border: 1px solid #e3e6df;
            border-left: 4px solid var(--insight-accent, #A85D2A);
            border-radius: 0 5px 5px 0;
            background: #fafbf7;
            color: #303a34;
            font-family: "Source Sans 3", sans-serif;
            font-size: 15px;
            line-height: 1.5;
            text-align: left;
            overflow-wrap: anywhere;
        }

        .chart-insight[hidden] {
            display: none;
        }

        .chart-insight-title {
            margin: 0 0 5px !important;
            color: #253b32;
            font-size: 16px;
            font-weight: 700;
            line-height: 1.35;
        }

        .chart-insight-body {
            margin: 0 !important;
        }

        .chart-insight-note {
            margin: 7px 0 0 !important;
            color: #606860;
            font-size: 13px;
            line-height: 1.45;
        }

        @media (max-width: 600px) {
            .chart-insight {
                padding: 12px 13px;
                font-size: 14px;
            }

            .chart-insight-title {
                font-size: 15px;
            }
        }
    `;

    document.head.append(style);
}

function createAnnotation(element) {
    if (!annotationCharts.has(element.id)) return null;

    const aside = document.createElement("aside");
    aside.className = "chart-insight";
    aside.id = `${element.id}-insight`;
    aside.setAttribute("aria-labelledby", `${aside.id}-title`);
    aside.hidden = true;

    const title = document.createElement("p");
    title.id = `${aside.id}-title`;
    title.className = "chart-insight-title";

    const body = document.createElement("p");
    body.className = "chart-insight-body";

    const note = document.createElement("p");
    note.className = "chart-insight-note";

    aside.append(title, body, note);

    // Normal document flow reserves room, including when text wraps or changes.
    element.insertAdjacentElement("afterend", aside);

    return {element: aside, title, body, note};
}

function showAnnotation(
    box,
    title,
    body,
    note = "",
    colour = annotationColour
) {
    if (!box) return;

    box.title.textContent = title;
    box.body.textContent = body;
    box.note.textContent = note;
    box.note.hidden = !note;
    box.element.style.setProperty("--insight-accent", colour);
    box.element.hidden = !body;
}

function chartMark(spec, name) {
    const find = marks => {
        for (const mark of marks || []) {
            if (mark.name === name) return mark;

            const nested = find(mark.marks);
            if (nested) return nested;
        }

        return null;
    };

    return find(spec.marks);
}

function prepareAnnotations(id, spec) {
    if (id === "chart2") {
        const encoding = spec.layer[0].encoding;
        const selectedMonths =
            "datum.month_num >= 5 && datum.month_num <= 8";

        encoding.stroke = {
            condition: {
                test: selectedMonths,
                value: annotationColour
            },
            value: "#FFFFFF"
        };

        encoding.strokeWidth = {
            condition: {
                test: selectedMonths,
                value: 2
            },
            value: 1
        };
    }

    if (id === "chart3") {
        spec.title.subtitle = [
            "Species selected for the largest additions to their",
            "documented seasonal windows. Outlines mark the comparison."
        ];

        spec.layer = [
            {
                mark: spec.mark
            },
            {
                transform: [
                    {
                        filter: "datum.new_record === 1 && indexof(['Blotched Dusky-blue', 'Cooktown Azure', 'Forest Brown'], datum.CommonName) >= 0"
                    }
                ],
                mark: {
                    type: "rect",
                    fillOpacity: 0,
                    stroke: annotationColour,
                    strokeWidth: 2,
                    cornerRadius: 1
                }
            }
        ];

        delete spec.mark;
    }

    if (id === "chart4") {
        spec.layer.unshift({
            transform: [
                {
                    filter: "datum.new_month_count <= 2"
                },
                {
                    aggregate: [
                        {op: "min", field: "dot_x", as: "left"},
                        {op: "max", field: "dot_x", as: "right"},
                        {op: "max", field: "label_row", as: "top"}
                    ]
                },
                {
                    calculate: "datum.left - 0.12",
                    as: "left"
                },
                {
                    calculate: "datum.right + 0.12",
                    as: "right"
                },
                {
                    calculate: "datum.top + 0.5",
                    as: "top"
                },
                {
                    calculate: "0",
                    as: "bottom"
                }
            ],
            mark: {
                type: "rect",
                fill: "#F8EFE5",
                fillOpacity: 0.65,
                stroke: annotationColour,
                strokeWidth: 1,
                strokeDash: [4, 3],
                cornerRadius: 5
            },
            encoding: {
                x: {
                    field: "left",
                    type: "quantitative"
                },
                x2: {
                    field: "right"
                },
                y: {
                    field: "bottom",
                    type: "quantitative"
                },
                y2: {
                    field: "top"
                }
            }
        });
    }

    if (id === "chart6") {
        const mark = chartMark(spec, "ribbons");
        const relevant =
            "datum.epbc_status_code === 'CR' && datum.extent_rank === 0";

        mark.encode.update.stroke = {
            signal: `${relevant} ? '#76332D' : '#FFFFFF'`
        };

        mark.encode.update.strokeWidth = {
            signal: `${relevant} ? 1.2 : 0.5`
        };
    }

    if (id === "chart7") {
        const mark = chartMark(spec, "membershipDot");
        const relevant =
            "datum.included && datum.state === 'NSW' && datum.jurisdiction_count > 1";

        mark.encode.update.stroke = {
            signal: `${relevant} ? '${annotationColour}' : datum.included ? '#ffffff' : '#dce2de'`
        };

        mark.encode.update.strokeWidth = {
            signal: `${relevant} ? 3 : 1`
        };
    }

    if (id === "chart8" || id === "chart9") {
        // Replace the highest-only headline; the detailed comparison is below.
        const headline = spec.marks.find(mark =>
            mark.type === "text" &&
            mark.encode?.update?.text?.signal?.includes("Highest CR share:")
        ) || spec.marks.find(mark =>
            mark.type === "text" &&
            mark.encode?.update?.text?.signal?.includes("Most listed taxa:")
        );

        if (headline) {
            headline.encode.update.text = {
                signal: id === "chart8"
                    ? "compact ? ['Compare threat-category shares', 'alongside their counts'] : 'Compare threat-category shares alongside their counts'"
                    : "compact ? ['Similar totals can hide different', 'jurisdiction associations'] : 'Similar totals can hide different jurisdiction associations'"
            };

            headline.encode.update.limit = {
                signal: "width - 20"
            };
        }
    }

    if (id === "chart9") {
        const mark = chartMark(spec, "stateSymbols");

        mark.encode.update.stroke = {
            signal: `hoverState && hoverState.code === datum.code ? '#173d38' : indexof(['NSW', 'TAS'], datum.state_abbreviation) >= 0 ? '${annotationColour}' : '#ffffff'`
        };

        mark.encode.update.strokeWidth = {
            signal: "hoverState && hoverState.code === datum.code ? 3 : indexof(['NSW', 'TAS'], datum.state_abbreviation) >= 0 ? 2.5 : 1.3"
        };
    }

    if (id === "chart11") {
        spec.signals.find(signal => signal.name === "plotRight").update =
            "width - 80";

        const mark = chartMark(spec, "order_paths");

        mark.encode.update.strokeWidth = {
            signal: "focusOrder === datum.order ? 3.5 : !focusOrder && indexof(['Hemiptera', 'Lepidoptera'], datum.order) >= 0 ? 3 : 2"
        };
    }

    if (id === "chart12") {
        const mark = chartMark(spec, "habitat_bars");
        const relevant =
            "datum.segment_key === 'unique_species' && (displayMode === 'percent' ? datum.habitat_type !== 'Lawn' : datum.habitat_type === 'Lawn')";

        mark.encode.update.stroke = {
            signal: `${relevant} ? '${annotationColour}' : '#ffffff'`
        };

        mark.encode.update.strokeWidth = {
            signal: `${relevant} ? 2 : 1`
        };
    }
}

function placeChart4Annotation(spec, width, annotationRows) {
    const rows = (annotationRows || [])
        .filter(row => Number(row.NewMonthCount) > 0);

    if (!rows.length) return;

    const small = rows
        .filter(row => Number(row.NewMonthCount) <= 2)
        .length;

    const compact = width < 430;
    const titleSize = compact ? 14 : 17;
    const bodySize = compact ? 12 : 15;
    const titleLineHeight = titleSize + 4;
    const bodyLineHeight = bodySize + 5;
    const textWidth = Math.max(90, width * 0.60 - 64);

    const title = wrapText(
        "Most additions are small",
        textWidth,
        `700 ${titleSize}px "Source Sans 3"`
    );

    const body = wrapText(
        `${numberLabel(small)} of ${numberLabel(rows.length)} species (${percentLabel(small / rows.length)}) add just one or two newly documented months.`,
        textWidth,
        `${bodySize}px "Source Sans 3"`
    );

    const top = 14;
    const titleY = top + 12;
    const bodyY = titleY + title.length * titleLineHeight + 8;
    const bottom = bodyY + body.length * bodyLineHeight + 12;

    // Move the shared position encodings to the existing data layers.
    // The annotation must not inherit dot_x or dot_row.
    const sharedEncoding = spec.encoding;

    for (const layer of spec.layer) {
        const encoding = structuredClone(sharedEncoding);

        for (const [channel, value] of Object.entries(layer.encoding || {})) {
            encoding[channel] = {
                ...encoding[channel],
                ...value
            };
        }

        layer.encoding = encoding;
    }

    delete spec.encoding;

    // Draw each annotation element once, rather than once per species.
    const once = [
        {
            aggregate: [
                {
                    op: "count",
                    as: "annotation_rows"
                }
            ]
        }
    ];

    spec.layer.push(
        {
            transform: once,
            mark: {
                type: "rect",
                fill: "#FAFBF7",
                stroke: "#E3E6DF",
                strokeWidth: 1,
                cornerRadius: 5
            },
            encoding: {
                x: {
                    value: {
                        expr: "width * 0.40"
                    }
                },
                x2: {
                    value: {
                        expr: "width - 8"
                    }
                },
                y: {
                    value: top
                },
                y2: {
                    value: bottom
                }
            }
        },
        {
            transform: once,
            mark: {
                type: "text",
                align: "left",
                baseline: "top",
                font: "Source Sans 3",
                fontSize: titleSize,
                fontWeight: 700,
                color: "#253B32",
                lineBreak: "\n",
                lineHeight: titleLineHeight
            },
            encoding: {
                x: {
                    value: {
                        expr: "width * 0.40 + 12"
                    }
                },
                y: {
                    value: titleY
                },
                text: {
                    value: title.join("\n")
                }
            }
        },
        {
            transform: once,
            mark: {
                type: "text",
                align: "left",
                baseline: "top",
                font: "Source Sans 3",
                fontSize: bodySize,
                color: "#303A34",
                lineBreak: "\n",
                lineHeight: bodyLineHeight
            },
            encoding: {
                x: {
                    value: {
                        expr: "width * 0.40 + 12"
                    }
                },
                y: {
                    value: bodyY
                },
                text: {
                    value: body.join("\n")
                }
            }
        }
    );
}

function updateAnnotation(id, box, view, spec, annotationRows) {
    if (!box) return;

    // Keep species counts separate from Vega-Lite's flattened/imputed cells.
    const data = name => name === "annotation_source"
        ? annotationRows || []
        : view.data(name) || [];

    if (id === "chart2") {
        const rows = data("annotation_source");

        const count = row =>
            Number(row.species_with_new_out_of_season_record) || 0;

        const total = rows.reduce(
            (sum, row) => sum + count(row),
            0
        );

        const additions = rows
            .filter(row =>
                Number(row.month_number) >= 5 &&
                Number(row.month_number) <= 8
            )
            .reduce(
                (sum, row) => sum + count(row),
                0
            );

        if (!total) return;

        showAnnotation(
            box,
            "Seasonal discoveries concentrate in May–August",
            `${numberLabel(additions)} of ${numberLabel(total)} newly documented species–month entries (${percentLabel(additions / total)}) fall in May–August. This describes additions to seasonal knowledge, rather than overall butterfly abundance.`,
            "Outlined sectors mark May–August. A species can contribute to several months, so these totals count month additions, not distinct species."
        );
    }

    if (id === "chart3") {
        const rows = data("annotation_source");

        const examples = [
            "Blotched Dusky-blue",
            "Cooktown Azure",
            "Forest Brown"
        ].map(name => rows.find(row => row.CommonName === name));

        if (examples.some(row => !row)) return;

        const months = row => listLabel(
            String(row.NewMonths)
                .split(",")
                .map(value => value.trim())
        );

        const [first, second, third] = examples;

        const comparison = first.NewMonths === second.NewMonths
            ? `${first.CommonName} and ${second.CommonName} both add ${months(first)}.`
            : `${first.CommonName} adds ${months(first)}; ${second.CommonName} adds ${months(second)}.`;

        const filter = spec.transform.find(transform =>
            typeof transform.filter === "string" &&
            transform.filter.includes("species_rank")
        );

        const limit = Number(
            filter?.filter.match(/<=\s*(\d+)/)?.[1]
        );

        const shown = Number.isFinite(limit)
            ? Math.min(limit, rows.length)
            : rows.length;

        showAnnotation(
            box,
            "Shared blocks, different seasonal windows",
            `${comparison} ${third.CommonName} adds ${months(third)}. New seasonal records cluster differently between species.`,
            `Showing ${numberLabel(shown)} of ${numberLabel(rows.length)} species, selected for the largest month additions. Outlines identify the compared records; pale cells do not establish absence.`
        );
    }

    if (id === "chart6") {
        const rows = data("taxa")
            .filter(row => row.epbc_status_code === "CR");

        const single = rows
            .filter(row => row.jurisdiction_count === 1)
            .length;

        if (!rows.length) return;

        showAnnotation(
            box,
            "Critical threat and a single listed jurisdiction",
            `${numberLabel(single)} of the ${numberLabel(rows.length)} Critically Endangered taxa have just one listed jurisdiction association.`,
            "Outlined ribbons show these pathways. One jurisdiction association does not establish a small range or occurrence nowhere else.",
            view.scale("riskColour")("CR")
        );
    }

    if (id === "chart7") {
        const rows = data("taxa")
            .filter(row => row.jurisdiction_count > 1);

        const shared = rows
            .filter(row => row.members.includes("NSW"))
            .length;

        if (!rows.length) return;

        showAnnotation(
            box,
            "NSW links the shared-jurisdiction combinations",
            shared === rows.length
                ? `All ${numberLabel(rows.length)} taxa associated with multiple jurisdictions include NSW in their listed combinations.`
                : `${numberLabel(shared)} of ${numberLabel(rows.length)} taxa associated with multiple jurisdictions include NSW in their listed combinations.`,
            "Outlined NSW dots mark that shared association. Combinations describe listings; they are not evidence of movement between jurisdictions."
        );
    }

    if (id === "chart8") {
        const rows = data("jurisdictions");
        const wa = rows.find(row => row.state_abbreviation === "WA");
        const nsw = rows.find(row => row.state_abbreviation === "NSW");

        if (!wa?.total || !nsw?.total) return;

        showAnnotation(
            box,
            "Read the share and the count together",
            `WA has ${numberLabel(wa.total)} listed taxa, including ${numberLabel(wa.cr)} Critically Endangered (${percentLabel(wa.cr / wa.total)}). NSW has ${numberLabel(nsw.total)}, including ${numberLabel(nsw.cr)} Critically Endangered (${percentLabel(nsw.cr / nsw.total)}).`,
            wa.total < nsw.total && wa.cr > nsw.cr
                ? "WA has fewer listed taxa overall, yet more Critically Endangered taxa. A larger count and a larger threat-category share need not occur in the same jurisdiction."
                : "Counts and threat-category shares describe different aspects of the listing extract."
        );
    }

    if (id === "chart9") {
        const taxa = new Map();

        for (const row of data("associations")) {
            if (!taxa.has(row.taxon_id)) {
                taxa.set(row.taxon_id, new Set());
            }

            taxa.get(row.taxon_id).add(row.state_abbreviation);
        }

        const summary = state => {
            const members = [...taxa.values()]
                .filter(states => states.has(state));

            return {
                total: members.length,
                shared: members.filter(states => states.size > 1).length
            };
        };

        const nsw = summary("NSW");
        const tas = summary("TAS");

        if (!nsw.total || !tas.total) return;

        showAnnotation(
            box,
            "Similar circles, different association patterns",
            `NSW and Tasmania have ${numberLabel(nsw.total)} and ${numberLabel(tas.total)} listed taxa. ${numberLabel(nsw.shared)} NSW taxa are shared with other jurisdictions; ${tas.shared === 0 ? `all ${numberLabel(tas.total)} Tasmanian taxa are associated only with Tasmania` : `${numberLabel(tas.shared)} Tasmanian taxa are shared`} in this extract.`,
            "The outlined circles highlight this comparison. A Tasmania-only listing association does not establish that a taxon occurs nowhere else."
        );
    }

    if (id === "chart10") {
        const rows = data("taxa");
        const selected = view.signal("selectedTaxon");

        if (selected) {
            const row = rows.find(taxon => taxon.taxon_id === selected);

            if (!row) return;

            const count = row.jurisdiction_count;
            const connections = count * (count - 1) / 2;

            showAnnotation(
                box,
                "One taxon can produce several connections",
                `${row.display_name} is associated with ${numberLabel(count)} jurisdictions (${row.jurisdiction_text}). Joining every pair produces ${numberLabel(connections)} ${connections === 1 ? "connection" : "connections"} for this one taxon.`,
                "Curves show shared listing associations, not migration routes. Choose All taxa to restore the comparison with unconnected jurisdictions.",
                view.scale("taxonColour")(selected)
            );
        } else {
            const local = rows.filter(row => {
                const states = row.association_rows
                    .map(item => item.state_abbreviation);

                return states.length === 1 &&
                    ["WA", "TAS"].includes(states[0]);
            }).length;

            if (!rows.length) return;

            showAnnotation(
                box,
                "No connections does not mean no listed taxa",
                `WA and Tasmania together contain ${numberLabel(local)} of the ${numberLabel(rows.length)} nationally listed taxa (${percentLabel(local / rows.length)}) with single-jurisdiction associations. These taxa generate no coloured connections.`,
                "This map displays taxa shared between jurisdictions. An unconnected region can still contain listed insects."
            );
        }
    }

    if (id === "chart11") {
        const rows = data("orders");
        const selected = view.signal("selectedOrder");

        const bugs = rows.find(row => row.order === "Hemiptera");
        const butterflies = rows.find(row => row.order === "Lepidoptera");

        if (!bugs || !butterflies) return;

        const ala = row => numberLabel(row.ala_species_1875_2014);

        const targeted = row => numberLabel(
            row.targeted_survey_species_2014_2015
        );

        const note =
            "The methods differ in duration, effort and coverage. Connecting lines compare recording sources, not population change or method performance.";

        if (!selected) {
            showAnnotation(
                box,
                "Different sources reveal different parts of the community",
                `The targeted survey records ${targeted(bugs)} true-bug species against ${ala(bugs)} in the ALA table. Butterflies and moths show the reverse: ${targeted(butterflies)} versus ${ala(butterflies)}.`,
                note
            );
        } else {
            const row = rows.find(order => order.order === selected);

            if (!row) return;

            const colour = view.scale("colour")(row.colour_key);

            showAnnotation(
                box,
                `${row.common_group}: a comparison of recording sources`,
                `ALA records contain ${ala(row)} species, the BioBlitz records ${numberLabel(row.melbourne_bioblitz_species_2014)}, and the targeted survey records ${targeted(row)}. ${Number(row.targeted_survey_species_2014_2015) > Number(row.ala_species_1875_2014) ? "The targeted survey documents species richness not fully represented in the longer-running ALA table." : "Differences across these axes describe what each source recorded; they do not show a decline over time."}`,
                note,
                colour
            );
        }
    }

    if (id === "chart12") {
        const rows = data("habitats");
        const lawn = rows.find(row => row.habitat_type === "Lawn");
        const others = rows.filter(row => row.habitat_type !== "Lawn");

        if (!lawn || !others.length) return;

        if (view.signal("displayMode") === "percent") {
            const shares = others.map(row => row.unique_share);

            showAnnotation(
                box,
                "Different habitats contribute distinct recorded species",
                `In ${listLabel(others.map(row => row.habitat_type.toLowerCase()))} habitats, ${percentLabel(Math.min(...shares))}–${percentLabel(Math.max(...shares))} of species were recorded only in that habitat, compared with ${percentLabel(lawn.unique_share)} in lawn.`,
                "Outlined dark segments show the non-lawn shares. 'Only in this habitat' refers to this historical local survey, not an exclusive biological requirement."
            );
        } else {
            showAnnotation(
                box,
                "A smaller total can still add distinct species",
                `Lawn contributes ${numberLabel(lawn.unique_species)} species not recorded in the other ${numberLabel(others.length)} habitat types. Its lower recorded richness still contributes to the survey's combined diversity.`,
                "The outlined lawn segment identifies these records. Switch to percentages to compare how much of each habitat's recorded richness was found only there."
            );
        }
    }
}

async function mountChart(id, path) {
    const element = document.getElementById(id);
    const isMap = ["chart8", "chart9", "chart10"].includes(id);
    const response = await fetch(path);

    if (!response.ok) {
        throw new Error(`${path}: HTTP ${response.status}`);
    }

    const original = await response.json();
    const annotation = createAnnotation(element);

    const annotationRows = ["chart2", "chart3", "chart4"].includes(id)
        ? await loadAnnotationRows(original.data.url)
        : null;

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
    let renderQueue = Promise.resolve();

    const taxonControl = id === "chart10"
        ? document.getElementById("chart10-taxon")
        : null;

    const orderControl = id === "chart11"
        ? document.getElementById("chart11-order")
        : null;

    const habitatMeasureControl = id === "chart12"
        ? document.getElementById("chart12-measure")
        : null;

    if (habitatMeasureControl) {
        habitatMeasureControl.addEventListener("change", () => {
            if (currentEmbed) {
                currentEmbed.view
                    .signal("displayMode", habitatMeasureControl.value)
                    .runAsync()
                    .catch(error =>
                        console.error("Error changing the habitat measure:", error)
                    );
            }
        });
    }

    if (orderControl) {
        orderControl.addEventListener("change", () => {
            if (currentEmbed) {
                currentEmbed.view
                    .signal("selectedOrder", orderControl.value || null)
                    .runAsync()
                    .catch(error =>
                        console.error("Error selecting an order:", error)
                    );
            }
        });
    }

    if (taxonControl) {
        taxonControl.addEventListener("change", () => {
            if (currentEmbed) {
                currentEmbed.view
                    .signal("selectedTaxon", taxonControl.value || null)
                    .runAsync()
                    .catch(error =>
                        console.error("Error selecting a taxon:", error)
                    );
            }
        });
    }

    function render() {
        // Serialise resize requests so two embeds cannot overwrite each other.
        renderQueue = renderQueue.catch(() => {}).then(renderChart);
        return renderQueue;
    }

    async function renderChart() {
        const width = Math.floor(element.clientWidth);

        if (width <= 0 || width === lastWidth) {
            return;
        }

        lastWidth = width;

        const spec = structuredClone(original);
        prepareAnnotations(id, spec);

        if (id === "chart4") {
            placeChart4Annotation(spec, width, annotationRows);
        }

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
                spec.height = width < 600
                    ? (width < 400 ? 660 : 780)
                    : 610;
            }

            if (id === "chart9") {
                spec.height = width < 600
                    ? (width < 400 ? 760 : 850)
                    : 650;
            }

            if (id === "chart10") {
                spec.height = width < 800
                    ? Math.round(
                        Math.max(300, Math.min(460, width * 0.75 + 100)) + 550
                    )
                    : 650;

                const selection = spec.signals.find(
                    signal => signal.name === "selectedTaxon"
                );

                if (selection && taxonControl) {
                    selection.value = taxonControl.value || null;
                }
            }

            if (id === "chart11") {
                spec.height = width < 600 ? 760 : 650;

                const selection = spec.signals.find(
                    signal => signal.name === "selectedOrder"
                );

                if (selection && orderControl) {
                    selection.value = orderControl.value || null;
                }
            }

            if (id === "chart12") {
                spec.height = width < 600 ? 530 : 450;

                const measure = spec.signals.find(
                    signal => signal.name === "displayMode"
                );

                if (measure && habitatMeasureControl) {
                    measure.value = habitatMeasureControl.value;
                }
            }

            spec.autosize = {
                type: isMap || ["chart11", "chart12"].includes(id)
                    ? "none"
                    : "fit-x",
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

        if (id === "chart3" && width < 430) {
            Object.assign(spec.encoding.x.axis, {
                labelAngle: -45,
                labelFontSize: 9,
                labelPadding: 5
            });

            spec.encoding.y.axis.labelLimit = 110;

            Object.assign(spec.encoding.color.legend, {
                columns: 1,
                direction: "vertical",
                labelLimit: 160,
                labelExpr:
                    "datum.label === 'Newly documented month' ? 'New month' : datum.label"
            });
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

        const refreshAnnotation = () => {
            try {
                updateAnnotation(
                    id,
                    annotation,
                    result.view,
                    spec,
                    annotationRows
                );
            } catch (error) {
                console.error(`Error updating ${id} annotation:`, error);

                if (annotation) {
                    annotation.element.hidden = true;
                }
            }
        };

        refreshAnnotation();

        for (const signal of id === "chart10"
            ? ["selectedTaxon"]
            : id === "chart11"
                ? ["selectedOrder"]
                : id === "chart12"
                    ? ["displayMode"]
                    : []
        ) {
            result.view.addSignalListener(signal, refreshAnnotation);
        }

        if (orderControl) {
            const selected = result.view.signal("selectedOrder");
            const options = [new Option("All orders", "")];

            for (const order of result.view.data("orders")) {
                options.push(new Option(
                    `${order.common_group} (${order.order})`,
                    order.order
                ));
            }

            orderControl.replaceChildren(...options);
            orderControl.value = selected || "";

            result.view.addSignalListener("selectedOrder", (name, value) => {
                orderControl.value = value || "";
            });
        }

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
    installAnnotationStyles();

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
        ["chart10", "specs/chart10_conservation_connections.json"],
        ["chart11", "specs/chart11_survey_methods.json"],
        ["chart12", "specs/chart12_habitat_richness.json"]
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