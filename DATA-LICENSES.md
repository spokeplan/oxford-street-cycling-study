# Data licences and attribution

`LICENSE` (MIT) covers the scripts and documentation written for this study. It does not cover the data below, which keep their own licences.

## OpenStreetMap

Map data © OpenStreetMap contributors, available under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/) (ODbL). See <https://www.openstreetmap.org/copyright>.

The committed study-area cut (`inputs/greater-london-261107-study-area.osm.pbf`, an osmium bbox extract of the Geofabrik file below, see `inputs/README.md`), the scenario extracts (`data/greater-london-*.osm.pbf`, built by `scripts/retag-scenario.ts`), the retagged way lists (`results/scenario-*.json`), the classified way GeoJSON (`data/lts/*-ways-lts-*.geojson`), the route and gap-closing GeoJSON (`results/lts/**/*.geojson`), all CSVs under `results/lts/` and the Valhalla results (`results/valhalla/`) are derived from OpenStreetMap data. They are derivative databases and are offered under the ODbL 1.0, with the attribution above.

Some of these files also carry DfT traffic volumes (see below): `results/dft/countpoints-matched.csv` (DfT count points matched to OSM way ids), the furth2017 classified way GeoJSON (`data/lts/*-ways-lts-furth2017-*.geojson`, not committed but produced by `scripts/lts/classify.ts`) and every output under `results/lts/furth2017-*/` (the per-street tables `street-lts.csv` with columns `adt` and `adt_source`, the route summaries and GeoJSON, the gap-closing and frontier CSVs) plus `results/lts/gap-closing-summary.csv` and `results/lts/detour-summary.csv`, whose LTS classes (or snap nodes) depend on those volumes. These files contain OGL v3.0 data (DfT) and ODbL data (OSM); use must satisfy both.

## Geofabrik

The OpenStreetMap extract is the Geofabrik Greater London extract of 2026-11-07 (`greater-london-261107.osm.pbf`), from <https://download.geofabrik.de/europe/united-kingdom/england/greater-london.html>. Geofabrik provides it free of charge and states that all OpenStreetMap-derived data on its download server is licensed under the ODbL 1.0 ([download terms](https://www.geofabrik.de/data/download.html)). Provenance: `results/extract-info.json`. Geofabrik removes dated extracts after a while, so a cut of it covering the study area is committed in `inputs/` (ODbL 1.0, © OpenStreetMap contributors); its SHA-256 and that of the full extract are in `inputs/SHA256SUMS`.

## Department for Transport road traffic statistics

Contains public sector information licensed under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/). Source: Department for Transport, Road Traffic Statistics, <https://roadtraffic.dft.gov.uk/>.

Used: count points and annual average daily flows for Westminster and Camden (files, Last-Modified dates and SHA-256 in `results/dft/source.json`), fetched 2026-11-08 from <https://storage.googleapis.com/dft-statistics/road-traffic/downloads/>. The DfT republishes these files every year, so the six CSVs are redistributed unmodified in `inputs/dft/` under the Open Government Licence v3.0, with the attribution above.

## London Atmospheric Emissions Inventory (LAEI) 2022

Contains public sector information licensed under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/). Source: London Atmospheric Emissions Inventory (LAEI) 2022, Greater London Authority and Transport for London, London Datastore, <https://data.london.gov.uk/dataset/london-atmospheric-emissions-inventory-laei-2022-2lg5g>.

Used by the best-evidence run only: the major-roads traffic flows, `LAEI2022-Traffic-Flows-and-Speeds-Major-and-Minor-Roads-GIS.zip`, fetched 2026-11-14 (URL, Last-Modified date and SHA-256 in `results/laei/source.json`; the SHA-256 is also in `inputs/SHA256SUMS`).

The archive is not redistributed here. The dataset page states the Open Government Licence v3.0 and nothing else. But the road links are keyed by Ordnance Survey MasterMap Highways Network identifiers (TOIDs), the LAEI 2022 Methodology Report names OS MasterMap Highways as a source, and neither says whether the link geometry may be passed on. The Open Government Licence does not cover third-party rights that the publisher is not authorised to license. So `bun run reproduce:laei` downloads the archive from the London Datastore and checks it against its SHA-256.

The repository holds only values derived from it, without LAEI geometry: per OSM way, the matched flow, the share of the way the links cover, the lowest and highest link flow and the identifiers of the links (`results/laei/ways-matched.csv`), and the checks built on it (`results/laei/dft-comparison.csv`, `published-comparison.csv`, `comparison-summary.csv`, `streets.csv`, `minor-high-flow.csv`, `outliers.csv`). The outputs of the best-evidence run (`results/lts/sensitivity/best-evidence/`, its rows of `results/lts/sensitivity-summary.csv` and the side comparison, `results/lts/sensitivity/side-comparison*`) depend on these flows. All of them combine OGL v3.0 data (LAEI, DfT) with ODbL data (OSM). Use must satisfy both.

