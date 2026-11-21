// Runs the LTS cross-check end to end: extract once per scenario, then for every
// criteria table classify -> route per scenario and the street-LTS sanity table.
// The furth2017 tables also run with --speed-col lt20 (sensitivity), and
// furth2017-high with --untagged-unlaned for today only (sensitivity).
// Then the gap-closing analysis for the furth2017 tables in both speed columns,
// every scenario, with and without the Oxford Street counterfactual and the
// two-way-track (contraflow) variant, plus the single unlaned variant
// (scripts/lts/gap-closing.ts, gapClosingAll), the detour summary (detour.ts),
// the sensitivity runs (sensitivity.ts: UK guidance, back-street volume floor,
// uncounted streets at zero, Great Chapel Street traffic-free, best evidence),
// the best-evidence run's own tables (best-evidence.ts), its robustness checks
// (robustness.ts) and the north-against-south comparison (side-comparison.ts).
// Outputs: results/lts/<mode>/<scenario>/... and results/lts/<mode>/street-lts.csv,
// where <mode> is the table name, suffixed "-lt20" / "-unlaned" for the sensitivity runs,
// plus results/lts/<mode>/<scenario>/gap-closing*.{csv,geojson} (frontier
// files included), results/lts/gap-closing-summary.csv, results/lts/detour-summary.csv,
// results/lts/sensitivity-summary.csv, results/lts/sensitivity/<name>/... and
// results/lts/sensitivity/side-comparison.csv (side-comparison/...)
// Reads the matched counts and flows of results/dft/, results/published-counts/
// and results/laei/ (written by the reproduce:* steps in package.json).
// Usage: bun scripts/lts/run-all.ts
import { bestEvidenceTables } from "./best-evidence";
import { classifyScenario } from "./classify";
import { DEFAULT_SPEED_COL, LT20_SPEED_COL, SCENARIOS, TABLES, isFurthTable, type LtsMode } from "./common";
import { detourSummary } from "./detour";
import { extractGraph } from "./extract-graph";
import { UNLANED_GAP_MODE, UNLANED_GAP_VARIANT, gapClosingAll } from "./gap-closing";
import { bestEvidenceRobustness } from "./robustness";
import { routeScenario } from "./route";
import { sideComparison } from "./side-comparison";
import { sensitivityAll } from "./sensitivity";
import { streetLts } from "./street-lts";

const modes: LtsMode[] = TABLES.flatMap((table): LtsMode[] =>
  isFurthTable(table)
    ? [{ table, speedCol: DEFAULT_SPEED_COL }, { table, speedCol: LT20_SPEED_COL }]
    : [{ table, speedCol: DEFAULT_SPEED_COL }],
);

for (const scenario of Object.keys(SCENARIOS)) await extractGraph(scenario);
for (const mode of modes) {
  for (const scenario of Object.keys(SCENARIOS)) {
    await classifyScenario(scenario, mode);
    await routeScenario(scenario, mode);
  }
  await streetLts(mode);
}
// The unlaned sensitivity covers one scenario only, so it has no street-lts table.
await classifyScenario(UNLANED_GAP_VARIANT.scenario, UNLANED_GAP_MODE);
await routeScenario(UNLANED_GAP_VARIANT.scenario, UNLANED_GAP_MODE);
await gapClosingAll();
await detourSummary();
await sensitivityAll();
await bestEvidenceTables();
await bestEvidenceRobustness();
await sideComparison();
