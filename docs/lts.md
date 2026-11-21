# Level of Traffic Stress (LTS) cross-check

An open, rule-based definition of a cautious rider, used as a second opinion next to Valhalla.

- **Rules source:** BikeOttawa stress model, `stressmodel.js` (daylight model v1.0.1), <https://github.com/BikeOttawa/stressmodel/blob/a0fdab9e5b9319b16e2ddf16602aa7fa944ecff3/stressmodel.js> (commit `a0fdab9e5b9319b16e2ddf16602aa7fa944ecff3`, 2022-03-11). That model in turn implements the Mekuria/Furth/Nixon LTS criteria (Mineta Transportation Institute report 11-19, 2012).
- **Tables:** `--table bikeottawa` (default) uses BikeOttawa's mixed-traffic rules. `--table mekuria2012` swaps only the mixed-traffic block for the original report's Table 4 (section 4b). `--table furth2017-low` and `--table furth2017-high` swap only the mixed-traffic block for Furth's volume-based LTS 2.0 table (section 4c), with low or high default volumes. Permission and separated-path rules are the same in all tables, since BikeOttawa implements the report's path criteria. BikeOttawa's bike-lane rules apply under `bikeottawa` and `mekuria2012`; under the furth2017 tables a painted lane without physical separation is rated by the mixed-traffic table instead (section 3).
- **Code:** `scripts/lts/classify.ts`. Rule ids `p*`, `s*`, `b*`, `c*`, `m*` are BikeOttawa's. Rows marked **UK** are adaptations made for this study.
- Rules are checked in table order: permission, then separated path, then (furth2017 tables only) painted lane rated as mixed traffic, then bike lane, then mixed traffic. The first match wins. Inside the bike-lane blocks the highest LTS reached wins.
- Speeds are in km/h, as in BikeOttawa. A `maxspeed` given in mph is converted (1 mph = 1.609344 km/h), so 20 mph = 32.2 km/h and 30 mph = 48.3 km/h.

## Scenarios

