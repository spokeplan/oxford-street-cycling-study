// Downloads the Geofabrik Greater London extract into
// data/greater-london-latest.osm.pbf (the file name every later step reads),
// checks it against Geofabrik's .md5 and, for the study's dated extract, against
// the SHA-256 in inputs/SHA256SUMS, and records its provenance, including the
// OSM replication timestamp from the PBF header, in results/extract-info.json.
// By default it fetches the dated extract the study used (STUDY_EXTRACT_DATE);
// pass another Geofabrik date stamp (YYMMDD) or "latest" to fetch a different one.
// Geofabrik keeps dated extracts for a limited time only. Once it is gone, the
// study's extract can come from the repository's release asset (RELEASE_ASSET_URL),
// or --from-inputs copies the committed study-area cut (inputs/, see
// inputs/README.md) instead: enough for every step except Valhalla, which was
// run on the full extract. results/extract-info.json is left unchanged then.
// Usage: bun scripts/download-extract.ts [YYMMDD|latest|--from-inputs]
import { rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { FROM_INPUTS_FLAG, FULL_EXTRACT, STUDY_AREA_PBF, STUDY_EXTRACT_DATE, copyVerifiedInput, sha256, verifySha256 } from "./inputs";
import { DATA, ROOT, SCENARIOS } from "./lts/common";

const BASE_URL = "https://download.geofabrik.de/europe/united-kingdom/england/greater-london";
// TODO: attach the full extract (FULL_EXTRACT) to that release.
const RELEASE_ASSET_URL = `https://github.com/spokeplan/oxford-street-cycling-study/releases/download/inputs-${STUDY_EXTRACT_DATE}/${FULL_EXTRACT}`;
const OUT_PBF = join(DATA, SCENARIOS.today);
// The OSMHeader block sits at the start of the file; this many bytes always cover it.
const HEADER_READ_BYTES = 1 << 16;
const MS_PER_S = 1000;

if (process.argv[2] === FROM_INPUTS_FLAG) {
  await copyVerifiedInput(STUDY_AREA_PBF, OUT_PBF);
  console.log("Study-area cut in place: enough for the LTS and DfT steps; Valhalla needs the full extract.");
  process.exit(0);
}
const stamp = process.argv[2] ?? STUDY_EXTRACT_DATE;
if (stamp !== "latest" && !/^\d{6}$/.test(stamp)) {
  console.error(`Usage: bun scripts/download-extract.ts [YYMMDD|latest|${FROM_INPUTS_FLAG}]`);
  process.exit(1);
}
const PBF_URL = `${BASE_URL}-${stamp}.osm.pbf`;

/** Minimal protobuf reader: yields [field number, wire type, value] for one message. */
function* protoFields(buf: Uint8Array): Generator<[number, number, bigint | Uint8Array]> {
  let i = 0;
  const varint = (): bigint => {
    let v = 0n, shift = 0n;
    for (;;) {
      const b = buf[i++];
      v |= BigInt(b & 0x7f) << shift;
      if (b < 0x80) return v;
      shift += 7n;
    }
  };
  while (i < buf.length) {
    const key = Number(varint());
    const field = key >> 3, wire = key & 7;
    if (wire === 0) yield [field, wire, varint()];
    else if (wire === 2) {
      const len = Number(varint());
      yield [field, wire, buf.subarray(i, i + len)];
      i += len;
    } else throw new Error(`Unsupported protobuf wire type ${wire}`);
  }
}

/**
 * Reads osmosis_replication_timestamp (field 32, seconds) and
 * osmosis_replication_sequence_number (field 33) from the PBF's OSMHeader block.
 * File layout (https://wiki.openstreetmap.org/wiki/PBF_Format): 4-byte big-endian
 * BlobHeader length, BlobHeader (field 3 = datasize), Blob (field 1 = raw,
 * field 3 = zlib_data) holding the HeaderBlock.
 */
async function pbfReplication(path: string): Promise<{ timestamp: string | null; sequence: string | null }> {
  const head = new Uint8Array(await Bun.file(path).slice(0, HEADER_READ_BYTES).arrayBuffer());
  const headerLen = new DataView(head.buffer).getUint32(0);
  let dataSize = 0;
  for (const [f, , v] of protoFields(head.subarray(4, 4 + headerLen))) if (f === 3) dataSize = Number(v);
  const blobStart = 4 + headerLen;
  let block: Uint8Array | null = null;
  for (const [f, , v] of protoFields(head.subarray(blobStart, blobStart + dataSize))) {
    if (f === 1) block = v as Uint8Array;
    else if (f === 3) block = inflateSync(v as Uint8Array);
  }
  let timestamp: string | null = null, sequence: string | null = null;
  for (const [f, , v] of protoFields(block ?? new Uint8Array())) {
    if (f === 32) timestamp = new Date(Number(v) * MS_PER_S).toISOString().replace(".000Z", "Z");
    else if (f === 33) sequence = String(v);
  }
  return { timestamp, sequence };
}

await mkdir(DATA, { recursive: true });
await mkdir(join(ROOT, "results"), { recursive: true });

console.log(`Downloading ${PBF_URL}`);
const res = await fetch(PBF_URL);
if (!res.ok) {
  throw new Error(`Download failed: ${res.status} ${res.statusText}. Geofabrik removes dated extracts after a while; ` +
    `get ${FULL_EXTRACT} from ${RELEASE_ASSET_URL}, or run with ${FROM_INPUTS_FLAG} (no Valhalla).`);
}
const lastModified = res.headers.get("last-modified");
// Buffered (about 130 MB): Bun.write(path, response) stalled on Windows with Bun 1.3.
const body = new Uint8Array(await res.arrayBuffer());
// The study's dated extract must match the SHA-256 recorded in inputs/SHA256SUMS.
const sha = sha256(body);
if (stamp === STUDY_EXTRACT_DATE && !(await verifySha256(FULL_EXTRACT, sha))) {
  throw new Error(`${FULL_EXTRACT} is not listed in inputs/SHA256SUMS`);
}
// Geofabrik's MD5, checked before anything is written, so a bad download never replaces the extract in data/.
const md5Res = await fetch(`${PBF_URL}.md5`);
if (!md5Res.ok) throw new Error(`MD5 download failed: ${md5Res.status} ${md5Res.statusText}`);
const expectedMd5 = (await md5Res.text()).split(/\s+/)[0];
const md5 = new Bun.CryptoHasher("md5").update(body).digest("hex");
if (md5 !== expectedMd5) throw new Error(`MD5 mismatch: got ${md5}, Geofabrik says ${expectedMd5}`);

// Remove first: the file may be hard-linked into valhalla/custom_files-today.
rmSync(OUT_PBF, { force: true });
const bytes = await Bun.write(OUT_PBF, body);
console.log(`Wrote ${OUT_PBF} (${bytes} bytes)`);

const { timestamp, sequence } = await pbfReplication(OUT_PBF);
const info = {
  source_url: PBF_URL,
  http_last_modified: lastModified,
  osm_replication_timestamp: timestamp,
  replication_sequence_number: sequence,
  md5,
  sha256: sha,
  size_bytes: bytes,
  downloaded_at: new Date().toISOString(),
};
await writeFile(join(ROOT, "results", "extract-info.json"), JSON.stringify(info, null, 2) + "\n");
console.log(info);
