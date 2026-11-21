// Matches the LAEI 2022 major-road links (modelled all-motor-vehicle daily flow)
// to the OSM motor-road ways of the `today` scenario (data/lts/today-ways.geojson,
// re-extracted first, as scripts/dft/match-countpoints.ts does) and writes the flow
// per way that scripts/lts/volume.ts reads for the best-evidence run.
//
// Rule: a way takes a flow only when LAEI links run along it, close and parallel,
// for most of its length, so a cross street does not pick up a main road's flow
// where the two meet. The way is cut into pieces of at most SAMPLE_STEP_M; each
// piece goes to the nearest link segment alongside it: within MATCH_DIST_M of the
// piece's midpoint, not more than END_SLACK_M beyond the segment's ends, and within
// MAX_ANGLE_DEG of its direction. A link that covers less than STRAY_LINK_SHARE
// of the way is dropped (where OSM and OS place a junction a few metres apart, the
// next link along the road takes the last metres of the way). A share, not a
// length, so short ways can match at all. Links with
// zero flow are no data: TfL's model assigns no traffic to them (Soho Square,
// Torrington Place, where the DfT counted 2,140 a day). The way is matched when
// the remaining links cover at least MIN_SHARE of its length; its flow is their
// length-weighted mean (weights: metres of the way each link covers). A link LAEI
// classes as an A road or motorway is not considered for a minor way without an A
// or M road number (MAIN_ROAD_LINK).
//
// Writes results/laei/ways-matched.csv: every motor way any link runs along,
// matched or not, with the share of its length the non-zero links cover
// (zero_flow_share: the zero links), the flow (adt), the lowest and highest flow of
// those links, and the links kept as <TOID>:<class initial>:<flow>@<metres covered>
// (A, B, C for "C / Unclassified Road" or M, from the LAEI road.classification).
// scripts/laei/validate.ts checks the result.
// Usage: bun scripts/laei/match-links.ts   (after scripts/laei/download.ts)
import { Database } from "bun:sqlite";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MOTOR_HIGHWAYS, NO, YES, toCsv } from "../dft/common";
import { isMotorOneway } from "../lts/classify";
import { M_PER_DEG_LAT, byCodeUnit, waysPath, type LonLat, type WayFeature } from "../lts/common";
import { extractGraph } from "../lts/extract-graph";
import { bngToWgs84 } from "./bng";
import { LAEI_DATA, LAEI_FLOW_COLUMNS, LAEI_GPKG, LAEI_RESULTS, LAEI_TABLE, LAEI_WAYS_CSV } from "./common";
import { gpkgLines } from "./gpkg";

const SCENARIO = "today";
// Way pieces are at most this long (metres).
const SAMPLE_STEP_M = 5;
// A link segment counts for a piece when the piece's midpoint lies within this
// distance (metres) of it. Covers the offset between OSM and OS centrelines plus the
// few metres of the Helmert transformation (scripts/laei/bng.ts), and stays under
// the spacing of parallel streets in the West End.
const MATCH_DIST_M = 12;
// ... when the midpoint lies alongside the segment, not more than this far
// (metres) beyond either end of it: a short link must not claim the way's pieces
// that only continue in its direction past a junction (bends and slightly offset
// junction nodes stay within the slack) ...
const END_SLACK_M = 3;
// ... and when the two directions differ by at most this angle (degrees, undirected).
const MAX_ANGLE_DEG = 20;
// A link covering less than this share of the way is dropped.
const STRAY_LINK_SHARE = 0.1;
// Least share of the way's length the non-zero links must cover.
const MIN_SHARE = 0.5;
// A link LAEI classes as an A road or motorway never covers a minor OSM way
// (these classes) that carries no A or M road number: such a way beside a main
// road is a slip, service road or side-street mouth, not the main road itself
// (a residential way along Park Lane took 36,789, a piece of Half Moon Street
// Piccadilly's 16,425).
const MAIN_ROAD_LINK = /^(A Road|M\d+|A\d+M)$/;
const MINOR_WAY_HIGHWAYS = new Set(["residential", "unclassified", "service", "living_street"]);
const MAIN_ROAD_REF = /(^|;)\s*[AM]\d/i;
// Spatial index cell (metres) for the link segments.
const CELL_M = 50;
// Rounding of shares in the output (two decimals).
const SHARE_DECIMALS = 2;
const M_PER_KM = 1000;

