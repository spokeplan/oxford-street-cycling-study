# Committed inputs

Geofabrik removes dated extracts after a while and the DfT republishes its count files every year, so the study's raw inputs are committed here. With them every step except the optional Valhalla run and the LAEI matching (see below) reproduces the published results without downloading anything.

| File | Size | Source | Licence |
|---|---|---|---|
| `greater-london-261107-study-area.osm.pbf` | 10.1 MB | osmium bbox cut of Geofabrik's Greater London extract of 2026-11-07, `greater-london-261107.osm.pbf` (<https://download.geofabrik.de/europe/united-kingdom/england/greater-london.html>; OSM replication timestamp 2026-11-07T21:21:36Z, see `results/extract-info.json`) | ODbL 1.0, © OpenStreetMap contributors |
| `dft/dft_{countpoints,aadf,aadfbydirection}_local_authority_id_{109,145}.csv` (6 files) | 3.2 MB together | DfT Road Traffic Statistics, Westminster (109) and Camden (145), fetched 2026-11-08 from <https://storage.googleapis.com/dft-statistics/road-traffic/downloads/> (URLs and Last-Modified dates in `results/dft/source.json`) | Open Government Licence v3.0 |
| `published-counts/counts.csv`, `other-figures.csv`, `README.md` | 0.14 MB together | Motor-vehicle counts on single streets published by TfL (Active Travel Counts Programme), the London Borough of Camden and Westminster City Council, compiled by hand: `counts.csv`, one row per count site with publisher, document, URL, page and terms, used by the best-evidence run (`docs/lts.md`); `other-figures.csv`, figures kept for reference and not used; `README.md`, the rules and the sources | TfL open data terms (Powered by TfL Open Data); Camden and Westminster figures quoted with a citation, no open licence (`DATA-LICENSES.md`) |
| `spokeplan-routes/hammersmith-russell-square-{road,city}.geojson`, `README.md` | 0.03 MB together | Two routes from Hammersmith to Russell Square returned by SpokePlan's production routing API on 16 November 2026 (its Road and City presets, default speed and mass, no via points), saved as returned, drawn by the `long-trip` figure. SpokePlan's own output: this repository cannot reproduce them. `README.md` gives the two request URLs | SpokePlan output; the routes follow OpenStreetMap data (ODbL 1.0, © OpenStreetMap contributors) |
| `SHA256SUMS` | | SHA-256 of every file above and of two downloads that are not committed: the full extract `greater-london-261107.osm.pbf` (130 MB) and the LAEI 2022 traffic flows `LAEI2022-Traffic-Flows-and-Speeds-Major-and-Minor-Roads-GIS.zip` (11.5 MB) | |

Check them with `sha256sum -c --ignore-missing SHA256SUMS` inside this directory (the two downloads are listed but not present).

## The LAEI traffic flows are downloaded, not committed

The best-evidence run also reads modelled flows from the London Atmospheric Emissions Inventory (LAEI) 2022. Its road links appear to be Ordnance Survey MasterMap geometry, and the publisher does not say whether that geometry may be redistributed (`DATA-LICENSES.md`), so no part of the archive is committed. `bun run reproduce:laei` downloads it from the London Datastore into `data/laei/` (checked against `SHA256SUMS`), matches its links to OSM ways and writes `results/laei/`. Those results are committed, so `reproduce:inputs` and `reproduce:lts` run without the download.

## The study-area cut

`bun scripts/make-inputs.ts` builds the cut and this directory from the downloaded data: `osmium extract -s complete_ways` with the study bbox (`BBOX` in `scripts/lts/common.ts`) widened by `INPUT_MARGIN_DEG` on every side (`scripts/make-inputs.ts`), so every way with a node in the area is kept with all its nodes. Every OSM step reads only ways inside that area: `scripts/lts/extract-graph.ts` cuts the same `BBOX` (complete ways) from the scenario extract, and `scripts/retag-scenario.ts` selects Oxford Street and Wigmore Street ways inside bboxes that lie within it. So the cut gives the same way GeoJSON, change files and results as the full extract.

The change files (`data/*.osc`), the street selections (`data/oxford-street-ways.osm`, `data/wigmore-street-ways.osm`) and `data/full-closure-sealed-extra-ways.osm` are outputs of `scripts/retag-scenario.ts`, regenerated from the extract, so they are not inputs. The retagged way ids are recorded in `results/scenario-*.json`.

## Running from the inputs

```sh
bun run reproduce:inputs   # copies the cut and the DfT CSVs into data/ (checked against SHA256SUMS), builds the scenarios, matches the DfT and published counts
bun run reproduce:lts
```

`bun scripts/download-extract.ts --from-inputs` writes the cut to `data/greater-london-latest.osm.pbf`, the name every later step reads, and leaves `results/extract-info.json` (the provenance of the full extract) unchanged. `bun scripts/dft/download.ts --from-inputs` copies the CSVs into `data/dft/` and leaves `results/dft/source.json` unchanged. The normal downloads (`bun run reproduce:data`) check the fetched files against the same sums and stop on a mismatch.

## Valhalla needs the full extract

The Valhalla results were built from the full Greater London extract. `bun run reproduce:valhalla` (`valhalla/run-all.ts`) therefore stops before starting any container when `data/greater-london-latest.osm.pbf` is the cut (its SHA-256 equals the cut's line in `SHA256SUMS`), or when `data/greater-london-wigmore-track.osm.pbf` or `data/greater-london-full-closure.osm.pbf` is missing or older than it: those were retagged from an earlier extract, for example from the cut by `reproduce:inputs`. So after `reproduce:inputs`, run `bun run reproduce:data` (full extract, then the scenarios) before `reproduce:valhalla`; downloading the extract alone is not enough. The full extract must come from Geofabrik (`bun scripts/download-extract.ts`, while Geofabrik still serves `greater-london-261107.osm.pbf`) or from the repository's release asset once published (`RELEASE_ASSET_URL` in `scripts/download-extract.ts`, a TODO until the repository URL is known); either way it must match its line in `SHA256SUMS`.
