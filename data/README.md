# FIT3179 Data Visualisation 2 — Australian Insect Diversity Data Package

Prepared: 23 September 2026

This package contains only traceable real-world data or transparent deterministic summaries.
No synthetic observations have been added.

## Recommended PRIMARY sources

### 1) DCCEEW — current national conservation data
Use:
- `dcceew_threatened_insects_2026.csv`
- `dcceew_threatened_insects_with_order_2026.csv`
- `dcceew_threatened_insects_by_order_2026.csv`
- `combined_threatened_insects_by_state_2026.csv`
- `combined_threatened_insects_state_summary_2026.csv`

The source snapshot is the Australian Government EPBC threatened-species state list dated **6 February 2026**.
There are **28 Class=Insecta listed taxa** in this extract: 13 Critically Endangered, 10 Endangered and 5 Vulnerable.

`order_derived_from_family` is an explicitly derived taxonomy convenience field; the source-like file without this derived field is retained.

### 2) iNaturalist / Backstrom (2026) — national butterfly seasonality and distribution
Use:
- `inaturalist_butterfly_study_summary_2026.csv`
- `inaturalist_out_of_season_species_2026.csv`
- `inaturalist_out_of_season_month_summary_2026.csv`

The peer-reviewed study downloaded Australian butterfly observations from iNaturalist on **3 February 2026**,
restricted them to Research Grade observations identified to species level or lower, and used observations made
before **1 January 2026**.

Published totals:
- 296,749 observations
- 393 observed butterfly species
- 462-species Australian baseline after taxonomic alignment
- 85.1% of the baseline fauna represented
- 84 species with likely range extensions
- 17 species with likely range expansions
- 41 species with vagrant records

The out-of-season species file is based directly on the authors' published `Data/OutOfSeasonsSheet.csv`.
The month-summary file is only a deterministic count of that file, not a new biological observation dataset.

Paper: Backstrom, L. J. (2026), *New Insights Into the Distribution of Australian Butterflies
(Lepidoptera: Papilionoidea) Provided by Citizen Science*, Austral Entomology.
DOI: 10.1111/aen.70067

Repository: https://github.com/Louis-Backstrom/AEN-Paper

## Supporting geography
`abs_state_codes_2026.csv` contains current ASGS Edition 4 state/territory identifiers (released 22 July 2026).

A full ABS state boundary shapefile is deliberately NOT bundled because the original file is much larger than needed
for the assignment. Use a simplified boundary/TopoJSON in the final site.

## Optional historical urban case study
The `city_melbourne_*` files are retained as optional supporting material. They are useful for explaining insect-order
diversity, habitat complexity and survey-method bias, but they are **not current national data** and should not be used
as the main evidence for Australia-wide claims.

## Recommended story using this package

**Australia's insects: diversity, seasonality and conservation risk**

1. Introduce insect diversity and explain that observation datasets reflect recording effort as well as ecology.
2. Use the 2026 butterfly study to show how citizen science has documented 393 species and uncovered observations
   outside previously documented seasonal windows.
3. Use the month summary as a seasonality/phenology story — phrase it as *newly documented out-of-season months*,
   not as population change.
4. Move to conservation: compare the 28 nationally EPBC-listed insect taxa by order and threat status.
5. Map state/territory occurrence of nationally listed taxa using DCCEEW state fields.
6. Use the optional Melbourne material only as a local example of how habitat and survey method affect what is recorded.

## Important interpretation rules

- Occurrence/observation count is **not population size**.
- A rise in records can reflect increased participation, digitisation or survey effort.
- DCCEEW state presence is indicative distribution for listed taxa, not abundance.
- The out-of-season file identifies newly documented months relative to prior documented seasons; it does not by itself
  prove climate-driven phenological change.
- Keep 2026 partial-year observations out of full-year trend comparisons unless explicitly labelled YTD.

## Why the raw iNaturalist observations are not bundled

The study's raw observation exports are tens of megabytes, which conflicts with the FIT3179 requirement that the
web visualisation's downloadable data remain below a few MB. This package therefore keeps the small, author-published
derived seasonality file and small summaries needed for Vega-Lite.

## Source URLs

DCCEEW:
https://data.gov.au/data/dataset/ae652011-f39e-4c6c-91b8-1dc2d2dfee8f

Backstrom (2026) article:
https://doi.org/10.1111/aen.70067

Backstrom data/code:
https://github.com/Louis-Backstrom/AEN-Paper

ABS ASGS Edition 4:
https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs/edition-4-july-2026-june-2031/access-and-downloads/digital-boundary-files

City of Melbourne optional case study:
https://discover.data.vic.gov.au/dataset/insect-records-in-the-city-of-melbourne-from-little-things-that-run-the-city
