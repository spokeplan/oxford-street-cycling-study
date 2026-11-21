// Step 3: LTS-weighted shortest paths for the Oxford Street corridor trips.
// Graph: nodes = endpoints of rideable ways + nodes shared by rideable ways;
// edges = way pieces between them, length by haversine over the vertices.
// Dijkstra per rider: cost = length x multiplier[LTS]; not rideable = no edge.
// Also runs the low-stress connectivity test of Mekuria, Furth, Nixon (2012),
// MTI Report 11-19: L4 = shortest rideable path, L2 = shortest path on LTS 1-2 only.
// Writes results/lts/<mode>/<scenario>/<trip>-<rider>.geojson and summary.csv
// (routeWays does the same for any classified ways and output directory: the
// best-evidence run, scripts/lts/best-evidence.ts).
// Usage: bun scripts/lts/route.ts <scenario> [--table <table>] [--speed-col 25|lt20]
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NOT_RIDEABLE, type Lts } from "./classify";
import {
  DEFAULT_MODE, MODE_USAGE, POINTS, TRIPS, classifiedPath, haversineM, modeName, parseMode, requireScenario, resultsDir,
  type LonLat, type LtsMode, type WayFeature,
} from "./common";

export type Multipliers = Record<Exclude<Lts, 0>, number>;
const RIDERS: Record<string, Multipliers> = {
  confident: { 1: 1, 2: 1, 3: 1, 4: 1 },
  cautious: { 1: 1, 2: 1, 3: 4, 4: 10 },
  // Sensitivity: milder penalties for LTS 3 / 4.
  "cautious-alt": { 1: 1, 2: 1, 3: 2.5, 4: 6 },
};
// Connectivity test (MTI Report 11-19, chapter II "Acceptable Level of Detour",
// pp. 14-15): an infinite multiplier removes the arc.
export const SHORTEST: Multipliers = { 1: 1, 2: 1, 3: 1, 4: 1 };
export const LOW_STRESS_ONLY: Multipliers = { 1: 1, 2: 1, 3: Infinity, 4: Infinity };
// A low-stress path is acceptable if L2/L4 is below this ratio ...
export const LOW_STRESS_MAX_RATIO = 1.25;
// ... or if it is less than this much longer: 1760 ft (a third of a mile; same source).
const M_PER_FT = 0.3048;
const LOW_STRESS_MAX_EXTRA_FT = 1760;
export const LOW_STRESS_MAX_EXTRA_M = LOW_STRESS_MAX_EXTRA_FT * M_PER_FT;
const NO_PATH = "no path";
const WIGMORE_STREET = "Wigmore Street";
const OXFORD_STREET = "Oxford Street";
// Runs of one street shorter than this are left out of street_sequence_major.
const MAJOR_RUN_MIN_M = 50;
// Lowest LTS counted as a barrier (high stress) in lts34_m / lts34_streets.
export const HIGH_STRESS_MIN_LTS = 3;

const YES_VALUES = new Set(["yes", "true", "1"]);
const CONTRAFLOW_KEYS = ["cycleway", "cycleway:left", "cycleway:right", "cycleway:both"];
const CONTRAFLOW_SIDE_ONEWAY = new Set(["no", "-1"]);
const IMPLIED_ONEWAY_JUNCTIONS = new Set(["roundabout", "circular"]);

export interface Edge {
  from: number;
  to: number;
  lengthM: number;
  coords: LonLat[];
  way: WayFeature["properties"];
  lts: Exclude<Lts, 0>;
  forward: boolean; // from -> to allowed
  backward: boolean; // to -> from allowed
}
export interface Arc {
  edge: number;
  reverse: boolean;
}

/**
 * Allowed directions for a bicycle along the way's drawing order.
 * oneway=yes|-1 (and roundabouts) are respected unless oneway:bicycle=no,
 * a cycleway*=opposite* value, or (current scheme) cycleway:<side>:oneway=no|-1
 * marks a contraflow; oneway:bicycle=yes makes a two-way road one-way for bikes.
 */
