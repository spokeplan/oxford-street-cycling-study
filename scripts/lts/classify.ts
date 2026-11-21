// Step 2: Level of Traffic Stress (LTS 1-4) per way from OSM tags, following
// the BikeOttawa stress model (github.com/BikeOttawa/stressmodel, stressmodel.js
// at commit a0fdab9e5b9319b16e2ddf16602aa7fa944ecff3) with UK adaptations.
// Rule ids (p*, s*, b*, c*, m*) are BikeOttawa's; UK adaptations use uk-* ids.
// Every rule is listed in docs/lts.md.
// lts = 0 means "not rideable" (excluded from routing).
// Tables for the mixed-traffic block (everything else is shared):
//   bikeottawa     - BikeOttawa's m5-m12 (default)
//   mekuria2012    - MTI Report 11-19 (Mekuria, Furth, Nixon 2012), Table 4
//   furth2017-low  - Furth 2017 LTS 2.0 volume-based table, low class-default ADT
//   furth2017-high - the same with high class-default ADT
// furth2017 only: a painted bike lane without physical separation is rated by the
// mixed-traffic table (Furth 2017 bike-lane note 1, see blockedLaneAsMixed);
// --speed-col lt20 reads 20 mph limits in the <=20 mph column; --untagged-unlaned
// (sensitivity) reads untagged two-way residential/living streets in the unlaned row.
// Usage: bun scripts/lts/classify.ts <scenario> [--table <table>] [--speed-col 25|lt20] [--untagged-unlaned]
//   reads data/lts/<scenario>-ways.geojson, writes data/lts/<scenario>-ways-lts-<mode>.geojson
//
// The permission, separated-path, bike-lane and mixed-traffic rules with
// BikeOttawa ids are ported from the BikeOttawa stress model
// (https://github.com/BikeOttawa/stressmodel), which carries this notice:
//
//   MIT License
//
//   Copyright (c) 2018 BikeOttawa
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in all
//   copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//   SOFTWARE.
import { writeFile } from "node:fs/promises";
import {
  DEFAULT_MODE, MODE_USAGE, classifiedPath, isFurthTable, modeName, parseMode, requireScenario, waysPath,
  type LtsMode, type WayFeature,
} from "./common";
import { ONE_WAY_ADT_FACTOR, furthLts, type FurthRow } from "./furth2017";
import { wayVolumes, type Volume } from "./volume";

export type Lts = 0 | 1 | 2 | 3 | 4;
export const NOT_RIDEABLE: Lts = 0;
export interface LtsResult {
  lts: Lts;
  rule: string;
}
type Tags = Record<string, unknown>;

const KMH_PER_MPH = 1.609344;
// UK adaptation: maxspeed default where untagged. Westminster and Camden
// (and the bbox fringes in the City, Islington, Lambeth, RBKC, plus TfL roads
// inside the congestion zone) have a 20 mph limit on all roads.
const DEFAULT_MAXSPEED_MPH = 20;
// BikeOttawa getLanes(): a flat default for every highway class.
const DEFAULT_LANES = 2;
// Furth 2017 lane defaults: one lane per direction.
const FURTH_TWO_WAY_LANES = 2;
const FURTH_ONE_WAY_LANES = 1;
const DIRECTIONS_TWO_WAY = 2;
// Furth 2017 rows by through lanes per direction.
const FURTH_TWO_LANES = 2;
const FURTH_THREE_LANES = 3;
// Motor-traffic one-way values (oneway:bicycle does not change the traffic volume).
const ONEWAY_VALUES = new Set(["yes", "true", "1", "-1"]);
const ONEWAY_JUNCTIONS = new Set(["roundabout", "circular"]);
// Rounding of the mph limit recovered from km/h (one decimal), so 20 mph stays exactly 20.
const MPH_DECIMALS = 10;

