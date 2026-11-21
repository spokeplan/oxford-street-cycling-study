// Runs the Valhalla cross-check for every Valhalla scenario in turn: starts the
// scenario's container (valhalla/run.ts; builds tiles on the first run), runs the
// trips (scripts/run-trips.ts), then removes the container.
// full-closure-sealed is an LTS-only sensitivity variant and has no Valhalla run.
// Needs the scenario PBFs in data/ built from the full extract
// (bun run reproduce:data: scripts/download-extract.ts, then scripts/retag-scenario.ts):
// the published routes come from the full extract. Refused before any container starts:
//   - data/greater-london-latest.osm.pbf is the committed study-area cut (--from-inputs);
//   - a scenario PBF is missing or older than it, i.e. was retagged from an earlier
//     extract (such as the cut, after reproduce:inputs followed by a full download).
// Usage: bun valhalla/run-all.ts
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { STUDY_AREA_PBF, readSums, sha256File } from "../scripts/inputs";
import { DATA, SCENARIOS } from "../scripts/lts/common";
import { VALHALLA_SCENARIOS, containerName } from "./common";

const ROOT = join(import.meta.dir, "..");

function run(cmd: string[]): void {
  console.log(`$ ${cmd.join(" ")}`);
  const proc = Bun.spawnSync(cmd, { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  if (proc.exitCode !== 0) throw new Error(`Failed (exit ${proc.exitCode}): ${cmd.join(" ")}`);
}

const TODAY = "today";
const REBUILD = "run bun run reproduce:data (full extract, then the scenarios), see inputs/README.md";
const todayPbf = join(DATA, SCENARIOS[TODAY]);
if (!existsSync(todayPbf)) throw new Error(`${todayPbf} is missing; ${REBUILD}`);
if ((await sha256File(todayPbf)) === (await readSums()).get(STUDY_AREA_PBF)) {
  throw new Error(`data/ holds the study-area cut from inputs/; Valhalla needs the full extract: ${REBUILD}`);
}
// The scenario PBFs are retagged copies of today's: one older than it was built from an earlier extract.
const todayMtimeMs = statSync(todayPbf).mtimeMs;
for (const scenario of VALHALLA_SCENARIOS.filter((s) => s !== TODAY)) {
  const pbf = join(DATA, SCENARIOS[scenario]);
  if (!existsSync(pbf)) throw new Error(`${pbf} is missing; ${REBUILD}`);
  if (statSync(pbf).mtimeMs < todayMtimeMs) {
    throw new Error(`${pbf} is older than ${todayPbf}, so it was retagged from an earlier extract; ${REBUILD}`);
  }
}

for (const scenario of VALHALLA_SCENARIOS) {
  run(["bun", "valhalla/run.ts", scenario, join("data", SCENARIOS[scenario])]);
  try {
    run(["bun", "scripts/run-trips.ts", scenario]);
  } finally {
    run(["docker", "rm", "-f", containerName(scenario)]);
  }
}
