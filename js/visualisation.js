// ============================================================
// Chart 1 — Butterfly diversity captured by citizen science
// ============================================================

vegaEmbed(
    "#chart1",
    "specs/chart1_waffle.json",
    {
        actions: false
    }
)
.then(function () {
    console.log("Chart 1 loaded successfully.");
})
.catch(function (error) {
    console.error("Error loading Chart 1:", error);
});


// ============================================================
// Chart 2 — Newly documented seasonal records by month
// ============================================================

vegaEmbed(
    "#chart2",
    "specs/chart2_seasonal.json",
    {
        actions: false
    }
)
.then(function () {
    console.log("Chart 2 loaded successfully.");
})
.catch(function (error) {
    console.error("Error loading Chart 2:", error);
});