// UK adaptation: the cycleway values BikeOttawa matches are only read from these
// keys. BikeOttawa matches any key starting with "cycleway", so sub-keys such as
// cycleway:right:oneway=yes would count as a bike lane ("yes").
const CYCLEWAY_KEYS = ["cycleway", "cycleway:left", "cycleway:right", "cycleway:both"];
// BikeOttawa isBikeLane() values.
const BIKE_LANE_VALUES = new Set(["crossing", "lane", "left", "opposite", "opposite_lane", "right", "yes"]);
// Physical separation of a lane from motor traffic: cycleway[:<side>]:separation
// (OSM key separation=*) with any value other than markings. A lane separated by
// kerbs, posts, planters etc. keeps the bike-lane rules in the furth2017 tables.
const SEPARATION_KEYS = CYCLEWAY_KEYS.map((k) => `${k}:separation`);
const MARKING_SEPARATION_VALUES = new Set(["no", "none", "solid_line", "dashed_line", "double_solid_line", "hatched_area"]);
// Rule-id prefix of a painted lane rated by the Furth 2017 mixed-traffic table.
const BLOCKED_LANE_RULE = "f17-blocked-lane";
// BikeOttawa parkingPresent() values for parking:lane:*.
const PARKING_LANE_VALUES = new Set(["parallel", "perpendicular", "diagonal", "yes", "marked"]);
// UK adaptation: current parking:<side>=* scheme (parking:both=lane etc.).
const PARKING_SIDE_KEYS = ["parking:left", "parking:right", "parking:both"];
const PARKING_SIDE_VALUES = new Set(["lane", "street_side", "on_kerb", "half_on_kerb", "shoulder", "yes"]);

// UK adaptations to the permission check.
const BICYCLE_PERMITTED = new Set(["yes", "designated", "permissive"]);
const BICYCLE_FORBIDDEN = new Set(["dismount", "private", "use_sidepath"]);
// Highway classes that can carry bicycles at all. Everything else (steps,
// corridor, platform, construction, services, elevator, ...) is not rideable.
const RIDEABLE_HIGHWAYS = new Set([
  "motorway", "motorway_link", // excluded by BikeOttawa p3/p4
  "proposed", // excluded by BikeOttawa p7
  "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link",
  "tertiary", "tertiary_link", "unclassified", "residential", "living_street", "road",
  "service", "track", "path", "cycleway", "footway", "pedestrian", "bridleway", "busway",
]);
// Ways that need an explicit bicycle permission. Footway/pedestrian: no general
// right to cycle. Path/bridleway/busway: untagged ones are excluded as a
// conservative choice (cyclists may legally use public bridleways, see docs/lts.md).
const NEEDS_PERMISSION = new Set(["footway", "pedestrian", "path", "bridleway", "busway"]);

// Speed thresholds of the BikeOttawa model, km/h.
const KMH_40 = 40;
const KMH_50 = 50;
const KMH_65 = 65;
const SERVICE_SLOW_KMH = 35;
// Mekuria 2012 Table 4 speed rows (posted limits in mph). A limit between two
// rows takes the higher-stress row, so e.g. 50 km/h (31 mph) counts as 35+ mph.
const MEKURIA_ROW1_KMH = 25 * KMH_PER_MPH;
const MEKURIA_ROW2_KMH = 30 * KMH_PER_MPH;
// Table 4 lane columns (total through lanes): 2-3, 4-5, 6+.
const MEKURIA_FEW_LANES_MAX = 3;
const MEKURIA_MID_LANES_MAX = 5;
// Table 4 footnote: the lower value applies only to streets with fewer than this many lanes.
const MEKURIA_LOW_VALUE_LANES_BELOW = 3;

const str = (tags: Tags, k: string) => (typeof tags[k] === "string" ? (tags[k] as string) : undefined);
const is = (tags: Tags, k: string, v: string) => str(tags, k) === v;
const cyclewayValues = (tags: Tags) => CYCLEWAY_KEYS.map((k) => str(tags, k)).filter((v): v is string => !!v);

