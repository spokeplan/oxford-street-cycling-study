// Robustness checks of the best-evidence run (docs/lts.md, "Best-evidence run"):
// each changes the best-evidence grading (scripts/lts/sensitivity.ts,
// bestEvidenceWays) in one respect, through the same code paths as the main
// runs' sensitivities, then reruns the low-stress connectivity test and the
// gap-closing search, scenario today, HEADLINE_RUN (two-way tracks, Oxford Street
// not rideable), both headline tables unless the check names fewer modes:
//   counts-only    - no LAEI step: DfT and published counts, carried counts, guesses
//   counts-only-zero - no LAEI step and every guess at UNCOUNTED_ADT: what the counts
//                    alone require; both tables must grade alike
//   lt20           - 20 mph limits read in the <=20 mph column (the main runs' lt20 modes)
//   unlaned        - untagged two-way residential streets unlaned (UNLANED_GAP_MODE only, as in the main runs)
//   uk-ltn120      - the LTN 1/20 regrade (sensitivity uk-ltn120) of the best-evidence grading
//   guesses-750    - remaining back-street guesses at BACK_STREET_FLOOR_ADT (as back-streets-750)
//   guesses-zero   - every remaining class guess at UNCOUNTED_ADT (as uncounted-zero): what
//                    counts and modelled flows alone require; both tables must grade alike
//   laei-halved,   - every LAEI flow times LAEI_HALVED or LAEI_DOUBLED before grading: about
//   laei-doubled     one matched way in four is off by more than a factor of 2 against DfT counts
// Writes results/lts/sensitivity/best-evidence/robustness.csv (one row per check and
// table; the union also takes both side-constrained unions as candidates, as the
// best-evidence run does; ways_regraded against the best-evidence grading of the same table in the
// 25 mph column) and each run's gap-closing files under
// results/lts/sensitivity/best-evidence/robustness/<check>/<mode>/today/.
// Usage: bun scripts/lts/robustness.ts   (after bun scripts/lts/sensitivity.ts)
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { toCsv } from "../dft/common";
import { DEFAULT_SPEED_COL, isFurthTable, modeName, type LtsMode, type WayFeature } from "./common";
import { HEADLINE_GAP_MODES, HEADLINE_RUN, LT20_GAP_MODES, UNLANED_GAP_MODE, solveGapClosing } from "./gap-closing";
import {
  BACK_STREET_CLASSES, BACK_STREET_FLOOR_ADT, BEST_EVIDENCE, LTN120_DESCRIPTION, SCENARIO_TODAY, SENSITIVITY_RESULTS, UNCOUNTED_ADT,
  backStreetDefaults, bestEvidenceWays, checkTablesAgree, lowStressConnectivity, ltn120, regradedCount, zeroDefaults,
} from "./sensitivity";
import { sideUnions } from "./sides";

const OUT = join(SENSITIVITY_RESULTS, BEST_EVIDENCE);
// The LAEI flow scaled by the model's typical error against DfT counts, a factor of 2 either way.
const LAEI_HALVED = 0.5;
const LAEI_DOUBLED = 2;

/** The mode's furth2017 table; throws for any other table. */
function table(mode: LtsMode) {
  if (!isFurthTable(mode.table)) throw new Error(`${mode.table}: not a furth2017 table`);
  return mode.table;
}

interface Check {
  name: string;
  description: string;
  modes: LtsMode[];
  /** The checked grading of scenario today under the mode. */
  ways: (mode: LtsMode) => Promise<WayFeature[]>;
}

