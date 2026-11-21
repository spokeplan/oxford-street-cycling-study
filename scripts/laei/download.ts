// Downloads the LAEI 2022 major and minor roads traffic flows (GIS) from the London
// Datastore into data/laei/, checks the archive against inputs/SHA256SUMS (the
// GLA revised the dataset in May 2026, so a mismatch means the source has changed
// since the study), extracts the major-roads GeoPackage and records provenance,
// including the SHA-256 of both, in results/laei/source.json.
// Nothing of it is committed under inputs/: the link geometry is keyed by Ordnance
// Survey MasterMap Highways identifiers and appears to be OS geometry, and the
// publisher does not say whether it may be redistributed (DATA-LICENSES.md). The
// matched flows per OSM way (results/laei/ways-matched.csv) are committed instead.
// Usage: bun scripts/laei/download.ts   (then bun scripts/laei/match-links.ts)
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256, verifySha256 } from "../inputs";
import { LAEI_DATA, LAEI_GPKG, LAEI_LANDING, LAEI_METHODOLOGY, LAEI_RESULTS, LAEI_ZIP, LAEI_ZIP_URL } from "./common";
import { unzipMember } from "./zip";

const LICENCE = "Open Government Licence v3.0 (https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/)";
const ATTRIBUTION = "Contains public sector information licensed under the Open Government Licence v3.0. " +
  "Source: London Atmospheric Emissions Inventory (LAEI) 2022, Greater London Authority and Transport for London.";

await mkdir(LAEI_DATA, { recursive: true });
await mkdir(LAEI_RESULTS, { recursive: true });
const res = await fetch(LAEI_ZIP_URL);
if (!res.ok) throw new Error(`${LAEI_ZIP_URL}: HTTP ${res.status}`);
const zip = new Uint8Array(await res.arrayBuffer());
const zipSha = sha256(zip);
if (!(await verifySha256(LAEI_ZIP, zipSha))) throw new Error(`${LAEI_ZIP} is not listed in inputs/SHA256SUMS`);
await writeFile(join(LAEI_DATA, LAEI_ZIP), zip);
const gpkg = unzipMember(zip, LAEI_GPKG);
await writeFile(join(LAEI_DATA, LAEI_GPKG), gpkg);
console.log(`${LAEI_ZIP}: ${zip.byteLength} bytes, SHA-256 verified; ${LAEI_GPKG}: ${gpkg.byteLength} bytes`);

const source = {
  source: "London Atmospheric Emissions Inventory (LAEI) 2022, Greater London Authority and Transport for London (London Datastore)",
  fetchedAt: new Date().toISOString(), licence: LICENCE, attribution: ATTRIBUTION, landing: LAEI_LANDING, methodology: LAEI_METHODOLOGY,
  files: [
    { file: LAEI_ZIP, url: LAEI_ZIP_URL, bytes: zip.byteLength, sha256: zipSha, lastModified: res.headers.get("last-modified") },
    { file: LAEI_GPKG, extractedFrom: LAEI_ZIP, bytes: gpkg.byteLength, sha256: sha256(gpkg) },
  ],
};
await writeFile(join(LAEI_RESULTS, "source.json"), JSON.stringify(source, null, 2) + "\n");
console.log(`-> ${LAEI_DATA}, provenance in results/laei/source.json`);