/** Lanes per BikeOttawa getLanes(); "a;b" is summed (BikeOttawa intends this but sums the array indices). */
export function lanes(tags: Tags): number {
  const l = str(tags, "lanes");
  if (!l) return DEFAULT_LANES;
  const total = l.split(";").reduce((sum, part) => sum + parseInt(part, 10), 0);
  return Number.isNaN(total) ? DEFAULT_LANES : total;
}

/**
 * Speed limit in km/h (the BikeOttawa thresholds are km/h).
 * UK adaptation: "<n> mph" is converted, and untagged ways get the 20 mph default
 * instead of BikeOttawa's 50/80/100 km/h class defaults. Unmodified BikeOttawa
 * keeps the raw string, so "20 mph" compares as NaN and every road falls to m12 (LTS 4).
 */
function maxspeedKmh(tags: Tags): number {
  const v = str(tags, "maxspeed");
  const defaultKmh = DEFAULT_MAXSPEED_MPH * KMH_PER_MPH;
  if (!v) return defaultKmh;
  const n = parseFloat(v);
  if (Number.isNaN(n)) return defaultKmh;
  return v.includes("mph") ? n * KMH_PER_MPH : n;
}

/** Speed limit in mph (from maxspeedKmh), rounded to MPH_DECIMALS so 20 mph stays exactly 20. */
export const speedLimitMph = (tags: Tags) => mphFromKmh(maxspeedKmh(tags));
const mphFromKmh = (kmh: number) => Math.round((kmh / KMH_PER_MPH) * MPH_DECIMALS) / MPH_DECIMALS;

function parkingPresent(tags: Tags): boolean {
  if (is(tags, "parking", "yes")) return true;
  for (const [k, v] of Object.entries(tags)) {
    if (k.startsWith("parking:lane") && PARKING_LANE_VALUES.has(String(v))) return true;
  }
  return PARKING_SIDE_KEYS.some((k) => PARKING_SIDE_VALUES.has(str(tags, k) ?? ""));
}

// UK adaptation: living_street counts as residential (BikeOttawa only knows residential).
const isResidential = (tags: Tags) => is(tags, "highway", "residential") || is(tags, "highway", "living_street");

function permission(tags: Tags): LtsResult | undefined {
  const highway = str(tags, "highway") ?? "";
  const bicycle = str(tags, "bicycle") ?? "";
  const permitted = BICYCLE_PERMITTED.has(bicycle);
  if (!highway) return { lts: NOT_RIDEABLE, rule: "p1" };
  if (bicycle === "no") return { lts: NOT_RIDEABLE, rule: "p2" };
  if (BICYCLE_FORBIDDEN.has(bicycle)) return { lts: NOT_RIDEABLE, rule: "uk-p-bicycle" };
  if (is(tags, "access", "no") && !permitted) return { lts: NOT_RIDEABLE, rule: "p6" };
  if (is(tags, "access", "private") && !permitted) return { lts: NOT_RIDEABLE, rule: "uk-p-private" };
  if (is(tags, "vehicle", "no") && !permitted) return { lts: NOT_RIDEABLE, rule: "uk-p-vehicle" };
  if (highway === "motorway") return { lts: NOT_RIDEABLE, rule: "p3" };
  if (highway === "motorway_link") return { lts: NOT_RIDEABLE, rule: "p4" };
  if (highway === "proposed") return { lts: NOT_RIDEABLE, rule: "p7" };
  // UK adaptation: BikeOttawa only accepts bicycle=yes here.
  if (is(tags, "footway", "sidewalk") && !permitted && (highway === "footway" || highway === "path")) {
    return { lts: NOT_RIDEABLE, rule: "p5" };
  }
  if (!RIDEABLE_HIGHWAYS.has(highway)) return { lts: NOT_RIDEABLE, rule: "uk-p-class" };
  if (NEEDS_PERMISSION.has(highway) && !permitted) return { lts: NOT_RIDEABLE, rule: "uk-p-permission" };
  if (is(tags, "area", "yes")) return { lts: NOT_RIDEABLE, rule: "uk-p-area" };
  return undefined;
}

