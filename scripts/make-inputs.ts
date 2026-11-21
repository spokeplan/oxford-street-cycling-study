// Maintainer step: builds inputs/ from the downloaded data so the study can be
// rerun without the original sources (Geofabrik removes dated extracts, DfT
// republishes its CSVs yearly). Writes
//   inputs/<STUDY_AREA_PBF>  osmium bbox cut of data/greater-london-latest.osm.pbf
//                            (the full extract), INPUT_MARGIN_DEG around the study
//                            BBOX, complete ways, so every way extract-graph.ts and
//                            retag-scenario.ts select is in it with all its nodes
//   inputs/dft/*.csv         the six DfT CSVs from data/dft/
//   inputs/SHA256SUMS        checksums of the above, of the files in
//                            inputs/published-counts/ (compiled by hand, not built here),
//                            and of two downloads that are not committed: the full
//                            extract and the LAEI 2022 traffic-flow archive (data/laei/,
//                            see scripts/laei/download.ts)
// Run after `bun run reproduce:data` (needs Docker for osmium). data/greater-london-latest.osm.pbf
// must be the study's dated extract as downloaded: it is checked against
// results/extract-info.json (source URL and SHA-256) before anything is written.
// Usage: bun scripts/make-inputs.ts
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { DFT_DATA } from "./dft/common";
import { LAEI_DATA, LAEI_ZIP } from "./laei/common";
import { PUBLISHED_INPUTS_DIR } from "./published-counts/common";
import { DFT_INPUTS_DIR, FULL_EXTRACT, INPUTS, STUDY_AREA_PBF, STUDY_EXTRACT_DATE, SUMS_FILE, sha256File } from "./inputs";
import { BBOX, DATA, OSMIUM_IMAGE, ROOT, SCENARIOS } from "./lts/common";

// Margin (degrees) added on every side of the study BBOX: roughly 0.7 km east-west
// and 1.1 km north-south at London's latitude.
const INPUT_MARGIN_DEG = 0.01;
const FULL_PBF = join(DATA, SCENARIOS.today);
const BYTES_PER_MB = 1e6;
// Decimals of the cut bbox in the osmium command (0.0001 degrees is about 10 m).
const BBOX_DECIMALS = 4;

// The file recorded below as FULL_EXTRACT must be that extract, not the cut (--from-inputs) or another date.
const EXTRACT_INFO = join(ROOT, "results", "extract-info.json");
const info = (await Bun.file(EXTRACT_INFO).json()) as { source_url?: string; md5?: string; sha256?: string };
if (!info.source_url?.endsWith(`-${STUDY_EXTRACT_DATE}.osm.pbf`)) {
  throw new Error(`${EXTRACT_INFO} records ${info.source_url}, not the study's extract of ${STUDY_EXTRACT_DATE}; run bun scripts/download-extract.ts`);
}
// MD5 is in every extract-info.json (Geofabrik's checksum); the SHA-256 only in those written since it was added.
const fullBytes = new Uint8Array(await Bun.file(FULL_PBF).arrayBuffer());
const fullMd5 = new Bun.CryptoHasher("md5").update(fullBytes).digest("hex");
const fullSha = await sha256File(FULL_PBF);
if (fullMd5 !== info.md5 || (info.sha256 !== undefined && fullSha !== info.sha256)) {
  throw new Error(`${FULL_PBF} is not the extract recorded in ${EXTRACT_INFO} (MD5 ${fullMd5}, recorded ${info.md5}); run bun scripts/download-extract.ts`);
}

const cut = {
  minLon: BBOX.minLon - INPUT_MARGIN_DEG, minLat: BBOX.minLat - INPUT_MARGIN_DEG,
  maxLon: BBOX.maxLon + INPUT_MARGIN_DEG, maxLat: BBOX.maxLat + INPUT_MARGIN_DEG,
};
mkdirSync(join(INPUTS, DFT_INPUTS_DIR), { recursive: true });

// osmium in Docker with the repository mounted, so it reads data/ and writes inputs/.
const toWork = (path: string) => `/work/${relative(ROOT, path).replaceAll("\\", "/")}`;
const cmd = [
  "docker", "run", "--rm", "-v", `${ROOT}:/work`, OSMIUM_IMAGE, "osmium", "extract",
  "-b", [cut.minLon, cut.minLat, cut.maxLon, cut.maxLat].map((d) => d.toFixed(BBOX_DECIMALS)).join(","), "-s", "complete_ways",
  toWork(FULL_PBF), "-o", toWork(join(INPUTS, STUDY_AREA_PBF)), "--overwrite",
];
console.log("$", cmd.join(" "));
const p = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
if (p.exitCode !== 0) throw new Error(p.stderr.toString());

const dftFiles = readdirSync(DFT_DATA).filter((f) => f.endsWith(".csv")).sort();
for (const f of dftFiles) {
  const dest = join(INPUTS, DFT_INPUTS_DIR, f);
  rmSync(dest, { force: true });
  copyFileSync(join(DFT_DATA, f), dest);
}

const entries: [string, string][] = [
  [FULL_EXTRACT, FULL_PBF],
  [STUDY_AREA_PBF, join(INPUTS, STUDY_AREA_PBF)],
  ...dftFiles.map((f): [string, string] => [`${DFT_INPUTS_DIR}/${f}`, join(INPUTS, DFT_INPUTS_DIR, f)]),
  ...readdirSync(join(INPUTS, PUBLISHED_INPUTS_DIR)).sort().map((f): [string, string] => [`${PUBLISHED_INPUTS_DIR}/${f}`, join(INPUTS, PUBLISHED_INPUTS_DIR, f)]),
  // SpokePlan's own routes for the longer sample trip, saved as returned (not built here).
  ...readdirSync(join(INPUTS, "spokeplan-routes")).sort().map((f): [string, string] => [`spokeplan-routes/${f}`, join(INPUTS, "spokeplan-routes", f)]),
  [LAEI_ZIP, join(LAEI_DATA, LAEI_ZIP)],
];
const lines: string[] = [];
for (const [name, path] of entries) {
  const size = Bun.file(path).size;
  lines.push(`${await sha256File(path)}  ${name}`);
  console.log(`${name}: ${(size / BYTES_PER_MB).toFixed(2)} MB`);
}
await writeFile(SUMS_FILE, lines.join("\n") + "\n");
console.log(`-> ${SUMS_FILE}`);