## Published traffic counts

`inputs/published-counts/counts.csv` holds motor-vehicle counts on single streets, taken from data and documents that Transport for London, the London Borough of Camden and Westminster City Council have published. Each row names its publisher, the document, its URL and page, and the terms it was published under (columns `publisher`, `document`, `url`, `page`, `licence`). `inputs/published-counts/README.md` describes every source. In short:

- Transport for London, Active Travel Counts Programme: TfL's Transport Data Service licence, based on the Open Government Licence. Powered by TfL Open Data.
- London Borough of Camden monitoring reports: no licence stated. The counts are quoted with a citation.
- Westminster City Council, Soho Monitoring Study: no open licence (Westminster's website terms). The counts are quoted with a citation.

`results/published-counts/counts-matched.csv` repeats the counts with the OSM way each is matched to (ODbL). The best-evidence run uses them.

## Figure basemap: OpenFreeMap and OpenMapTiles

The figures in `figures/` are drawn on vector tiles from [OpenFreeMap](https://openfreemap.org) (style `positron`, <https://tiles.openfreemap.org/styles/positron>, no API key), built on the [OpenMapTiles](https://openmaptiles.org) schema from OpenStreetMap data. OpenFreeMap asks for the attribution "OpenFreeMap © OpenMapTiles Data from OpenStreetMap"; each figure carries "© OpenStreetMap contributors · basemap © OpenFreeMap, OpenMapTiles". The Positron style derives from the OpenMapTiles Positron GL style (code BSD-3-Clause, design CC BY 4.0), which its LICENSE.md describes as derived from "CartoDB Basemaps", "designed by Stamen and Paul Norman for CartoDB Inc." Map labels use the Noto Sans glyphs served by OpenFreeMap (SIL Open Font License 1.1). Tiles, style and glyphs are fetched at render time and not redistributed here.

The figures themselves are offered under CC BY 4.0 with that attribution line (see README, "Figures").

## Software

- **Valhalla**, open-source routing engine, MIT licence, <https://github.com/valhalla/valhalla>. Run unmodified from the `ghcr.io/gis-ops/docker-valhalla/valhalla` image (Valhalla 3.5.1, pinned by digest in `valhalla/run.ts`).
- **MapLibre GL JS** 6.16.0, BSD-3-Clause, <https://github.com/maplibre/maplibre-gl-js>. Loaded unmodified from <https://unpkg.com/maplibre-gl@6.16.0/> by the figure pages (`scripts/figures/render.ts`); not redistributed here.
- **Playwright**, Apache-2.0, <https://github.com/microsoft/playwright>. A dev dependency that installs the headless Chromium used to render the figures.
- **osmium-tool**, GPL-3.0, <https://github.com/osmcode/osmium-tool>. Run unmodified from the `stefda/osmium-tool` Docker image (pinned by digest in `scripts/lts/common.ts`); not redistributed here.
- **BikeOttawa stress model**, MIT licence (`LICENSE`, copyright 2018 BikeOttawa; its `package.json` declares ISC), <https://github.com/BikeOttawa/stressmodel>, commit [`a0fdab9`](https://github.com/BikeOttawa/stressmodel/tree/a0fdab9e5b9319b16e2ddf16602aa7fa944ecff3). Its rules were ported to TypeScript for this study (`scripts/lts/classify.ts`, BikeOttawa rule ids kept); see `docs/lts.md` for every rule and the UK adaptations, and the licence notice below.

## BikeOttawa stress model licence

The LTS rules in `scripts/lts/classify.ts` are ported from the BikeOttawa stress model (<https://github.com/BikeOttawa/stressmodel>), which carries this notice:

```text
MIT License

Copyright (c) 2018 BikeOttawa

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Methods cited

- Maaza C. Mekuria, Peter G. Furth and Hilary Nixon, *Low-Stress Bicycling and Network Connectivity*, Mineta Transportation Institute Report 11-19, May 2012. <https://transweb.sjsu.edu/research/Low-Stress-Bicycling-and-Network-Connectivity> ([PDF](https://transweb.sjsu.edu/sites/default/files/1005-low-stress-bicycling-network-connectivity.pdf)).
- Peter G. Furth, *Level of Traffic Stress Criteria for Road Segments*, version 2.0, June 2017. <https://peterfurth.sites.northeastern.edu/files/2014/05/LTS-Tables-v2-June-1.pdf> (linked from <https://peterfurth.sites.northeastern.edu/2014/05/21/criteria-for-level-of-traffic-stress/>).

The criteria tables are transcribed in `docs/lts.md` for reference and remain the work of their authors.
