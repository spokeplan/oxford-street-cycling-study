// Through-traffic measures for every car-class way of the `today` scenario
// (data/lts/today-ways.geojson, re-extracted first): builds the driving graph
// (graph.ts, node tags from nodes.ts), the through trips between portals and the
// measures of measures.ts. Writes results/through/ways.csv (per way: drivable or
// why not, fastest_pairs, detour_ratio, near_pairs_<tolerance>, structural) and
// results/through/portals.csv.
// Usage: bun scripts/through/run.ts   (then bun scripts/through/validate.ts)
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { toCsv } from "../dft/common";
import { waysPath, type WayFeature } from "../lts/common";
import { extractGraph } from "../lts/extract-graph";
import { CLASS_SPEED_KMH, MAIN_HIGHWAYS, SCENARIO, THROUGH_RESULTS, THROUGH_WAYS_CSV, carDirections } from "./common";
import { buildDrivingGraph } from "./graph";
import { TOLERANCES, portals, structuralThrough, tripMeasures } from "./measures";
import { nodeTags } from "./nodes";

const RATIO_DECIMALS = 4;
const YES = "yes", NO = "no", MAIN = "main";

await extractGraph(SCENARIO);
const ways = ((await Bun.file(waysPath(SCENARIO)).json()) as { features: WayFeature[] }).features
  .filter((f) => String(f.properties.highway) in CLASS_SPEED_KMH);
const tags = await nodeTags(SCENARIO);
const g = buildDrivingGraph(ways, tags);
const highwayOf = new Map(ways.map((f) => [f.properties["@id"], String(f.properties.highway)]));
const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);
const identityOf = new Map(ways.flatMap((f) => {
  const id = str(f.properties.ref) ?? str(f.properties.name);
  return id ? [[f.properties["@id"], id] as const] : [];
}));

const ports = portals(g, highwayOf);
const { fastestPairs, detour, nearPairs, pairs } = tripMeasures(g, ports);
const structural = structuralThrough(g, highwayOf, identityOf);

// Node stops that lie on a car-class way, for the log and the report.
const onWays = new Set(ways.flatMap((f) => f.properties["@nodes"]));
const stopsOnWays = [...g.stops].filter(([id]) => onWays.has(id));

const drivable = new Set(g.way);
const rows = ways.map((f) => {
  const p = f.properties;
  const id = p["@id"];
  const dirs = carDirections(p);
  const reason = g.closed.get(id) ?? (drivable.has(id) ? "" : "cut off by node stops");
  return {
    way_id: id, name: str(p.name) ?? "", highway: String(p.highway), car_oneway: dirs.forward && dirs.backward ? NO : YES,
    drivable: reason === "" ? YES : NO, closed_reason: reason,
    fastest_pairs: fastestPairs.get(id) ?? 0, detour_ratio: detour.has(id) ? detour.get(id)!.toFixed(RATIO_DECIMALS) : "",
    ...Object.fromEntries(TOLERANCES.map((tol, x) => [`near_pairs_${tol}`, nearPairs.get(id)?.[x] ?? 0])),
    structural: MAIN_HIGHWAYS.has(String(p.highway)) ? MAIN : structural.has(id) ? YES : NO,
    node_stops: p["@nodes"].filter((n) => g.stops.has(n)).map((n) => `${n}:${g.stops.get(n)}`).join(" "),
  };
}).sort((a, b) => a.way_id - b.way_id);

await mkdir(THROUGH_RESULTS, { recursive: true });
await writeFile(THROUGH_WAYS_CSV, toCsv(Object.keys(rows[0]), rows));
const portalRows = [...ports.origins.map((v) => ({ v, role: "origin" })), ...ports.destinations.map((v) => ({ v, role: "destination" }))]
  .map(({ v, role }) => ({ node_id: g.nodeIds[v], role, lon: g.coords[v][0], lat: g.coords[v][1] }));
await writeFile(join(THROUGH_RESULTS, "portals.csv"), toCsv(Object.keys(portalRows[0]), portalRows));
console.log(`${ways.length} car-class ways, ${drivable.size} drivable; ${g.nodeIds.length} vertices, ${g.tail.length} arcs; ` +
  `${stopsOnWays.length} node stops on car-class ways; ${ports.origins.length} origin and ${ports.destinations.length} destination portals, ` +
  `${pairs} through trips; ${structural.size} minor ways structurally through -> ${THROUGH_RESULTS}`);