type Xy = [number, number];
interface Link { toid: string; flow: number; cls: string; lines: Xy[][] }
interface Segment { link: number; a: Xy; b: Xy }

const ways = await (async () => {
  await extractGraph(SCENARIO);
  const all = ((await Bun.file(waysPath(SCENARIO)).json()) as { features: WayFeature[] }).features;
  return all.filter((f) => MOTOR_HIGHWAYS.has(String(f.properties.highway)));
})();

// Local equirectangular projection (metres) centred on the ways' extent.
const lons = ways.flatMap((f) => f.geometry.coordinates.map((c) => c[0]));
const lats = ways.flatMap((f) => f.geometry.coordinates.map((c) => c[1]));
const extent = { minLon: Math.min(...lons), maxLon: Math.max(...lons), minLat: Math.min(...lats), maxLat: Math.max(...lats) };
const lat0 = (extent.minLat + extent.maxLat) / 2;
const kx = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
const project = ([lon, lat]: LonLat): Xy => [(lon - extent.minLon) * kx, (lat - lat0) * M_PER_DEG_LAT];
const inExtent = ([lon, lat]: LonLat) => lon >= extent.minLon && lon <= extent.maxLon && lat >= extent.minLat && lat <= extent.maxLat;

/** Every LAEI link with a vertex inside the ways' extent, projected, with its all-motor-vehicle flow. */
function loadLinks(): Link[] {
  const db = new Database(join(LAEI_DATA, LAEI_GPKG), { readonly: true });
  const flow = LAEI_FLOW_COLUMNS.map((c) => `"${c}"`).join(" + ");
  const rows = db.query(`select TOID as toid, "road.classification" as cls, geom, ${flow} as flow from "${LAEI_TABLE}" order by TOID`).all() as { toid: string; cls: string; geom: Uint8Array; flow: number }[];
  const links: Link[] = [];
  for (const r of rows) {
    const lines = gpkgLines(r.geom).map((l) => l.map(([e, n]) => bngToWgs84(e, n)));
    if (!lines.some((l) => l.some(inExtent))) continue;
    links.push({ toid: r.toid, flow: r.flow, cls: r.cls, lines: lines.map((l) => l.map(project)) });
  }
  db.close();
  return links;
}

const cellKey = (cx: number, cy: number) => `${cx},${cy}`;
/** Grid index of the link segments: each segment is listed in every cell its bounding box, widened by MATCH_DIST_M, touches. */
function indexSegments(links: Link[]): Map<string, Segment[]> {
  const grid = new Map<string, Segment[]>();
  links.forEach((l, link) => {
    for (const line of l.lines) {
      for (let i = 1; i < line.length; i++) {
        const s: Segment = { link, a: line[i - 1], b: line[i] };
        const [x0, x1] = [Math.min(s.a[0], s.b[0]) - MATCH_DIST_M, Math.max(s.a[0], s.b[0]) + MATCH_DIST_M];
        const [y0, y1] = [Math.min(s.a[1], s.b[1]) - MATCH_DIST_M, Math.max(s.a[1], s.b[1]) + MATCH_DIST_M];
        for (let cx = Math.floor(x0 / CELL_M); cx <= Math.floor(x1 / CELL_M); cx++) {
          for (let cy = Math.floor(y0 / CELL_M); cy <= Math.floor(y1 / CELL_M); cy++) {
            const k = cellKey(cx, cy);
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k)!.push(s);
          }
        }
      }
    }
  });
  return grid;
}

const MAX_SIN = Math.sin((MAX_ANGLE_DEG * Math.PI) / 180);
/**
 * Distance from p to segment s, or Infinity when s is not parallel (within
 * MAX_ANGLE_DEG) to direction d (unit vector) or p lies more than END_SLACK_M beyond its ends.
 */
function parallelDistance(p: Xy, d: Xy, s: Segment): number {
  const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0 || Math.abs(d[0] * dy - d[1] * dx) / len > MAX_SIN) return Infinity; // |sin| of the angle between the directions
  const along = ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dy) / len; // metres from a towards b
  if (along < -END_SLACK_M || along > len + END_SLACK_M) return Infinity;
  const t = Math.max(0, Math.min(1, along / len));
  return Math.hypot(p[0] - s.a[0] - t * dx, p[1] - s.a[1] - t * dy);
}

