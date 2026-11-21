// North against south: the gap-closing search confined to one side of Oxford
// Street (scripts/lts/sides.ts), so each side's cost is measured on its own rather
// than read off the union heuristic. L4 and the budget still come from the whole network,
// so a side is held to the same quarter-longer bar; a side with no path within it
// is reported, the budget is not relaxed.
// Run for four gradings, scenario today, HEADLINE_RUN (two-way tracks, Oxford
// Street not rideable): the main run and the best-evidence run (sensitivity.ts),
// each under both headline tables. Coherence check, logged and in the CSV: the
// cheaper side against the unconstrained union of the same grading. The main
// run's union is the plain heuristic, an upper bound, so a cheaper side would mean
// it missed a better set; the best-evidence union already takes both sides as
// candidates, so it never exceeds the cheaper side.
// Writes results/lts/sensitivity/side-comparison.csv and the runs' gap-closing
// files under results/lts/sensitivity/side-comparison/<grading>/<mode>/<side>/.
// Usage: bun scripts/lts/side-comparison.ts   (after bun scripts/lts/sensitivity.ts)
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseCsv, toCsv } from "../dft/common";
import { openedRoutes, headlineUnion } from "./best-evidence";
import { TRIPS, classifiedPath, modeName, resultsDir, tripPrefix, type LtsMode, type WayFeature } from "./common";
import { HEADLINE_GAP_MODES, HEADLINE_RUN, NoSolutionWithinBudget, UNION_DIRECTION, UNION_SOLUTION, gapClosingCsv, solveGapClosing } from "./gap-closing";
import { BEST_EVIDENCE, SCENARIO_TODAY, SENSITIVITY_RESULTS, bestEvidenceWays, lowStressConnectivity } from "./sensitivity";
import { SIDES, forbiddenWays } from "./sides";

const RATIO_DECIMALS = 3;
const MAIN = "main";
// Float slack (metres) in the budget comparison, as in gap-closing.ts.
const EPS_M = 1e-6;

const GRADINGS: { name: string; ways: (mode: LtsMode) => Promise<WayFeature[]>; dir: (mode: LtsMode) => string }[] = [
  {
    name: MAIN,
    ways: async (mode) => ((await Bun.file(classifiedPath(SCENARIO_TODAY, mode)).json()) as { features: WayFeature[] }).features,
    dir: (mode) => resultsDir(mode, SCENARIO_TODAY),
  },
  {
    name: BEST_EVIDENCE,
    ways: (mode) => bestEvidenceWays(SCENARIO_TODAY, mode),
    dir: (mode) => join(SENSITIVITY_RESULTS, BEST_EVIDENCE, modeName(mode), SCENARIO_TODAY),
  },
];

export async function sideComparison() {
  const rows: Record<string, unknown>[] = [];
  for (const grading of GRADINGS) {
    for (const mode of HEADLINE_GAP_MODES) {
      const ways = await grading.ways(mode);
      const unconstrained = parseCsv(await Bun.file(gapClosingCsv(grading.dir(mode), HEADLINE_RUN.allowOxford, HEADLINE_RUN.contraflow)).text())
        .find((r) => r.direction === UNION_DIRECTION && r.solution === UNION_SOLUTION);
      if (!unconstrained) throw new Error(`${grading.name} ${modeName(mode)}: no unconstrained union row`);
      const unconstrainedM = Number(unconstrained.converted_m);
      for (const side of SIDES) {
        const forbidden = forbiddenWays(ways, side);
        const outDir = join(SENSITIVITY_RESULTS, "side-comparison", grading.name, modeName(mode), side);
        const row: Record<string, unknown> = {
          grading: grading.name, table: modeName(mode), side, ways_forbidden: forbidden.size,
          ...lowStressConnectivity(ways.filter((f) => !forbidden.has(f.properties["@id"]))),
          unconstrained_union_m: unconstrainedM,
        };
        try {
          const result = await solveGapClosing({
            scenario: SCENARIO_TODAY, table: `side-comparison/${grading.name}/${side}/${modeName(mode)}`, ways, ...HEADLINE_RUN, outDir, forbiddenWays: forbidden,
          });
          const routes = openedRoutes(ways, await headlineUnion(outDir), forbidden);
          Object.assign(row, {
            status: "solved", ab_min_converted_m: result.ab_min_converted_m, ba_min_converted_m: result.ba_min_converted_m,
            union_converted_m: result.union_converted_m, union_method: result.union_method, union_vs_unconstrained_m: Number(result.union_converted_m) - unconstrainedM,
            union_streets: result.union_streets,
            ...Object.fromEntries(routes.flatMap((r) => {
              const p = tripPrefix(r.trip);
              return [[`${p}_route_m`, Math.round(r.pathM)], [`${p}_l4_m`, Math.round(r.l4M)], [`${p}_route_ratio`, (r.pathM / r.l4M).toFixed(RATIO_DECIMALS)],
                [`${p}_within_budget`, r.pathM <= r.budgetM + EPS_M ? "yes" : "no"]];
            })),
          });
        } catch (e) {
          if (!(e instanceof NoSolutionWithinBudget)) throw e;
          row.status = `no solution within the budget (${e.message})`;
        }
        rows.push(row);
      }
      const solved = rows.slice(-SIDES.length).filter((r) => r.status === "solved").map((r) => Number(r.union_converted_m));
      const best = Math.min(...solved);
      console.log(`side-comparison ${grading.name} [${modeName(mode)}]: ${rows.slice(-SIDES.length).map((r) => `${r.side} ${r.union_converted_m ?? r.status}`).join(", ")}; ` +
        `unconstrained union ${unconstrainedM} m${best < unconstrainedM ? `: a side beats the union heuristic by ${unconstrainedM - best} m` : ""}`);
    }
  }
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  // Fixed column order: every key of the solved rows, the status after the connectivity columns.
  const trips = Object.keys(TRIPS).map(tripPrefix);
  const order = [
    "grading", "table", "side", "ways_forbidden", ...trips.flatMap((p) => [`${p}_l2_m`, `${p}_connected_lowstress`]), "status",
    "ab_min_converted_m", "ba_min_converted_m", "union_converted_m", "union_method", "unconstrained_union_m", "union_vs_unconstrained_m", "union_streets",
    ...trips.flatMap((p) => [`${p}_route_m`, `${p}_l4_m`, `${p}_route_ratio`, `${p}_within_budget`]),
  ];
  const missing = columns.filter((c) => !order.includes(c));
  if (missing.length > 0) throw new Error(`side-comparison: columns without a place: ${missing.join(" ")}`);
  const out = join(SENSITIVITY_RESULTS, "side-comparison.csv");
  await writeFile(out, toCsv(order, rows));
  console.log(`-> ${out}`);
}

if (import.meta.main) await sideComparison();
