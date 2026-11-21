// Tables of the best-evidence run (docs/lts.md, "Best-evidence run"), written after
// scripts/lts/sensitivity.ts has run it (its gap-closing files, summary rows,
// frequency table and runs.csv come from there). From the regraded ways
// (bestEvidenceWays) and those gap-closing files, for both headline tables, under
// results/lts/sensitivity/best-evidence/:
//   headline-streets.csv   the headline solution (scenario today, HEADLINE_RUN, the
//                          union of both directions): per street and volume, the
//                          converted metres, the ADT used, its source, the count id and year
//   coverage.csv           scenario today: metres of way graded by the Furth table,
//                          per volume source, main run against best-evidence
//   close-to-line.csv      scenario today, headline solution: metres resting on an
//                          LAEI flow within a factor of CLOSE_FACTOR of the calm
//                          threshold that applied to the way (converted ways, and the
//                          calm ways of the route the union opens per direction)
//   <table>/today/<trip>-<rider>.geojson, summary.csv
//                          the riders' routes on the regraded ways (scripts/lts/route.ts)
// The robustness checks of the run are scripts/lts/robustness.ts.
// Usage: bun scripts/lts/best-evidence.ts   (after bun scripts/lts/sensitivity.ts)
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { toCsv } from "../dft/common";
import { isMotorOneway } from "./classify";
import {
  POINTS, TRIPS, byCodeUnit, classifiedPath, haversineM, modeName, type LonLat, type LtsMode, type WayFeature,
} from "./common";
import { ONE_WAY_ADT_FACTOR, calmMaxEffectiveAdt, isFurthRow } from "./furth2017";
import {
  HEADLINE_GAP_MODES, HEADLINE_RUN, UNION_SOLUTION, gapClosingGeojson,
} from "./gap-closing";
import {
  LOW_STRESS_MAX_EXTRA_M, LOW_STRESS_MAX_LTS, LOW_STRESS_MAX_RATIO, LOW_STRESS_ONLY, SHORTEST, buildGraph, dijkstra, label, pathLength, routeWays, snap,
  type Arc, type Edge, type Graph,
} from "./route";
import { BEST_EVIDENCE, SCENARIO_TODAY, SENSITIVITY_RESULTS, bestEvidenceWays, furthTableRule } from "./sensitivity";
import { type AdtSource } from "./volume";

const OUT = join(SENSITIVITY_RESULTS, BEST_EVIDENCE);
const runDir = (mode: LtsMode, scenario: string) => join(OUT, modeName(mode), scenario);
// "How close to the line": an LAEI flow within this factor of the way's calm
// threshold could cross it if the model is off by that factor. Against the DfT
// counts about three matched ways in four are within a factor of 2
// (scripts/laei/validate.ts, docs/lts.md "Best-evidence run").
const CLOSE_FACTOR = 2;
const SOURCES: readonly AdtSource[] = ["count", "road", "laei", "class-default"];
const NO_VOLUME = "no-volume"; // ways graded by a rule before the table, without an ADT
const MAIN_RUN = "main";
const M_PER_KM = 1000;
const KM_DECIMALS = 2;
const SHARE_DECIMALS = 3;
const round = Math.round;

export type Feature = { geometry: { coordinates: LonLat[] }; properties: Record<string, unknown> };
const byId = (ways: WayFeature[]) => new Map(ways.map((f) => [f.properties["@id"], f.properties]));

/** The converted edges of the union of both directions in a HEADLINE_RUN written to outDir. */
export async function headlineUnion(outDir: string): Promise<Feature[]> {
  const path = gapClosingGeojson(outDir, HEADLINE_RUN.allowOxford, HEADLINE_RUN.contraflow);
  return ((await Bun.file(path).json()) as { features: Feature[] }).features.filter((f) => f.properties.solution === UNION_SOLUTION);
}

/** Converted metres of the headline solution per street, fragment and volume (with its source, count id and year). */
function headlineStreets(mode: LtsMode, ways: WayFeature[], union: Feature[]): Record<string, unknown>[] {
  const props = byId(ways);
  const groups = new Map<string, Record<string, unknown> & { m: number; ways: Set<number> }>();
  for (const f of union) {
    const id = f.properties.way_id as number;
    const w = props.get(id)!;
    const row = {
      table: modeName(mode), street: f.properties.street, fragment: f.properties.fragment,
      adt: w.adt ?? "", adt_source: w.adt_source ?? NO_VOLUME, count_id: w.adt_count_point ?? "", count_year: w.adt_count_year ?? "",
    };
    const key = JSON.stringify(row);
    const g = groups.get(key) ?? { ...row, m: 0, ways: new Set<number>() };
    g.m += f.properties.length_m as number;
    g.ways.add(id);
    groups.set(key, g);
  }
  return [...groups.values()]
    .sort((a, b) => byCodeUnit(String(a.street), String(b.street)) || byCodeUnit(String(a.fragment), String(b.fragment)) || Number(a.adt) - Number(b.adt))
    .map(({ m, ways: ids, ...g }) => ({ ...g, converted_m: round(m), way_ids: [...ids].sort((a, b) => a - b).join(" ") }));
}