/** Metres of the way covered by each link (index into links), from the nearest close and parallel segment per piece. */
function coverage(f: WayFeature, grid: Map<string, Segment[]>): { wayM: number; byLink: Map<number, number> } {
  const p0 = f.properties;
  const minorWay = MINOR_WAY_HIGHWAYS.has(String(p0.highway)) && !MAIN_ROAD_REF.test(String(p0.ref ?? ""));
  const fits = (link: number) => !(minorWay && MAIN_ROAD_LINK.test(links[link].cls));
  const pts = f.geometry.coordinates.map(project);
  const byLink = new Map<number, number>();
  let wayM = 0;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len === 0) continue;
    wayM += len;
    const d: Xy = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const pieces = Math.ceil(len / SAMPLE_STEP_M);
    for (let k = 0; k < pieces; k++) {
      const t = (k + 0.5) / pieces;
      const p: Xy = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      let best = { link: -1, dist: MATCH_DIST_M };
      for (const s of grid.get(cellKey(Math.floor(p[0] / CELL_M), Math.floor(p[1] / CELL_M))) ?? []) {
        const dist = fits(s.link) ? parallelDistance(p, d, s) : Infinity;
        if (dist <= best.dist) best = { link: s.link, dist };
      }
      if (best.link >= 0) byLink.set(best.link, (byLink.get(best.link) ?? 0) + len / pieces);
    }
  }
  return { wayM, byLink };
}

const links = loadLinks();
const grid = indexSegments(links);
const round = Math.round;
const share = (x: number) => x.toFixed(SHARE_DECIMALS);

interface WayMatch {
  way_id: number; name: string; ref: string; highway: string; oneway: string; way_m: number; matched: typeof YES | typeof NO;
  share: string; zero_flow_share: string; adt: number | ""; flow_min: number | ""; flow_max: number | ""; links: string;
}
const rows: WayMatch[] = [];
for (const f of ways) {
  const { wayM, byLink } = coverage(f, grid);
  const kept = [...byLink].filter(([, m]) => m >= STRAY_LINK_SHARE * wayM).sort(([a], [b]) => byCodeUnit(links[a].toid, links[b].toid));
  if (kept.length === 0) continue;
  const flowing = kept.filter(([l]) => links[l].flow > 0);
  const flowingM = flowing.reduce((s, [, m]) => s + m, 0);
  const zeroM = kept.reduce((s, [, m]) => s + m, 0) - flowingM;
  const matched = flowing.length > 0 && flowingM >= MIN_SHARE * wayM;
  const flows = flowing.map(([l]) => links[l].flow);
  const p = f.properties;
  rows.push({
    way_id: p["@id"], name: String(p.name ?? ""), ref: String(p.ref ?? ""), highway: String(p.highway),
    oneway: isMotorOneway(p) ? YES : NO, way_m: round(wayM), matched: matched ? YES : NO,
    share: share(flowingM / wayM), zero_flow_share: share(zeroM / wayM),
    adt: matched ? round(flowing.reduce((s, [l, m]) => s + links[l].flow * m, 0) / flowingM) : "",
    flow_min: matched ? round(Math.min(...flows)) : "", flow_max: matched ? round(Math.max(...flows)) : "",
    links: kept.map(([l, m]) => `${links[l].toid}:${links[l].cls[0]}:${round(links[l].flow)}@${round(m)}m`).join(" "),
  });
}
rows.sort((a, b) => a.way_id - b.way_id);
await mkdir(LAEI_RESULTS, { recursive: true });
await writeFile(LAEI_WAYS_CSV, toCsv(Object.keys(rows[0]), rows as unknown as Record<string, unknown>[]));
const matched = rows.filter((r) => r.matched === YES);
const km = (rs: WayMatch[]) => (rs.reduce((s, r) => s + r.way_m, 0) / M_PER_KM).toFixed(1);
console.log(`${links.length} LAEI links near ${ways.length} motor ways; ${rows.length} ways with a link along them, ` +
  `${matched.length} matched (${km(matched)} km) -> ${LAEI_WAYS_CSV}`);
