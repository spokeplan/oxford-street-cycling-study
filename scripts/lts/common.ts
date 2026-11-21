// Shared paths, scenario table and geometry helpers for the LTS cross-check.
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..", "..");
export const DATA = join(ROOT, "data");
export const LTS_DATA = join(DATA, "lts");
export const LTS_RESULTS = join(ROOT, "results", "lts");

// Scenario name -> source PBF (file name inside data/).
export const SCENARIOS: Record<string, string> = {
  today: "greater-london-latest.osm.pbf",
  "wigmore-track": "greater-london-wigmore-track.osm.pbf",
  "full-closure": "greater-london-full-closure.osm.pbf",
  "full-closure-sealed": "greater-london-full-closure-sealed.osm.pbf",
};

// osmium-tool image used by extract-graph.ts and retag-scenario.ts, pinned by
// digest so a later push to the tag cannot change the extracts.
export const OSMIUM_IMAGE = "stefda/osmium-tool@sha256:d2321d0e926f77ead7547b4b35f5cf98d9fd74043673cecc4fc2bb7cce06ff63";

// Short unnamed median links that cross the Oxford Street carriageway between
// cross-streets; full-closure keeps them rideable, full-closure-sealed retags them
// like the closed street (scripts/retag-scenario.ts) and gap-closing's
// --allow-oxford makes them convertible again (scripts/lts/gap-closing.ts).
export const SEALED_CROSSING_WAY_IDS: readonly number[] = [
  1199406460, // tertiary_link, Wardour Street -> Berners Street
  1199406459, // unclassified, Wells Street -> Berwick Street
  728793127, // service, Great Titchfield Street <-> Ramillies Street
];

// Study bbox, lon/lat degrees WGS84 (Paddington to Holborn).
export const BBOX = { minLon: -0.185, maxLon: -0.11, minLat: 51.505, maxLat: 51.53 };

export type LonLat = [number, number];

/** A longitude range, degrees WGS84. */
export interface LonWindow { minLon: number; maxLon: number }
/**
 * Oxford Street's pedestrianised no-cycling length today, Orchard Street to just east
 * of Oxford Circus: an Oxford Street way with every vertex inside this window belongs
 * to it. Used by gap-closing's --allow-oxford counterfactual and by the figures.
 */
export const OXFORD_PED_WINDOW: LonWindow = { minLon: -0.154, maxLon: -0.1405 };
/** The whole of Oxford Street, Marble Arch (~-0.1587) to Tottenham Court Road (~-0.1304) with margin: the full-closure scenarios close it. */
export const OXFORD_FULL_WINDOW: LonWindow = { minLon: -0.1595, maxLon: -0.1295 };
/** True when every vertex lies inside the longitude window. */
export const inLonWindow = (coords: LonLat[], w: LonWindow) => coords.every(([lon]) => lon >= w.minLon && lon <= w.maxLon);

export interface WayFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: LonLat[] };
  properties: { "@id": number; "@nodes": number[] } & Record<string, unknown>;
}

// LTS criteria tables (see docs/lts.md): BikeOttawa's model, the original
// Mekuria/Furth/Nixon 2012 mixed-traffic table, or Furth's 2017 volume-based
// table (LTS 2.0) under a low or a high default-volume assumption.
export const TABLES = ["bikeottawa", "mekuria2012", "furth2017-low", "furth2017-high"] as const;
export type LtsTable = (typeof TABLES)[number];
const DEFAULT_TABLE: LtsTable = "bikeottawa";
export type FurthTable = Extract<LtsTable, `furth2017-${string}`>;
export const FURTH_TABLES: readonly FurthTable[] = ["furth2017-low", "furth2017-high"];
export const isFurthTable = (t: LtsTable): t is FurthTable => (FURTH_TABLES as readonly string[]).includes(t);

// Speed column a 20 mph limit reads in the Furth 2017 table: "25" (default,
// prevailing speed on a 20 mph street taken as 20-25 mph) or "lt20" (sensitivity).
export const SPEED_COLS = ["25", "lt20"] as const;
export type SpeedCol = (typeof SPEED_COLS)[number];
export const DEFAULT_SPEED_COL: SpeedCol = "25";
export const LT20_SPEED_COL: SpeedCol = "lt20";

/**
 * A criteria table plus its options; its name keys the output files.
 * untaggedUnlaned (furth2017 only, sensitivity): an untagged two-way residential or
 * living_street way reads the table's unlaned row instead of the with-centreline row.
 */