/**
 * Metres per volume source (scenario today) of the ways the main run grades by a
 * row of the Furth table (`graded`), so both runs cover the same ways: Great
 * Chapel Street, graded traffic-free in the best-evidence run, counts by the
 * volume that run still gives it.
 */
function coverage(mode: LtsMode, run: string, ways: WayFeature[], graded: Set<number>): Record<string, unknown>[] {
  const metres = new Map<string, { m: number; n: number }>(SOURCES.map((s) => [s, { m: 0, n: 0 }]));
  for (const f of ways) {
    if (!graded.has(f.properties["@id"])) continue;
    const c = metres.get(String(f.properties.adt_source))!;
    c.n++;
    c.m += f.geometry.coordinates.slice(1).reduce((s, p, i) => s + haversineM(f.geometry.coordinates[i], p), 0); // as the routing graph measures
  }
  const total = [...metres.values()].reduce((s, c) => s + c.m, 0);
  return [...metres].map(([source, c]) => ({
    table: modeName(mode), run, adt_source: source, ways: c.n, km: (c.m / M_PER_KM).toFixed(KM_DECIMALS), share: (c.m / total).toFixed(SHARE_DECIMALS),
  }));
}

/** The way's calm threshold in its own ADT (both directions): the table's effective threshold, divided by the one-way factor on one-way ways. */
export function calmThreshold(way: Record<string, unknown>): number | undefined {
  const rule = furthTableRule(String(way["@lts_rule"]));
  if (!rule) return undefined;
  const [, row, , col] = rule.split("/");
  if (!isFurthRow(row)) throw new Error(`way ${way["@id"]}: rule ${rule} names no Furth row`);
  const effective = calmMaxEffectiveAdt(row, col);
  return effective === undefined ? undefined : effective / (isMotorOneway(way) ? ONE_WAY_ADT_FACTOR : 1);
}

const edgeKey = (wayId: unknown, coords: LonLat[]) => `${wayId}:${coords[0].join(",")}:${coords.at(-1)!.join(",")}`;
/** The graph with the union's edges converted: low-stress and, since the headline run allows two-way tracks, two-way. */
function withConverted(g: Graph, converted: Set<string>): Graph {
  const edges: Edge[] = g.edges.map((e) => (converted.has(edgeKey(e.way["@id"], e.coords))
    ? { ...e, lts: LOW_STRESS_MAX_LTS, forward: true, backward: true } : e));
  const adj = new Map<number, Arc[]>();
  const add = (n: number, arc: Arc) => (adj.get(n) ?? adj.set(n, []).get(n)!).push(arc);
  edges.forEach((e, edge) => {
    if (e.forward) add(e.from, { edge, reverse: false });
    if (e.backward) add(e.to, { edge, reverse: true });
  });
  return { edges, adj, nodeCoord: g.nodeCoord };
}

/** The low-stress route a converted union opens for one trip, against the trip's shortest rideable path (L4) and budget. */
export interface OpenedRoute {
  trip: string;
  l4M: number;
  budgetM: number;
  pathM: number;
  /** The route's edges; `converted`: in the union (otherwise calm already). */
  edges: { edge: Edge; converted: boolean }[];
}

/**
 * Per trip, the shortest LTS <= 2 path once the union's edges are converted
 * (withConverted), between the low-stress snap nodes of gap-closing.ts, without
 * the forbidden ways. L4 and the budget come from the whole network, as in the search.
 */
export function openedRoutes(ways: WayFeature[], union: Feature[], forbiddenWays: ReadonlySet<number> = new Set()): OpenedRoute[] {
  const base = buildGraph(ways);
  const keys = new Set(union.map((f) => edgeKey(f.properties.way_id, f.geometry.coordinates)));
  const g = withConverted(buildGraph(ways.filter((f) => !forbiddenWays.has(f.properties["@id"]))), keys);
  return Object.entries(TRIPS).map(([trip, [from, to]]) => {
    const s = snap(base, POINTS[from], LOW_STRESS_MAX_LTS).node;
    const t = snap(base, POINTS[to], LOW_STRESS_MAX_LTS).node;
    const l4 = dijkstra(base, s, t, SHORTEST);
    const path = dijkstra(g, s, t, LOW_STRESS_ONLY);
    if (!l4 || !path) throw new Error(`${trip}: no low-stress path with the union converted`);
    const l4M = pathLength(base, l4.arcs);
    return {
      trip, l4M, budgetM: Math.max(LOW_STRESS_MAX_RATIO * l4M, l4M + LOW_STRESS_MAX_EXTRA_M), pathM: pathLength(g, path.arcs),
      edges: path.arcs.map((a) => ({ edge: g.edges[a.edge], converted: keys.has(edgeKey(g.edges[a.edge].way["@id"], g.edges[a.edge].coords)) })),
    };
  });
}

