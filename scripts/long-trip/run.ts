// Long-trip experiment: routes Hammersmith (Brook Green) -> Russell Square with
// Valhalla's bicycle costing at several use_roads settings and compares each route
// with two SpokePlan routes (a Road-preset and a City-preset GeoJSON Feature).
// Writes one GeoJSON Feature per Valhalla route plus summary.csv to results/long-trip/.
// Needs the 'today' Valhalla container on localhost:8002 (bun valhalla/run.ts today
// data/greater-london-latest.osm.pbf; remove it afterwards with docker rm -f valhalla-today).
// Usage: bun scripts/long-trip/run.ts [spokeplan-road.json] [spokeplan-city.json]
//   (defaults: the two saved routes in inputs/spokeplan-routes/; read only)
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { OXFORD_FULL_WINDOW, OXFORD_PED_WINDOW, ROOT, type LonLat } from "../lts/common";

const VALHALLA = "http://localhost:8002";
const OUT_DIR = join(ROOT, "results", "long-trip");
const M_PER_KM = 1000;
const S_PER_MIN = 60;
const EARTH_RADIUS_M = 6_371_000;
/** A point of one route counts as shared with another when it lies within this distance of it, metres. */
const OVERLAP_TOLERANCE_M = 25;
/** Spacing at which a route is resampled for the overlap measure, metres. */
const SAMPLE_STEP_M = 5;
/** Valhalla encodes route shapes as polylines with 6 decimal places. */
const POLYLINE_PRECISION = 1e6;
const OXFORD_STREET = "Oxford Street";

const FROM: LonLat = [-0.21504, 51.49378]; // Hammersmith, near Brook Green
const TO: LonLat = [-0.12601, 51.52161]; // Russell Square
// Via points in Kensington, hand-placed on an earlier SpokePlan route (since dropped), used as Valhalla 'through' locations.
const KENSINGTON_VIAS: LonLat[] = [[-0.19505, 51.50037], [-0.1932, 51.50104]];
/** Longitudes across the West End at which each route's latitude is reported, degrees. */
const PROBE_LONS = [-0.2, -0.19, -0.18, -0.17, -0.16, -0.15, -0.14, -0.13];

// Repo default for the other options: shortest false, as in scripts/run-trips.ts.
// The sweep uses bicycle_type Road (the repo's confident setting); hybrid-0 and the
// repo's own confident/cautious presets are added for reference.
interface Variant { id: string; bicycle: Record<string, unknown>; via: boolean }
const sweep = (useRoads: number): Variant => ({ id: `road-${useRoads}`, bicycle: { use_roads: useRoads, bicycle_type: "Road", shortest: false }, via: false });
const VARIANTS: Variant[] = [
  ...[1.0, 0.5, 0.25, 0.1, 0.0].map(sweep),
  { id: "hybrid-0", bicycle: { use_roads: 0.0, bicycle_type: "Hybrid", shortest: false }, via: false },
  { id: "repo-confident", bicycle: { use_roads: 0.8, bicycle_type: "Road", shortest: false }, via: false },
  { id: "repo-cautious", bicycle: { use_roads: 0.2, bicycle_type: "Hybrid", shortest: false }, via: false },
  // Second pass: the traffic-averse settings forced through the Kensington via points.
  { id: "road-0-via", bicycle: { use_roads: 0.0, bicycle_type: "Road", shortest: false }, via: true },
  { id: "hybrid-0-via", bicycle: { use_roads: 0.0, bicycle_type: "Hybrid", shortest: false }, via: true },
];

const [roadArg, cityArg] = process.argv.slice(2);
const SPOKEPLAN: Record<string, string> = {
  road: roadArg ?? join(ROOT, "inputs", "spokeplan-routes", "hammersmith-russell-square-road.geojson"),
  city: cityArg ?? join(ROOT, "inputs", "spokeplan-routes", "hammersmith-russell-square-city.geojson"),
};

const rad = (d: number) => (d * Math.PI) / 180;
function haversine(a: LonLat, b: LonLat): number {
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}
const lengthM = (c: LonLat[]) => c.slice(1).reduce((s, p, i) => s + haversine(c[i], p), 0);