function directions(p: WayFeature["properties"]): { forward: boolean; backward: boolean } {
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  const oneway = s("oneway");
  const reversed = oneway === "-1";
  const isOneway =
    YES_VALUES.has(oneway) || reversed || IMPLIED_ONEWAY_JUNCTIONS.has(s("junction")) || YES_VALUES.has(s("oneway:bicycle"));
  const contraflow =
    s("oneway:bicycle") === "no" ||
    CONTRAFLOW_KEYS.some((k) => s(k).startsWith("opposite")) ||
    CONTRAFLOW_KEYS.slice(1).some((k) => CONTRAFLOW_SIDE_ONEWAY.has(s(`${k}:oneway`)));
  if (!isOneway || contraflow) return { forward: true, backward: true };
  return reversed ? { forward: false, backward: true } : { forward: true, backward: false };
}

export function buildGraph(features: WayFeature[]) {
  const rideable = features.filter((f) => (f.properties["@lts"] as Lts) !== NOT_RIDEABLE);
  const uses = new Map<number, number>();
  for (const f of rideable) for (const n of f.properties["@nodes"]) uses.set(n, (uses.get(n) ?? 0) + 1);

  const nodeCoord = new Map<number, LonLat>();
  const edges: Edge[] = [];
  const adj = new Map<number, Arc[]>();
  const addArc = (node: number, arc: Arc) => {
    if (!adj.has(node)) adj.set(node, []);
    adj.get(node)!.push(arc);
  };
  for (const f of rideable) {
    const ids = f.properties["@nodes"];
    const pts = f.geometry.coordinates;
    const dir = directions(f.properties);
    let start = 0;
    let length = 0;
    for (let i = 1; i < ids.length; i++) {
      length += haversineM(pts[i - 1], pts[i]);
      const isGraphNode = i === ids.length - 1 || (uses.get(ids[i]) ?? 0) > 1;
      if (!isGraphNode) continue;
      const e = edges.length;
      edges.push({
        from: ids[start], to: ids[i], lengthM: length, coords: pts.slice(start, i + 1),
        way: f.properties, lts: f.properties["@lts"] as Exclude<Lts, 0>, ...dir,
      });
      nodeCoord.set(ids[start], pts[start]);
      nodeCoord.set(ids[i], pts[i]);
      if (dir.forward) addArc(ids[start], { edge: e, reverse: false });
      if (dir.backward) addArc(ids[i], { edge: e, reverse: true });
      start = i;
      length = 0;
    }
  }
  return { edges, adj, nodeCoord };
}
export type Graph = ReturnType<typeof buildGraph>;

const MAX_LTS: Exclude<Lts, 0> = 4;
// Highest LTS of the low-stress network in the connectivity test.
export const LOW_STRESS_MAX_LTS: Exclude<Lts, 0> = 2;

/**
 * Nearest graph node (by haversine) that has at least one usable outgoing or
 * incoming arc on a way with LTS <= maxLts.
 */
export function snap(g: Graph, p: LonLat, maxLts = MAX_LTS): { node: number; distM: number } {
  const usable = new Set<number>();
  for (const [tail, arcs] of g.adj) {
    for (const arc of arcs) {
      const e = g.edges[arc.edge];
      if (e.lts > maxLts) continue;
      usable.add(tail); // outgoing arc
      usable.add(arc.reverse ? e.from : e.to); // the arc's head has an incoming arc
    }
  }
  let best = { node: -1, distM: Infinity };
  for (const node of usable) {
    const d = haversineM(p, g.nodeCoord.get(node)!);
    if (d < best.distM) best = { node, distM: d };
  }
  if (best.node < 0) throw new Error(`Graph has no usable arcs with LTS <= ${maxLts}`);
  return best;
}