- `today`: the extract as downloaded (`data/greater-london-latest.osm.pbf`, which is Geofabrik's dated extract of 2026-11-07, `greater-london-261107.osm.pbf`, saved under that name by `scripts/download-extract.ts`; `--from-inputs` puts the committed study-area cut of it there instead, which gives byte-identical LTS results, see `inputs/README.md`): Oxford Street pedestrianised with no cycling from Orchard Street to just east of Oxford Circus, still `highway=primary` west to Marble Arch and east to Tottenham Court Road.
- `wigmore-track`: `today` with every Wigmore Street way tagged `cycleway=track` (`bun scripts/retag-scenario.ts wigmore-track`).
- `full-closure`: `today` with the rest of Oxford Street closed too. The full-length closure is **this study's assumption**, not a published scheme. It is derived from the Oxford Street Development Corporation's brief for a Whole Street Concept Design, which covers the whole street from Marble Arch to Tottenham Court Road, and from the fact that the first phase (the pedestrianised length in `today`) bans cycling. So every still-rideable Oxford Street carriageway way (`highway` primary to residential, including the `vehicle=no` `primary_link` pieces at Oxford Circus) between lon −0.1595 and −0.1295 becomes `highway=pedestrian`, `bicycle=dismount`, `motor_vehicle=no`, with its `oneway`, `lanes`, `cycleway*`, `bus`, `psv` and `vehicle:conditional` tags removed (`bun scripts/retag-scenario.ts full-closure`; way ids in `results/scenario-full-closure.json`). Only Oxford Street ways are retagged: every cross-street stays open and meets the closed street at shared nodes, so a rider can still cross it there. Three short unnamed median links also cross the closed carriageway and stay rideable: way 1199406460 (`tertiary_link`, Wardour Street → Berners Street), way 1199406459 (`unclassified`, Wells Street → Berwick Street) and way 728793127 (`service`, Great Titchfield Street ↔ Ramillies Street); `full-closure-sealed` closes them. The retagged ways also stop donating their DfT count to neighbouring ways with the same `ref` (the Marble Arch trunk ways fall back to class-default volumes), so volumes change in the furth2017 tables, but no LTS class does. Trip end B (at the Tottenham Court Road junction) is not moved: it already lies on the first Charing Cross Road way, so it snaps to the same Charing Cross Road node as in `today` (about 17 m away in the LTS graph).
- `full-closure-sealed`: sensitivity variant of `full-closure` in which the three median links above are retagged like the closed street (`highway=pedestrian`, `bicycle=dismount`, `motor_vehicle=no`, same tags removed), so they are not rideable and the closed street can only be crossed at the shared nodes of the cross-streets (`bun scripts/retag-scenario.ts full-closure-sealed`; 30 way ids in `results/scenario-full-closure-sealed.json`). LTS cross-check only: no Valhalla tiles are built for it.

## Inputs

| Input | Rule | |
|---|---|---|
| `maxspeed` | `"<n> mph"` → n × 1.609344 km/h, a bare number is km/h | **UK** (BikeOttawa keeps the raw string, so `"20 mph"` compares as NaN and every such road falls to m12 = LTS 4) |
| `maxspeed` missing | 20 mph (32.2 km/h) for every highway class. Westminster and Camden apply 20 mph on all borough roads, and TfL applies it on its roads inside the congestion zone. The bbox fringes (City, Islington, Lambeth, RBKC) are also 20 mph areas. | **UK** (BikeOttawa: motorway 100, primary/secondary 80, others 50 km/h) |
| `maxspeed=national` or unparsable | 20 mph default | **UK** (BikeOttawa: 40 / 50 km/h. Does not occur in the extract.) |
| `lanes` missing | 2 for every class (BikeOttawa uses one flat default, not one per class) | BikeOttawa |
| `lanes=a;b` | sum of the parts | BikeOttawa intends this but sums the array indices instead. Does not occur in the extract. |
| cycleway values | read only from `cycleway`, `cycleway:left`, `cycleway:right`, `cycleway:both` | **UK** (BikeOttawa matches any key starting with `cycleway`, so `cycleway:right:oneway=yes` would count as a bike lane) |
| parking present | `parking=yes`, or `parking:lane*` ∈ {parallel, perpendicular, diagonal, yes, marked} (BikeOttawa), or `parking:left/right/both` ∈ {lane, street_side, on_kerb, half_on_kerb, shoulder, yes} | last part **UK** (current OSM parking scheme) |
| residential | `highway=residential`, or `highway=living_street` | `living_street` **UK** |
| bicycle permission | `bicycle` ∈ {yes, designated, permissive} | **UK** (BikeOttawa only checks `bicycle=yes`, and only in p5) |

## 1. Permission (LTS 0 = not rideable, the edge is removed)

| Id | Condition | Result | |
|---|---|---|---|
| p1 | no `highway` tag | not rideable | BikeOttawa (cannot occur: the extract only holds highways) |
| p2 | `bicycle=no` | not rideable | BikeOttawa |
| uk-p-bicycle | `bicycle` ∈ {dismount, private, use_sidepath} | not rideable | **UK** (this is what closes Oxford Street) |
| p6 | `access=no` without bicycle permission | not rideable | BikeOttawa, plus the **UK** exception for bicycle permission |
| uk-p-private | `access=private` without bicycle permission | not rideable | **UK** |
| uk-p-vehicle | `vehicle=no` without bicycle permission (in the OSM access hierarchy a bicycle is a vehicle) | not rideable | **UK** |
| p3 / p4 | `highway=motorway` / `motorway_link` | not rideable | BikeOttawa |
| p7 | `highway=proposed` | not rideable | BikeOttawa |
| p5 | `footway=sidewalk` on `highway=footway/path` without bicycle permission | not rideable | BikeOttawa, with the **UK** permitted set (BikeOttawa only accepts `bicycle=yes`, so `bicycle=designated` pavements would be unrideable) |
| uk-p-class | `highway` not in {trunk, primary, secondary, tertiary (and their `_link`s), unclassified, residential, living_street, road, service, track, path, cycleway, footway, pedestrian, bridleway}. This covers steps, corridor, platform, construction, services and elevator. | not rideable | **UK**. BikeOttawa makes steps LTS 1 (m1), construction=path/footway/cycleway LTS 1 (s4–s6), and lets the rest fall through to mixed traffic. |
| uk-p-permission | `highway` ∈ {footway, pedestrian, path, bridleway, busway} without bicycle permission | not rideable | **UK**. BikeOttawa: path/footway LTS 1 (s1/s2), pedestrian LTS 1 (m13), footway crossing LTS 2 (m14), bridleway and busway mixed traffic. There is no general right to cycle on footways and pedestrian areas. On public bridleways in England and Wales cyclists do have a right of way (Countryside Act 1968, s.30); untagged bridleways (and paths) are excluded here as a conservative choice, not for legal reasons. A busway with bicycle permission falls through to mixed traffic, as in BikeOttawa. |
| uk-p-area | `area=yes` (a polygon outline, e.g. a pedestrian square) | not rideable | **UK** |

## 2. Separated path → LTS 1

| Id | Condition | LTS | |
|---|---|---|---|
| s1 | `highway=path` (with bicycle permission, see above) | 1 | BikeOttawa |
| s2 | `highway=footway`, not `footway=crossing` (with bicycle permission) | 1 | BikeOttawa |
| s3 | `highway=cycleway` | 1 | BikeOttawa |
| uk-s-bridleway | `highway=bridleway` with bicycle permission | 1 | **UK** |
| s7 | a cycleway value is `track` | 1 | BikeOttawa (this is how the Wigmore scenario becomes LTS 1) |
| s8 | a cycleway value is `opposite_track` | 1 | BikeOttawa |
| uk-separate | a cycleway value is `separate` (the track is mapped as its own way) | no effect: falls through to bike lane / mixed traffic | **UK**, changed: earlier versions made this LTS 1 (protected). The track is its own way in the graph and gets its own LTS (s3), so the carriageway is rated as a road without cycle infrastructure. |

## 3. Bike lane

Applies when a cycleway value is one of {crossing, lane, left, opposite[^opposite], opposite_lane, right, yes}, or `shoulder:access:bicycle=yes`. `shared_lane`, `share_busway`, `shared`, `no` and `sidewalk` are not bike lanes and drop to mixed traffic (BikeOttawa behaviour, as the brief requires). Start at LTS 1 and raise.

**Furth 2017 tables: painted lanes are rated as mixed traffic.** Under `furth2017-low` and `furth2017-high` (both speed columns) a bike lane as defined above that has no physical separation skips this section and is rated by the Furth mixed-traffic table (section 4c), rule `f17-blocked-lane+<mixed-traffic rule>` (e.g. `f17-blocked-lane+f17/1/3000+/25`, shown in `street-lts.csv` and the classified GeoJSON). Source: Furth 2017, note 1 under both bike-lane tables: "If bike lane / shoulder is frequently blocked, use mixed traffic criteria" (and "If bike lane is frequently blocked, use mixed traffic criteria" for lanes alongside parking). West End painted lanes are routinely obstructed by loading and parked vehicles, so this study treats every painted lane there as frequently blocked; that is an assumption, not a measured blockage rate. It follows MTI Report 11-19 (chapter III, "Criteria Related to Bike Lane Blockage", p. 20), which raises frequently blocked lanes to LTS 3 and suggests assuming "frequent" blockage for bike lanes in commercial areas. It also removes BikeOttawa's b9/c7 rule ("not residential" → LTS 3), which Furth never wrote, so painted lanes no longer count as LTS 3 by that rule and are no longer "converted" metres for that reason alone. Physical separation means a `cycleway[:left|:right|:both]:separation` value other than a marking (`no`, `none`, `solid_line`, `dashed_line`, `double_solid_line`, `hatched_area`); none of the lanes in the extract carries such a tag. Physically separated tracks (`cycleway=track`, `opposite_track`) keep their separated-path grading (s7/s8, LTS 1) in all tables. `bikeottawa` and `mekuria2012` keep the rules below unchanged. In `today` under `furth2017-high`, 788 ways take this rule (768 grade LTS 3, 16 LTS 2, 4 LTS 1); under `furth2017-low` 604, 174 and 10.

| Id | Condition | LTS | |
|---|---|---|---|
| b1 | parking present, no rule below fires | 1 | BikeOttawa |
| b2 | parking, lanes ≥ 3 | 3 | BikeOttawa |
| b6 | parking, 40 < speed ≤ 50 | 2 | BikeOttawa |
| b7 | parking, 50 < speed < 65 | 3 | BikeOttawa |
| b8 | parking, speed ≥ 65 | 4 | BikeOttawa |
| b9 | parking, not residential | 3 | BikeOttawa |
| c1 | no parking, no rule below fires | 1 | BikeOttawa |
| c3 | no parking, lanes ≥ 3 | 3 | BikeOttawa |
| c5 | no parking, 50 < speed < 65 | 3 | BikeOttawa |
| c6 | no parking, speed ≥ 65 | 4 | BikeOttawa |
| c7 | no parking, not residential | 3 | BikeOttawa |
| b3–b5, c4 | width rules | never fire | BikeOttawa's `bikeAndParkingWidth()` is a placeholder that returns 99999.9 |
| c2 | 3 lanes with a separating median → 2 | never fires | BikeOttawa's `hasSeparatingMedian()` always returns false |

[^opposite]: `cycleway=opposite` (a contraflow without a marked lane) is counted as a bike lane exactly as BikeOttawa does, although it carries no lane marking.

## 4. Mixed traffic, BikeOttawa table (default, first match)

| Id | Condition | LTS | |
|---|---|---|---|
| m17 | `motor_vehicle=no` | 1 | BikeOttawa |
| m13 | `highway=pedestrian` (only reached with bicycle permission) | 1 | BikeOttawa (permission gate **UK**) |
| m14 | `highway=footway` + `footway=crossing` (only reached with bicycle permission) | 2 | BikeOttawa (permission gate **UK**) |
| m2 | `highway=service` + `service=alley` | 2 | BikeOttawa |
| m15 | `highway=track` | 2 | BikeOttawa |
| m12 | speed > 50 | 4 | BikeOttawa (checked after the rows above, as in BikeOttawa) |
| m3 | service + `service=parking_aisle` (speed ≤ 50) | 2 | BikeOttawa |
| m4 | service + `service=driveway` (speed ≤ 50) | 2 | BikeOttawa |
| m16 | service, speed < 35 | 2 | BikeOttawa (with the 20 mph default, every service road lands here or in m2–m4) |
| m5 | speed ≤ 40, lanes ≤ 3, residential | 2 | BikeOttawa |
| m6 | speed ≤ 40, lanes ≤ 3, not residential | 3 | BikeOttawa |
| m7 | speed ≤ 40, 4–5 lanes | 3 | BikeOttawa |
| m8 | speed ≤ 40, lanes > 5 | 4 | BikeOttawa |
| m9 | 40 < speed ≤ 50, lanes < 3, residential | 2 | BikeOttawa |
| m10 | 40 < speed ≤ 50, lanes ≤ 3 | 3 | BikeOttawa |
| m11 | 40 < speed ≤ 50, lanes > 3 | 4 | BikeOttawa |

`trunk` and `primary` get no special rule. They are classified by speed and lanes like any other road, exactly as BikeOttawa does.

## 4b. Mixed traffic, Mekuria 2012 table (`--table mekuria2012`)

Source: Mekuria, Furth, Nixon, "Low-Stress Bicycling and Network Connectivity", Mineta Transportation Institute Report 11-19, 2012, Table 4 (criteria for mixed traffic). The rows m17, m13, m14, m2, m15, m3, m4 and m16 stay as in section 4 (they cover OSM classes the table does not), and the table replaces m5–m12.

| Speed limit | 2–3 lanes | 4–5 lanes | 6+ lanes |
|---|---|---|---|
| up to 25 mph (≤ 40.2 km/h) | 1 or 2[^t4] (t4-25-a / t4-25-b) | 3 (t4-25-c) | 4 (t4-25-d) |
| 30 mph (≤ 48.3 km/h) | 2 or 3[^t4] (t4-30-a / t4-30-b) | 4 (t4-30-c) | 4 (t4-30-d) |
| 35 mph and above | 4 (t4-35) | 4 | 4 |

- Lanes are total through lanes (`lanes`, default 2). Fewer than 2 lanes counts as the 2–3 column.
[^t4]: Table 4 footnote: "Use lower value for streets without marked centerlines or classified as residential and with fewer than 3 lanes; use higher value otherwise." Implemented as: lower value if (unmarked or residential) and lanes < 3, so a 3-lane residential street takes the higher value.

- Residential: `highway=residential|living_street`. Unmarked (no marked centreline): `lanes=1` or `lane_markings=no`.
- A limit between two rows takes the higher-stress row, so 50 km/h (31 mph) is LTS 4. The extract only has mph limits (4–30 mph).
- t4-35 is checked where m12 sits in section 4, before the service-road rows.
- **Known deviation:** this mode replaces only the mixed-traffic block and keeps BikeOttawa's bike-lane rules (section 3). The report's bike-lane criteria (its Tables 2 and 3) depend on lane width, parking, speed and lane count and have no "not residential → LTS 3" rule, but BikeOttawa's b9/c7 do. So a painted lane on a non-residential street grades LTS 3 while the same street without a lane grades LTS 2 (t4-25-b). Affected in the corridor: George Street, New Cavendish Street and a short piece of Wigmore Street. The furth2017 tables are excepted: under them painted lanes fall through to the volume table (section 3).

## 4c. Mixed traffic, Furth 2017 volume-based table (`--table furth2017-low|furth2017-high`)

Source: Peter G. Furth, "Level of Traffic Stress Criteria for Road Segments, version 2.0, June, 2017", <https://peterfurth.sites.northeastern.edu/files/2014/05/LTS-Tables-v2-June-1.pdf> (fetched 2026-11-08; linked from <https://peterfurth.sites.northeastern.edu/2014/05/21/criteria-for-level-of-traffic-stress/>). Transcribed from the PDF's "Mixed traffic criteria" table. Code: `scripts/lts/furth2017.ts` (table), `scripts/lts/classify.ts` (tag interpretation), `scripts/lts/volume.ts` (ADT).

This mode changes the mixed-traffic block and how painted bike lanes are rated. Permission (section 1) and separated path (section 2) are unchanged. A painted bike lane without physical separation is rated by this table, following Furth's note that frequently blocked bike lanes take the mixed-traffic criteria (section 3), so the bike-lane deviation of section 4b does not apply here. Furth's own bike-lane tables (same PDF) are not used: they need lane and parking widths that OSM rarely carries, and with every painted lane taken as blocked they would not be reached. A lane with a physical-separation tag would still take BikeOttawa's bike-lane rules (none in the extract). Pedestrianised Oxford Street stays not rideable.

Mixed traffic criteria (LTS by number of lanes, effective ADT and prevailing speed):

| Number of lanes | Effective ADT | ≤ 20 mph | 25 mph | 30 mph | 35 mph | 40 mph | 45 mph | 50+ mph |
|---|---|---|---|---|---|---|---|---|
| Unlaned 2-way street (no centerline) | 0–750 | 1 | 1 | 2 | 2 | 3 | 3 | 3 |
| | 751–1500 | 1 | 1 | 2 | 3 | 3 | 3 | 4 |
| | 1501–3000 | 2 | 2 | 2 | 3 | 4 | 4 | 4 |
| | 3000+ | 2 | 3 | 3 | 3 | 4 | 4 | 4 |
| 1 thru lane per direction (1-way, 1-lane street or 2-way street with centerline) | 0–750 | 1 | 1 | 2 | 2 | 3 | 3 | 3 |
| | 751–1500 | 2 | 2 | 2 | 3 | 3 | 3 | 4 |
| | 1501–3000 | 2 | 3 | 3 | 3 | 4 | 4 | 4 |
| | 3000+ | 3 | 3 | 3 | 3 | 4 | 4 | 4 |
| 2 thru lanes per direction | 0–8000 | 3 | 3 | 3 | 3 | 4 | 4 | 4 |
| | 8001+ | 3 | 3 | 4 | 4 | 4 | 4 | 4 |
| 3+ thru lanes per direction | any ADT | 3 | 3 | 4 | 4 | 4 | 4 | 4 |

Table footnote, verbatim: "\* Effective ADT = ADT for two-way roads; Effective ADT = 1.5\*ADT for one-way roads". The one-way factor is therefore **1.5** (equivalently, one-way thresholds at two-thirds of the two-way ones), not 1.67.

Rule ids: `f17/<row>/<ADT band>/<speed column>`, e.g. `f17/1/3000+/25`, prefixed `f17-blocked-lane+` for a painted lane (section 3). Rows `unlaned`, `1`, `2`, `3+`; columns `le20`, `25` … `50+`.

How OSM tags map onto the table:

| Input | Rule |
|---|---|
| speed column | The `maxspeed` limit in mph stands in for prevailing speed (untagged: the 20 mph default of section "Inputs"). A limit between two columns takes the higher-stress column. A **20 mph limit reads the 25 mph column** by default, taking the prevailing speed on a 20 mph street as 20–25 mph (conservative). Sensitivity `--speed-col lt20` reads it in the ≤ 20 mph column. Limits below 20 mph always read the ≤ 20 mph column. |
| row, two-way | `lanes=1` or `lane_markings=no` → unlaned. Otherwise lanes per direction = `lanes` / 2 (default `lanes=2`, so an untagged two-way street reads the "2-way street with centerline" 1-lane row; see Known limitations): below 2 → 1-lane row (so `lanes=3` is the 1-lane row), 2 to below 3 → 2-lane row, 3 or more → 3+ row. Sensitivity `--untagged-unlaned`: an untagged two-way `highway=residential` or `living_street` way reads the unlaned row. |
| row, one-way | Lanes per direction = `lanes` (default 1). One-way streets are never unlaned (the table's unlaned row is for 2-way streets). |
| one-way | `oneway=yes/true/1/-1` or `junction=roundabout/circular` (motor traffic; `oneway:bicycle` and contraflows do not change the volume). Effective ADT = 1.5 × ADT. |
| ADT band edges | ADT ≤ 750, ≤ 1500, ≤ 3000, > 3000 (3000 itself falls in 1501–3000); 2-lane row ≤ 8000, > 8000. |
| rows before the table | m17, m13, m14, m2, m15 and the service-road rows m3, m4, m16 apply first, as in section 4b. There is no speed gate before them (the table covers every speed). |

Volume (ADT, vehicles per day, both directions, before the one-way factor) per way, recorded in the classified GeoJSON as `adt`, `adt_source`, `adt_count_point`, `adt_count_year` and `adt_road_m`:

| `adt_source` | Rule |
|---|---|
| `count` | A DfT count point is matched to this way (`results/dft/countpoints-matched.csv`, `all_motor_vehicles`). Several points on one way: the latest year wins, then the closest snap. |
| `road` | No point on the way, but the way shares `ref` (or, when it has no `ref`, `name`) with a counted way and lies within 600 m of that count point, measured along the ways of that road from the count way's vertex nearest the point (`adt_road_m`). Several candidates: the nearest wins. Only motor highways (the DfT matching set) take part; counts on ways that are now pedestrian (Oxford Street) are not carried. |
| `class-default` | Everything else, by highway class (`_link`s take their parent class; `road` and `busway` count as unclassified, `service` as residential). |

Class defaults (vehicles/day), two assumptions run as separate tables:

| Highway class | `furth2017-low` | `furth2017-high` |
|---|---|---|
| residential, living_street (service) | 1,000 | 2,500 |
| unclassified (road, busway) | 1,500 | 3,000 |
| tertiary | 3,000 | 6,000 |
| secondary, primary, trunk | 10,000 | 15,000 |

These defaults are assumptions of this study, not values from Furth or the DfT. New Cavendish Street, for example, has no count point and takes the tertiary default.

Known limitations:

- The posted limit stands in for prevailing speed. With 20 mph everywhere, the 25 mph column (and the ≤ 20 mph column) has no LTS 4, so in this mode multi-lane arterials such as Park Lane grade LTS 3, not 4, and the cautious rider's LTS 4 penalty never applies on 20 mph roads. That no way in the bbox grades LTS 4 under either furth2017 table is a property of reading 20 mph limits in the 25 mph column, not a finding that no street is very stressful. Park Lane (its 3+ lane carriageway, LTS 3) is convertible like any LTS 3 street and appears in 8 of the 32 headline unions; converting a stretch of it stands for a protected track along a multi-lane arterial, which the metre count does not distinguish from a quiet back street.
- **Untagged two-way streets read the centreline row.** `lanes` defaults to 2, so a two-way street without a `lanes` tag reads the "1 thru lane per direction (2-way street with centerline)" row rather than the unlaned row. In the `today` extract (study bbox), 847 of 974 two-way `highway=residential` ways (55.8 of 64.4 km), both two-way `living_street` ways and 403 of 612 two-way `unclassified` ways (22.7 of 35.0 km) have no `lanes` tag; 805 residential, 2 living_street and 379 unclassified of them are graded by the volume table (6 and 3 of those as painted lanes; the rest stop at earlier rules). Two-way means not one-way for motor traffic as the table reads it (row "one-way" above), so `oneway=no` counts as two-way. `bun scripts/lts/untagged-lanes.ts` prints these counts. Many West End side streets have no centreline, so this default errs towards higher stress: at the 25 mph column the two rows differ by one level for 751–3000 vehicles/day (unlaned 1/2, centreline 2/3) and coincide above 3000. On the residential class default that means LTS 3 with a centreline against LTS 2 without one under `furth2017-high` (2,500 vehicles/day), and LTS 2 against LTS 1 under `furth2017-low` (1,000). See "Untagged two-way streets as unlaned" below for the sensitivity run.
- `lanes` in London often counts bus lanes, which the table's "thru lanes" arguably exclude. They are counted as through lanes here.
- A DfT count on a dual carriageway is the two-way total, but each carriageway is a one-way way, so its effective ADT is 1.5 × the two-way total rather than 1.5 × its own share.
- Camden's open Vivacity sensor data covers cyclists only, so it adds no motor volumes. The main runs use the DfT counts alone. The best-evidence run adds published counts and the LAEI 2022 model (see "Best-evidence run").
- The DfT Wigmore Street count (count point 48010, 15,534 vehicles/day) is from 2019 and predates the February 2025 conversion of Wigmore Street and Mortimer Street to two-way traffic.
- The Marble Arch gyratory carriageways (`ref=A40`) inherit the Oxford Street west count by the `road` rule, far below the real gyratory volume. The LTS is the same (3+ lanes → LTS 3 at 20 mph).

## Routing (`scripts/lts/route.ts`)

- Graph nodes are the endpoints of rideable ways plus nodes shared by two or more rideable ways. Edge length is the haversine sum over the vertices.
- Costs:
  - **confident**: length.
  - **cautious**: length × {LTS 1: 1, LTS 2: 1, LTS 3: 4, LTS 4: 10}.
  - **cautious-alt** (sensitivity): LTS 3 × 2.5, LTS 4 × 6.
  - Not-rideable ways are not in the graph for any rider.
- One-way rules:
  - `oneway=yes|true|1|-1`, `junction=roundabout|circular` and `oneway:bicycle=yes` are respected.
  - Exempt: `oneway:bicycle=no`, a cycleway value starting with `opposite`, or `cycleway:<side>:oneway=no|-1`. The last exemption is an addition for the current contraflow tagging scheme.
- LTS has no direction. As in BikeOttawa, a way's LTS applies to both travel directions.
- Trip points snap to the nearest graph node that has at least one rideable outgoing or incoming arc.
- `lts34_m` and `lts34_streets` give the metres on LTS 3–4 and the distinct street names of those segments (metres each, in route order). On the `cautious` row they list the barriers a cautious rider still has to ride.
- **Low-stress connectivity test** (MTI Report 11-19, chapter II, "Acceptable Level of Detour", pp. 14–15): per trip, L4 = shortest rideable path (any LTS) and L2 = shortest path on LTS 1–2 ways only (LTS 3–4 removed; `no path` if disconnected). The low-stress route is acceptable if L2/L4 < 1.25 or L2 − L4 < 1760 ft (536 m; the report's "25 percent or, for short trips, 0.33 miles"). The report designed this criterion for aggregate origin–destination measures, not for a verdict on one trip (see the gap-closing caveats). For this test both ends snap to the nearest node with an LTS 1–2 arc (snap distances in `l2_snap_from_m` / `l2_snap_to_m`), and L4 is computed between the same nodes, so a trip end on an LTS 3 street does not fail the test trivially. Columns `l4_m`, `l2_m`, `l2_ratio`, `connected_lowstress` repeat on every rider row of the trip.
- **Why L4 differs between tables.** L4 is the same kind of path in every table (shortest rideable path, LTS ignored), but its end points are not: each table snaps the trip ends to its own nearest node with an LTS 1–2 arc, and which arcs are LTS 1–2 depends on the table. So the same trip has a slightly different L4 per table (A→B: 2424 m under `mekuria2012`, 2385 m under `bikeottawa` and the furth2017 tables), and the acceptance bar moves with it. Compare L2/L4 ratios within a table, not L4 across tables.

## Gap closing (`scripts/lts/gap-closing.ts`)

Question: which LTS 3–4 links, made low-stress, would let the trip pass the low-stress connectivity test above, and how many metres is that at least?

- Same graph, one-way rules and low-stress snap nodes as the connectivity test. **L4** is the shortest rideable path between those nodes on the variant's own network (see own-L4 gating below).
- Per trip, the trade-off between **converted metres** (summed length of the LTS 3–4 edges on the path; LTS 1–2 edges cost nothing) and **path length**, subject to path length ≤ max(1.25 × L4, L4 + 536 m), the test's acceptance bar. Not-rideable ways are not in the graph and cannot be converted.
- Exact bi-criteria label-setting search: Pareto labels (converted, length) per node, dominated labels dropped, labels that cannot meet the length budget (length so far + shortest remaining length) pruned, labels popped in order of converted metres plus a lower bound on the converted metres still to come. The first label popped at the target is the **minimum** conversion. The search then continues to collect the whole frontier: labels pop in nondecreasing converted order, so a label whose length plus shortest remaining length reaches the shortest target label already found is dominated and pruned. Each variant runs in about a second.
- **Pareto frontier** (`gap-closing-frontier[...].csv`): every non-dominated (converted_m, path_m) point at the target, ascending converted metres, with ratio = path / L4 and the converted streets. The minimum is its first point; the last is the shortest path within the budget.
- **Knee**: the frontier point minimising converted_m + path_m − L4, i.e. one metre of conversion weighs the same as one metre of detour. It is reported next to the minimum (`solution` = `min` / `knee`, summary `*_knee_*`). Often they coincide; where they differ, the knee converts more metres for a shorter route. With contraflow, path − L4 can be negative (converted contraflow arcs can beat L4); the rule is applied unchanged.
- **Crossings vs links**: the converted edges are split into fragments (edges of one street that share a node; `*_link` and `junction=*` pieces kept apart from the rest). A fragment is a **crossing** when it is ≤ 40 m or its ways are `*_link` or `junction=*`; otherwise it is a **link**. `links_m` and `crossings_m` are reported separately and crossings are listed as "Crossing at <street>" (an unnamed piece is named after the highest-LTS named street at its nodes). The rule "within 25 m of a signalised node" is not applied: the classified GeoJSON carries way tags and node ids only, no node tags, so signals are not known.
- **Union** (the practical set, a converted street serves both directions): each seed of one direction is fixed as converted and the other direction re-solved with those edges free; the smallest union wins (`union_method`, e.g. `B-A frontier #3 first`). Seeds are every frontier point and, for each street the minimum converts, the minimum with that street's LTS 3–4 edges banned (`B-A no <street> first`). The ban-one-street re-solves only seed the union; they are not published as solutions. `independent_union_m` is the plain union of the two minima.
- Variants: `furth2017-low` and `furth2017-high` × all four scenarios × `--allow-oxford` off/on × `--contraflow` off/on (32 runs, the **headline set**; output names get the `-allow-oxford` and `-contraflow` suffixes in that order). Sensitivities, not headline: the same 32 in the ≤ 20 mph column (`--speed-col lt20`, mode `furth2017-*-lt20`), and one `--untagged-unlaned` run (`furth2017-high`, `today`, `--contraflow`, mode `furth2017-high-unlaned`). The three regradings of "Sensitivity runs" below have their own summary file.

**Two-way-track variant (`--contraflow`).** Without it, converting a one-way street keeps it one-way, so a trip may need a long detour to use it in the other direction. A protected scheme on such a street is often a two-way track on one side, so this variant lets a conversion include the missing direction: every LTS 3–4 one-way edge gets a reverse arc. Traversing that arc costs the edge length in converted metres and in path length, exactly like the forward arc, so it is never usable at zero conversion cost. LTS 1–2 one-way edges get no reverse arc: adding a contraflow there is not a conversion of a high-stress link, so a route that would need a cheap contraflow on a quiet one-way street is not found, which biases the minima upward. L4 and the budget use the network without these arcs, the plain directed shortest path: the arcs cannot be ridden today, so they are not part of the rideable baseline. In the union a converted edge is a two-way track, so both its arcs become free for the other direction.

**Oxford Street counterfactual (`--allow-oxford`).** The not-rideable carriageway of Oxford Street between about lon −0.154 and −0.1405 (the pedestrian zone: its `highway=pedestrian` ways and the two `vehicle=no` `primary_link` pieces across Oxford Circus, without which the zone is cut in two) becomes convertible at LTS 3, rule `gap/oxford-counterfactual`: cycling permitted through the pedestrian zone on a marked track. Its leftover `oneway` tags (from the former bus carriageway) are dropped, so the track is two-way. Its sidewalks (`highway=footway`) and every other not-rideable way stay excluded. Under `full-closure` the window is the whole street, lon −0.1595 to −0.1295 (Marble Arch to Tottenham Court Road): the counterfactual reopens the entire pedestrianised Oxford Street to cycling on a marked track. Under `full-closure-sealed` it reopens the three sealed median links too (matched by way id, as they are unnamed), since they are part of reopening the street; they lose their `oneway` like the rest. So `--allow-oxford` under `full-closure*` makes the whole street a two-way LTS 3 track (61 ways, 64 with the median links), whereas under `today` and `wigmore-track` only the pedestrian zone (36 ways) is reopened and the open ends west and east keep their one-way, as-classified edges: the 36-way and 61-way results are not directly comparable.

**Own-L4 gating.** With `--allow-oxford` the budget and the ratio are computed against the shortest rideable path on the counterfactual network itself (Oxford Street rideable), not the scenario's L4 without it: a detour that is acceptable against today's network is not acceptable once a much shorter route exists. Reconstructing Oxford Street shortens L4 (A→B 2385 → 2056 m, B→A 2508 → 2295 m), so the budget tightens (A→B 2981 → 2592 m, B→A 3135 → 2869 m) and the minimum can rise above the no-Oxford minimum. `l4_base_m` keeps the scenario's own L4 without the counterfactual for reference.

**Caveats.**

- L4 is computed on the network after the ban (Oxford Street is not rideable today), so "within 25 %" is relative to the already detoured baseline, not to a direct ride along Oxford Street.
- The acceptance bar is the MTI Report 11-19 detour criterion (chapter II, "Acceptable Level of Detour", pp. 14–15; also Executive Summary, "Measuring Connectivity", p. 3): a low-stress path is acceptable if it is less than 25 % longer than the shortest path or, for short trips, less than 0.33 mi (1760 ft) longer. The report set it for aggregate measures over many origin–destination pairs ("percent trips connected" over a regional trip table, "percent nodes connected"; chapter VIII), where a threshold effect on one pair averages out. Applied to a single pair, as here, a path just over the bar fails outright, so minima near the bar are sensitive to it.
- `withContraflow()` never adds a contraflow to an LTS 1–2 one-way street (adding one there is not a conversion of a high-stress link). A contraflow on a quiet one-way street is often cheap, so leaving it out biases the contraflow minima upward.
- Converted metres are not cost: a metre of quiet side street and a metre of gyratory count the same, and crossings (junction redesign, signals) usually cost far more per metre than links.
- The union is a heuristic upper bound on the jointly optimal set for both directions, not the optimum. Checked against an exact solver (an integer program over the same graph, by a reviewer) for the 16 runs with Oxford Street not rideable, it equals the optimum in 12, including the four headline cells (`today` and `wigmore-track`, two-way tracks, both volume tables), and is up to about 6 % above it in runs without two-way tracks (`today`, `furth2017-high`: 2490 m found, 2347 m optimal).
- The main runs and the sensitivities other than `best-evidence` keep this heuristic union, an upper bound. For the two main headline rows (`today`, two-way tracks, Oxford Street not rideable) the side comparison confirms it: 1113 m under `furth2017-low` and 1940 m under `furth2017-high` equal the cheaper of the north-only and south-only searches (see "North against south"). The best-evidence run and its robustness checks add those two side-constrained unions as candidates (below).
- Trip end B snaps to the nearest node with an LTS 1–2 arc, on a service lane 54 m from the station (`l2_snap_to_m`), not to the nearest rideable node. Ending at the nearest rideable node instead adds about 95 m of Charing Cross Road to the trip, and an independent replication found the per-direction minima then rise by about 70 to 180 m (with two-way tracks, low volumes 909 to 982 m and 802 to 979 m, high volumes by 142 m each).

**Results.** The headline set is the 32 default-column runs (rows with `speed_col` 25 and `untagged_two_way` centreline in `gap-closing-summary.csv`). No street is in every solution: none is in all 32 unions or in all 64 per-direction minima. Great Chapel Street is in 27 of the 32 unions (an artefact of its assumed volume, see "Sensitivity runs"); Great Chapel Street, Noel Street and Great Marlborough Street together in 23, and with Soho Square (the whole Soho link) in 14; the Cavendish Square / Cavendish Place / Mortimer Street spine in 12; Park Lane (LTS 3, see section 4c) in 8. Cavendish Square, Cavendish Place and Mortimer Street are absent from all eight furth2017-high `today` minima (both directions, Oxford off/on, contraflow off/on), and at least one of them appears in 10 of the 32 contraflow minima (6 of 16 under furth2017-low, 4 of 16 under furth2017-high). The 32 unions are not 32 independent results: only 19 are distinct edge sets (21 distinct by `union_converted_m` and `union_streets`, since the same set can be listed in a different order). The high-volume `full-closure` and `full-closure-sealed` rows coincide in all four flag combinations, and several closure rows repeat `today` or each other. The union is a heuristic that moves with its seeds, so the effect of the Wigmore Street track is computed per direction: it cuts the minimum converted metres (`today` → `wigmore-track`, Oxford Street not rideable) by:

| Variant | A→B | B→A |
|---|---|---|
| furth2017-low | 1054 → 852 m (−19 %) | 1036 → 996 m (−4 %) |
| furth2017-high | 1788 → 1539 m (−14 %) | 1903 → 1572 m (−17 %) |
| furth2017-low, contraflow | 909 → 600 m (−34 %) | 802 → 802 m (0 %) |
| furth2017-high, contraflow | 1733 → 1469 m (−15 %) | 1902 → 1516 m (−20 %) |

**Speed-column sensitivity (`lt20`).** The same 32 variants with 20 mph limits read in the ≤ 20 mph column (`results/lts/furth2017-*-lt20/<scenario>/gap-closing*.*`, summary rows with `speed_col` lt20). They are a sensitivity, not part of the headline set. The low-stress network stays disconnected in every lt20 run (`summary.csv`, `connected_lowstress` no), but much less needs converting:

| | Headline (25 mph column) | lt20 |
|---|---|---|
| two-way tracks, `today`: union low / high | 1113 / 1940 m | 636 / 1051 m |
| two-way tracks, `today`: per-direction minima | 802–1902 m | 294–1026 m |
| two-way tracks, `wigmore-track`: union low / high | 929 / 1527 m | 504 / 1017 m |
| two-way tracks, `wigmore-track`: per-direction minima | 600–1516 m | 236–984 m |
| no two-way tracks, `today`: union low / high | 1561 / 2490 m | 907 / 2139 m |
| no two-way tracks, `today`: per-direction minima | 1036–1903 m | 430–1378 m |
| all 32 runs: per-direction minima / unions | 600–1903 / 929–2913 m | 236–1600 / 504–2139 m |

(Oxford Street not rideable in every row except the last.)

**Untagged two-way streets as unlaned (`--untagged-unlaned`).** Sensitivity for the centreline default (section 4c, Known limitations), run for `furth2017-high`, `today`, two-way tracks on, Oxford Street not rideable only (`results/lts/furth2017-high-unlaned/today/`; summary row with table `furth2017-high-unlaned` and `untagged_two_way` unlaned, not a headline row). Reading untagged two-way residential and living streets in the unlaned row turns 749 ways from LTS 3 to LTS 2 (747 residential, 2 living_street) and 3 from LTS 2 to LTS 1. The low-stress network still does not connect A and B (no LTS ≤ 2 path either way), but the minima fall from 1733 to 1208 m A→B and from 1902 to 1237 m B→A, and the union from 1940 to 1354 m (Soho Square, Carlisle Street, Great Chapel Street, Noel Street, Great Marlborough Street, Maddox Street, Binney Street and 58 m of Park Lane, plus crossings). So the centreline default raises the high-volume requirement by about 40 % (1354 against 1940 m for the union); where side streets have no centreline, the headline high-volume numbers are pessimistic.

### Sensitivity runs

`scripts/lts/sensitivity.ts` (run by `run-all.ts` after the main runs) regrades the classified ways of both headline tables in one respect (the best-evidence run in two: volumes and Great Chapel Street) and reruns the same low-stress connectivity test and gap-closing search on them. Summary rows (`results/lts/sensitivity-summary.csv`, not part of `gap-closing-summary.csv`): two-way tracks allowed, Oxford Street's pedestrianised stretch not rideable, scenario `today` unless stated; `ways_regraded` counts the ways whose LTS differs from the main run, `*_connected_lowstress` is the connectivity test on the regraded network. Per-run files (`gap-closing*.csv`, `.geojson`, frontier) are under `results/lts/sensitivity/<name>/<table>/<scenario>/`.

- **`uk-ltn120`: UK guidance instead of Furth's table.** Every way graded by a row of the Furth mixed-traffic table (rule `f17/…`, also behind `f17-blocked-lane+`) is regraded by motor flow and speed limit alone: LTS 2 (suitable for most people) when the two-way ADT is at most 2,500 vehicles a day and the limit is 20 mph or less, otherwise LTS 3 (rules `ltn120/within-limits`, `ltn120/over-limits`). No one-way factor and no lane rows. Source: Department for Transport, Local Transport Note 1/20 *Cycle Infrastructure Design* (2020), paragraph 7.1.1 ("Most people … will not feel comfortable on-carriageways with more than 2,500 vehicles per day and speeds of more than 20 mph. These values should be regarded as desirable upper limits for inclusive cycling within the carriageway") and Figure 4.1, <https://assets.publishing.service.gov.uk/media/5ffa1f96d3bf7f65d9e35825/cycle-infrastructure-design-ltn-1-20.pdf>. Ways graded by other rules (permission, separated path, the rows before the table, and painted lanes the mixed-traffic block grades by such a row, e.g. `f17-blocked-lane+m13`) keep their grade. Run with the low and the high default volumes.
- **`back-streets-750`: a lower volume on uncounted back streets.** The class-default ADT of `residential`, `living_street`, `service` and `unclassified` ways is set to 750 vehicles a day, the top of the table's lowest band; `tertiary` and above keep the low or high default, counts and the road rule are unchanged, then the normal Furth 2017 table, 25 mph column. Reason: the one Soho back street with a DfT count, D'Arblay Street (count point 942336), carried about 400 a day, and four of the seven minor-road count points matched to `unclassified` ways in the study bbox carry under 1,000 (`results/dft/countpoints-matched.csv`), well below the 1,500 and 3,000 the main runs assume for unclassified streets. This run is not a floor: uncounted `tertiary` and larger streets, Noel Street, Great Marlborough Street and the tertiary part of Brook Street among them, keep their assumed 3,000 or 6,000 vehicles a day. `uncounted-zero` is the floor.
- **`uncounted-zero`: the lower bound.** Every way whose volume is a class default (`adt_source` class-default, every highway class) gets ADT 0; counts and the road rule are unchanged, then the normal Furth 2017 table, 25 mph column. It answers "what if the uncounted streets carried almost nothing" and shows what the counted streets alone do. The low and high tables differ only in their class defaults, so with all of them at zero the two runs are identical by construction (the script checks that both grade every way the same); both rows are written. Zero volume does not make every uncounted street low-stress: a street read in the 2-lane or 3+ lane row (one-way with `lanes=2`, or a wide two-way street) stays LTS 3 at any volume.
- **`great-chapel-traffic-free`: Great Chapel Street closed to motor traffic.** Its four ways (33096425, 1414470432, 628701125, 1245985425: the whole street in the extract; the script checks this) are graded LTS 1, as rule m17 grades `motor_vehicle=no`. Reason: Westminster City Council's project page for the street (<https://www.westminstertransportationservices.co.uk/projects/project_details.php?id=627>, read 2026-11-14) says it "was pedestrianised as part of measures introduced during the Covid-19 pandemic" and "has operated successfully as a traffic-free space". Works to make the pedestrianisation permanent are on site from 7 September to 4 December 2026. OpenStreetMap carried `motor_vehicle=no` on all four ways until changeset 181301075 of 14 April 2026 removed the tag without a source, so the extract has the street open to traffic. The street has no count, and the main runs give it the unclassified default (1,500 or 3,000 vehicles a day, LTS 3 as a one-way street). Run for all 32 headline variants; `results/lts/sensitivity/great-chapel-traffic-free/frequency.csv` gives, per street, in how many of the 32 both-directions sets it appears in the main runs and in this sensitivity (streets of the `min-union` solution, crossings not counted, as in the fix-frequency figure).
- **`best-evidence`: counts and modelled flows instead of guesses.** Volumes come from every count and model flow available, the class defaults only where there is none, and Great Chapel Street is graded traffic-free as above. Run for all 32 headline variants. See "Best-evidence run" below.

Results (`today`, two-way tracks, Oxford Street not rideable; per-direction minima A→B / B→A and union, converted metres):

| | furth2017-low | furth2017-high |
|---|---|---|
| Headline | 909 / 802, union 1113 | 1733 / 1902, union 1940 |
| `uk-ltn120` | 580 / 336, union 916 | 1008 / 1176, union 1486 |
| `back-streets-750` | 580 / 336, union 874 | 580 / 336, union 916 |
| `uncounted-zero` | 58 / 90, union 148 | 58 / 90, union 148 (identical by construction) |
| `great-chapel-traffic-free` | 909 / 683, union 1071 | 1726 / 1840, union 1878 |
| `best-evidence` | 1055 / 923, union 1359 | 1726 / 1823, union 1878 |

None of them connects A and B on low-stress streets: no run has an LTS 1–2 path in either direction, not even `uncounted-zero`. There the counted streets and the multi-lane rows keep the ends apart, and the minimum is short: A→B converts a crossing of Brook Gate (19 m) and one of Regent Street (39 m), B→A a crossing of Grosvenor Street (36 m), 47 m of Grosvenor Gate and a crossing of Park Lane (8 m). Brook Gate, Regent Street and Park Lane carry a count on their road; Grosvenor Street and Grosvenor Gate are uncounted but one-way with two lanes, so LTS 3 at any volume. UK guidance roughly halves the low-volume requirement per direction (the union falls by about a fifth, 1113 to 916 m) and cuts the high-volume union by about a quarter; with back streets at 750 vehicles a day both tables need under a kilometre, all of it on streets with a count or a carried count or on tertiary and larger roads. Treating Great Chapel Street as traffic-free changes the totals little: the searches go round it at about the same cost. With `wigmore-track` its unions are 816 m (low) and 1465 m (high), against 929 and 1527 m in the main runs. Over the 32 headline variants Great Chapel Street drops from 27 sets to none, while Noel Street and Great Marlborough Street stay in 23 and Soho Square and Carlisle Street in 16.

### Best-evidence run

The main runs give every street without a DfT count a guess per highway class, a low one and a high one, and the answer moves with the guess. The best-evidence run replaces the guess with evidence wherever there is any and keeps the guesses only for the streets left. It is the sensitivity `best-evidence` (`scripts/lts/sensitivity.ts`, `bestEvidenceWays`), run like `great-chapel-traffic-free`: both tables, all four scenarios, all four variants, 32 runs. Under `furth2017-low` the remaining streets take the low guess, under `furth2017-high` the high one. Great Chapel Street is graded traffic-free on top (see `great-chapel-traffic-free`). The union of both directions in every best-evidence run and robustness check also takes the two side-constrained unions (north-only and south-only, see "North against south" and `scripts/lts/sides.ts`) as candidates and keeps the smallest, so it never exceeds the better side. `union_method` names the candidate that won: a seed of the heuristic, `north-only` or `south-only`. On a tie the heuristic's set is kept.

Volume sources, first match wins (`adt_source`, `scripts/lts/volume.ts` with `bestEvidence`):

| `adt_source` | Rule |
|---|---|
| `count` | A count point on the way: a DfT point as in the main runs, or a published count from `inputs/published-counts/counts.csv`. Several points on one way: the latest year wins, then the closest snap. A published count is used as it stands: the vehicles counted over its period (`hours`: 12, 16 or 24), not expanded to a day. A 12- or 16-hour count is therefore a lower bound of the daily flow. |
| `road` | As in the main runs, 600 m along the same road. For a DfT count the same road is the same `ref` (or `name` without a `ref`), as before. A published count names its street, not a road number, so it is carried along ways of the same `name` only. The count carried from a way is the one that wins on that way. Where a newer published count displaces a DfT count, the DfT count is no longer carried from that way either (the Conduit Street ways that took 8,496 from the New Bond Street DfT count of 2009 now take LAEI flows, one of them the guess). |
| `laei` | The modelled 2022 all-motor-vehicle daily flow of the London Atmospheric Emissions Inventory (LAEI) 2022, matched to the way (below). |
| `class-default` | The table's guess, as in the main runs. |

**Published counts.** `inputs/published-counts/README.md` sets out which counts qualify: observed counts of all motor vehicles over the whole carriageway, 12 hours or more of a day, from 2016 on. `all_motor_vehicles` is therefore treated exactly like a DfT street total, and `carriageway` only says whether the street is one-way or two-way at the site. `scripts/published-counts/match.ts` matches each count to the nearest motor road within 40 m (the DfT matching radius) whose OSM name equals the count's `street`. Name agreement is required, so a count never snaps to a road of another name. Only when no motor road of the name is that close does a pedestrian street or busway of the name qualify, the way a DfT count matches pedestrianised Oxford Street. Such a count grades nothing: the way stops at the permission rules or m13, and the road rule does not carry counts from it. A count without a way of its name, a repeated id, or a count, period, year or carriageway that is not valid stops the script with every such row listed. Output: `results/published-counts/counts-matched.csv`.

All 98 counts match a way of their street, all within 15 m of it. One, the west side of Gordon Square (`camden-tor-gordon-sq-west`), lies on a street that is `highway=pedestrian` in the extract, so it matches that way and grades nothing. Ten counts cover 12 hours, 47 cover 16 hours and 41 cover 24 hours. On six ways a published count and a DfT count meet. The newer one wins: the published count on New Bond Street (TfL 2017 against DfT 2009) and Tottenham Court Road (Camden 2022 against DfT 2019), the DfT count on Bloomsbury Way, Theobalds Road, New Oxford Street and Tavistock Square (DfT 2019 to 2025 against published 2017 and 2018).

**LAEI 2022.** Greater London Authority and Transport for London, London Datastore, under the Open Government Licence v3.0. `DATA-LICENSES.md` says why the file is downloaded, not committed. `scripts/laei/download.ts` fetches the major-roads traffic flows (`LAEI2022-major-roads-flows-and-speeds.gpkg` in the GIS archive), 79,437 road links in British National Grid, each with an annual average daily flow per vehicle type. What I established from the file and the LAEI 2022 Methodology Report (section 5.2.3):

- The flows are modelled, not counted. TfL's London Highway Assignment Model (LoHAM) gives peak-hour flows for a 2019 base. Expansion factors from automatic counters, one per zone and road type, turn them into daily flows, and DfT counter growth scales them to 2022. Bus flows come from TfL's iBus records.
- All motor vehicles is the sum of the ten flow columns (motorcycles, taxis, cars, private hire vehicles, LGVs, rigid and articulated HGVs, TfL buses, other buses, coaches), the classes DfT's `all_motor_vehicles` adds up. Check: that sum times link length times 365 over all links is 38.77 billion vehicle-km, the report's total for the major roads.
- A link is one Ordnance Survey road link and carries all the traffic on it. There is no second link per direction: only 28 of the 79,437 links repeat another link's geometry. So a two-way street with one carriageway has one link with both directions, which is the study's `adt`. Where OS maps a road as two carriageways, each carriageway is a link of its own. I could not separate dual carriageways from one-way streets in the data, so the comparisons below do not test how such a link's flow divides.
- Only the major-roads network has links: all A roads, most B roads and many C and unclassified streets. Other streets get no LAEI flow (the minor roads are 1 km grid totals).
- Links with zero flow are no data. TfL's model assigns no traffic to them: Soho Square, or Torrington Place, where the DfT counted 2,140 vehicles a day.

**Matching links to ways** (`scripts/laei/match-links.ts`). Each OSM motor-road way of `today` is cut into pieces of at most 5 m. A piece goes to the nearest link segment that runs alongside it: within 12 m of the piece's midpoint, not more than 3 m beyond the segment's ends, and within 20° of its direction. Link coordinates are converted to WGS84 with the Ordnance Survey's Helmert transformation, which is good to a few metres (`scripts/laei/bng.ts`). A link that covers less than a tenth of a way is dropped, a share rather than a length, so short ways can match. A link LAEI classes as an A road or motorway is never considered for a residential, unclassified, service or living-street way without an A or M road number: such a way beside a main road is a slip, a service road or a side street's mouth. The way takes a flow only when non-zero links cover at least half its length, so a cross street does not pick up a main road's flow where the two meet. Its flow is the length-weighted mean of those links. Per way, `results/laei/ways-matched.csv` records the share covered, the zero-flow share, the flow, the lowest and highest link flow and the links (TOID, road class, flow, metres covered). Of 5,699 motor-road ways, 3,027 have a link along them and 2,899 are matched (116.4 km).

**Checks** (`scripts/laei/validate.ts`, files in `results/laei/`). Ratios are LAEI over the count on the same way. Minor means residential, unclassified, tertiary, living street or service (`comparison-summary.csv`):

| Counts compared | Ways | Median ratio | Within a factor of 1.5 | Within a factor of 2 |
|---|---|---|---|---|
| DfT, all | 117 | 0.76 | 56 | 88 |
| DfT, minor streets | 4 | 1.32 | 1 | 3 |
| Published, all | 57 | 1.06 | 32 | 42 |
| Published, minor streets | 29 | 1.26 | 15 | 19 |
| Published, major roads | 28 | 0.82 | 17 | 23 |

- *Against DfT counts* (`dft-comparison.csv`): almost all are A and B roads, so they say little about back streets. The large misses are short main-road ways at junctions that sit on a short LAEI turning link with a small flow (Theobalds Road, a 39 m way at 467 against 17,292).
- *Against the published counts* (`published-comparison.csv`, with each count's hours and year): on minor streets LAEI runs high, although the 12- and 16-hour counts leave out the night. Wardour Street takes 9,705 against 2,846 counted over 24 hours in 2024 (3.4 times), Devonshire Street 12,464 against 4,313 over 16 hours (2.9 times), Dean Street 2,381 against 1,487 over 24 hours (1.6 times). The extremes are a filtered street (Brunswick Square, 4,167 against 75) and a link with almost no assigned traffic (Cleveland Street, 46 against 927).
- *Per street* (`streets.csv`, length-weighted over the matched ways, lowest to highest link): Brook Street 5,776 (3,794 to 9,249, the name also covers a Brook Street in Bayswater), Upper Brook Street 8,742 (8,068 to 9,360), Wimpole Street 8,119 (5,580 to 9,646), Noel Street 5,187 (3,078 to 8,088), Great Marlborough Street 4,276 (2,506 to 6,783), Maddox Street 3,262 (2,506 to 4,667), Hanover Street 2,608 (2,009 to 3,010), Hanover Square 3,364 (2,009 to 4,892), Grosvenor Square 8,551 (1,595 to 15,855), Carlisle Street 1,819, Soho Square none (its link has zero flow), North Audley Street 5,770 (5,068 to 6,446), Davies Street 3,695 (1,085 to 5,987), Henrietta Place 7,795 (6,076 to 9,268), Berners Street 2,440 (2,432 to 2,445), New Cavendish Street 12,136 (4,110 to 15,624), George Street 7,404 (1,307 to 11,011).
- *False matches* (`minor-high-flow.csv`): 35 residential, unclassified, service or living-street ways take a flow above 10,000. I checked the geometry of these against their links: ways 18771038 (Devonshire Street), 67104773 (Upper Montagu Street, one link at 25,476), 94584336 (Berkeley Square), 303559641 (Maple Street), 4255578 (the Strand at Aldwych, an A road mapped as unclassified) and 292728156 (a 13 m stub of Gordon Street at Euston Road) are genuine matches on streets the model loads heavily. Two remain doubtful: way 832038906, a 6 m stub of Mac Farren Place at Marylebone Road (32,476), and way 38433759, an unnamed 13 m curve off Fitzmaurice Place (11,497). The A-road rule above removed the false matches found earlier: ways 1067121866 and 4257261 (York Gate beside Marylebone Road, 29,649), 240342339 (a residential way beside Park Lane, 36,789), 1426725936 (Half Moon Street, Piccadilly's 16,425) and 150695590 (Chapel Street). The end limit removed ways that only continued a link past a junction (8504992 Northwick Terrace, 207117510 Belgrove Street).
- *Outliers* (`outliers.csv`): 228 matched ways take a flow more than three times above or below the rest of their street. Most are short pieces at junctions, where a link can carry a single turning movement, so a short piece of a busy street can come out very low (Gower Street, 21 m at 81 a day against 10,000 to 15,000 on the rest). Some junction bleed remains: way 1434448178, a 12 m residential way beside Park Lane, takes a 4,766 slip-road link, and a 32 m piece of St George Street shares a 9,226 link.

**Limits.** LAEI is a strategic model, not a count. It is a 2019-base assignment scaled to 2022, so it predates the two-way conversion of Wigmore Street and Mortimer Street (February 2025), the bus diversions and the Oxford Street closure (26 October 2026). Against the counts on the same ways it is within a factor of 2 for 88 of 117 DfT ways and 42 of 57 published-count ways. On minor streets it runs high: the median is 1.26 times the published count, and 10 of 29 differ by more than a factor of 2. Most published counts are from one day, and the 12- and 16-hour counts leave out the night, so they understate the daily flow. Several counted streets have changed since the survey: Tottenham Court Road, Gower Street, Bloomsbury Street and Gloucester Place became two-way, and Newman Street and Berners Street changed direction (`inputs/published-counts/README.md`). The rule is the same as for DfT points, the latest count on a way wins, with no special cases. The one-way factor applies to the carriageway flow of a dual road, as Furth defines it, while a DfT count on such a road is still the two-way total (section 4c).

**Results.** Measured. Files under `results/lts/sensitivity/best-evidence/` and the `best-evidence` rows of `results/lts/sensitivity-summary.csv`.

Volume source of the ways the main run grades by the Furth table, scenario `today` (`coverage.csv`). Both columns cover the same ways, Great Chapel Street's four counted by the volume the best-evidence run still gives them, and both tables give the same figures, since only the class-default values differ:

| `adt_source` | Main runs | Best-evidence run |
|---|---|---|
| `count` | 10.8 km (4.1 %) | 19.8 km (7.6 %) |
| `road` | 52.6 km (20.1 %) | 67.7 km (25.8 %) |
| `laei` | | 37.8 km (14.4 %) |
| `class-default` | 198.5 km (75.8 %) | 136.6 km (52.1 %) |

The new sources regrade 388 ways under `furth2017-low` and 156 under `furth2017-high` (`ways_regraded`, against the main run, Great Chapel Street included). The low-stress network still connects A and B in no run: no LTS 1–2 path in either direction in any scenario under either table.

Headline solution (`today`, two-way tracks, Oxford Street not rideable), converted metres:

| | furth2017-low | furth2017-high |
|---|---|---|
| Main runs | 909 / 802, union 1113 | 1733 / 1902, union 1940 |
| Best-evidence | 1055 / 923, union 1301 | 1726 / 1823, union 1878 |

The best-evidence unions: under `furth2017-low` the north-only set (`union_method` north-only) of Great Cumberland Place, Seymour Street, Portman Square, Fitzhardinge Street, Welbeck Street, Hallam Street, Great Portland Street, Riding House Street, Wells Street, Eastcastle Street, Newman Street, 125 m of Oxford Street's open east end and Soho Street, with crossings at Marble Arch and Langham Street. Under `furth2017-high` Upper Brook Street, Grosvenor Square, Brook Street, Hanover Square, Hanover Street, Maddox Street, Great Marlborough Street, Noel Street, Carlisle Street and Soho Square, with crossings at Brook Gate and Park Lane (the heuristic's set, equal to the south-only one). `headline-streets.csv` lists, per street and volume, the converted metres, the ADT used, its source and, for a count, its id and year. Of the 1301 m, 306 rest on a count, 598 on a carried count, 73 on an LAEI flow (Soho Street) and 324 on a class default (Wells Street 145 m, Riding House Street 122 m, Eastcastle Street 40 m and two short crossings). Published TfL counts lie on Fitzhardinge Street and Welbeck Street and are carried along Great Cumberland Place, Fitzhardinge Street and Newman Street. Of the 1878 m, 1594 rest on an LAEI flow, 97 on a carried DfT count and 187 on a class default, mostly Soho Square (156 m), and no published count lies on them.

What changed the low table. In the main run the northern route leaves Marble Arch on Great Cumberland Place, Fitzhardinge Street and Welbeck Street, which the low guess makes calm (LTS 2) apart from one Great Cumberland Place way, and converts Oxford Street's east end, Newman Street, Wells Street, Mortimer Street, the Cavendish spine and short pieces of Wigmore Street, Wimpole Street, Gloucester Place and Great Cumberland Place (1113 m). The best-evidence run finds TfL counts on all three (Great Cumberland Place 7,825 over 16 hours in 2017, Fitzhardinge Street 3,849, Welbeck Street 4,579), and an LAEI flow on Soho Street (1,623), so they grade LTS 3 and the northern set has to convert them: it costs 1301 m. The southern alternative costs 1359 m. Noel Street and Great Marlborough Street, on the high table's set and the low table's southern alternative, take modelled flows (3,078 to 8,088 and 2,506 to 6,783) in an area where the model runs high against counts (Wardour Street, Dean Street above). Per direction the low table's minima lie on different sides: A→B south (1055 m), B→A north (923 m: Newman Street, Wells Street, Mortimer Street, Cavendish Place, starting from Carlisle Street in Soho). The routes the low union opens still rest on guesses: of the A→B route's 1,721 m of calm street, 1,545 m carry a class default, mostly Queen Anne Street (268 m), Duchess Street, Wells Mews, Manchester Square, Bentinck Street and Hinde Street.

The fixes to the first version of this run moved the low table's heuristic union from 1333 to 1359 m (B→A minimum 906 to 923 m), and the side candidates then bring it to 1301 m. The high table's union stayed at 1878 m. Short ways now take LAEI flows (pieces of Noel Street, Maddox Street, Great Marlborough Street, Grosvenor Gate and Carlisle Street that had sat on the guess), published counts no longer travel along a shared road number (St Giles High Street's count onto High Holborn, New Bond Street's onto Vere Street, Henrietta Place and Welbeck Street), and Carlos Place lost its 12,073: one of its two links now covers less than a tenth of it, which leaves less than half the way covered.

Over all 32 runs (`runs.csv`, with `union_method`) the per-direction minima range from 847 to 1824 m and the unions from 1078 to 2845 m (`furth2017-low` 1078 to 1817 m, `furth2017-high` 1465 to 2845 m). A side candidate wins in one of the 32 (`furth2017-low`, `today`, two-way tracks, north-only). In the frequency table (`frequency.csv`, 32 runs each) Carlisle Street is in 31 of the 32 unions (16 in the main runs), Great Marlborough Street and Noel Street in 27 (23), Oxford Street in 19 (17), Soho Square in 16 (16), Park Lane in 13 (8), Great Chapel Street in none (27), and the Cavendish Square, Cavendish Place and Mortimer Street spine in 7 (12). No street is in all 32.

How close to the line (`close-to-line.csv`): of the converted metres of the headline solution, those that rest on an LAEI flow within a factor of 2 of the calm threshold that applied to the way, the highest ADT at which its row and speed column still grade LTS 2 (divided by 1.5 on a one-way way). An LAEI overestimate of up to that factor could make them calm. `furth2017-low`: 73 m, all of it Soho Street (1,623 against a threshold of 1,500 on 60 m and of 1,000 on 13 m one-way). `furth2017-high`: 81 m, 48 m of Carlisle Street (1,819 against 1,000), 9 m of Great Marlborough Street (4,645 against 3,000) and 24 m of Hanover Square (2,091 against 1,500). The file also takes the calm streets of the route the union opens in each direction: none of them rests on an LAEI flow within a factor of 2 of its threshold.

Cautious rider (`<table>/today/summary.csv`, scenario `today`, the regraded ways): under `furth2017-low` 3537 m A→B with 776 m of LTS 3 (Berkeley Square, Bruton Street and Brewer Street among them) and 3499 m B→A with 991 m of LTS 3 (Charlotte Street, Riding House Street and Gloucester Place among them), against 4053 / 3392 m with 374 / 643 m of LTS 3 in the main run. Under `furth2017-high` 2578 m A→B with 1821 m of LTS 3 and 2566 m B→A with 2007 m, against 2578 / 2559 m with 1877 / 2069 m in the main run.

**Robustness checks** (`scripts/lts/robustness.ts`, `results/lts/sensitivity/best-evidence/robustness.csv`, gap-closing files under `robustness/<check>/<mode>/today/`). Each check changes the best-evidence grading in one respect, through the same code as the main runs' sensitivities, then reruns the connectivity test and the search: scenario `today`, two-way tracks, Oxford Street not rideable. No check connects A and B on low-stress streets in either direction. Converted metres, A→B / B→A minima and union:

| Check | Change | furth2017-low | furth2017-high |
|---|---|---|---|
| (best evidence) | | 1055 / 923, union 1301 | 1726 / 1823, union 1878 |
| `counts-only` | no LAEI step: counts, carried counts, guesses | 929 / 875, union 1236 | 1726 / 1840, union 1878 |
| `counts-only-zero` | no LAEI step, every guess at 0 (both tables identical, checked) | 58 / 90, union 148 | 58 / 90, union 148 |
| `lt20` | 20 mph read in the ≤ 20 mph column | 829 / 617, union 1219 | 1081 / 1268, union 1325 |
| `unlaned` | untagged two-way residential streets unlaned (high table only, as in the main runs) | | 1212 / 1330, union 1356 |
| `uk-ltn120` | LTN 1/20 limit instead of Furth's table | 886 / 654, union 1248 | 1232 / 1117, union 1518 |
| `guesses-750` | remaining back-street guesses at 750 | 911 / 639, union 1308 | 911 / 639, union 1308 |
| `guesses-zero` | every remaining guess at 0 (both tables identical, checked) | 911 / 639, union 1292 | 911 / 639, union 1292 |
| `laei-halved` | every LAEI flow × 0.5 | 941 / 875, union 1237 | 1645 / 1751, union 1801 |
| `laei-doubled` | every LAEI flow × 2 | 1055 / 923, union 1301 | 1726 / 1829, union 1878 |

The unions with their streets and `union_method` are in `robustness.csv`. A side candidate wins in four checks, all north-only: `guesses-750` under both tables, `laei-halved` and `laei-doubled` under `furth2017-low`. The counts alone (`counts-only-zero`) require what the main runs' `uncounted-zero` requires, 148 m of crossings and Grosvenor Gate: the published counts add nothing there. With the LAEI flows added and every remaining guess at zero (`guesses-zero`), 1292 m: Park Lane, North Audley Street, South Audley Street, Grosvenor Street, Maddox Street, Great Marlborough Street, Noel Street, Carlisle Street and Davies Street, with crossings.

**North against south** (`scripts/lts/side-comparison.ts`, `results/lts/sensitivity/side-comparison.csv`, gap-closing files under `side-comparison/<grading>/<mode>/<side>/`). The union of both directions is a heuristic, so each side's cost is measured on its own. The side line is the straight line between the trip ends, which sit at the two ends of Oxford Street, so it follows the street. `north-only` forbids every way lying wholly more than 30 m south of the line, `south-only` every way lying wholly more than 30 m north of it. Ways on or crossing that band stay, so the first block of a cross street stays on both sides. The 30 m keep the trip-end snap nodes (B's lies 12 m south of the line) and the junction mouths at both ends, and stay well under the distance to the first parallel streets either side. Oxford Street bows north of the line, up to 76 m in its middle, so its middle counts as north. L4 and the budget come from the whole network, so each side meets the same quarter-longer bar. Scenario `today`, two-way tracks, Oxford Street not rideable. Union converted metres, with the route it opens (A→B / B→A) against the shortest legal ride:

| Grading | North only | South only | Unconstrained union |
|---|---|---|---|
| Main, furth2017-low | 1113 (routes 1.22 / 1.24 × L4) | 1298 (1.06 / 0.99) | 1113 |
| Main, furth2017-high | 2149 (1.03 / 0.98) | 1940 (1.04 / 1.01) | 1940 |
| Best evidence, furth2017-low | 1301 (1.25 / 1.23) | 1359 (1.17 / 1.16) | 1301 |
| Best evidence, furth2017-high | 2142 (1.08 / 1.03) | 1878 (1.04 / 1.01) | 1878 |

Every side has a solution within the budget, and no side connects A and B on low-stress streets as it stands. For the main runs, whose unions stay the plain heuristic, the cheaper side equals the union under both tables (1113 m, 1940 m), so the heuristic did not miss a cheaper one-sided set there. For best evidence under `furth2017-low` the heuristic alone found 1359 m (southern) while the northern set costs 1301 m. The heuristic starts from each direction's Pareto frontier and from the minimum with one street banned at a time. The northern A→B solution (1093 m converted, 2980 m path) is dominated by two southern frontier points (1055 m and 1076 m with shorter paths), so it never seeds the union, and banning one southern street at a time leads to other southern sets. The best-evidence union therefore takes both sides as candidates (above) and now reports 1301 m. Under `furth2017-high` south is cheaper by 264 m (best evidence) and 209 m (main).

### Through-traffic check: can the map tell busy side streets from quiet ones?

About half the graded street length still takes the quiet or busy guess (`coverage.csv` above). The grading only needs to know whether a street is over or under its calm threshold, so I tested whether the map alone can tell: a street that can serve through motor traffic should be busy, a street that cannot should be quiet. It cannot tell, so no grading uses it. Code: `scripts/through/`, run with `bun run reproduce:through` (it re-extracts `today` with Docker and reads the best-evidence and side-comparison outputs, so it is not part of `reproduce:lts`). Outputs: `results/through/`.

**What was tested.** A driving graph of `today`: ways open to general motor traffic in the directions a car may drive them, without ways whose access tags bar through traffic (`no`, `private`, `destination`, `delivery` and similar), and without nodes that stop a car. The ways file carries no node tags, so the nodes with a barrier or access tag are read from the bbox extract with the pinned osmium image. 300 nodes on car ways stop a car, by a barrier (bollards most often) or by their own access tags. Gates without access tags count as passable, as in the OSRM car profile. Travel time is length over the OSRM car profile's class speed, capped at the posted limit. There are no turn delays or turn restrictions. Through trips run between the 100 entry and 104 exit points where a public road crosses the study bbox, 6,501 trips in all. Three measures per way (`results/through/ways.csv`): on the fastest path of a trip (with the number of trips), within a factor of 1.1, 1.2 or 1.3 of a trip's fastest time (with the number of trips, and the least such factor), and structural, on a drivable route between two different main roads over minor streets. On the counted main roads the measures behave: 128 of 138 lie on a fastest path, and the two that are not drivable are the bus-only Oxford Street and Strand.

**Validation set** (`results/through/validation.csv`, by group in `summary.csv`): the 86 ways of a minor class (residential, living street, unclassified, tertiary, service) that carry a count on the way itself in the best-evidence grading. A way is busy when its count is over the calm threshold that applies to it (the threshold of the close-to-line check). 63 are over and 23 under. By class: residential 20 over and 11 under, unclassified 24 and 12, tertiary 19 and 0. 16 are within a factor of 1.5 of their threshold.

| Predictor | Accuracy | Calm street called busy | Busy street called calm |
|---|---|---|---|
| Every counted side street busy | 0.733 | 1.00 | 0.00 |
| Quiet guess | 0.558 | 0.22 | 0.52 |
| Busy guess | 0.744 | 0.83 | 0.05 |
| In the LAEI network | 0.593 | 0.09 | 0.52 |
| LAEI flow over the threshold | 0.605 | 0.04 | 0.52 |
| On a fastest path (trip count chosen by leave-one-out) | 0.477 | 0.09 | 0.68 |
| Within 1.1 / 1.2 / 1.3 of a fastest path | 0.709 / 0.698 / 0.698 | 0.96 / 1.00 / 1.00 | 0.05 |
| Least detour factor under a threshold (leave-one-out) | 0.651 | 0.70 | 0.22 |
| Within a factor of a fastest path for enough trips (leave-one-out) | 0.744 | 0.83 | 0.05 |
| Structural | 0.721 | 0.91 | 0.05 |

Where a measure has a free threshold, the table gives the leave-one-out result (`results/through/predictors.csv`, which also has the in-sample figures and the confusion matrices). Counted flows by predicted class are in `flows.csv`.

**Conclusion.** No measure from the map alone beats calling every counted side street busy, so none is used. The West End grid lets almost every street serve a through trip within a few per cent of the fastest time, and the quiet and the busy counted streets overlap in every measure.

Two facts from the validation that the study leans on:

- Of the 54 counted minor ways that TfL's model network (LAEI) leaves out, 33 are over the calm threshold and 21 under (`results/through/summary.csv`, row "not in the LAEI network").
- The quiet guess classifies 56 % of the 86 correctly, the busy guess 74 % (`results/through/predictors.csv`).

Selection caveat: counts are taken where traffic is expected, so the counted streets are busier than side streets in general, and the sample of calm streets is small (23, none of them tertiary).

**Map-data notes** (not findings). These streets carry counts far below what an open through street would carry, while the map shows them open and connected: Gate Street (73 vehicles a day), Brunswick Square (75), Lamb's Conduit Street (207), Carburton Street (347), Bruton Lane (354), Conway Street (415) and Huntley Street (481). Unmapped filters or timed closures may explain them.

### Results detail

Allowing cycling through the pedestrianised Oxford Street (`--allow-oxford`) lowers the requirement under high back-street volumes today and under full closure, but not with a Wigmore Street track (there the A→B minimum rises from 1539 to 1542 m and the union from 1739 to 2031 m without two-way tracks; with them the union stays at 1527 m and A→B rises from 1469 to 1504 m). Under low volumes it never lowers a per-direction minimum; only the unions without two-way tracks drop, slightly today and under full closure (1561 → 1548 m, 1561 → 1556 m) and more under the sealed closure (1668 → 1556 m). Closing all of Oxford Street leaves the per-direction minima unchanged (high volumes 1788 / 1903 m; low volumes 1054 m A→B, B→A 1036 → 1041 m, without two-way tracks) but raises the unions found: under high volumes without two-way tracks from 2490 to 2913 m, under low volumes with two-way tracks from 1113 to 1190 m (today's set, which is the exact optimum, uses 125 m of the eastern stub). The unions are heuristic upper bounds (see the caveats), so part of a rise can come from the heuristic rather than the closure: for high volumes without two-way tracks, the exact optimum is 2347 m today and uses none of the western stub, against 2882 m under full closure.

## Detour of the confident rider (`scripts/lts/detour.ts`)

`results/lts/detour-summary.csv` compares, per direction, L4 today with L4 on the `--allow-oxford` reconstruction: the pedestrianised Oxford Street ways made rideable as a two-way LTS 3 track with their leftover one-way tags dropped. That reconstruction is not the pre-ban network, so the difference is the detour against a rideable Oxford Street as reconstructed here, not against the old ride. Both values are computed between the same furth2017 low-stress snap nodes (from the `today`, `--allow-oxford`, no-contraflow rows of `gap-closing-summary.csv`; identical under both furth2017 tables), so like is compared with like:

| Direction | L4 today | L4 with the reconstruction | Difference | At Valhalla's average speed |
|---|---|---|---|---|
| A→B | 2385 m | 2056 m | +329 m (+16.0 %) | 52 s at 23.0 km/h |
| B→A | 2508 m | 2295 m | +213 m (+9.3 %) | 36 s at 21.3 km/h |

The speed is Valhalla's distance over time for the same trip, scenario `today`, setting `confident` (`results/valhalla/today/summary.csv`: 2595 m in 407 s A→B, 2796 m in 472 s B→A). The time is a calculation, not a measured time. Do not set these L4 values against the `mekuria2012` ones (A→B 2424 m, B→A 2507 m): that table snaps the trip ends to different low-stress nodes.

## Outputs

- `results/lts/<mode>/<scenario>/<trip>-<rider>.geojson` and `summary.csv`, for `<mode>` ∈ {bikeottawa, mekuria2012, furth2017-low, furth2017-high, furth2017-low-lt20, furth2017-high-lt20}, plus `furth2017-high-unlaned` for `today` only. The `-lt20` modes are the furth2017 tables run with `--speed-col lt20`, the `-unlaned` mode with `--untagged-unlaned`.
- `results/lts/<mode>/street-lts.csv`: LTS per corridor street (not for the one-scenario `-unlaned` mode). For the furth2017 modes, `adt` is the ADT range and `adt_source` the metres per volume source; `rules` shows `f17-blocked-lane+…` for painted lanes.
- `results/lts/<mode>/<scenario>/gap-closing[-allow-oxford][-contraflow].csv` (per direction a `min` and a `knee` row with `converted_m`, `links_m`, `crossings_m`, `contraflow_m`, `path_m`, `l4_m`, `l4_base_m`, `budget_m`, plus a `union` row), `.geojson` (converted edges with `street`, `lts`, `length_m`, `fragment` = link/crossing, `solution`, `direction`, and `contraflow` on path arcs) and `gap-closing-frontier[-allow-oxford][-contraflow].csv` (the Pareto frontier per direction; `role` marks min and knee), for `<mode>` ∈ {furth2017-low, furth2017-high, furth2017-low-lt20, furth2017-high-lt20} and (one variant) furth2017-high-unlaned.
- `results/lts/gap-closing-summary.csv`: one row per gap-closing run, 65 in all. `table` is the mode name; `speed_col` (25 | lt20) and `untagged_two_way` (centreline | unlaned) give its options. The 32 headline rows are those with `speed_col` 25 and `untagged_two_way` centreline; the 32 `lt20` rows and the single `unlaned` row are sensitivities. Wall-clock runtimes go to the log only, so a rerun leaves the file unchanged. `bun scripts/lts/gap-closing.ts` runs all 65; `bun scripts/lts/gap-closing.ts <scenario> --table <table> [--speed-col 25|lt20] [--untagged-unlaned] [--allow-oxford] [--contraflow]` runs one.
- `results/lts/detour-summary.csv`: the confident rider's detour per direction (see "Detour of the confident rider").
- `results/lts/sensitivity-summary.csv`, `results/lts/sensitivity/<name>/<table>/<scenario>/gap-closing*.{csv,geojson}` and `results/lts/sensitivity/{great-chapel-traffic-free,best-evidence}/frequency.csv`: the sensitivity runs (see "Sensitivity runs"); `bun scripts/lts/sensitivity.ts` reruns them.
- `results/lts/sensitivity/side-comparison.csv` and `results/lts/sensitivity/side-comparison/<grading>/<mode>/<side>/gap-closing*`: north against south (`bun scripts/lts/side-comparison.ts`).
- `results/lts/sensitivity/best-evidence/`: the best-evidence run's own tables, `runs.csv`, `headline-streets.csv`, `coverage.csv` and `close-to-line.csv`, and the riders' routes on its grading for `today` (`<table>/today/<trip>-<rider>.geojson`, `summary.csv`); `bun scripts/lts/best-evidence.ts` rewrites them after `sensitivity.ts`. `robustness.csv` and `robustness/<check>/<mode>/today/gap-closing*`: the robustness checks (`bun scripts/lts/robustness.ts`). The volumes come from `results/published-counts/counts-matched.csv` (`bun scripts/published-counts/match.ts`) and `results/laei/ways-matched.csv` (`bun run reproduce:laei`: download, match, and the checks `dft-comparison.csv`, `published-comparison.csv`, `comparison-summary.csv`, `streets.csv`, `minor-high-flow.csv`, `outliers.csv`; provenance in `results/laei/source.json`).
- `results/through/`: the through-traffic check (`bun run reproduce:through`, see "Through-traffic check").
- `bun scripts/lts/run-all.ts` runs every mode for every scenario, the `-unlaned` mode for `today`, then the gap-closing variants, the detour summary, the sensitivity runs, the best-evidence tables, its robustness checks and the side comparison. The single steps take `--table <table>` (default bikeottawa) and, for the furth2017 tables, `--speed-col 25|lt20` (default 25) and `--untagged-unlaned`.