/** Decodes a Google-style encoded polyline at Valhalla's precision into [lon, lat] pairs. */
function decodePolyline(str: string): LonLat[] {
  const out: LonLat[] = [];
  let i = 0, lat = 0, lon = 0;
  const next = () => {
    let shift = 0, result = 0, byte: number;
    do { byte = str.charCodeAt(i++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < str.length) { lat += next(); lon += next(); out.push([lon / POLYLINE_PRECISION, lat / POLYLINE_PRECISION]); }
  return out;
}

/** Latitude where the route first crosses the longitude, or "" if it never does. */
function latAt(c: LonLat[], lon: number): string {
  for (let i = 1; i < c.length; i++) {
    const [a, b] = [c[i - 1], c[i]];
    if ((a[0] - lon) * (b[0] - lon) <= 0) {
      const t = a[0] === b[0] ? 0 : (lon - a[0]) / (b[0] - a[0]);
      return (a[1] + t * (b[1] - a[1])).toFixed(4);
    }
  }
  return "";
}

// Overlap: points are projected to a local equirectangular plane (metres), which
// is accurate to well under a metre over a London-sized area.
const LAT0 = rad((FROM[1] + TO[1]) / 2);
const M_PER_DEG = (EARTH_RADIUS_M * Math.PI) / 180;
const toXY = ([lon, lat]: LonLat): [number, number] => [lon * M_PER_DEG * Math.cos(LAT0), lat * M_PER_DEG];
function pointSegDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
/** Share of route a's length lying within OVERLAP_TOLERANCE_M of route b (resampled every SAMPLE_STEP_M). */
function overlapShare(a: LonLat[], b: LonLat[]): number {
  const A = a.map(toXY), B = b.map(toXY);
  let near = 0, total = 0;
  for (let i = 1; i < A.length; i++) {
    const segLen = Math.hypot(A[i][0] - A[i - 1][0], A[i][1] - A[i - 1][1]);
    const n = Math.max(1, Math.ceil(segLen / SAMPLE_STEP_M));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const p: [number, number] = [A[i - 1][0] + t * (A[i][0] - A[i - 1][0]), A[i - 1][1] + t * (A[i][1] - A[i - 1][1])];
      let d = Infinity;
      for (let j = 1; j < B.length && d > OVERLAP_TOLERANCE_M; j++) d = Math.min(d, pointSegDist(p, B[j - 1], B[j]));
      total += segLen / n;
      if (d <= OVERLAP_TOLERANCE_M) near += segLen / n;
    }
  }
  return total === 0 ? 0 : near / total;
}

async function post(action: string, body: unknown): Promise<any> {
  const res = await fetch(`${VALHALLA}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${action} ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

const csvCell = (v: unknown) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const pct = (x: number) => (100 * x).toFixed(0);

const spokeplan: Record<string, LonLat[]> = {};
for (const [name, path] of Object.entries(SPOKEPLAN)) {
  const f = JSON.parse(await Bun.file(path).text());
  spokeplan[name] = (f.geometry.coordinates as number[][]).map(([lon, lat]) => [lon, lat] as LonLat);
}

await mkdir(OUT_DIR, { recursive: true });
const header = [
  "variant", "bicycle_options", "via", "length_km", "time_min",
  ...PROBE_LONS.map((l) => `lat_at_${l}`),
  "west_end_streets", "west_end_edge_streets", "oxford_street_m", "oxford_ped_stretch_m",
  ...Object.keys(spokeplan).flatMap((s) => [`${s}_length_diff_km`, `share_near_${s}_pct`, `${s}_share_near_this_pct`]),
];
const rows: string[][] = [];
for (const name of Object.keys(spokeplan)) {
  const c = spokeplan[name];
  rows.push([`spokeplan-${name}`, "", "", (lengthM(c) / M_PER_KM).toFixed(2), "", ...PROBE_LONS.map((l) => latAt(c, l)), "", "", "", "",
    ...Object.keys(spokeplan).flatMap(() => ["", "", ""])]);
}

for (const v of VARIANTS) {
  const vias = v.via ? KENSINGTON_VIAS.map(([lon, lat]) => ({ lon, lat, type: "through" })) : [];
  const costing_options = { bicycle: v.bicycle };
  const route = await post("route", {
    locations: [{ lon: FROM[0], lat: FROM[1] }, ...vias, { lon: TO[0], lat: TO[1] }],
    costing: "bicycle", costing_options, directions_options: { units: "kilometers" },
  });
  const leg = route.trip.legs[0];
  const shape = decodePolyline(leg.shape);

  // West End streets from Valhalla's manoeuvres: those with any shape point inside the
  // Marble Arch / Park Lane to Tottenham Court Road longitude window.
  const streets: string[] = [];
  for (const m of leg.maneuvers as any[]) {
    const pts = shape.slice(m.begin_shape_index, m.end_shape_index + 1);
    if (!pts.some(([lon]) => lon >= OXFORD_FULL_WINDOW.minLon && lon <= OXFORD_FULL_WINDOW.maxLon)) continue;
    const label = (m.street_names ?? []).join(" / ");
    if (label && streets.at(-1) !== label) streets.push(label);
  }

  // Edge-level check for Oxford Street, and its pedestrianised (no-cycling) stretch.
  const attrs = await post("trace_attributes", {
    encoded_polyline: leg.shape, shape_match: "edge_walk", costing: "bicycle", costing_options,
    filters: { attributes: ["edge.names", "edge.length", "edge.use", "edge.begin_shape_index", "edge.end_shape_index", "shape"], action: "include" },
  });
  const edgeShape = decodePolyline(attrs.shape);
  let oxfordM = 0, oxfordPedM = 0;
  // Manoeuvre names keep only names shared by all of a manoeuvre's edges (Piccadilly
  // and the streets beyond it come back as one "Piccadilly / A4" manoeuvre), so also
  // list the West End streets edge by edge: first name, or "(<use>)" when unnamed.
  const edgeStreets: string[] = [];
  for (const e of attrs.edges ?? []) {
    const names: string[] = e.names ?? [];
    const midLon = edgeShape[Math.round((e.begin_shape_index + e.end_shape_index) / 2)]?.[0] ?? NaN;
    if (midLon >= OXFORD_FULL_WINDOW.minLon && midLon <= OXFORD_FULL_WINDOW.maxLon) {
      const label = names[0] ?? `(${e.use})`;
      if (edgeStreets.at(-1) !== label) edgeStreets.push(label);
    }
    if (!names.includes(OXFORD_STREET)) continue;
    oxfordM += e.length * M_PER_KM;
    if (midLon >= OXFORD_PED_WINDOW.minLon && midLon <= OXFORD_PED_WINDOW.maxLon) oxfordPedM += e.length * M_PER_KM;
  }

  const len = route.trip.summary.length * M_PER_KM;
  const comparisons = Object.entries(spokeplan).flatMap(([, sp]) => [
    ((len - lengthM(sp)) / M_PER_KM).toFixed(2), pct(overlapShare(shape, sp)), pct(overlapShare(sp, shape)),
  ]);
  rows.push([
    v.id, JSON.stringify(v.bicycle), String(v.via), (len / M_PER_KM).toFixed(2), (route.trip.summary.time / S_PER_MIN).toFixed(1),
    ...PROBE_LONS.map((l) => latAt(shape, l)), streets.join(" > "), edgeStreets.join(" > "), oxfordM.toFixed(0), oxfordPedM.toFixed(0), ...comparisons,
  ]);

  const feature = {
    type: "Feature",
    properties: {
      source: "Valhalla 3.5.1, bicycle costing, 'today' tiles (valhalla/custom_files-today)",
      variant: v.id, costing_options, via: v.via ? KENSINGTON_VIAS : [],
      length_m: Math.round(len), time_s: Math.round(route.trip.summary.time),
    },
    geometry: { type: "LineString", coordinates: shape },
  };
  await writeFile(join(OUT_DIR, `${v.id}.geojson`), JSON.stringify(feature) + "\n");
}

const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
await writeFile(join(OUT_DIR, "summary.csv"), csv);
console.log(csv);
