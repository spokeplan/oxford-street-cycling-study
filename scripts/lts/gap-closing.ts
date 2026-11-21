// Step 4: gap closing. Which LTS >= 3 links, made low-stress, would give an
// acceptable LTS <= 2 route between the trip ends (MTI Report 11-19 test, see
// route.ts)? Per trip: the Pareto frontier of (converted metres, path length)
// over paths with length <= the test's budget max(LOW_STRESS_MAX_RATIO x L4,
// L4 + LOW_STRESS_MAX_EXTRA_M); converted metres = length of the LTS >= 3 edges
// on the path (LTS 1-2 edges convert for free). L4 = shortest rideable path on
// the variant's own network (contraflow arcs excluded, see withContraflow).
// Exact bi-criteria label-setting search: Pareto labels (converted, length) per
// node, labels popped in order of converted + a lower bound on the converted
// metres still to come (A*), so the first label popped at the target is the
// minimum; the search then continues to collect the rest of the frontier.
// Labels whose length + the shortest remaining length exceeds the budget are pruned.
// Reported per direction: the minimum and the knee (frontier point minimising
// converted + path - L4), plus the union of both directions (heuristic upper bound).
// Not-rideable ways are not in the graph, so they are never converted, except
// with --allow-oxford: the pedestrianised Oxford Street ways become convertible
// two-way LTS 3 edges (counterfactual: cycling permitted on a marked track), and
// so do the sealed median crossings of full-closure-sealed.
// With --contraflow a converted LTS >= 3 one-way edge becomes a two-way track:
// it gets a reverse arc that always costs conversion.
// Writes results/lts/<mode>/<scenario>/gap-closing[-allow-oxford][-contraflow].{csv,geojson}
// and gap-closing-frontier[-allow-oxford][-contraflow].csv; run without arguments it
// runs every variant of gapClosingAll and writes results/lts/gap-closing-summary.csv.
// Usage: bun scripts/lts/gap-closing.ts [<scenario> [--table <table>] [--speed-col 25|lt20] [--untagged-unlaned] [--allow-oxford] [--contraflow]]
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NOT_RIDEABLE } from "./classify";
import {
  DEFAULT_SPEED_COL, FURTH_TABLES, LT20_SPEED_COL, LTS_RESULTS, MODE_USAGE, OXFORD_FULL_WINDOW, OXFORD_PED_WINDOW, POINTS, SCENARIOS,
  SEALED_CROSSING_WAY_IDS, TRIPS, classifiedPath, inLonWindow, modeName, parseMode, requireScenario, resultsDir,
  type LonWindow, type LtsMode, type WayFeature,
} from "./common";
import {
  HIGH_STRESS_MIN_LTS, LOW_STRESS_MAX_EXTRA_M, LOW_STRESS_MAX_LTS, LOW_STRESS_MAX_RATIO, SHORTEST,
  buildGraph, csvField, dijkstra, label, pathLength, roundLengthM, sequence, snap, type Arc, type Edge, type Graph,
} from "./route";

const ALLOW_OXFORD_FLAG = "--allow-oxford";
const CONTRAFLOW_FLAG = "--contraflow";
// Counterfactual for --allow-oxford: the not-rideable carriageway of Oxford
// Street with every vertex inside the scenario's longitude window (degrees WGS84)
// is convertible and treated as this LTS. By default the window is the
// pedestrianised length (OXFORD_PED_WINDOW, Orchard Street to just east of Oxford
// Circus): the highway=pedestrian ways plus the two vehicle=no primary_link pieces
// across Oxford Circus, without which the pedestrian zone is cut in two. Under
// full-closure* the whole street is pedestrian, so the window spans Marble Arch to
// Tottenham Court Road (OXFORD_FULL_WINDOW, the longitudes scripts/retag-scenario.ts closes):
// reopening the entire street on a marked track. Reopening the street also
// reopens the median crossings full-closure-sealed closes (SEALED_CROSSING_WAY_IDS,
// matched by id: they are unnamed). Sidewalks (highway=footway) and every other
// not-rideable way stay excluded. The oneway tags left on the
// pedestrian ways (former bus carriageway) are dropped: a marked track is taken
// as two-way.
const OXFORD_STREET = "Oxford Street";
const SIDEWALK_HIGHWAY = "footway";
const DROPPED_ONEWAY_KEYS = ["oneway", "oneway:bicycle", "junction"];
const OXFORD_WINDOW_BY_SCENARIO: Record<string, LonWindow> = {
  "full-closure": OXFORD_FULL_WINDOW,
  "full-closure-sealed": OXFORD_FULL_WINDOW,
};
const oxfordWindow = (scenario: string) => OXFORD_WINDOW_BY_SCENARIO[scenario] ?? OXFORD_PED_WINDOW;
const OXFORD_COUNTERFACTUAL_LTS = 3;
const OXFORD_COUNTERFACTUAL_RULE = "gap/oxford-counterfactual";
// Crossing vs link: a converted fragment (connected run of one street) is a
// crossing when it is at most this long (metres) or its ways are *_link or
// junction=*. The signalised-node rule (within 25 m of highway=traffic_signals /
// crossing=traffic_signals) is not applied: the classified GeoJSON carries way
// tags and node ids only, no node tags.
const CROSSING_MAX_M = 40;
const LINK_HIGHWAY_SUFFIX = "_link";
const JUNCTION_KEY = "junction";
// `fragment` values in the GeoJSON, and the `direction` / `solution` values of the union of both directions.
export const CROSSING_FRAGMENT = "crossing";
const LINK_FRAGMENT = "link";
export const UNION_DIRECTION = "union";
export const UNION_SOLUTION = "min-union";
// Float slack (metres) in the budget and dominance comparisons.
const EPS_M = 1e-6;
const MS_PER_S = 1000;
// untagged_two_way column of the summary: the Furth row an untagged two-way street reads.
const UNTAGGED_CENTRELINE = "centreline";
const UNTAGGED_UNLANED = "unlaned";
/** Summary columns that mark a headline row, with their headline values (the other values mark sensitivities). */
export const HEADLINE_SUMMARY_SETTINGS = { speed_col: DEFAULT_SPEED_COL, untagged_two_way: UNTAGGED_CENTRELINE } as const;

