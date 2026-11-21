// Decodes the line geometry of a GeoPackage feature (the LAEI road links,
// scripts/laei/match-links.ts) without GIS libraries. A GeoPackage is an SQLite
// file (read with bun:sqlite); each geometry is a blob of a GeoPackage header
// followed by standard well-known binary (WKB).
// Source: OGC GeoPackage Encoding Standard 1.3, clause 2.1.3 "Geometry Encoding"
// (https://www.geopackage.org/spec131/#gpb_format), and OGC Simple Features
// (ISO 19125-1) for WKB.

// Header: magic "GP" (2 bytes), version (1), flags (1), srs_id (4), then the envelope.
const HEADER_BYTES = 8;
const FLAGS_OFFSET = 3;
// Flags bits 1-3: envelope contents indicator -> envelope size in bytes
// (0 none, 1 xy, 2 xyz, 3 xym, 4 xyzm; eight-byte doubles each).
const ENVELOPE_BYTES = [0, 32, 48, 48, 64];
const ENVELOPE_SHIFT = 1;
const ENVELOPE_MASK = 0b111;
// WKB: byte order (1 = little endian), uint32 type, then the coordinates.
const WKB_LITTLE_ENDIAN = 1;
const WKB_LINESTRING = 2;
const WKB_MULTILINESTRING = 5;
const UINT32_BYTES = 4;
const DOUBLE_BYTES = 8;

/** The linestrings of a GeoPackage LineString or MultiLineString blob, as [x, y] in the layer's CRS (2D only). */
export function gpkgLines(blob: Uint8Array): [number, number][][] {
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  if (blob[0] !== "G".charCodeAt(0) || blob[1] !== "P".charCodeAt(0)) throw new Error("not a GeoPackage geometry blob");
  const envelope = ENVELOPE_BYTES[(blob[FLAGS_OFFSET] >> ENVELOPE_SHIFT) & ENVELOPE_MASK];
  if (envelope === undefined) throw new Error("invalid GeoPackage envelope indicator");
  let at = HEADER_BYTES + envelope;
  const lines: [number, number][][] = [];
  const read = () => {
    const little = blob[at] === WKB_LITTLE_ENDIAN;
    const type = view.getUint32(at + 1, little);
    at += 1 + UINT32_BYTES;
    const count = view.getUint32(at, little);
    at += UINT32_BYTES;
    if (type === WKB_MULTILINESTRING) {
      for (let i = 0; i < count; i++) read();
    } else if (type === WKB_LINESTRING) {
      const pts: [number, number][] = [];
      for (let i = 0; i < count; i++, at += 2 * DOUBLE_BYTES) pts.push([view.getFloat64(at, little), view.getFloat64(at + DOUBLE_BYTES, little)]);
      lines.push(pts);
    } else throw new Error(`WKB geometry type ${type}: only 2D (Multi)LineString is supported`);
  };
  read();
  return lines;
}
