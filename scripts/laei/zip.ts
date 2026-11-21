// Reads one member of a ZIP archive in memory (the LAEI download, scripts/laei/download.ts),
// so the study needs no unzip tool. Supports what that archive uses: stored or
// deflated members, no ZIP64, no encryption.
// Source: PKWARE APPNOTE.TXT, the .ZIP File Format Specification
// (https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT), sections 4.3.7
// (local file header), 4.3.12 (central directory header) and 4.3.16 (end of central directory).
import { inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
// The end-of-central-directory record is 22 bytes plus a comment of at most 65,535 bytes.
const EOCD_MIN_BYTES = 22;
const MAX_COMMENT_BYTES = 0xffff;
// Field offsets within the records.
const EOCD_ENTRIES = 10, EOCD_DIR_OFFSET = 16;
const CEN_METHOD = 10, CEN_COMPRESSED = 20, CEN_UNCOMPRESSED = 24, CEN_NAME_LEN = 28, CEN_EXTRA_LEN = 30, CEN_COMMENT_LEN = 32,
  CEN_LOCAL_OFFSET = 42, CEN_HEADER_BYTES = 46;
const LOC_NAME_LEN = 26, LOC_EXTRA_LEN = 28, LOC_HEADER_BYTES = 30;
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;

/** The uncompressed bytes of the archive member called `name`; throws when it is missing or unsupported. */
export function unzipMember(zip: Uint8Array, name: string): Uint8Array {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = zip.length - EOCD_MIN_BYTES; i >= Math.max(0, zip.length - EOCD_MIN_BYTES - MAX_COMMENT_BYTES); i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a ZIP archive (no end of central directory)");
  const decoder = new TextDecoder();
  let at = view.getUint32(eocd + EOCD_DIR_OFFSET, true);
  for (let n = view.getUint16(eocd + EOCD_ENTRIES, true); n > 0; n--) {
    if (view.getUint32(at, true) !== CENTRAL_SIGNATURE) throw new Error("corrupt ZIP central directory");
    const nameLen = view.getUint16(at + CEN_NAME_LEN, true);
    const entryName = decoder.decode(zip.subarray(at + CEN_HEADER_BYTES, at + CEN_HEADER_BYTES + nameLen));
    if (entryName === name) {
      const method = view.getUint16(at + CEN_METHOD, true);
      const compressed = view.getUint32(at + CEN_COMPRESSED, true);
      const size = view.getUint32(at + CEN_UNCOMPRESSED, true);
      const local = view.getUint32(at + CEN_LOCAL_OFFSET, true);
      if (view.getUint32(local, true) !== LOCAL_SIGNATURE) throw new Error(`${name}: corrupt local header`);
      const start = local + LOC_HEADER_BYTES + view.getUint16(local + LOC_NAME_LEN, true) + view.getUint16(local + LOC_EXTRA_LEN, true);
      const data = zip.subarray(start, start + compressed);
      const out = method === METHOD_STORED ? data : method === METHOD_DEFLATED ? new Uint8Array(inflateRawSync(data)) : undefined;
      if (!out) throw new Error(`${name}: compression method ${method} is not supported`);
      if (out.length !== size) throw new Error(`${name}: ${out.length} bytes inflated, the directory says ${size}`);
      return out;
    }
    at += CEN_HEADER_BYTES + nameLen + view.getUint16(at + CEN_EXTRA_LEN, true) + view.getUint16(at + CEN_COMMENT_LEN, true);
  }
  throw new Error(`${name}: not in the archive`);
}