/** Ways as classified; with allowOxford the pedestrianised Oxford Street ways become two-way LTS 3 (copies, input untouched). */
function variantFeatures(
  features: WayFeature[], allowOxford: boolean, lonWindow: LonWindow,
): { features: WayFeature[]; oxfordWays: number } {
  if (!allowOxford) return { features, oxfordWays: 0 };
  let oxfordWays = 0;
  const out = features.map((f) => {
    const p = f.properties;
    const inWindow = inLonWindow(f.geometry.coordinates, lonWindow);
    const isPedOxford = p.highway !== SIDEWALK_HIGHWAY && p["@lts"] === NOT_RIDEABLE && (
      (p.name === OXFORD_STREET && inWindow) ||
      SEALED_CROSSING_WAY_IDS.includes(p["@id"])
    );
    if (!isPedOxford) return f;
    oxfordWays++;
    const props: WayFeature["properties"] = { ...p, "@lts": OXFORD_COUNTERFACTUAL_LTS, "@lts_rule": OXFORD_COUNTERFACTUAL_RULE };
    for (const k of DROPPED_ONEWAY_KEYS) delete props[k];
    return { ...f, properties: props };
  });
  return { features: out, oxfordWays };
}

const isHighStress = (e: Edge) => e.lts >= HIGH_STRESS_MIN_LTS;
const headOf = (g: Graph, arc: Arc) => (arc.reverse ? g.edges[arc.edge].from : g.edges[arc.edge].to);
const tailOf = (g: Graph, arc: Arc) => (arc.reverse ? g.edges[arc.edge].to : g.edges[arc.edge].from);
/** True when the arc runs against a one-way edge (only present with --contraflow). */
const isContraflowArc = (g: Graph, arc: Arc) => (arc.reverse ? !g.edges[arc.edge].backward : !g.edges[arc.edge].forward);

/**
 * Two-way-track variant: g plus, for every LTS >= 3 one-way edge, an arc in the
 * missing direction. These arcs are high stress like their edge, so traversing
 * one always costs the edge length in converted metres: they exist only if the
 * edge is converted (to a two-way track). LTS 1-2 one-way edges get none
 * (adding a contraflow there is not a conversion), so a contraflow on a quiet
 * one-way street is never available: this biases the minima upward. L4 is
 * computed on g without these arcs, the plain directed shortest path, since none of them is free.
 */
function withContraflow(g: Graph): { graph: Graph; contraflowArcs: number } {
  const adj = new Map([...g.adj].map(([n, arcs]) => [n, [...arcs]]));
  let contraflowArcs = 0;
  g.edges.forEach((e, edge) => {
    if (!isHighStress(e) || (e.forward && e.backward)) return;
    const arc: Arc = { edge, reverse: e.forward };
    const tail = tailOf(g, arc);
    if (!adj.has(tail)) adj.set(tail, []);
    adj.get(tail)!.push(arc);
    contraflowArcs++;
  });
  return { graph: { ...g, adj }, contraflowArcs };
}

/** Search options: `banned` edges are impassable, `free` edges cost no conversion (already converted), `firstOnly` stops at the minimum. */
interface SearchOpts {
  banned?: Set<number>;
  free?: Set<number>;
  firstOnly?: boolean;
}
const conversionCost = (g: Graph, edge: number, opts: SearchOpts) =>
  isHighStress(g.edges[edge]) && !opts.free?.has(edge) ? g.edges[edge].lengthM : 0;

/** Arcs entering each node, for the backward lower-bound searches. */
function reverseAdjacency(g: Graph): Map<number, Arc[]> {
  const radj = new Map<number, Arc[]>();
  for (const arcs of g.adj.values()) {
    for (const arc of arcs) {
      const head = headOf(g, arc);
      if (!radj.has(head)) radj.set(head, []);
      radj.get(head)!.push(arc);
    }
  }
  return radj;
}

