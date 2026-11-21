// Average daily motor traffic (ADT, vehicles per day, both directions) per way,
// the volume input of the Furth 2017 table (docs/lts.md, section 4c).
// Sources, first match wins:
//   count         - a count point matched to the way: DfT (results/dft/countpoints-matched.csv)
//                   and, in the best-evidence run, the published counts
//                   (results/published-counts/counts-matched.csv)
//   road          - no point on the way, but it lies within ROAD_MAX_M of a counted way's
//                   count point, measured along ways of the same road; the nearest such count
//                   wins. The same road: for a DfT count, ways sharing its way's `ref` (or,
//                   lacking ref, `name`); for a published count, which names its street, ways
//                   sharing its way's `name` only. The count carried from a way is the one that
//                   wins on it, so a DfT count displaced by a newer published count is not carried
//   laei          - best-evidence run only: the LAEI 2022 modelled flow matched to the way
//                   (results/laei/ways-matched.csv)
//   class-default - per-highway-class default, low or high assumption
import { MATCHED_CSV, MOTOR_HIGHWAYS, YES, parseCsv, supersedes } from "../dft/common";
import { LAEI_WAYS_CSV } from "../laei/common";
import { PUBLISHED_MATCHED_CSV } from "../published-counts/common";
import { haversineM, type FurthTable, type LonLat, type WayFeature } from "./common";

export type AdtSource = "count" | "road" | "laei" | "class-default";
export interface Volume {
  adt: number;
  source: AdtSource;
  countPoint?: string; // DfT count_point_id or published count id (count and road)
  countYear?: number; // year of that count (count and road)
  roadM?: number; // distance along the road from the count point (road only)
}

/** Options of wayVolumes. */
export interface VolumeOptions {
  /** Class defaults instead of the table's CLASS_DEFAULTS (a sensitivity run passes its own). */
  classDefaults?: Record<string, number>;
  /** Best-evidence run: published counts join the DfT counts, and LAEI flows come before the class defaults. */
  bestEvidence?: boolean;
  /** Best-evidence only, robustness checks: false leaves the LAEI step out (default true). */
  laei?: boolean;
  /** Best-evidence only, robustness checks: factor applied to every LAEI flow (default 1). */
  laeiScale?: number;
}

// A count is carried this far along the same road (metres).
const ROAD_MAX_M = 600;

// Default ADT per highway class, vehicles/day. `_link`s take their parent class;
// `road` and `busway` count as unclassified, `service` as residential (service
// roads normally stop at rules m2-m4/m16 before the table).
const LOW_RES = 1000, LOW_UNCL = 1500, LOW_TERT = 3000, LOW_MAJOR = 10000;
const HIGH_RES = 2500, HIGH_UNCL = 3000, HIGH_TERT = 6000, HIGH_MAJOR = 15000;
const defaults = (res: number, uncl: number, tert: number, major: number): Record<string, number> => ({
  residential: res, living_street: res, service: res,
  unclassified: uncl, road: uncl, busway: uncl,
  tertiary: tert, secondary: major, primary: major, trunk: major,
});
export const CLASS_DEFAULTS: Record<FurthTable, Record<string, number>> = {
  "furth2017-low": defaults(LOW_RES, LOW_UNCL, LOW_TERT, LOW_MAJOR),
  "furth2017-high": defaults(HIGH_RES, HIGH_UNCL, HIGH_TERT, HIGH_MAJOR),
};

const baseClass = (highway: unknown) => String(highway ?? "").replace(/_link$/, "");
const str = (p: Record<string, unknown>, k: string) => (typeof p[k] === "string" && p[k] !== "" ? (p[k] as string) : undefined);
/** Road identity a DfT count is carried along: the ref, or the name when there is no ref. */
function roadKey(p: Record<string, unknown>): string | undefined {
  const ref = str(p, "ref");
  if (ref) return `ref=${ref}`;
  return nameKey(p);
}
/** Road identity a published count is carried along: the name only (a count names its street, not a road number). */
function nameKey(p: Record<string, unknown>): string | undefined {
  const name = str(p, "name");
  return name ? `name=${name}` : undefined;
}

interface Count {
  adt: number;
  countPoint: string;
  at: LonLat;
  year: number;
  distM: number;
  /** A published count (carried by name only), not a DfT point. */
  published: boolean;
}

/**
 * Count per matched way id, from the DfT points and (bestEvidence) the published
 * counts. Several points on one way: the latest year wins, then the closest snap.
 */
async function loadCounts(bestEvidence: boolean): Promise<Map<number, Count>> {
  const points: { way: number; count: Count }[] = [];
  for (const r of parseCsv(await Bun.file(MATCHED_CSV).text())) {
    if (r.matched !== YES) continue;
    points.push({
      way: Number(r.way_id),
      count: {
        adt: Number(r.all_motor_vehicles), countPoint: r.count_point_id, at: [Number(r.longitude), Number(r.latitude)],
        year: Number(r.year), distM: Number(r.distance_m), published: false,
      },
    });
  }
  // Every published count is matched (scripts/published-counts/match.ts stops otherwise) and used as published.
  if (bestEvidence) {
    for (const r of parseCsv(await Bun.file(PUBLISHED_MATCHED_CSV).text())) {
      points.push({
        way: Number(r.way_id),
        count: {
          adt: Number(r.all_motor_vehicles), countPoint: r.id, at: [Number(r.lon), Number(r.lat)], year: Number(r.year), distM: Number(r.distance_m),
          published: true,
        },
      });
    }
  }
  const out = new Map<number, Count>();
  for (const { way, count: c } of points) {
    if (supersedes(c, out.get(way))) out.set(way, c);
  }
  return out;
}

