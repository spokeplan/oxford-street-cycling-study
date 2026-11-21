// Counts behind docs/lts.md, section 4c, Known limitations ("Untagged two-way
// streets read the centreline row"): per highway class, the two-way ways of the
// `today` extract and those without a `lanes` tag, with their length, and how many
// of the untagged ones the Furth 2017 table grades (rule f17/..., also behind the
// painted-lane prefix f17-blocked-lane+). Two-way means not one-way for motor
// traffic as classify.ts reads it (isMotorOneway: oneway=yes/true/1/-1 or
// junction=roundabout/circular), so oneway=no and untagged ways are two-way.
// Ways: every highway way of data/lts/today-ways.geojson (the study BBOX cut,
// complete ways). Prints a table; writes nothing.
// Usage: bun scripts/lts/untagged-lanes.ts   (after bun scripts/lts/run-all.ts)
import { isMotorOneway } from "./classify";
import { DEFAULT_SPEED_COL, classifiedPath, haversineM, type LtsMode, type WayFeature } from "./common";

const SCENARIO = "today";
const CLASSES = ["residential", "living_street", "unclassified"];
// Rule ids are the same under both furth2017 tables (only the ADT band differs).
const MODE: LtsMode = { table: "furth2017-high", speedCol: DEFAULT_SPEED_COL };
const PAINTED_LANE_PREFIX = "f17-blocked-lane+";
const FURTH_TABLE_RULE = /^(f17-blocked-lane\+)?f17\//;

const lengthM = (f: WayFeature) => f.geometry.coordinates.slice(1).reduce((s, c, i) => s + haversineM(f.geometry.coordinates[i], c), 0);

const ways = ((await Bun.file(classifiedPath(SCENARIO, MODE)).json()) as { features: WayFeature[] }).features;
console.log("highway,two_way_ways,two_way_m,untagged_lanes_ways,untagged_lanes_m,untagged_graded_by_furth_table,untagged_graded_as_painted_lane");
for (const highway of CLASSES) {
  const twoWay = ways.filter((f) => f.properties.highway === highway && !isMotorOneway(f.properties));
  const untagged = twoWay.filter((f) => f.properties.lanes === undefined);
  const graded = untagged.filter((f) => FURTH_TABLE_RULE.test(String(f.properties["@lts_rule"])));
  const sumM = (fs: WayFeature[]) => fs.reduce((s, f) => s + lengthM(f), 0);
  console.log([highway, twoWay.length, Math.round(sumM(twoWay)), untagged.length, Math.round(sumM(untagged)), graded.length,
    graded.filter((f) => String(f.properties["@lts_rule"]).startsWith(PAINTED_LANE_PREFIX)).length].join(","));
}