/**
 * Metres of the headline solution by volume source, and the LAEI metres within
 * CLOSE_FACTOR of the calm threshold: on the converted edges (above the threshold:
 * an LAEI overestimate of up to that factor could make them calm) and on the calm
 * edges of the route the union opens per direction (an underestimate could make them busy).
 */
function closeToLine(mode: LtsMode, ways: WayFeature[], union: Feature[]): Record<string, unknown>[] {
  const props = byId(ways);
  const parts: { part: string; edges: { wayId: number; m: number }[]; close: (adt: number, threshold: number) => boolean }[] = [{
    part: "union-converted",
    edges: union.map((f) => ({ wayId: f.properties.way_id as number, m: f.properties.length_m as number })),
    close: (adt, threshold) => adt <= CLOSE_FACTOR * threshold,
  }];
  for (const route of openedRoutes(ways, union)) {
    parts.push({
      part: `${route.trip}-route-calm`,
      edges: route.edges.filter((e) => !e.converted).map(({ edge }) => ({ wayId: edge.way["@id"], m: edge.lengthM })),
      close: (adt, threshold) => adt * CLOSE_FACTOR >= threshold,
    });
  }
  return parts.map(({ part, edges, close }) => {
    const bySource = new Map<string, number>([...SOURCES, NO_VOLUME].map((s) => [s, 0]));
    const near = new Map<string, number>();
    for (const { wayId, m } of edges) {
      const w = props.get(wayId)!;
      const source = typeof w.adt_source === "string" ? w.adt_source : NO_VOLUME;
      bySource.set(source, bySource.get(source)! + m);
      const threshold = source === "laei" ? calmThreshold(w) : undefined;
      if (threshold !== undefined && Number.isFinite(threshold) && close(w.adt as number, threshold)) {
        const key = `${label(w)} (${w.adt} vs ${round(threshold)})`;
        near.set(key, (near.get(key) ?? 0) + m);
      }
    }
    return {
      table: modeName(mode), part, metres: round([...bySource.values()].reduce((a, b) => a + b, 0)),
      ...Object.fromEntries([...bySource].map(([s, m]) => [`${s.replace("-", "_")}_m`, round(m)])),
      laei_within_factor_m: round([...near.values()].reduce((a, b) => a + b, 0)),
      laei_within_factor: [...near].map(([k, m]) => `${k}: ${round(m)} m`).join("; "),
    };
  });
}

export async function bestEvidenceTables() {
  const streets: Record<string, unknown>[] = [];
  const cover: Record<string, unknown>[] = [];
  const close: Record<string, unknown>[] = [];
  for (const mode of HEADLINE_GAP_MODES) {
    const ways = await bestEvidenceWays(SCENARIO_TODAY, mode);
    const union = await headlineUnion(runDir(mode, SCENARIO_TODAY));
    streets.push(...headlineStreets(mode, ways, union));
    const main = ((await Bun.file(classifiedPath(SCENARIO_TODAY, mode)).json()) as { features: WayFeature[] }).features;
    const graded = new Set(main.filter((f) => furthTableRule(String(f.properties["@lts_rule"]))).map((f) => f.properties["@id"]));
    cover.push(...coverage(mode, MAIN_RUN, main, graded), ...coverage(mode, BEST_EVIDENCE, ways, graded));
    close.push(...closeToLine(mode, ways, union));
    await routeWays(ways, SCENARIO_TODAY, `${BEST_EVIDENCE}/${modeName(mode)}`, runDir(mode, SCENARIO_TODAY));
  }
  await writeFile(join(OUT, "headline-streets.csv"), toCsv(Object.keys(streets[0]), streets));
  await writeFile(join(OUT, "coverage.csv"), toCsv(Object.keys(cover[0]), cover));
  await writeFile(join(OUT, "close-to-line.csv"), toCsv(Object.keys(close[0]), close));
  console.log(`${BEST_EVIDENCE}: headline streets, coverage, close-to-line and routes -> ${OUT}`);
}

if (import.meta.main) await bestEvidenceTables();
