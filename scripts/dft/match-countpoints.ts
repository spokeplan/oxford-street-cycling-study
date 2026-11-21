// Picks one AADF year per DfT count point inside the study bbox and matches
// the point to an OSM way of the `today` scenario (data/lts/today-ways.geojson,
// re-extracted by scripts/lts/extract-graph.ts on every run, so a file left from an
// earlier extract is never matched against).
//
// Year rule: the latest year whose estimation_method is "Counted"; if a point
// was never counted, the latest "Estimated" year.
// Match rule, first tier that finds a way wins, nearest way within the tier:
//   1. "ref":      within MATCH_RADIUS_M, way ref (any of a ";" list) equals the
//                  DfT road_name (e.g. A5204). Pedestrian/bus-only ways count here
//                  (Oxford Street west is highway=pedestrian with ref A40).
//   2. "name":     within MATCH_RADIUS_M, way name equals the DfT road_name.
//   3. "class":    unnumbered minor point ("C"/"U"), within MATCH_RADIUS_M, the
//                  nearest motor road without an A/B ref (a side-street count must
//                  not snap to the A road it meets).
//   4. "ref-wide": as "ref" but within REF_FALLBACK_RADIUS_M. DfT publishes
//                  coordinates from a 10 m OS grid reference and places some points
//                  between the carriageways of a junction, so a few sit just
//                  outside MATCH_RADIUS_M of their own road.
//   5. "nearest":  nearest motor road within MATCH_RADIUS_M (flagged in `note`).
// Usage: bun scripts/dft/match-countpoints.ts   (after scripts/dft/download.ts)
import { mkdir, writeFile } from "node:fs/promises";
import { BBOX, pointToLineM, waysPath, type LonLat, type WayFeature } from "../lts/common";
import { extractGraph } from "../lts/extract-graph";
import {
  AADF_COLUMNS, COUNTED, DFT_RESULTS, LOCAL_AUTHORITIES, MATCHED_CSV, MATCH_RADIUS_M, MOTOR_HIGHWAYS, NO, STALE_BEFORE_YEAR, YES, dftPath, groupBy, parseCsv, toCsv,
} from "./common";

const SCENARIO = "today";
// Wider radius (metres) used only for a way whose ref equals the DfT road number.
const REF_FALLBACK_RADIUS_M = 60;
// Highway values accepted only when the way's ref matches the DfT road number.
const REF_ONLY_HIGHWAYS = new Set(["pedestrian", "busway"]);
// OSM highway classes that an A/B road is expected to carry.
const NUMBERED_ROAD_HIGHWAYS = /^(motorway|trunk|primary|secondary|tertiary)(_link)?$/;
const NUMBERED_ROAD = /^[AB]\d+$/i;
const UNNUMBERED_MINOR = new Set(["C", "U"]);

type Row = Record<string, string>;
type Candidate = { f: WayFeature; d: number; motor: boolean };

const refs = (f: WayFeature) => String(f.properties.ref ?? "").split(";").map((s) => s.trim().toUpperCase()).filter(Boolean);
const inBbox = (lon: number, lat: number) => lon >= BBOX.minLon && lon <= BBOX.maxLon && lat >= BBOX.minLat && lat <= BBOX.maxLat;

/** One AADF row per count point: latest Counted year, else latest Estimated year. */
function pickYears(aadf: Row[]): Map<string, { pick: Row; latestYear: string }> {
  const out = new Map<string, { pick: Row; latestYear: string }>();
  for (const [id, rows] of groupBy(aadf, (r) => r.count_point_id)) {
    rows.sort((a, b) => Number(b.year) - Number(a.year));
    out.set(id, { pick: rows.find((r) => r.estimation_method === COUNTED) ?? rows[0], latestYear: rows[0].year });
  }
  return out;
}

await extractGraph(SCENARIO);
const ways = (JSON.parse(await Bun.file(waysPath(SCENARIO)).text()) as { features: WayFeature[] }).features.filter((f) => {
  const hw = String(f.properties.highway);
  return MOTOR_HIGHWAYS.has(hw) || REF_ONLY_HIGHWAYS.has(hw);
});

