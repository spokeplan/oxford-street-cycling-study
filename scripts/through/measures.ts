// Through-traffic measures per way on the driving graph (graph.ts):
//   fastest pairs  - how many through trips (ordered portal pairs) have the way on
//                    their fastest path
//   detour ratio   - the least ratio, over all portal pairs, of the fastest time
//                    via the way to the pair's fastest time: 1 for a way on some
//                    fastest path; a way with ratio <= tolerance lies on a path at
//                    most that much slower than the fastest, usable as a cut-through
//   near pairs     - per tolerance in TOLERANCES, how many through trips have such a
//                    path via the way (the cut-through's catchment, not just its existence)
//   structural     - the way lies on a drivable route between two different main
//                    roads (MAIN_HIGHWAYS, told apart by ref or name) using minor
//                    streets only: not a dead end, not behind a filter, not access-only
// Portals: where an arc of a public road (every car class but service) crosses the
// study BBOX, the vertex outside it; a portal is an origin when a car can drive in
// there, a destination when it can drive out. A through trip runs from an origin
// to a different destination, so it passes through the area.
import { BBOX, type LonLat } from "../lts/common";
import { MAIN_HIGHWAYS } from "./common";
import { dijkstra, type DrivingGraph } from "./graph";

// Portal roads: public roads only, so car parks and private service roads are not trip ends.
const NON_PORTAL_HIGHWAYS = new Set(["service"]);
const inBbox = ([lon, lat]: LonLat) => lon >= BBOX.minLon && lon <= BBOX.maxLon && lat >= BBOX.minLat && lat <= BBOX.maxLat;

export interface Portals { origins: number[]; destinations: number[] }

/** Origin and destination portal vertices, ascending by OSM node id. */
export function portals(g: DrivingGraph, highwayOf: Map<number, string>): Portals {
  const origins = new Set<number>(), destinations = new Set<number>();
  g.tail.forEach((a, k) => {
    if (NON_PORTAL_HIGHWAYS.has(highwayOf.get(g.way[k]) ?? "")) return;
    const b = g.head[k];
    const [ina, inb] = [inBbox(g.coords[a]), inBbox(g.coords[b])];
    if (!ina && inb) origins.add(a);
    if (ina && !inb) destinations.add(b);
  });
  const byNode = (s: Set<number>) => [...s].sort((x, y) => g.nodeIds[x] - g.nodeIds[y]);
  return { origins: byNode(origins), destinations: byNode(destinations) };
}

// Detour tolerances (time via the way over the trip's fastest time) counted per way.
export const TOLERANCES = [1.1, 1.2, 1.3] as const;

/**
 * Per way id: the number of through trips with the way on their fastest path, the
 * least detour ratio via the way, and per tolerance the number of trips within it.
 */
export function tripMeasures(g: DrivingGraph, { origins, destinations }: Portals): {
  fastestPairs: Map<number, number>; detour: Map<number, number>; nearPairs: Map<number, number[]>; pairs: number;
} {
  const forward = origins.map((p) => dijkstra(g, p));
  const backward = destinations.map((q) => dijkstra(g, q, true).dist);
  const fastestPairs = new Map<number, number>();
  const arcRatio = new Float64Array(g.tail.length).fill(Infinity);
  const nearPairs = new Map<number, number[]>();
  // Trip index that last counted a way per tolerance, so a way counts once per trip.
  const lastTrip = new Map<number, number[]>();
  let pairs = 0;
  forward.forEach(({ dist, via }, i) => {
    destinations.forEach((q, j) => {
      const total = dist[q];
      if (q === origins[i] || !(total > 0 && Number.isFinite(total))) return;
      pairs++;
      // Ways on the fastest path, each once per trip.
      const onPath = new Set<number>();
      for (let v = q; v !== origins[i]; v = g.tail[via[v]]) onPath.add(g.way[via[v]]);
      for (const w of onPath) fastestPairs.set(w, (fastestPairs.get(w) ?? 0) + 1);
      // Fastest time via each arc (to its tail, the arc, from its head) over the trip's time.
      const back = backward[j];
      for (let k = 0; k < g.tail.length; k++) {
        const r = (dist[g.tail[k]] + g.seconds[k] + back[g.head[k]]) / total;
        if (r < arcRatio[k]) arcRatio[k] = r;
        if (!(r <= TOLERANCES[TOLERANCES.length - 1])) continue;
        const w = g.way[k];
        const counts = nearPairs.get(w) ?? nearPairs.set(w, TOLERANCES.map(() => 0)).get(w)!;
        const seen = lastTrip.get(w) ?? lastTrip.set(w, TOLERANCES.map(() => -1)).get(w)!;
        TOLERANCES.forEach((t, x) => {
          if (r <= t && seen[x] !== pairs) {
            seen[x] = pairs;
            counts[x]++;
          }
        });
      }
    });
  });
  const detour = new Map<number, number>();
  arcRatio.forEach((r, k) => {
    if (Number.isFinite(r) && r < (detour.get(g.way[k]) ?? Infinity)) detour.set(g.way[k], r);
  });
  return { fastestPairs, detour, nearPairs, pairs };
}

// Main roads distinct for the structural measure: up to this many identities are
// kept per vertex, enough to tell whether two differ.
const MAX_LABELS = 2;

/**
 * Ways of minor classes that lie on a drivable route between two different main
 * roads over minor arcs only. Labels: the main roads a vertex can be reached from
 * (forward) and can reach (backward) through minor arcs; a minor arc u -> v is
 * through when some road reaching u differs from some road reached from v.
 */
export function structuralThrough(g: DrivingGraph, highwayOf: Map<number, string>, identityOf: Map<number, string>): Set<number> {
  const isMain = (k: number) => MAIN_HIGHWAYS.has(highwayOf.get(g.way[k]) ?? "");
  const propagate = (backward: boolean): string[][] => {
    const labels: string[][] = g.nodeIds.map(() => []);
    const queue: number[] = [];
    const add = (v: number, id: string) => {
      if (labels[v].length < MAX_LABELS && !labels[v].includes(id)) {
        labels[v].push(id);
        queue.push(v);
      }
    };
    g.tail.forEach((a, k) => {
      const id = identityOf.get(g.way[k]);
      if (isMain(k) && id) {
        add(a, id);
        add(g.head[k], id);
      }
    });
    while (queue.length > 0) {
      const u = queue.pop()!;
      for (const k of backward ? g.in[u] : g.out[u]) {
        if (isMain(k)) continue;
        const v = backward ? g.tail[k] : g.head[k];
        for (const id of labels[u]) add(v, id);
      }
    }
    return labels;
  };
  const from = propagate(false), to = propagate(true);
  const through = new Set<number>();
  g.tail.forEach((u, k) => {
    if (isMain(k)) return;
    const [a, b] = [from[u], to[g.head[k]]];
    if (a.some((x) => b.some((y) => x !== y))) through.add(g.way[k]);
  });
  return through;
}