function separatedPath(tags: Tags): LtsResult | undefined {
  const highway = str(tags, "highway");
  if (highway === "path") return { lts: 1, rule: "s1" };
  if (highway === "footway" && !is(tags, "footway", "crossing")) return { lts: 1, rule: "s2" };
  if (highway === "cycleway") return { lts: 1, rule: "s3" };
  if (highway === "bridleway") return { lts: 1, rule: "uk-s-bridleway" };
  // s4-s6 (highway=construction + construction=path|footway|cycleway) cannot
  // fire: construction is not rideable (uk-p-class).
  const values = cyclewayValues(tags);
  if (values.includes("track")) return { lts: 1, rule: "s7" };
  if (values.includes("opposite_track")) return { lts: 1, rule: "s8" };
  // cycleway*=separate means the track is its own way in the graph, so this way
  // carries no infrastructure: it falls through to the bike-lane / mixed-traffic rules.
  return undefined;
}

// BikeOttawa bikeAndParkingWidth() is a placeholder returning a huge width, so
// its width rules (b3-b5, c4) never fire; they are omitted here for that reason.
const hasBikeLane = (tags: Tags) =>
  cyclewayValues(tags).some((v) => BIKE_LANE_VALUES.has(v)) || is(tags, "shoulder:access:bicycle", "yes");
const physicallySeparated = (tags: Tags) =>
  SEPARATION_KEYS.some((k) => { const v = str(tags, k); return v !== undefined && !MARKING_SEPARATION_VALUES.has(v); });

/**
 * furth2017 tables only: a painted bike lane (no physical separation) is rated
 * by the mixed-traffic table, rule "f17-blocked-lane+<mixed-traffic rule>".
 * Source: Furth 2017, notes to both bike-lane tables: "If bike lane [/ shoulder]
 * is frequently blocked, use mixed traffic criteria." West End lanes are routinely
 * blocked by loading and parked vehicles, so every painted lane is treated as
 * blocked (a study assumption; MTI Report 11-19, chapter III "Criteria Related to
 * Bike Lane Blockage", p. 20, suggests assuming frequent blockage in commercial
 * areas). This also replaces BikeOttawa's b9/c7 rule
 * ("not residential" -> LTS 3), which is not Furth's.
 */
function blockedLaneAsMixed(tags: Tags, mode: LtsMode, volume?: Volume): LtsResult | undefined {
  if (!isFurthTable(mode.table) || !hasBikeLane(tags) || physicallySeparated(tags)) return undefined;
  const mixed = mixedTraffic(tags, mode, volume);
  return { lts: mixed.lts, rule: `${BLOCKED_LANE_RULE}+${mixed.rule}` };
}

function bikeLane(tags: Tags): LtsResult | undefined {
  if (!hasBikeLane(tags)) return undefined;
  const n = lanes(tags);
  const speed = maxspeedKmh(tags);
  const residential = isResidential(tags);
  let lts: Lts = 1;
  let rule = "";
  const raise = (to: Lts, r: string) => {
    if (lts < to) {
      lts = to;
      rule = r;
    }
  };
  if (parkingPresent(tags)) {
    if (n >= 3) raise(3, "b2");
    if (speed > KMH_40) {
      if (speed <= KMH_50) raise(2, "b6");
      else if (speed < KMH_65) raise(3, "b7");
      else raise(4, "b8");
    }
    if (!residential) raise(3, "b9");
    return { lts, rule: rule || "b1" };
  }
  // c2 (3 lanes with separating median) cannot fire: BikeOttawa hasSeparatingMedian() is always false.
  if (n >= 3) raise(3, "c3");
  if (speed > KMH_50) {
    if (speed < KMH_65) raise(3, "c5");
    else raise(4, "c6");
  }
  if (!residential) raise(3, "c7");
  return { lts, rule: rule || "c1" };
}

