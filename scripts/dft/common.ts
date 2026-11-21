// Shared paths, CSV helpers and local-authority table for the DfT traffic-count steps.
import { join } from "node:path";
import { DATA, ROOT } from "../lts/common";

export const DFT_DATA = join(DATA, "dft");
export const DFT_RESULTS = join(ROOT, "results", "dft");
export const MATCHED_CSV = join(DFT_RESULTS, "countpoints-matched.csv");

// Flag values of the `matched` columns in the results CSVs.
export const YES = "yes";
export const NO = "no";

/** Several counts on one way: the latest year wins, then the closest snap. True when c replaces prev. */
export const supersedes = (c: { year: number; distM: number }, prev?: { year: number; distM: number }) =>
  !prev || c.year > prev.year || (c.year === prev.year && c.distM < prev.distM);

// Search radius (metres) around a count point for candidate ways (DfT and published counts).
export const MATCH_RADIUS_M = 40;

// Counts older than this year are flagged as stale (the street may have changed since).
export const STALE_BEFORE_YEAR = 2015;
/** DfT estimation_method of an AADF year that was counted on the street (the other value is "Estimated"). */
export const COUNTED = "Counted";

// DfT AADF columns carried through to the results (vehicles per average day, both directions).
export const AADF_COLUMNS = ["all_motor_vehicles", "cars_and_taxis", "buses_and_coaches", "lgvs", "all_hgvs", "pedal_cycles"] as const;

// DfT Road Traffic Statistics local authorities covering the study bbox.
// `id` is DfT's legacy local_authority_id used in the download file names.
export const LOCAL_AUTHORITIES = [
  { name: "Westminster", ons: "E09000033", id: 109 },
  { name: "Camden", ons: "E09000007", id: 145 },
] as const;

// Highway values that carry the motor traffic DfT counts (footways, cycleways,
// service roads and paths are excluded so a point does not snap to a pavement).
export const MOTOR_HIGHWAYS = new Set([
  "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link",
  "tertiary", "tertiary_link", "unclassified", "residential", "living_street",
]);

// Datasets fetched per authority (DfT download folder name -> file stem).
export const DATASETS = ["countpoints", "aadf", "aadfbydirection"] as const;
export type Dataset = (typeof DATASETS)[number];

const DFT_DOWNLOAD_BASE = "https://storage.googleapis.com/dft-statistics/road-traffic/downloads";
export const dftUrl = (dataset: Dataset, laId: number) =>
  `${DFT_DOWNLOAD_BASE}/${dataset}/local_authority_id/dft_${dataset}_local_authority_id_${laId}.csv`;
export const dftPath = (dataset: Dataset, laId: number) => join(DFT_DATA, `dft_${dataset}_local_authority_id_${laId}.csv`);

/** Minimal RFC 4180 CSV parser (quoted fields, doubled quotes, CRLF) -> array of header-keyed rows. */
export function parseCsv(text: string, sep = ","): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) row.push(field), (field = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field), (field = "");
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) row.push(field), rows.push(row);
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, j) => [h.trim(), r[j] ?? ""])));
}

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Serialises rows to CSV with the given column order. */
export function toCsv(columns: readonly string[], rows: Record<string, unknown>[]): string {
  return [columns.join(","), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n";
}

/** Groups items by key, preserving first-seen order (Map.groupBy needs lib ES2024; tsconfig targets ES2022). */
export function groupBy<T, K>(items: Iterable<T>, key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const g = out.get(k);
    if (g) g.push(item);
    else out.set(k, [item]);
  }
  return out;
}