const out: Record<string, string | number>[] = [];
let newestYear = 0;
for (const la of LOCAL_AUTHORITIES) {
  const points = parseCsv(await Bun.file(dftPath("countpoints", la.id)).text());
  const years = pickYears(parseCsv(await Bun.file(dftPath("aadf", la.id)).text()));
  for (const y of years.values()) newestYear = Math.max(newestYear, Number(y.latestYear));
  for (const cp of points) {
    const p: LonLat = [Number(cp.longitude), Number(cp.latitude)];
    if (!inBbox(...p)) continue;
    const y = years.get(cp.count_point_id);
    const roadName = cp.road_name.trim().toUpperCase();
    const cands: Candidate[] = ways
      .map((f) => ({ f, d: pointToLineM(p, f.geometry.coordinates), motor: MOTOR_HIGHWAYS.has(String(f.properties.highway)) }))
      .filter((c) => c.d <= REF_FALLBACK_RADIUS_M)
      .sort((a, b) => a.d - b.d);
    const near = (c: Candidate) => c.d <= MATCH_RADIUS_M;
    const refMatch = (c: Candidate) => refs(c.f).includes(roadName);
    const tiers: [string, (c: Candidate) => boolean][] = [
      ["ref", (c) => near(c) && refMatch(c)],
      ["name", (c) => near(c) && c.motor && String(c.f.properties.name ?? "").trim().toUpperCase() === roadName],
      ["class", (c) => near(c) && c.motor && UNNUMBERED_MINOR.has(roadName) && !refs(c.f).some((r) => NUMBERED_ROAD.test(r))],
      ["ref-wide", refMatch],
      ["nearest", (c) => near(c) && c.motor],
    ];
    const tier = tiers.find(([, test]) => cands.some(test));
    const hit = tier && cands.find(tier[1]);
    // Other distinct ways satisfying the same rule (dual carriageways, ways split at a junction).
    const others = tier ? cands.filter((c) => c !== hit && tier[1](c)) : [];
    const hw = String(hit?.f.properties.highway ?? "");
    const notes: string[] = [];
    if (!y) notes.push("no AADF rows");
    if (!hit) notes.push(`no motor-traffic way within ${MATCH_RADIUS_M} m`);
    else if (NUMBERED_ROAD.test(roadName) && !tier[0].startsWith("ref")) notes.push(`no way with ref ${roadName} within ${REF_FALLBACK_RADIUS_M} m`);
    if (hit && NUMBERED_ROAD.test(roadName) && !NUMBERED_ROAD_HIGHWAYS.test(hw)) notes.push(`${roadName} count on OSM highway=${hw}`);
    if (y && Number(y.pick.year) < STALE_BEFORE_YEAR) notes.push(`stale count (${y.pick.year})`);
    if (y && Number(y.latestYear) < newestYear) notes.push(`no AADF published after ${y.latestYear}`);
    const pr = hit?.f.properties;
    out.push({
      count_point_id: cp.count_point_id,
      local_authority: la.name,
      road_name: cp.road_name,
      road_type: cp.road_type,
      start_junction: cp.start_junction_road_name,
      end_junction: cp.end_junction_road_name,
      latitude: cp.latitude,
      longitude: cp.longitude,
      matched: hit ? YES : NO,
      match_rule: tier?.[0] ?? "none",
      way_id: String(pr?.["@id"] ?? ""),
      way_name: String(pr?.name ?? ""),
      way_ref: String(pr?.ref ?? ""),
      way_highway: hw,
      distance_m: hit ? hit.d.toFixed(1) : "",
      other_same_rule_ways: others.map((c) => `${c.f.properties["@id"]}@${c.d.toFixed(0)}m`).join(" "),
      year: y?.pick.year ?? "",
      estimation_method: y?.pick.estimation_method ?? "",
      estimation_method_detailed: y?.pick.estimation_method_detailed ?? "",
      latest_year_available: y?.latestYear ?? "",
      ...Object.fromEntries(AADF_COLUMNS.map((c) => [c, y?.pick[c] ?? ""])),
      note: notes.join("; "),
    });
  }
}

// DfT re-registers some links under a new count_point_id at the same coordinates.
for (const group of groupBy(out, (r) => `${r.latitude},${r.longitude}`).values()) {
  if (group.length < 2) continue;
  for (const r of group) {
    const twins = group.filter((o) => o !== r).map((o) => `${o.count_point_id} (${o.year})`).join(" ");
    r.note = [r.note, `same location as ${twins}`].filter(Boolean).join("; ");
  }
}

await mkdir(DFT_RESULTS, { recursive: true });
await writeFile(MATCHED_CSV, toCsv(Object.keys(out[0] ?? {}), out));
const by = (k: string) => [...groupBy(out, (r) => String(r[k]))].map(([v, rs]) => `${v}=${rs.length}`).join(" ");
console.log(`${out.length} count points in bbox; matched: ${by("matched")}; rule: ${by("match_rule")}; method: ${by("estimation_method")} -> ${MATCHED_CSV}`);