// Minimal binary min-heap keyed by cost.
class MinHeap {
  private items: [number, number][] = [];
  get size() { return this.items.length; }
  push(item: [number, number]) {
    const a = this.items;
    a.push(item);
    for (let i = a.length - 1; i > 0; ) {
      const parent = (i - 1) >> 1;
      if (a[parent][0] <= a[i][0]) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }
  pop(): [number, number] {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Least-cost path, or undefined when the target is unreachable. Arcs with an infinite multiplier are skipped. */
export function dijkstra(g: Graph, source: number, target: number, mult: Multipliers): { arcs: Arc[]; cost: number } | undefined {
  const dist = new Map<number, number>([[source, 0]]);
  const prev = new Map<number, Arc>();
  const heap = new MinHeap();
  heap.push([0, source]);
  while (heap.size > 0) {
    const [cost, node] = heap.pop();
    if (cost > (dist.get(node) ?? Infinity)) continue;
    if (node === target) break;
    for (const arc of g.adj.get(node) ?? []) {
      const e = g.edges[arc.edge];
      if (!Number.isFinite(mult[e.lts])) continue;
      const next = arc.reverse ? e.from : e.to;
      const c = cost + e.lengthM * mult[e.lts];
      if (c < (dist.get(next) ?? Infinity)) {
        dist.set(next, c);
        prev.set(next, arc);
        heap.push([c, next]);
      }
    }
  }
  if (!dist.has(target)) return undefined;
  const arcs: Arc[] = [];
  for (let n = target; n !== source; ) {
    const arc = prev.get(n)!;
    arcs.push(arc);
    const e = g.edges[arc.edge];
    n = arc.reverse ? e.to : e.from;
  }
  return { arcs: arcs.reverse(), cost: dist.get(target)! };
}

export const label = (way: WayFeature["properties"]) => (way.name as string | undefined) ?? `(${way.highway})`;

/** Consecutive-deduplicated street labels; with minRunM, short runs are dropped first. */
export function sequence(runs: { label: string; m: number }[], minRunM = 0): string {
  const out: string[] = [];
  for (const r of runs) if (r.m >= minRunM && out.at(-1) !== r.label) out.push(r.label);
  return out.join(" > ");
}

export const csvField = (v: unknown) => (/[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v));

// Edge lengths in the GeoJSON outputs are rounded to a tenth of a metre.
const LENGTH_ROUNDING = 10;
export const roundLengthM = (m: number) => Math.round(m * LENGTH_ROUNDING) / LENGTH_ROUNDING;

export const pathLength = (g: Graph, arcs: Arc[]) => arcs.reduce((sum, arc) => sum + g.edges[arc.edge].lengthM, 0);

/**
 * MTI Report 11-19 low-stress connectivity test. Both ends snap to the nearest
 * node on the low-stress network (so a trip end on an LTS 3 street does not
 * make the test fail trivially); L4 and L2 are measured between the same nodes.
 */
export function connectivity(g: Graph, from: LonLat, to: LonLat) {
  const s = snap(g, from, LOW_STRESS_MAX_LTS);
  const t = snap(g, to, LOW_STRESS_MAX_LTS);
  const snaps = { l2_snap_from_m: Math.round(s.distM), l2_snap_to_m: Math.round(t.distM) };
  const [source, target] = [s.node, t.node];
  const l4 = dijkstra(g, source, target, SHORTEST);
  if (!l4) throw new Error(`No path from ${source} to ${target}`);
  const l4M = pathLength(g, l4.arcs);
  const l2 = dijkstra(g, source, target, LOW_STRESS_ONLY);
  if (!l2) return { l4_m: Math.round(l4M), l2_m: NO_PATH, l2_ratio: NO_PATH, connected_lowstress: "no", ...snaps };
  const l2M = pathLength(g, l2.arcs);
  const ratio = l2M / l4M;
  const connected = ratio < LOW_STRESS_MAX_RATIO || l2M - l4M < LOW_STRESS_MAX_EXTRA_M;
  return {
    l4_m: Math.round(l4M), l2_m: String(Math.round(l2M)), l2_ratio: ratio.toFixed(3),
    connected_lowstress: connected ? "yes" : "no", ...snaps,
  };
}

/** "Street 123; Other street 45": distinct labels of the high-stress (LTS >= 3) edges with their metres, in route order. */
function highStressStreets(g: Graph, arcs: Arc[]): string {
  const metres = new Map<string, number>();
  for (const arc of arcs) {
    const e = g.edges[arc.edge];
    if (e.lts < HIGH_STRESS_MIN_LTS) continue;
    const l = label(e.way);
    metres.set(l, (metres.get(l) ?? 0) + e.lengthM);
  }
  return [...metres].map(([l, m]) => `${l} ${Math.round(m)}`).join("; ");
}

export async function routeScenario(scenario: string, mode: LtsMode = DEFAULT_MODE) {
  const fc = (await Bun.file(classifiedPath(scenario, mode)).json()) as { features: WayFeature[] };
  await routeWays(fc.features, scenario, modeName(mode), resultsDir(mode, scenario));
}

/** Routes every trip and rider on classified ways; `table` fills the table column, outputs go to outDir. */
export async function routeWays(ways: WayFeature[], scenario: string, table: string, outDir: string) {
  const g = buildGraph(ways);
  console.log(`${scenario} [${table}]: graph ${g.nodeCoord.size} nodes, ${g.edges.length} edges`);
  await mkdir(outDir, { recursive: true });

  const header = [
    "table", "scenario", "trip", "rider", "mult_lts3", "mult_lts4", "distance_m", "cost", "lts1_m", "lts2_m", "lts3_m", "lts4_m",
    "lts34_m", "lts34_streets",
    "wigmore_street_m", "oxford_street_m", "snap_from_m", "snap_to_m", "street_sequence_major", "street_sequence",
    "l4_m", "l2_m", "l2_ratio", "connected_lowstress", "l2_snap_from_m", "l2_snap_to_m",
  ];
  const rows: string[] = [header.join(",")];
  for (const [trip, [from, to]] of Object.entries(TRIPS)) {
    const s = snap(g, POINTS[from]);
    const t = snap(g, POINTS[to]);
    const conn = connectivity(g, POINTS[from], POINTS[to]);
    console.log(`${scenario} [${table}] ${trip}: L4 ${conn.l4_m} m, L2 ${conn.l2_m}, low-stress connected: ${conn.connected_lowstress}`);
    for (const [rider, mult] of Object.entries(RIDERS)) {
      const path = dijkstra(g, s.node, t.node, mult);
      if (!path) throw new Error(`No path for ${trip} ${rider}`);
      const { arcs, cost } = path;
      const byLts = { 1: 0, 2: 0, 3: 0, 4: 0 };
      let distance = 0, wigmore = 0, oxford = 0;
      const runs: { label: string; m: number }[] = [];
      const features = arcs.map((arc) => {
        const e = g.edges[arc.edge];
        distance += e.lengthM;
        byLts[e.lts] += e.lengthM;
        if (e.way.name === WIGMORE_STREET) wigmore += e.lengthM;
        if (e.way.name === OXFORD_STREET) oxford += e.lengthM;
        const l = label(e.way);
        if (runs.at(-1)?.label === l) runs.at(-1)!.m += e.lengthM;
        else runs.push({ label: l, m: e.lengthM });
        return {
          type: "Feature",
          geometry: { type: "LineString", coordinates: arc.reverse ? [...e.coords].reverse() : e.coords },
          properties: {
            way_id: e.way["@id"], name: e.way.name ?? null, highway: e.way.highway, lts: e.lts,
            lts_rule: e.way["@lts_rule"], length_m: roundLengthM(e.lengthM),
            ...(e.way.adt_source ? { adt: e.way.adt, adt_source: e.way.adt_source } : {}), // furth2017 tables only
          },
        };
      });
      const round = (x: number) => Math.round(x);
      const summary = {
        table, scenario, trip, rider, mult_lts3: mult[3], mult_lts4: mult[4], distance_m: round(distance), cost: round(cost),
        lts1_m: round(byLts[1]), lts2_m: round(byLts[2]), lts3_m: round(byLts[3]), lts4_m: round(byLts[4]),
        lts34_m: round(byLts[3] + byLts[4]), lts34_streets: highStressStreets(g, arcs),
        wigmore_street_m: round(wigmore), oxford_street_m: round(oxford), snap_from_m: round(s.distM), snap_to_m: round(t.distM),
        street_sequence_major: sequence(runs, MAJOR_RUN_MIN_M), street_sequence: sequence(runs),
        ...conn,
      };
      await writeFile(
        join(outDir, `${trip}-${rider}.geojson`),
        JSON.stringify({ type: "FeatureCollection", properties: summary, features }, null, 1) + "\n",
      );
      rows.push(header.map((h) => csvField(summary[h as keyof typeof summary])).join(","));
      console.log(`${scenario} ${trip} ${rider}: ${summary.distance_m} m, Wigmore ${summary.wigmore_street_m} m: ${summary.street_sequence_major}`);
    }
  }
  await writeFile(join(outDir, "summary.csv"), rows.join("\n") + "\n");
}

if (import.meta.main) {
  const usage = `bun scripts/lts/route.ts <scenario> ${MODE_USAGE}`;
  await routeScenario(requireScenario(process.argv[2], usage), parseMode(process.argv, usage));
}