// Binary min-heap of ids ordered by a caller-supplied comparison.
class Heap {
  private a: number[] = [];
  constructor(private less: (x: number, y: number) => boolean) {}
  get size() { return this.a.length; }
  push(x: number) {
    const a = this.a;
    a.push(x);
    for (let i = a.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (!this.less(a[i], a[p])) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l], a[m])) m = l;
        if (r < a.length && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Distance from every node to `target` (backward Dijkstra) under the edge weight w. */
function distancesTo(g: Graph, radj: Map<number, Arc[]>, target: number, w: (edge: number) => number): Map<number, number> {
  const dist = new Map<number, number>([[target, 0]]);
  const nodes: number[] = [target];
  const keys: number[] = [0];
  const heap = new Heap((x, y) => keys[x] < keys[y]);
  heap.push(0);
  while (heap.size > 0) {
    const i = heap.pop();
    const node = nodes[i];
    if (keys[i] > dist.get(node)!) continue;
    for (const arc of radj.get(node) ?? []) {
      const c = keys[i] + w(arc.edge);
      const tail = tailOf(g, arc);
      if (c < (dist.get(tail) ?? Infinity)) {
        dist.set(tail, c);
        nodes.push(tail);
        keys.push(c);
        heap.push(nodes.length - 1);
      }
    }
  }
  return dist;
}

interface Solution {
  arcs: Arc[];
  convertedM: number;
  pathM: number;
  converted: number[]; // edge ids converted, in path order (free edges excluded)
}

/**
 * Pareto frontier of (converted metres, path length) from source to target with
 * path length <= budgetM, ascending converted metres; the first point is the
 * minimum conversion. Exact: label-setting over Pareto labels, A* on converted.
 * Keys (converted + lower bound still to come) are consistent, so labels pop in
 * nondecreasing key order and every target label popped so far converts no more
 * than any later extension: a label whose length + shortest remaining length
 * reaches the shortest target label found is dominated and pruned.
 */
function paretoSearch(
  g: Graph, radj: Map<number, Arc[]>, source: number, target: number, budgetM: number, opts: SearchOpts = {},
): Solution[] {
  const passable = (edge: number) => !opts.banned?.has(edge);
  const lbLen = distancesTo(g, radj, target, (e) => (passable(e) ? g.edges[e].lengthM : Infinity));
  const lbConv = distancesTo(g, radj, target, (e) => (passable(e) ? conversionCost(g, e, opts) : Infinity));

  // Label store (struct of arrays).
  const node: number[] = [], conv: number[] = [], len: number[] = [], parent: number[] = [];
  const via: (Arc | undefined)[] = [], dead: boolean[] = [];
  const atNode = new Map<number, number[]>();
  const key = (i: number) => conv[i] + lbConv.get(node[i])!;
  const heap = new Heap((x, y) => {
    const kx = key(x), ky = key(y);
    return kx !== ky ? kx < ky : len[x] + lbLen.get(node[x])! < len[y] + lbLen.get(node[y])!;
  });
  const add = (n: number, c: number, l: number, p: number, arc: Arc | undefined) => {
    const here = atNode.get(n) ?? [];
    for (const j of here) if (conv[j] <= c + EPS_M && len[j] <= l + EPS_M) return; // dominated (or equal)
    const kept = here.filter((j) => {
      const dominated = c <= conv[j] && l <= len[j];
      if (dominated) dead[j] = true;
      return !dominated;
    });
    const i = node.length;
    node.push(n); conv.push(c); len.push(l); parent.push(p); via.push(arc); dead.push(false);
    kept.push(i);
    atNode.set(n, kept);
    heap.push(i);
  };
  const solutionAt = (i: number): Solution => {
    const arcs: Arc[] = [];
    for (let j = i; parent[j] >= 0; j = parent[j]) arcs.push(via[j]!);
    arcs.reverse();
    const converted = arcs.map((a) => a.edge).filter((e) => conversionCost(g, e, opts) > 0);
    return { arcs, convertedM: conv[i], pathM: len[i], converted };
  };

  const frontier: Solution[] = [];
  if (!lbLen.has(source) || lbLen.get(source)! > budgetM + EPS_M) return frontier;
  let bestTargetLen = Infinity; // shortest target label popped so far
  add(source, 0, 0, -1, undefined);
  while (heap.size > 0) {
    const i = heap.pop();
    if (dead[i] || len[i] + lbLen.get(node[i])! >= bestTargetLen - EPS_M) continue;
    if (node[i] === target) {
      frontier.push(solutionAt(i));
      if (opts.firstOnly) break;
      bestTargetLen = len[i];
      continue; // a path through the target and back is dominated by its prefix
    }
    for (const arc of g.adj.get(node[i]) ?? []) {
      if (!passable(arc.edge)) continue;
      const next = headOf(g, arc);
      const l = len[i] + g.edges[arc.edge].lengthM;
      const rest = lbLen.get(next);
      if (rest === undefined || l + rest > budgetM + EPS_M || l + rest >= bestTargetLen - EPS_M) continue;
      add(next, conv[i] + conversionCost(g, arc.edge, opts), l, i, arc);
    }
  }
  // Equal-key ties can pop a dominated point first; keep strictly improving lengths.
  return frontier.filter((s, k) => frontier.slice(k + 1).every((t) => t.convertedM > s.convertedM + EPS_M || t.pathM > s.pathM - EPS_M));
}

/** A converted fragment: a connected run of converted edges of one street, link/junction pieces apart. */
interface Fragment {
  name: string; // street, or "Crossing at <street>"
  m: number;
  crossing: boolean;
  edges: number[];
}

const isLinkOrJunction = (e: Edge) => String(e.way.highway).endsWith(LINK_HIGHWAY_SUFFIX) || e.way[JUNCTION_KEY] !== undefined;

/** Edges at each node, for naming unnamed crossings after the street they meet. */
function incidentEdges(g: Graph): Map<number, number[]> {
  const inc = new Map<number, number[]>();
  g.edges.forEach((e, i) => {
    for (const n of [e.from, e.to]) {
      if (!inc.has(n)) inc.set(n, []);
      inc.get(n)!.push(i);
    }
  });
  return inc;
}

/**
 * Splits converted edges into fragments (edges of one label and link/junction
 * status that share a node), in order of first appearance, and classifies each
 * as crossing or link (see CROSSING_MAX_M). An unnamed crossing is named after
 * the highest-LTS, then longest, named edge at its nodes.
 */
function fragments(g: Graph, inc: Map<number, number[]>, edgeList: number[]): Fragment[] {
  const edges = [...new Set(edgeList)];
  const groupKey = (e: number) => `${label(g.edges[e].way)}|${isLinkOrJunction(g.edges[e])}`;
  const root = edges.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
  const seen = new Map<string, number>(); // node|groupKey -> first edge index
  edges.forEach((e, i) => {
    for (const n of [g.edges[e].from, g.edges[e].to]) {
      const k = `${n}|${groupKey(e)}`;
      const j = seen.get(k);
      if (j === undefined) seen.set(k, i);
      else root[find(i)] = find(j);
    }
  });
  const groups = new Map<number, number[]>();
  edges.forEach((e, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(e);
  });
  return [...groups.values()].map((fe) => {
    const m = fe.reduce((s, e) => s + g.edges[e].lengthM, 0);
    const crossing = isLinkOrJunction(g.edges[fe[0]]) || m <= CROSSING_MAX_M;
    if (!crossing) return { name: label(g.edges[fe[0]].way), m, crossing, edges: fe };
    let street = label(g.edges[fe[0]].way);
    if (g.edges[fe[0]].way.name === undefined) {
      const own = new Set(fe);
      const named = fe.flatMap((e) => [g.edges[e].from, g.edges[e].to]).flatMap((n) => inc.get(n) ?? [])
        .filter((e) => !own.has(e) && g.edges[e].way.name !== undefined)
        .sort((a, b) => g.edges[b].lts - g.edges[a].lts || g.edges[b].lengthM - g.edges[a].lengthM);
      if (named.length > 0) street = label(g.edges[named[0]].way);
    }
    return { name: `Crossing at ${street}`, m, crossing, edges: fe };
  });
}

const linksM = (frags: Fragment[]) => frags.filter((f) => !f.crossing).reduce((s, f) => s + f.m, 0);
const crossingsM = (frags: Fragment[]) => frags.filter((f) => f.crossing).reduce((s, f) => s + f.m, 0);

/**
 * "Street (m) > Crossing at Street (m) > ...": fragments in path order,
 * consecutive same-name fragments (not node-connected, e.g. split by an LTS 1-2 piece) merged.
 */
function fragmentRuns(frags: Fragment[]): string {
  const runs: { name: string; m: number }[] = [];
  for (const f of frags) {
    if (runs.at(-1)?.name === f.name) runs.at(-1)!.m += f.m;
    else runs.push({ name: f.name, m: f.m });
  }
  return runs.map((r) => `${r.name} (${Math.round(r.m)})`).join(" > ");
}

/** "Street (m) > Crossing at Street ×n (m) > ...": metres per name, names in first-seen order. */
function fragmentTotals(frags: Fragment[]): string {
  const totals = new Map<string, { m: number; n: number }>();
  for (const f of frags) {
    const t = totals.get(f.name) ?? { m: 0, n: 0 };
    totals.set(f.name, { m: t.m + f.m, n: t.n + 1 });
  }
  return [...totals].map(([name, t]) => `${name}${name.startsWith("Crossing") && t.n > 1 ? ` ×${t.n}` : ""} (${Math.round(t.m)})`).join(" > ");
}

function streetSequence(g: Graph, arcs: Arc[]): string {
  return sequence(arcs.map((a) => ({ label: label(g.edges[a.edge].way), m: g.edges[a.edge].lengthM })));
}

const sumM = (g: Graph, edges: Iterable<number>) => [...edges].reduce((s, e) => s + g.edges[e].lengthM, 0);
const contraflowM = (g: Graph, arcs: Arc[]) => arcs.filter((a) => isContraflowArc(g, a)).reduce((s, a) => s + g.edges[a.edge].lengthM, 0);

interface TripResult {
  trip: string;
  l4M: number; // on the variant's own network (contraflow arcs excluded): sets the budget
  l4BaseM: number; // the scenario's own L4 without the counterfactual (differs from l4M only with --allow-oxford)
  budgetM: number;
  snapFromM: number;
  snapToM: number;
  source: number;
  target: number;
  frontier: Solution[]; // ascending converted metres; [0] is the minimum
  knee: Solution;
}

/** Shortest rideable path length (any LTS), metres. */
function shortestM(g: Graph, source: number, target: number, trip: string): number {
  const p = dijkstra(g, source, target, SHORTEST);
  if (!p) throw new Error(`${trip}: no rideable path`);
  return pathLength(g, p.arcs);
}

/** Knee: the frontier point minimising converted + (path - L4), one metre of conversion = one metre of detour. */
const kneeScore = (sol: Solution, l4M: number) => sol.convertedM + sol.pathM - l4M;

/** Thrown when a trip has no path within the budget: only possible with forbidden ways (GapRun.forbiddenWays). */
export class NoSolutionWithinBudget extends Error {}

/**
 * Frontier and knee for one trip. L4 and the budget come from `base`, the
 * variant's network without contraflow arcs; the search runs on `g` (base plus
 * contraflow arcs, or base itself) without the `forbidden` edges.
 */
function solveTrip(
  g: Graph, base: Graph, asIs: Graph, radj: Map<number, Arc[]>, trip: string, from: string, to: string, forbidden: Set<number>,
): TripResult {
  const s = snap(base, POINTS[from], LOW_STRESS_MAX_LTS);
  const t = snap(base, POINTS[to], LOW_STRESS_MAX_LTS);
  const l4M = shortestM(base, s.node, t.node, trip);
  const l4BaseM = base === asIs ? l4M : shortestM(asIs, s.node, t.node, trip);
  const budgetM = Math.max(LOW_STRESS_MAX_RATIO * l4M, l4M + LOW_STRESS_MAX_EXTRA_M);
  const frontier = paretoSearch(g, radj, s.node, t.node, budgetM, { banned: forbidden });
  // Without forbidden edges the L4 path itself is in the search graph and within budget, so a solution exists.
  if (frontier.length === 0) throw new NoSolutionWithinBudget(`${trip}: no solution within the budget`);
  const knee = frontier.reduce((a, b) => (kneeScore(b, l4M) < kneeScore(a, l4M) - EPS_M ? b : a));
  return { trip, l4M, l4BaseM, budgetM, snapFromM: s.distM, snapToM: t.distM, source: s.node, target: t.node, frontier, knee };
}

/**
 * Seeds for the union heuristic, not published as solutions: every frontier
 * point ("frontier #k", #1 = minimum), and for each street the minimum
 * converts, the minimum with that street's LTS >= 3 edges banned ("no <street>"),
 * which finds equal-cost solutions on other streets that may suit the other direction.
 */
function unionSeeds(g: Graph, radj: Map<number, Arc[]>, r: TripResult, forbidden: Set<number>): { name: string; solution: Solution }[] {
  const seeds = r.frontier.map((solution, i) => ({ name: `frontier #${i + 1}`, solution }));
  for (const street of new Set(r.frontier[0].converted.map((e) => label(g.edges[e].way)))) {
    const banned = new Set([...forbidden, ...g.edges.flatMap((e, i) => (isHighStress(e) && label(e.way) === street ? [i] : []))]);
    const [solution] = paretoSearch(g, radj, r.source, r.target, r.budgetM, { banned, firstOnly: true });
    if (solution) seeds.push({ name: `no ${street}`, solution });
  }
  return seeds;
}

const DIRECTION_FIELDS = [
  "l4_m", "l4_base_m", "budget_m", "min_converted_m", "min_path_m", "min_ratio",
  "knee_converted_m", "knee_path_m", "knee_ratio", "frontier_points",
] as const;
/** Result columns of one run, shared by gap-closing-summary.csv and the sensitivity summary (scripts/lts/sensitivity.ts). */
export const GAP_RESULT_FIELDS = [
  ...DIRECTION_FIELDS.map((f) => `ab_${f}` as const), ...DIRECTION_FIELDS.map((f) => `ba_${f}` as const),
  "union_converted_m", "union_links_m", "union_crossings_m", "union_method", "independent_union_m", "union_streets",
] as const;
export type GapResult = Record<(typeof GAP_RESULT_FIELDS)[number], string | number>;
const SUMMARY_HEADER = ["table", "speed_col", "untagged_two_way", "scenario", "allow_oxford", "contraflow", ...GAP_RESULT_FIELDS] as const;
type GapSummary = Record<(typeof SUMMARY_HEADER)[number], string | number>;

const round = Math.round;
const ratio = (pathM: number, l4M: number) => (pathM / l4M).toFixed(3);

function directionSummary(r: TripResult): Record<(typeof DIRECTION_FIELDS)[number], string | number> {
  const min = r.frontier[0];
  return {
    l4_m: round(r.l4M), l4_base_m: round(r.l4BaseM), budget_m: round(r.budgetM),
    min_converted_m: round(min.convertedM), min_path_m: round(min.pathM), min_ratio: ratio(min.pathM, r.l4M),
    knee_converted_m: round(r.knee.convertedM), knee_path_m: round(r.knee.pathM), knee_ratio: ratio(r.knee.pathM, r.l4M),
    frontier_points: r.frontier.length,
  };
}
const prefixed = (prefix: string, rec: Record<string, string | number>) =>
  Object.fromEntries(Object.entries(rec).map(([k, v]) => [`${prefix}_${k}`, v]));

/** Output file suffix of a run: "-allow-oxford" and "-contraflow", in that order, when set. */
const runSuffix = (allowOxford: boolean, contraflow: boolean) => `${allowOxford ? "-allow-oxford" : ""}${contraflow ? "-contraflow" : ""}`;
/** The converted-edges GeoJSON of a run written to outDir. */
export const gapClosingGeojson = (outDir: string, allowOxford: boolean, contraflow: boolean) =>
  join(outDir, `gap-closing${runSuffix(allowOxford, contraflow)}.geojson`);
/** The solutions CSV (per direction min and knee, plus the union) of a run written to outDir. */
export const gapClosingCsv = (outDir: string, allowOxford: boolean, contraflow: boolean) =>
  join(outDir, `gap-closing${runSuffix(allowOxford, contraflow)}.csv`);

/** One gap-closing run on classified ways; `table` fills the table column of its CSVs. */
export interface GapRun {
  scenario: string;
  table: string;
  ways: WayFeature[];
  allowOxford: boolean;
  contraflow: boolean;
  outDir: string;
  /** Ways the search may not use (side-constrained runs, scripts/lts/side-comparison.ts); L4 and the budget still come from the whole network. */
  forbiddenWays?: ReadonlySet<number>;
  /**
   * Further union candidates: the union each of these constrained searches finds
   * (method = its name in union_method), e.g. the two sides of scripts/lts/sides.ts.
   * A constrained search without a solution within the budget adds none.
   */
  constrainedUnions?: { method: string; forbiddenWays: ReadonlySet<number> }[];
}

type UnionCandidate = { edges: Set<number>; method: string };
/** The smallest candidate; on a tie (within EPS_M) the earlier one. */
const smallestUnion = (g: Graph, candidates: UnionCandidate[]) => candidates.reduce((a, b) => (sumM(g, b.edges) < sumM(g, a.edges) - EPS_M ? b : a));

/**
 * Union candidates of one solved pair of directions (every edge set that lets
 * both pass, built from either direction's seeds) without the forbidden edges.
 * Practical set: one converted street serves both directions. The independent
 * union of the two minima can be beaten by solving one direction with the
 * other's converted edges already free (with --contraflow a converted edge is
 * a two-way track, so both its arcs become free). Seeds of either direction:
 * every frontier point, plus near-minimum alternatives (unionSeeds); the
 * smallest union is kept. This is a heuristic: an upper bound on the joint
 * optimum, not the optimum itself.
 */
function unionCandidates(g: Graph, radj: Map<number, Arc[]>, [ab, ba]: TripResult[], forbidden: Set<number>): UnionCandidate[] {
  const candidates = [{ edges: new Set([...ab.frontier[0].converted, ...ba.frontier[0].converted]), method: "independent" }];
  for (const [first, second] of [[ab, ba], [ba, ab]] as const) {
    for (const seed of unionSeeds(g, radj, first, forbidden)) {
      const free = new Set(seed.solution.converted);
      const [rest] = paretoSearch(g, radj, second.source, second.target, second.budgetM, { free, banned: forbidden, firstOnly: true });
      if (rest) candidates.push({ edges: new Set([...free, ...rest.converted]), method: `${first.trip} ${seed.name} first` });
    }
  }
  return candidates;
}

/** Runs the search for both directions and the union, writes the run's CSVs and GeoJSON to run.outDir and returns its result columns. */
export async function solveGapClosing({ scenario, table, ways, allowOxford, contraflow, outDir, forbiddenWays, constrainedUnions }: GapRun): Promise<GapResult> {
  const started = performance.now();
  const { features, oxfordWays } = variantFeatures(ways, allowOxford, oxfordWindow(scenario));
  const base = buildGraph(features);
  const asIs = allowOxford ? buildGraph(ways) : base;
  const { graph: g, contraflowArcs } = contraflow ? withContraflow(base) : { graph: base, contraflowArcs: 0 };
  const radj = reverseAdjacency(g);
  const inc = incidentEdges(g);
  const tag = `${scenario} [${table}${allowOxford ? ", allow-oxford" : ""}${contraflow ? ", contraflow" : ""}]`;
  console.log(`${tag}: graph ${g.nodeCoord.size} nodes, ${g.edges.length} edges` +
    `${allowOxford ? `, ${oxfordWays} pedestrianised Oxford Street ways convertible` : ""}` +
    `${contraflow ? `, ${contraflowArcs} contraflow arcs` : ""}`);

  const edgesOf = (ids?: ReadonlySet<number>) => new Set(g.edges.flatMap((e, i) => (ids?.has(e.way["@id"]) ? [i] : [])));
  const solveBoth = (forbidden: Set<number>) =>
    Object.entries(TRIPS).map(([trip, [from, to]]) => solveTrip(g, base, asIs, radj, trip, from, to, forbidden));
  const forbidden = edgesOf(forbiddenWays);
  const results = solveBoth(forbidden);
  const [ab, ba] = results;
  const independentUnionM = sumM(g, new Set([...ab.frontier[0].converted, ...ba.frontier[0].converted]));
  const candidates = unionCandidates(g, radj, results, forbidden);
  // A constrained search can find a set the seeds above never reach (a set on one
  // side whose per-direction solutions are dominated by the other side's).
  for (const run of constrainedUnions ?? []) {
    const banned = edgesOf(run.forbiddenWays);
    try {
      candidates.push({ edges: smallestUnion(g, unionCandidates(g, radj, solveBoth(banned), banned)).edges, method: run.method });
    } catch (e) {
      if (!(e instanceof NoSolutionWithinBudget)) throw e;
    }
  }
  const union = smallestUnion(g, candidates);
  const unionFrags = fragments(g, inc, [...union.edges]);

  const flags = [table, scenario, allowOxford, contraflow];
  const header = [
    "table", "scenario", "allow_oxford", "contraflow", "direction", "solution", "converted_m", "links_m", "crossings_m",
    "contraflow_m", "path_m", "l4_m", "l4_base_m", "budget_m", "ratio", "extra_m",
    "converted_streets", "street_sequence", "l2_snap_from_m", "l2_snap_to_m",
  ];
  const rows = [header.join(",")];
  const frontierHeader = ["table", "scenario", "allow_oxford", "contraflow", "direction", "point", "role", "converted_m", "path_m", "ratio", "knee_score_m", "converted_streets"];
  const frontierRows = [frontierHeader.join(",")];
  const geo: object[] = [];
  const feature = (e: number, crossing: boolean, solution: string, direction: string, contraflowArc?: boolean) => {
    const edge = g.edges[e];
    return {
      type: "Feature",
      geometry: { type: "LineString", coordinates: edge.coords },
      properties: {
        street: label(edge.way), way_id: edge.way["@id"], highway: edge.way.highway, lts: edge.lts,
        lts_rule: edge.way["@lts_rule"], length_m: roundLengthM(edge.lengthM),
        fragment: crossing ? CROSSING_FRAGMENT : LINK_FRAGMENT, solution, direction,
        ...(contraflowArc === undefined ? {} : { contraflow: contraflowArc }),
      },
    };
  };
  for (const r of results) {
    const roles: [string, Solution][] = [["min", r.frontier[0]], ["knee", r.knee]];
    for (const [solution, sol] of roles) {
      const frags = fragments(g, inc, sol.converted);
      rows.push([
        ...flags, r.trip, solution, round(sol.convertedM), round(linksM(frags)), round(crossingsM(frags)), round(contraflowM(g, sol.arcs)),
        round(sol.pathM), round(r.l4M), round(r.l4BaseM), round(r.budgetM), ratio(sol.pathM, r.l4M), round(sol.pathM - r.l4M),
        fragmentRuns(frags), streetSequence(g, sol.arcs), round(r.snapFromM), round(r.snapToM),
      ].map(csvField).join(","));
      const crossingEdge = new Map(frags.flatMap((f) => f.edges.map((e) => [e, f.crossing] as const)));
      for (const a of sol.arcs) {
        if (crossingEdge.has(a.edge)) geo.push(feature(a.edge, crossingEdge.get(a.edge)!, solution, r.trip, isContraflowArc(g, a)));
      }
    }
    r.frontier.forEach((sol, i) => {
      const role = [i === 0 ? "min" : "", sol === r.knee ? "knee" : ""].filter(Boolean).join("+");
      frontierRows.push([
        ...flags, r.trip, i + 1, role, round(sol.convertedM), round(sol.pathM), ratio(sol.pathM, r.l4M),
        round(kneeScore(sol, r.l4M)), fragmentRuns(fragments(g, inc, sol.converted)),
      ].map(csvField).join(","));
    });
  }
  rows.push([...flags, UNION_DIRECTION, UNION_SOLUTION, round(sumM(g, union.edges)), round(linksM(unionFrags)), round(crossingsM(unionFrags)),
    "", "", "", "", "", "", "", fragmentTotals(unionFrags), "", "", ""].map(csvField).join(","));
  for (const f of unionFrags) for (const e of f.edges) geo.push(feature(e, f.crossing, UNION_SOLUTION, UNION_DIRECTION));

  await mkdir(outDir, { recursive: true });
  const suffix = runSuffix(allowOxford, contraflow);
  await writeFile(gapClosingCsv(outDir, allowOxford, contraflow), rows.join("\n") + "\n");
  await writeFile(gapClosingGeojson(outDir, allowOxford, contraflow), JSON.stringify({ type: "FeatureCollection", features: geo }, null, 1) + "\n");
  await writeFile(join(outDir, `gap-closing-frontier${suffix}.csv`), frontierRows.join("\n") + "\n");

  const summary = {
    ...prefixed("ab", directionSummary(ab)), ...prefixed("ba", directionSummary(ba)),
    union_converted_m: round(sumM(g, union.edges)), union_links_m: round(linksM(unionFrags)), union_crossings_m: round(crossingsM(unionFrags)),
    union_method: union.method, independent_union_m: round(independentUnionM), union_streets: fragmentTotals(unionFrags),
  } as GapResult;
  // Wall-clock runtime goes to the log only, so a rerun leaves the summary CSV unchanged.
  const runtimeS = ((performance.now() - started) / MS_PER_S).toFixed(1);
  console.log(`${tag}: A-B min ${summary.ab_min_converted_m} m (knee ${summary.ab_knee_converted_m} m / ${summary.ab_knee_path_m} m path), ` +
    `B-A min ${summary.ba_min_converted_m} m (knee ${summary.ba_knee_converted_m} m / ${summary.ba_knee_path_m} m path), ` +
    `union ${summary.union_converted_m} m (${summary.union_method}): ${summary.union_streets} [${runtimeS} s]`);
  return summary;
}

/** One run of a criteria table on its own classified ways, written to results/lts/<mode>/<scenario>/. */
async function gapClosing(scenario: string, mode: LtsMode, allowOxford: boolean, contraflow: boolean): Promise<GapSummary> {
  const table = modeName(mode);
  const fc = (await Bun.file(classifiedPath(scenario, mode)).json()) as { features: WayFeature[] };
  const result = await solveGapClosing({ scenario, table, ways: fc.features, allowOxford, contraflow, outDir: resultsDir(mode, scenario) });
  return {
    table, speed_col: mode.speedCol, untagged_two_way: mode.untaggedUnlaned ? UNTAGGED_UNLANED : UNTAGGED_CENTRELINE,
    scenario, allow_oxford: String(allowOxford), contraflow: String(contraflow), ...result,
  };
}

/** Headline modes: every furth2017 table in the default speed column (with all scenarios and flags: the headline rows). */
export const HEADLINE_GAP_MODES: LtsMode[] = FURTH_TABLES.map((table) => ({ table, speedCol: DEFAULT_SPEED_COL }));
/** Sensitivity: the same in the <=20 mph column, same scenarios and flags. */
export const LT20_GAP_MODES: LtsMode[] = FURTH_TABLES.map((table) => ({ table, speedCol: LT20_SPEED_COL }));
/** Option combinations each headline and lt20 mode runs for every scenario, in summary order. */
export const GAP_VARIANTS = [false, true].flatMap((allowOxford) => [false, true].map((contraflow) => ({ allowOxford, contraflow })));
/** The article's headline options: two-way tracks allowed, the pedestrianised Oxford Street not rideable. */
export const HEADLINE_RUN = { allowOxford: false, contraflow: true } as const;
/** Sensitivity: untagged two-way residential/living streets unlaned; run for one variant only (UNLANED_GAP_VARIANT). */
export const UNLANED_GAP_MODE: LtsMode = { table: "furth2017-high", speedCol: DEFAULT_SPEED_COL, untaggedUnlaned: true };
export const UNLANED_GAP_VARIANT = { scenario: "today", ...HEADLINE_RUN } as const;

/**
 * Headline and lt20 modes x scenario x Oxford counterfactual x contraflow, plus the
 * single unlaned variant; writes the combined summary (one row per run; the
 * headline rows are those with speed_col 25 and untagged_two_way centreline).
 */
export async function gapClosingAll() {
  const summaries: GapSummary[] = [];
  for (const mode of [...HEADLINE_GAP_MODES, ...LT20_GAP_MODES]) {
    for (const scenario of Object.keys(SCENARIOS)) {
      for (const { allowOxford, contraflow } of GAP_VARIANTS) {
        summaries.push(await gapClosing(scenario, mode, allowOxford, contraflow));
      }
    }
  }
  const { scenario, allowOxford, contraflow } = UNLANED_GAP_VARIANT;
  summaries.push(await gapClosing(scenario, UNLANED_GAP_MODE, allowOxford, contraflow));
  const rows = [SUMMARY_HEADER.join(","), ...summaries.map((s) => SUMMARY_HEADER.map((h) => csvField(s[h])).join(","))];
  await writeFile(join(LTS_RESULTS, "gap-closing-summary.csv"), rows.join("\n") + "\n");
}

if (import.meta.main) {
  const usage = `bun scripts/lts/gap-closing.ts [<scenario> ${MODE_USAGE} [${ALLOW_OXFORD_FLAG}] [${CONTRAFLOW_FLAG}]]`;
  if (process.argv.length <= 2) await gapClosingAll();
  else {
    await gapClosing(requireScenario(process.argv[2], usage), parseMode(process.argv, usage),
      process.argv.includes(ALLOW_OXFORD_FLAG), process.argv.includes(CONTRAFLOW_FLAG));
  }
}
