// Committed inputs (inputs/, see inputs/README.md) and their SHA-256 checksums.
// inputs/SHA256SUMS lists, in `sha256sum` format relative to inputs/, every
// committed input plus the full Geofabrik extract (not committed: too large),
// so downloads can be checked against the files the study used:
//   sha256sum -c --ignore-missing SHA256SUMS   (run inside inputs/)
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { ROOT } from "./lts/common";

export const INPUTS = join(ROOT, "inputs");
export const SUMS_FILE = join(INPUTS, "SHA256SUMS");
export const FROM_INPUTS_FLAG = "--from-inputs";
// Geofabrik date stamp of the extract behind the published results (data up to 2026-11-07).
export const STUDY_EXTRACT_DATE = "261107";
/** Name of the full Geofabrik extract in SHA256SUMS (the file is not in inputs/). */
export const FULL_EXTRACT = `greater-london-${STUDY_EXTRACT_DATE}.osm.pbf`;
/** osmium bbox cut of the full extract around the study area (inputs/, made by scripts/make-inputs.ts). */
export const STUDY_AREA_PBF = `greater-london-${STUDY_EXTRACT_DATE}-study-area.osm.pbf`;
/** Subdirectory of inputs/ holding the DfT CSVs (same file names as data/dft/). */
export const DFT_INPUTS_DIR = "dft";

export const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
export const sha256File = async (path: string) => sha256(new Uint8Array(await Bun.file(path).arrayBuffer()));

/** SHA256SUMS as a map from path relative to inputs/ to hex digest. */
export async function readSums(): Promise<Map<string, string>> {
  const sums = new Map<string, string>();
  if (!existsSync(SUMS_FILE)) return sums;
  for (const line of (await Bun.file(SUMS_FILE).text()).split(/\r?\n/)) {
    const m = line.match(/^([0-9a-f]{64}) [ *](.+)$/);
    if (m) sums.set(m[2], m[1]);
  }
  return sums;
}

/** Throws when `name` is listed in SHA256SUMS with a different digest; returns whether it was listed. */
export async function verifySha256(name: string, digest: string): Promise<boolean> {
  const expected = (await readSums()).get(name);
  if (expected === undefined) return false;
  if (expected !== digest) {
    throw new Error(`SHA-256 mismatch for ${name}: got ${digest}, inputs/SHA256SUMS says ${expected}. ` +
      `The source has changed since the study; use ${FROM_INPUTS_FLAG} to run from the committed inputs.`);
  }
  return true;
}

/**
 * Copies inputs/<name> to `dest` after checking it against SHA256SUMS. The
 * destination is removed first: data/ files may be hard-linked into
 * valhalla/custom_files-*, and writing through the link would change that copy too.
 */
export async function copyVerifiedInput(name: string, dest: string): Promise<void> {
  const src = join(INPUTS, name);
  if (!(await verifySha256(name, await sha256File(src)))) throw new Error(`${name} is not listed in inputs/SHA256SUMS`);
  mkdirSync(dirname(dest), { recursive: true });
  rmSync(dest, { force: true });
  copyFileSync(src, dest);
  console.log(`inputs/${name} (SHA-256 verified) -> ${dest}`);
}
