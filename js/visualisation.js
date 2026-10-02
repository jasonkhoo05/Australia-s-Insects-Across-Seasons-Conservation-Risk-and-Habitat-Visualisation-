// All observations and counts come from the CSV URLs in the JSON specs.
// Numeric constants below control layout only.

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
    const response = await fetch(path);

    if (!response.ok) {
        throw new Error(`${path}: HTTP ${response.status}`);
    }

    const original = await response.json();

    let currentView;
    let lastWidth = -1;
    let timer;

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

            spec.autosize = {
                type: "fit-x",
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

        if (currentView) {
            currentView.finalize();
        }

        const result = await vegaEmbed(element, spec, {
            actions: false,
            renderer: "svg",
            mode: isVega ? "vega" : "vega-lite"
        });

        currentView = result.view;
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
        ["chart5", "specs/chart5_conservation_treemap.json"]
    ];

    await Promise.all(
        charts.map(async ([id, path]) => {
            try {
                await mountChart(id, path);
            } catch (error) {
                console.error(`Error loading ${id}:`, error);

                document.getElementById(id).textContent =
                    "This chart could not load. Check the JSON and CSV paths.";
            }
        })
    );
}

initialiseCharts();