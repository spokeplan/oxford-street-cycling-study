// Runs the Oxford Street corridor trips against a local Valhalla and writes
// full responses plus summary.csv to results/valhalla/<scenario>/.
// Usage: bun scripts/run-trips.ts <scenario>
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { POINTS, TRIPS, type LonLat } from "./lts/common";

const VALHALLA = "http://localhost:8002";
const M_PER_KM = 1000;
const OXFORD_STREET = "Oxford Street";
const WIGMORE_STREET = "Wigmore Street";
// Edge uses that indicate pedestrian-only infrastructure (Valhalla Use enum names).
const PEDESTRIAN_USES = new Set(["footway", "pedestrian", "sidewalk", "steps", "pedestrian_crossing", "elevator"]);

// bicycle_type omitted for "reference" -> Valhalla's default (Hybrid).
const SETTINGS: Record<string, Record<string, unknown>> = {
  confident: { use_roads: 0.8, bicycle_type: "Road", shortest: false },
  cautious: { use_roads: 0.2, bicycle_type: "Hybrid", shortest: false },
  reference: { use_roads: 0.5, shortest: false },
};

const scenario = process.argv[2];
if (!scenario) {
  console.error("Usage: bun scripts/run-trips.ts <scenario>");
  process.exit(1);
}
const outDir = join(import.meta.dir, "..", "results", "valhalla", scenario);
await mkdir(outDir, { recursive: true });

async function post(action: string, body: unknown): Promise<any> {
  const res = await fetch(`${VALHALLA}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${action} ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

const loc = ([lon, lat]: LonLat) => ({ lon, lat });
const round = (x: number) => Math.round(x);
const csvCell = (v: unknown) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

const header = [
  "scenario", "trip", "setting", "distance_m", "time_s", "street_sequence",
  "uses_oxford_street", "oxford_street_m",
  // Edge-level cross-check via /trace_attributes on the returned shape:
  "edge_street_sequence", "edge_oxford_street_m", "edge_pedestrian_use_m", "edge_wigmore_street_m", "wigmore_cycle_lane",
];
const rows: string[][] = [];

for (const [trip, [from, to]] of Object.entries(TRIPS)) {
  for (const [setting, bicycle] of Object.entries(SETTINGS)) {
    const costing_options = { bicycle };
    const route = await post("route", {
      locations: [loc(POINTS[from]), loc(POINTS[to])],
      costing: "bicycle",
      costing_options,
      directions_options: { units: "kilometers" },
    });
    await writeFile(join(outDir, `${trip}-${setting}.json`), JSON.stringify(route, null, 2) + "\n");

    const leg = route.trip.legs[0];
    const maneuvers: any[] = leg.maneuvers;
    const sequence: string[] = [];
    let oxfordM = 0;
    for (const m of maneuvers) {
      const names: string[] = m.street_names ?? [];
      const label = names.join(" / ");
      if (label && sequence.at(-1) !== label) sequence.push(label);
      if (names.includes(OXFORD_STREET)) oxfordM += m.length * M_PER_KM;
    }

    const attrs = await post("trace_attributes", {
      encoded_polyline: leg.shape,
      shape_match: "edge_walk",
      costing: "bicycle",
      costing_options,
      directions_options: { units: "kilometers" },
      filters: { attributes: ["edge.names", "edge.length", "edge.use", "edge.way_id", "edge.cycle_lane"], action: "include" },
    });
    await writeFile(join(outDir, `${trip}-${setting}.edges.json`), JSON.stringify(attrs, null, 2) + "\n");
    let edgeOxford = 0, edgePed = 0, edgeWigmore = 0;
    const wigmoreLanes = new Set<string>();
    // Maneuver street_names only keep names shared by all edges of a maneuver
    // (often just a ref like A5204), so also build the sequence from edges:
    // first name (refs come after names), or "(<use>)" for unnamed edges.
    const edgeSeq: string[] = [];
    for (const e of attrs.edges ?? []) {
      const m = e.length * M_PER_KM;
      const names: string[] = e.names ?? [];
      const label = names[0] ?? `(${e.use})`;
      if (edgeSeq.at(-1) !== label) edgeSeq.push(label);
      if (names.includes(OXFORD_STREET)) edgeOxford += m;
      if (PEDESTRIAN_USES.has(e.use)) edgePed += m;
      if (names.includes(WIGMORE_STREET)) { edgeWigmore += m; wigmoreLanes.add(e.cycle_lane); }
    }

    rows.push([
      scenario, trip, setting,
      String(round(route.trip.summary.length * M_PER_KM)), String(round(route.trip.summary.time)),
      sequence.join(" > "),
      String(oxfordM > 0), String(round(oxfordM)),
      edgeSeq.join(" > "), String(round(edgeOxford)), String(round(edgePed)), String(round(edgeWigmore)), [...wigmoreLanes].join("|"),
    ]);
  }
}

const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
await writeFile(join(outDir, "summary.csv"), csv);
console.log(csv);