const CHECKS: Check[] = [
  {
    name: "counts-only",
    description: "best evidence without the LAEI step: count (DfT and published), road, class-default",
    modes: HEADLINE_GAP_MODES,
    ways: (mode) => bestEvidenceWays(SCENARIO_TODAY, mode, { laei: false }),
  },
  {
    name: "counts-only-zero",
    description: `best evidence without the LAEI step, every class-default ADT set to ${UNCOUNTED_ADT}: low and high tables identical by construction`,
    modes: HEADLINE_GAP_MODES,
    ways: async (mode) => checkTablesAgree(
      "counts-only-zero", SCENARIO_TODAY, mode.table,
      await bestEvidenceWays(SCENARIO_TODAY, mode, { laei: false, classDefaults: zeroDefaults(table(mode)) }),
    ),
  },
  {
    name: "lt20",
    description: "best evidence, 20 mph limits read in the <=20 mph column",
    modes: LT20_GAP_MODES,
    ways: (mode) => bestEvidenceWays(SCENARIO_TODAY, mode),
  },
  {
    name: "unlaned",
    description: "best evidence, untagged two-way residential and living streets read in the unlaned row",
    modes: [UNLANED_GAP_MODE],
    ways: (mode) => bestEvidenceWays(SCENARIO_TODAY, mode),
  },
  {
    name: "uk-ltn120",
    description: `best evidence, then ${LTN120_DESCRIPTION}`,
    modes: HEADLINE_GAP_MODES,
    ways: async (mode) => ltn120(await bestEvidenceWays(SCENARIO_TODAY, mode)),
  },
  {
    name: "guesses-750",
    description: `best evidence, remaining class-default ADT of ${BACK_STREET_CLASSES.join(", ")} ways set to ${BACK_STREET_FLOOR_ADT}`,
    modes: HEADLINE_GAP_MODES,
    ways: (mode) => bestEvidenceWays(SCENARIO_TODAY, mode, { classDefaults: backStreetDefaults(table(mode)) }),
  },
  {
    name: "guesses-zero",
    description: `best evidence, remaining class-default ADT of every class set to ${UNCOUNTED_ADT}: low and high tables identical by construction`,
    modes: HEADLINE_GAP_MODES,
    ways: async (mode) => checkTablesAgree(
      "guesses-zero", SCENARIO_TODAY, mode.table, await bestEvidenceWays(SCENARIO_TODAY, mode, { classDefaults: zeroDefaults(table(mode)) }),
    ),
  },
  {
    name: "laei-halved",
    description: `best evidence, every LAEI flow times ${LAEI_HALVED}`,
    modes: HEADLINE_GAP_MODES,
    ways: (mode) => bestEvidenceWays(SCENARIO_TODAY, mode, { laeiScale: LAEI_HALVED }),
  },
  {
    name: "laei-doubled",
    description: `best evidence, every LAEI flow times ${LAEI_DOUBLED}`,
    modes: HEADLINE_GAP_MODES,
    ways: (mode) => bestEvidenceWays(SCENARIO_TODAY, mode, { laeiScale: LAEI_DOUBLED }),
  },
];

export async function bestEvidenceRobustness() {
  const rows: Record<string, unknown>[] = [];
  for (const check of CHECKS) {
    for (const mode of check.modes) {
      const name = modeName(mode);
      const ways = await check.ways(mode);
      const reference = await bestEvidenceWays(SCENARIO_TODAY, { table: mode.table, speedCol: DEFAULT_SPEED_COL });
      const result = await solveGapClosing({
        scenario: SCENARIO_TODAY, table: `${BEST_EVIDENCE}/${check.name}/${name}`, ways, ...HEADLINE_RUN,
        outDir: join(OUT, "robustness", check.name, name, SCENARIO_TODAY), constrainedUnions: sideUnions(ways),
      });
      rows.push({
        name: check.name, table: name, description: check.description, ways_regraded: regradedCount(reference, ways),
        ...lowStressConnectivity(ways),
        ab_min_converted_m: result.ab_min_converted_m, ba_min_converted_m: result.ba_min_converted_m,
        union_converted_m: result.union_converted_m, union_method: result.union_method, union_streets: result.union_streets,
      });
    }
  }
  const out = join(OUT, "robustness.csv");
  await writeFile(out, toCsv(Object.keys(rows[0]), rows));
  console.log(`${BEST_EVIDENCE}: ${rows.length} robustness runs -> ${out}`);
}

if (import.meta.main) await bestEvidenceRobustness();
