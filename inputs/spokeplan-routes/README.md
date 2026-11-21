# SpokePlan routes: Hammersmith to Russell Square

Two routes returned by SpokePlan's production routing API on 16 November 2026, saved as returned (GeoJSON Features: a LineString with lon, lat, elevation, and the planner's `distance` in metres, `time` in seconds, `ascent`, `energy` and per-point `surface`). They are SpokePlan's own output. This repository cannot reproduce them: the planner, its profiles and its map data are not part of the study. The `long-trip` figure draws them (`scripts/figures/data.ts`, `figures/README.md`), and `scripts/long-trip/run.ts` compares Valhalla routes with them.

Both run from 51.49374, -0.21518 (Hammersmith) to 51.52161, -0.12602 (Russell Square), with no via points. Both requests are the planner's presets with their default speed and mass.

| File | SpokePlan preset | Planner distance | Request |
|---|---|---|---|
| `hammersmith-russell-square-road.geojson` | Road | 8,629 m | <https://spokeplan.com/api/routing/calculate?w=-0.21518,51.49374%7C-0.12602,51.52161&sa=0.7&ta=0.3&tw=28&fs=28&rp=128&tm=80&crr=0.00445&cda=0.35&af=false> |
| `hammersmith-russell-square-city.geojson` | City | 9,997 m | <https://spokeplan.com/api/routing/calculate?w=-0.21518,51.49374%7C-0.12602,51.52161&sa=0.6&ta=0.4&na=0.1&sp=0&tw=42&fs=20&rp=90&tm=100&crr=0.00592&cda=0.55&af=false> |

The same two routes are saved as SpokePlan share links: [Road preset](https://spokeplan.com/s/nlBYhXsMFadl) and [City preset](https://spokeplan.com/s/MjMjUSIACIpF).
