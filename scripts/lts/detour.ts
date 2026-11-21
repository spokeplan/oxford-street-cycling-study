// The confident rider's detour caused by the ban: per trip direction, L4 today
// (shortest rideable path, LTS ignored) against L4 on the Oxford Street
// reconstruction, and the time the difference takes at Valhalla's average speed.
// Both L4 values come from the gap-closing summary (results/lts/gap-closing-summary.csv,
// headline furth2017 rows, scenario today, allow_oxford=true, contraflow=false):
//   l4_today_m          = ba/ab_l4_base_m: today's network
//   l4_reconstruction_m = ab/ba_l4_m: the --allow-oxford counterfactual (pedestrianised
//                         Oxford Street ways made rideable, their one-way tags dropped),
//                         not the pre-ban network
// both between the same furth2017 low-stress snap nodes, so like is compared with like.
// Speed: Valhalla's distance / time for the same direction, scenario today,
// setting confident (results/valhalla/today/summary.csv). A calculation, not a measured time.
// Writes results/lts/detour-summary.csv.
// Usage: bun scripts/lts/detour.ts
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseCsv } from "../dft/common";
import { LTS_RESULTS, ROOT, TRIPS, tripPrefix } from "./common";
import { HEADLINE_GAP_MODES } from "./gap-closing";
import { csvField } from "./route";

const GAP_SUMMARY = join(LTS_RESULTS, "gap-closing-summary.csv");
const VALHALLA_SUMMARY = join(ROOT, "results", "valhalla", "today", "summary.csv");
const OUT = join(LTS_RESULTS, "detour-summary.csv");
const SCENARIO = "today";
const VALHALLA_SETTING = "confident";
const TRUE = "true";
const FALSE = "false";
// Conversion of metres per second to km/h (3600 s per hour / 1000 m per km).
const KMH_PER_M_S = 3.6;
const PERCENT = 100;

export async function detourSummary() {
  const gapRows = parseCsv(await Bun.file(GAP_SUMMARY).text());
  const valhallaRows = parseCsv(await Bun.file(VALHALLA_SUMMARY).text());

  const header = [
    "table", "direction", "l4_today_m", "l4_reconstruction_m", "detour_m", "detour_pct",
    "valhalla_setting", "valhalla_distance_m", "valhalla_time_s", "valhalla_speed_m_s", "valhalla_speed_kmh", "detour_time_s",
  ];
  const rows = [header.join(",")];
  for (const { table } of HEADLINE_GAP_MODES) {
    const g = gapRows.find((r) => r.table === table && r.scenario === SCENARIO && r.allow_oxford === TRUE && r.contraflow === FALSE);
    if (!g) throw new Error(`${GAP_SUMMARY}: no ${table} ${SCENARIO} allow-oxford row`);
    for (const trip of Object.keys(TRIPS)) {
      const v = valhallaRows.find((r) => r.trip === trip && r.setting === VALHALLA_SETTING);
      if (!v) throw new Error(`${VALHALLA_SUMMARY}: no ${trip} ${VALHALLA_SETTING} row`);
      const p = tripPrefix(trip);
      const today = Number(g[`${p}_l4_base_m`]);
      const reconstruction = Number(g[`${p}_l4_m`]);
      const detour = today - reconstruction;
      const speed = Number(v.distance_m) / Number(v.time_s);
      const row = [
        table, trip, today, reconstruction, detour, ((PERCENT * detour) / reconstruction).toFixed(1),
        VALHALLA_SETTING, v.distance_m, v.time_s, speed.toFixed(2), (speed * KMH_PER_M_S).toFixed(1), Math.round(detour / speed),
      ];
      rows.push(row.map(csvField).join(","));
      console.log(`${table} ${trip}: L4 today ${today} m vs reconstruction ${reconstruction} m: +${detour} m, ` +
        `${Math.round(detour / speed)} s at ${(speed * KMH_PER_M_S).toFixed(1)} km/h`);
    }
  }
  await writeFile(OUT, rows.join("\n") + "\n");
  console.log(`-> ${OUT}`);
}

if (import.meta.main) await detourSummary();