function mixedTraffic(tags: Tags, mode: LtsMode, volume?: Volume): LtsResult {
  const highway = str(tags, "highway");
  const n = lanes(tags);
  const speed = maxspeedKmh(tags);
  const residential = isResidential(tags);
  if (is(tags, "motor_vehicle", "no")) return { lts: 1, rule: "m17" };
  // m1 (highway=steps -> 1) cannot fire: steps are not rideable (uk-p-class).
  if (highway === "pedestrian") return { lts: 1, rule: "m13" }; // only reached with bicycle permission
  if (highway === "footway" && is(tags, "footway", "crossing")) return { lts: 2, rule: "m14" };
  if (highway === "service" && is(tags, "service", "alley")) return { lts: 2, rule: "m2" };
  if (highway === "track") return { lts: 2, rule: "m15" };
  const mekuria = mode.table === "mekuria2012";
  const furth = isFurthTable(mode.table);
  if (mekuria && speed > MEKURIA_ROW2_KMH) return { lts: 4, rule: "t4-35" };
  if (!mekuria && !furth && speed > KMH_50) return { lts: 4, rule: "m12" };
  if (highway === "service") {
    if (is(tags, "service", "parking_aisle")) return { lts: 2, rule: "m3" };
    if (is(tags, "service", "driveway")) return { lts: 2, rule: "m4" };
    if (speed < SERVICE_SLOW_KMH) return { lts: 2, rule: "m16" };
  }
  if (mekuria) return mekuriaTable4(tags, n, speed, residential);
  if (furth) return furth2017(tags, speed, mode, volume);
  if (speed <= KMH_40) {
    if (n <= 3 && residential) return { lts: 2, rule: "m5" };
    if (n <= 3) return { lts: 3, rule: "m6" };
    if (n <= 5) return { lts: 3, rule: "m7" };
    return { lts: 4, rule: "m8" };
  }
  if (n < 3 && residential) return { lts: 2, rule: "m9" };
  if (n <= 3) return { lts: 3, rule: "m10" };
  return { lts: 4, rule: "m11" };
}

/**
 * Mixed traffic per Mekuria, Furth, Nixon (2012), MTI Report 11-19, Table 4.
 * Footnote: "Use lower value for streets without marked centerlines or classified
 * as residential and with fewer than 3 lanes; use higher value otherwise."
 * Unmarked = lanes=1 or lane_markings=no. Speeds above the 30 mph row are
 * handled by the caller (rule t4-35).
 */
function mekuriaTable4(tags: Tags, n: number, speed: number, residential: boolean): LtsResult {
  const unmarked = is(tags, "lanes", "1") || is(tags, "lane_markings", "no");
  const low = (residential || unmarked) && n < MEKURIA_LOW_VALUE_LANES_BELOW;
  if (speed <= MEKURIA_ROW1_KMH) {
    if (n <= MEKURIA_FEW_LANES_MAX) return low ? { lts: 1, rule: "t4-25-a" } : { lts: 2, rule: "t4-25-b" };
    if (n <= MEKURIA_MID_LANES_MAX) return { lts: 3, rule: "t4-25-c" };
    return { lts: 4, rule: "t4-25-d" };
  }
  if (n <= MEKURIA_FEW_LANES_MAX) return low ? { lts: 2, rule: "t4-30-a" } : { lts: 3, rule: "t4-30-b" };
  return { lts: 4, rule: n <= MEKURIA_MID_LANES_MAX ? "t4-30-c" : "t4-30-d" };
}

/** One-way for motor traffic (oneway:bicycle and contraflows do not change the volume). */
export const isMotorOneway = (tags: Tags) =>
  ONEWAY_VALUES.has(str(tags, "oneway") ?? "") || ONEWAY_JUNCTIONS.has(str(tags, "junction") ?? "");

/**
 * Furth 2017 row. Two-way: `lanes=1` or `lane_markings=no` is the unlaned row,
 * otherwise lanes / 2 per direction (default 2 lanes, i.e. a centreline). One-way:
 * `lanes` per direction (default 1); the table has no unlaned row for one-way
 * streets. With untaggedUnlaned (sensitivity) an untagged two-way residential or
 * living_street way is unlaned too.
 */
