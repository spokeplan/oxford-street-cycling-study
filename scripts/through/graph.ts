// The driving graph of a scenario for the through-traffic measures: OSM node ids
// as vertices, one arc per consecutive vertex pair of a way open to through motor
// traffic (common.ts, closedReason) in each direction a car may drive it, weighted
// by travel time (length over the class speed, no signal or turn delays; turn
// restrictions are not read). A node that stops a car (common.ts, nodeStopReason:
// bollards, blocks and the like, or node access tags) is removed with every arc
// through it.
import { haversineM, type LonLat, type WayFeature } from "../lts/common";
import { carDirections, closedReason, nodeStopReason, speedMs } from "./common";

export interface DrivingGraph {
  /** Vertex index -> OSM node id and position. */
  nodeIds: number[];
  coords: LonLat[];
  /** Arcs as parallel arrays: tail, head (vertex indices), travel time (s), way id. */
  tail: number[];
  head: number[];
  seconds: number[];
  way: number[];
  /** Outgoing and incoming arc indices per vertex. */
  out: number[][];
  in: number[][];
  /** Per way id: why it is not in the graph (absent: it is). */
  closed: Map<number, string>;
  /** Per node id that stops a car: why. */
  stops: Map<number, string>;
}

export function buildDrivingGraph(ways: WayFeature[], nodeTags: Map<number, Record<string, string>>): DrivingGraph {
  const stops = new Map<number, string>();
  for (const [id, tags] of nodeTags) {
    const reason = nodeStopReason(tags);
    if (reason) stops.set(id, reason);
  }
  const g: DrivingGraph = { nodeIds: [], coords: [], tail: [], head: [], seconds: [], way: [], out: [], in: [], closed: new Map(), stops };
  const index = new Map<number, number>();
  const vertex = (id: number, at: LonLat) => {
    let i = index.get(id);
    if (i === undefined) {
      i = g.nodeIds.length;
      index.set(id, i);
      g.nodeIds.push(id);
      g.coords.push(at);
      g.out.push([]);
      g.in.push([]);
    }
    return i;
  };
  const arc = (a: number, b: number, s: number, wayId: number) => {
    const k = g.tail.length;
    g.tail.push(a);
    g.head.push(b);
    g.seconds.push(s);
    g.way.push(wayId);
    g.out[a].push(k);
    g.in[b].push(k);
  };
  for (const f of ways) {
    const p = f.properties;
    const reason = closedReason(p);
    if (reason) {
      g.closed.set(p["@id"], reason);
      continue;
    }
    const { forward, backward } = carDirections(p);
    const v = speedMs(p);
    const ids = p["@nodes"];
    const pts = f.geometry.coordinates;
    for (let i = 1; i < ids.length; i++) {
      if (stops.has(ids[i - 1]) || stops.has(ids[i])) continue;
      const a = vertex(ids[i - 1], pts[i - 1]);
      const b = vertex(ids[i], pts[i]);
      const s = haversineM(pts[i - 1], pts[i]) / v;
      if (forward) arc(a, b, s, p["@id"]);
      if (backward) arc(b, a, s, p["@id"]);
    }
  }
  return g;
}

// Binary min-heap of (key, vertex) entries; a vertex may be pushed again with a smaller key.
class Heap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() { return this.keys.length; }
  private swap(i: number, j: number) {
    [this.keys[i], this.keys[j]] = [this.keys[j], this.keys[i]];
    [this.vals[i], this.vals[j]] = [this.vals[j], this.vals[i]];
  }
  push(key: number, val: number) {
    this.keys.push(key);
    this.vals.push(val);
    for (let i = this.keys.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(p, i);
      i = p;
    }
  }
  pop(): number {
    const top = this.vals[0];
    const k = this.keys.pop()!, v = this.vals.pop()!;
    if (this.keys.length > 0) {
      this.keys[0] = k;
      this.vals[0] = v;
      for (let i = 0; ; ) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.keys.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.keys.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(m, i);
        i = m;
      }
    }
    return top;
  }
}

/**
 * Travel times (s) from `source` to every vertex (forward) or from every vertex to
 * `source` (backward), and the arc each vertex was reached by (-1 for none).
 */
export function dijkstra(g: DrivingGraph, source: number, backward = false): { dist: Float64Array; via: Int32Array } {
  const n = g.nodeIds.length;
  const dist = new Float64Array(n).fill(Infinity);
  const via = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[source] = 0;
  const heap = new Heap();
  heap.push(0, source);
  while (heap.size > 0) {
    const u = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    for (const k of backward ? g.in[u] : g.out[u]) {
      const v = backward ? g.tail[k] : g.head[k];
      const d = dist[u] + g.seconds[k];
      if (d < dist[v]) {
        dist[v] = d;
        via[v] = k;
        heap.push(d, v);
      }
    }
  }
  return { dist, via };
}