export interface LtsMode {
  table: LtsTable;
  speedCol: SpeedCol;
  untaggedUnlaned?: boolean;
}
export const DEFAULT_MODE: LtsMode = { table: DEFAULT_TABLE, speedCol: DEFAULT_SPEED_COL };
const UNLANED_SUFFIX = "unlaned";
/** Output name: the table, suffixed with the speed column when it is not the default and "-unlaned" for that sensitivity. */
export const modeName = ({ table, speedCol, untaggedUnlaned }: LtsMode) =>
  [table, ...(speedCol === DEFAULT_SPEED_COL ? [] : [speedCol]), ...(untaggedUnlaned ? [UNLANED_SUFFIX] : [])].join("-");

export const waysPath = (scenario: string) => join(LTS_DATA, `${scenario}-ways.geojson`);
export const classifiedPath = (scenario: string, mode: LtsMode) => join(LTS_DATA, `${scenario}-ways-lts-${modeName(mode)}.geojson`);
export const resultsDir = (mode: LtsMode, scenario?: string) =>
  scenario ? join(LTS_RESULTS, modeName(mode), scenario) : join(LTS_RESULTS, modeName(mode));

const UNTAGGED_UNLANED_FLAG = "--untagged-unlaned";
export const MODE_USAGE = `[--table ${TABLES.join("|")}] [--speed-col ${SPEED_COLS.join("|")}] [${UNTAGGED_UNLANED_FLAG}]`;

/** Value after `flag` in argv, or undefined; exits when it is not one of `allowed`. */
function flagValue<T extends string>(argv: string[], flag: string, allowed: readonly T[], usage: string): T | undefined {
  const i = argv.indexOf(flag);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (!(allowed as readonly string[]).includes(v)) {
    console.error(`Usage: ${usage}  (${flag}: ${allowed.join(" | ")})`);
    process.exit(1);
  }
  return v as T;
}

/**
 * Reads "--table <name>", "--speed-col <col>" and "--untagged-unlaned" from argv;
 * the last two only apply to the furth2017 tables.
 */
export function parseMode(argv: string[], usage: string): LtsMode {
  const table = flagValue(argv, "--table", TABLES, usage) ?? DEFAULT_TABLE;
  const speedCol = flagValue(argv, "--speed-col", SPEED_COLS, usage) ?? DEFAULT_SPEED_COL;
  const untaggedUnlaned = argv.includes(UNTAGGED_UNLANED_FLAG);
  if ((speedCol !== DEFAULT_SPEED_COL || untaggedUnlaned) && !isFurthTable(table)) {
    console.error(`Usage: ${usage}  (--speed-col and ${UNTAGGED_UNLANED_FLAG} only apply to ${FURTH_TABLES.join(" | ")})`);
    process.exit(1);
  }
  return untaggedUnlaned ? { table, speedCol, untaggedUnlaned } : { table, speedCol };
}

// Trip ends of the Oxford Street corridor (lon/lat degrees WGS84), shared by the
// LTS routing (scripts/lts/route.ts) and the Valhalla trips (scripts/run-trips.ts).
export const POINTS: Record<string, LonLat> = {
  A: [-0.15874, 51.5132], // Marble Arch, Oxford Street west end
  B: [-0.13027, 51.51587], // Tottenham Court Road station, Oxford Street east end
};
export const TRIPS: Record<string, [string, string]> = { "A-B": ["A", "B"], "B-A": ["B", "A"] };
/** Trip name (A-B) -> column prefix of the summaries (ab). */
export const tripPrefix = (trip: string) => trip.replace("-", "").toLowerCase();

// Mean Earth radius in metres (IUGG), used by the haversine great-circle distance.
const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Locale-independent string order (UTF-16 code units), for output that must not depend on the machine's locale. */
export const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// Metres per degree of latitude on the mean-radius sphere (2*pi*R/360), for local
// equirectangular projections over short distances.
export const M_PER_DEG_LAT = 111_195;

/** Distance in metres from point p to polyline `line`, in a local equirectangular projection centred on p (error well under 1 % within a few hundred metres). */
export function pointToLineM(p: LonLat, line: LonLat[]): number {
  const kx = M_PER_DEG_LAT * Math.cos(toRad(p[1]));
  const xy = line.map(([lon, lat]) => [(lon - p[0]) * kx, (lat - p[1]) * M_PER_DEG_LAT] as const);
  let best = Infinity;
  for (let i = 1; i < xy.length; i++) {
    const [ax, ay] = xy[i - 1];
    const [bx, by] = xy[i];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/** Great-circle distance in metres between two lon/lat points (haversine formula). */
export function haversineM([lon1, lat1]: LonLat, [lon2, lat2]: LonLat): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function requireScenario(arg: string | undefined, usage: string): string {
  if (!arg || !(arg in SCENARIOS)) {
    console.error(`Usage: ${usage}  (scenario: ${Object.keys(SCENARIOS).join(" | ")})`);
    process.exit(1);
  }
  return arg;
}