function furthRow(tags: Tags, oneway: boolean, untaggedUnlaned: boolean): FurthRow {
  const tagged = str(tags, "lanes") ? lanes(tags) : undefined;
  const untaggedResidential = untaggedUnlaned && tagged === undefined && isResidential(tags);
  if (!oneway && (tagged === 1 || is(tags, "lane_markings", "no") || untaggedResidential)) return "unlaned";
  const perDirection = oneway ? (tagged ?? FURTH_ONE_WAY_LANES) : (tagged ?? FURTH_TWO_WAY_LANES) / DIRECTIONS_TWO_WAY;
  if (perDirection >= FURTH_THREE_LANES) return "3+";
  return perDirection >= FURTH_TWO_LANES ? "2" : "1";
}

/** Mixed traffic per Furth 2017 (docs/lts.md, section 4c); one-way roads use the effective ADT. */
function furth2017(tags: Tags, speedKmh: number, mode: LtsMode, volume?: Volume): LtsResult {
  if (!volume) throw new Error(`way ${String(tags["@id"])} (highway=${str(tags, "highway")}) reached the Furth table without an ADT`);
  const oneway = isMotorOneway(tags);
  const effectiveAdt = oneway ? volume.adt * ONE_WAY_ADT_FACTOR : volume.adt;
  return furthLts(furthRow(tags, oneway, mode.untaggedUnlaned ?? false), effectiveAdt, mphFromKmh(speedKmh), mode.speedCol);
}

export function classify(tags: Tags, mode: LtsMode = DEFAULT_MODE, volume?: Volume): LtsResult {
  return permission(tags) ?? separatedPath(tags) ?? blockedLaneAsMixed(tags, mode, volume) ?? bikeLane(tags) ?? mixedTraffic(tags, mode, volume);
}

/**
 * Grades every way in place (@lts, @lts_rule and, for the furth2017 tables, the
 * adt* properties). `volumes` defaults to the table's own (scripts/lts/volume.ts).
 * Returns the number of ways per rule and per ADT source.
 */
export async function classifyWays(
  features: WayFeature[], mode: LtsMode, volumes?: Map<number, Volume>,
): Promise<{ counts: Record<string, number>; sources: Record<string, number> }> {
  volumes ??= isFurthTable(mode.table) ? await wayVolumes(features, mode.table) : undefined;
  const counts: Record<string, number> = {};
  const sources: Record<string, number> = {};
  for (const f of features) {
    const volume = volumes?.get(f.properties["@id"]);
    const { lts, rule } = classify(f.properties, mode, volume);
    f.properties["@lts"] = lts;
    f.properties["@lts_rule"] = rule;
    counts[rule] = (counts[rule] ?? 0) + 1;
    if (volume) {
      f.properties.adt = volume.adt;
      f.properties.adt_source = volume.source;
      f.properties.adt_count_point = volume.countPoint ?? null;
      f.properties.adt_count_year = volume.countYear ?? null;
      f.properties.adt_road_m = volume.roadM ?? null;
      sources[volume.source] = (sources[volume.source] ?? 0) + 1;
    }
  }
  return { counts, sources };
}

export async function classifyScenario(scenario: string, mode: LtsMode = DEFAULT_MODE): Promise<string> {
  const fc = (await Bun.file(waysPath(scenario)).json()) as { features: WayFeature[] };
  const { counts, sources } = await classifyWays(fc.features, mode);
  const out = classifiedPath(scenario, mode);
  await writeFile(out, JSON.stringify(fc));
  const name = modeName(mode);
  if (isFurthTable(mode.table)) console.log(`${scenario} [${name}]: ways per ADT source ${JSON.stringify(sources)}`);
  console.log(`${scenario} [${name}]: ways per rule ${JSON.stringify(counts)} -> ${out}`);
  return out;
}

if (import.meta.main) {
  const usage = `bun scripts/lts/classify.ts <scenario> ${MODE_USAGE}`;
  await classifyScenario(requireScenario(process.argv[2], usage), parseMode(process.argv, usage));
}