/** LAEI flow per matched way id (results/laei/ways-matched.csv). */
async function loadLaei(): Promise<Map<number, number>> {
  const rows = parseCsv(await Bun.file(LAEI_WAYS_CSV).text()).filter((r) => r.matched === YES);
  return new Map(rows.map((r) => [Number(r.way_id), Number(r.adt)]));
}

/**
 * Shortest distances (metres) from `source` over the vertex graph of `ways`,
 * stopping at ROAD_MAX_M. Groups are small, so the frontier is a plain array.
 */
function roadDistances(ways: WayFeature[], source: number): Map<number, number> {
  const adj = new Map<number, [number, number][]>();
  const link = (a: number, b: number, m: number) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push([b, m]);
  };
  for (const w of ways) {
    const ids = w.properties["@nodes"];
    const pts = w.geometry.coordinates;
    for (let i = 1; i < ids.length; i++) {
      const m = haversineM(pts[i - 1], pts[i]);
      link(ids[i - 1], ids[i], m);
      link(ids[i], ids[i - 1], m);
    }
  }
  const dist = new Map<number, number>([[source, 0]]);
  const done = new Set<number>();
  const frontier = [source];
  while (frontier.length > 0) {
    let best = 0;
    for (let i = 1; i < frontier.length; i++) if (dist.get(frontier[i])! < dist.get(frontier[best])!) best = i;
    const node = frontier.splice(best, 1)[0];
    if (done.has(node)) continue;
    done.add(node);
    for (const [next, m] of adj.get(node) ?? []) {
      const d = dist.get(node)! + m;
      if (d <= ROAD_MAX_M && d < (dist.get(next) ?? Infinity)) {
        dist.set(next, d);
        frontier.push(next);
      }
    }
  }
  return dist;
}

/**
 * ADT per way id for every way of a class in the class defaults (others get none
 * unless a count, the road rule or an LAEI flow gives them one).
 */
export async function wayVolumes(features: WayFeature[], table: FurthTable, options: VolumeOptions = {}): Promise<Map<number, Volume>> {
  const classDefaults = options.classDefaults ?? CLASS_DEFAULTS[table];
  const bestEvidence = options.bestEvidence ?? false;
  const laeiScale = options.laeiScale ?? 1;
  const counts = await loadCounts(bestEvidence);
  const out = new Map<number, Volume>();

  // 1. count
  for (const f of features) {
    const c = counts.get(f.properties["@id"]);
    if (c) out.set(f.properties["@id"], { adt: c.adt, source: "count", countPoint: c.countPoint, countYear: c.year });
  }

  // 2. road: per counted motor way, walk the ways of the same road from the vertex nearest the count point.
  // Counts on ways that are no longer motor roads (pedestrianised Oxford Street) are not carried.
  // Two groupings of the motor ways: by roadKey (DfT counts) and by nameKey (published counts).
  const group = (key: (p: Record<string, unknown>) => string | undefined) => {
    const groups = new Map<string, WayFeature[]>();
    for (const f of features) {
      const k = MOTOR_HIGHWAYS.has(String(f.properties.highway)) ? key(f.properties) : undefined;
      if (!k) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(f);
    }
    return groups;
  };
  const byRoad = group(roadKey);
  const byName = group(nameKey);
  for (const f of features) {
    const c = counts.get(f.properties["@id"]);
    const key = c?.published ? nameKey(f.properties) : roadKey(f.properties);
    if (!c || !key || !MOTOR_HIGHWAYS.has(String(f.properties.highway))) continue;
    const pts = f.geometry.coordinates;
    let nearest = 0;
    for (let i = 1; i < pts.length; i++) if (haversineM(c.at, pts[i]) < haversineM(c.at, pts[nearest])) nearest = i;
    const road = (c.published ? byName : byRoad).get(key)!;
    const dist = roadDistances(road, f.properties["@nodes"][nearest]);
    for (const w of road) {
      const id = w.properties["@id"];
      const prev = out.get(id);
      if (prev?.source === "count") continue;
      const d = Math.min(...w.properties["@nodes"].map((n) => dist.get(n) ?? Infinity));
      if (d <= ROAD_MAX_M && (!prev || d < prev.roadM!)) {
        out.set(id, { adt: c.adt, source: "road", countPoint: c.countPoint, countYear: c.year, roadM: Math.round(d) });
      }
    }
  }

  // 3. laei (best-evidence only), on ways that are motor roads in this scenario: the
  // flows were matched on `today`, where the closed Oxford Street was still a road.
  if (bestEvidence && (options.laei ?? true)) {
    const laei = await loadLaei();
    for (const f of features) {
      const id = f.properties["@id"];
      const adt = laei.get(id);
      if (adt !== undefined && !out.has(id) && MOTOR_HIGHWAYS.has(String(f.properties.highway))) out.set(id, { adt: adt * laeiScale, source: "laei" });
    }
  }

  // 4. class-default
  for (const f of features) {
    const adt = classDefaults[baseClass(f.properties.highway)];
    if (adt !== undefined && !out.has(f.properties["@id"])) out.set(f.properties["@id"], { adt, source: "class-default" });
  }
  return out;
}
