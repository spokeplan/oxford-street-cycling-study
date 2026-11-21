// Downloads DfT Road Traffic Statistics CSVs (count points, AADF, AADF by
// direction) for the local authorities covering the study bbox into data/dft/,
// checks each against inputs/SHA256SUMS (DfT republishes these files yearly, so a
// mismatch means the source has changed since the study) and records provenance,
// including each file's SHA-256, in results/dft/source.json.
// --from-inputs copies the committed CSVs from inputs/dft/ instead (verified
// against the same sums) and leaves results/dft/source.json unchanged.
// Usage: bun scripts/dft/download.ts [--from-inputs]
import { rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { DFT_INPUTS_DIR, FROM_INPUTS_FLAG, copyVerifiedInput, sha256, verifySha256 } from "../inputs";
import { DATASETS, DFT_DATA, DFT_RESULTS, LOCAL_AUTHORITIES, dftPath, dftUrl } from "./common";

const LICENCE = "Open Government Licence v3.0 (https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/)";
const ATTRIBUTION = "Contains public sector information licensed under the Open Government Licence v3.0. Source: Department for Transport, Road Traffic Statistics.";
const LANDING = (ons: string) => `https://roadtraffic.dft.gov.uk/local-authorities/${ons}`;
const inputName = (path: string) => `${DFT_INPUTS_DIR}/${basename(path)}`;

await mkdir(DFT_DATA, { recursive: true });

if (process.argv[2] === FROM_INPUTS_FLAG) {
  for (const la of LOCAL_AUTHORITIES) {
    for (const dataset of DATASETS) await copyVerifiedInput(inputName(dftPath(dataset, la.id)), dftPath(dataset, la.id));
  }
  process.exit(0);
}

await mkdir(DFT_RESULTS, { recursive: true });
const files: {
  localAuthority: string; ons: string; laId: number; dataset: string; url: string; landing: string; bytes: number;
  sha256: string; lastModified: string | null;
}[] = [];
for (const la of LOCAL_AUTHORITIES) {
  for (const dataset of DATASETS) {
    const url = dftUrl(dataset, la.id);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const body = new Uint8Array(await res.arrayBuffer());
    const path = dftPath(dataset, la.id);
    const digest = sha256(body);
    if (!(await verifySha256(inputName(path), digest))) throw new Error(`${inputName(path)} is not listed in inputs/SHA256SUMS`);
    rmSync(path, { force: true });
    await writeFile(path, body);
    files.push({
      localAuthority: la.name, ons: la.ons, laId: la.id, dataset, url, landing: LANDING(la.ons), bytes: body.byteLength,
      sha256: digest, lastModified: res.headers.get("last-modified"),
    });
    console.log(`${la.name} ${dataset}: ${body.byteLength} bytes, SHA-256 verified`);
  }
}

const source = { source: "Department for Transport, Road Traffic Statistics", fetchedAt: new Date().toISOString(), licence: LICENCE, attribution: ATTRIBUTION, files };
await writeFile(join(DFT_RESULTS, "source.json"), JSON.stringify(source, null, 2) + "\n");
console.log(`-> ${DFT_DATA}, provenance in results/dft/source.json`);
