// Data preparation for the article figures (scripts/figures/render.ts). The figures
// show the best-evidence grading (docs/lts.md, "Best-evidence run"): volumes from
// counts, then TfL's modelled flows, and the low ("quiet") or high ("busy") guess
// only for streets with neither. This module grades the ways as that run does
// (scripts/lts/sensitivity.ts, bestEvidenceWays), reads its route, gap-closing and
// side-comparison results and the count points it uses, selects and counts
// features, and writes each figure's layers to data/figures/<figure>-<layer>.geojson
// (gitignored, inspectable in any GIS).
// No result number is written into the figures by hand: every one is read here.
// Usage: bun scripts/figures/data.ts   (prints the counts without rendering)
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { openedRoutes, headlineUnion, type OpenedRoute } from "../lts/best-evidence";
import {
  BBOX, DATA, OXFORD_PED_WINDOW, POINTS, ROOT, TRIPS, pointToLineM, byCodeUnit, haversineM, inLonWindow, modeName, tripPrefix,
  type FurthTable, type LonLat, type LtsMode, type WayFeature,
} from "../lts/common";
import { CROSSING_FRAGMENT, HEADLINE_GAP_MODES, HEADLINE_RUN, UNION_DIRECTION, UNION_SOLUTION, gapClosingCsv, gapClosingGeojson } from "../lts/gap-closing";
import { HIGH_STRESS_MIN_LTS, LOW_STRESS_MAX_LTS, buildGraph, label, snap, type Edge, type Graph } from "../lts/route";
import { BEST_EVIDENCE, SCENARIO_TODAY, SENSITIVITY_RESULTS, bestEvidenceWays, furthTableRule, lowStressConnectivity, zeroDefaults } from "../lts/sensitivity";
import { SIDES, forbiddenWays, type Side } from "../lts/sides";
import { COUNTED, MATCHED_CSV, MOTOR_HIGHWAYS, STALE_BEFORE_YEAR, YES, parseCsv } from "../dft/common";
import { PUBLISHED_MATCHED_CSV } from "../published-counts/common";
import { CALM_FRAME, FREQUENCY_FRAME, type Bounds } from "./style";

export const FIGURES_DATA = join(DATA, "figures");

type Props = Record<string, unknown>;
export interface Feature<G = { type: string; coordinates: unknown }> { type: "Feature"; geometry: G; properties: Props }
export interface FC { type: "FeatureCollection"; features: Feature[] }
const fc = (features: Feature[]): FC => ({ type: "FeatureCollection", features });

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** A headline mode (scripts/lts/gap-closing.ts): the Furth 2017 table at its default speed column. */
function headlineMode(table: FurthTable): LtsMode {
  const mode = HEADLINE_GAP_MODES.find((m) => m.table === table);
  if (!mode) throw new Error(`${table} is not a headline mode`);
  return mode;
}
/**
 * The two readings of the best-evidence grading: streets with no count and no
 * modelled flow take the table's low guess (quiet) or its high guess (busy).
 */
const VOLUME_MODES = { low: headlineMode("furth2017-low"), high: headlineMode("furth2017-high") } as const;
export type Volume = keyof typeof VOLUME_MODES;
export const VOLUMES = Object.keys(VOLUME_MODES) as Volume[];
export { SIDES, type Side };

/** OSM extract metadata written by scripts/download-extract.ts; its replication timestamp dates the data. */
const EXTRACT_INFO = join(ROOT, "results", "extract-info.json");

/** The best-evidence run's results (scripts/lts/sensitivity.ts, best-evidence.ts): gap-closing runs, routes, tables. */
const BEST_EVIDENCE_RESULTS = join(SENSITIVITY_RESULTS, BEST_EVIDENCE);
const bestEvidenceDir = (mode: LtsMode, scenario: string) => join(BEST_EVIDENCE_RESULTS, modeName(mode), scenario);
/** One row per best-evidence gap-closing run (scripts/lts/best-evidence.ts). */
const RUNS_CSV = join(BEST_EVIDENCE_RESULTS, "runs.csv");
/** Per street: in how many of the main runs' and of the best-evidence runs' sets it appears (scripts/lts/sensitivity.ts). */
const FREQUENCY_CSV = join(BEST_EVIDENCE_RESULTS, "frequency.csv");
const FREQ_COLS = { street: "street", count: "sensitivity_runs", runs: "runs" } as const;
/** Every best-evidence gap-closing run (table x scenario x allow-oxford x contraflow), not the robustness checks beside them. */
const GAP_RUN_GLOB = `{${HEADLINE_GAP_MODES.map(modeName).join(",")}}/*/gap-closing*.geojson`;

/** North against south (scripts/lts/side-comparison.ts): one row per grading, table and side, and each run's files. */
const SIDE_COMPARISON = "side-comparison";
const SIDE_CSV = join(SENSITIVITY_RESULTS, `${SIDE_COMPARISON}.csv`);
const sideDir = (mode: LtsMode, side: Side) => join(SENSITIVITY_RESULTS, SIDE_COMPARISON, BEST_EVIDENCE, modeName(mode), side);
const SIDE_SOLVED = "solved";
const SIDE_UNION_COL = "union_converted_m";
/** Per-trip column of the side comparison: the length of the route the side's set opens, metres (rounded). */
const routeCol = (trip: string) => `${tripPrefix(trip)}_route_m`;

/** The best-evidence rows of the sensitivity summary (scenario today, HEADLINE_RUN): the connectivity columns are checked against the ways drawn. */
const SENSITIVITY_SUMMARY_CSV = join(SENSITIVITY_RESULTS, "..", "sensitivity-summary.csv");
const CONNECTED = "yes";
const M_PER_KM = 1000;
/** adt_source of a way whose volume is the table's class default: no count, no carried count, no modelled flow. */
const CLASS_DEFAULT_SOURCE = "class-default";
const connectedCol = (trip: string) => `${tripPrefix(trip)}_connected_lowstress`;

// Pedestrianised no-cycling stretch of Oxford Street: highway=pedestrian ways
// named Oxford Street with every vertex inside OXFORD_PED_WINDOW, the window
// gap-closing's --allow-oxford reopens (scripts/lts/common.ts).
export const OXFORD_STREET = "Oxford Street";
const PEDESTRIAN = "pedestrian";
const inPedWindow = (coords: LonLat[]) => inLonWindow(coords, OXFORD_PED_WINDOW);

/** Streets labelled on the frequency map: at least this many appearances, with a counted way inside the frame. */
export const FREQUENCY_LABEL_MIN_COUNT = 12;
/** Streets of the confident rider's path named on the routes map: the longest ones, Oxford Street aside. */
const CONFIDENT_LABELS = 4;
/** Street-type words shortened in map labels. */
const STREET_ABBREVIATIONS: [RegExp, string][] = [[/ Street$/, " St"], [/ Square$/, " Sq"], [/ Place$/, " Pl"], [/ Road$/, " Rd"]];
const shortName = (street: string) => STREET_ABBREVIATIONS.reduce((n, [re, abbr]) => n.replace(re, abbr), street);
/** Streets listed by describe(), most frequent first. */
const TOP_STREETS_REPORTED = 10;

/** Valid LTS values in the classified ways: 0 (not rideable) and 1-4. */
const LTS_MIN = 0;
const LTS_MAX = 4;

/** Coordinates rounded to this many decimals (1e-6 degree is about 0.1 m) to keep the inline GeoJSON small. */
const COORD_DECIMALS = 6;
const roundCoord = ([lon, lat]: LonLat): LonLat => [Number(lon.toFixed(COORD_DECIMALS)), Number(lat.toFixed(COORD_DECIMALS))];
const line = (coords: LonLat[]) => ({ type: "LineString", coordinates: coords.map(roundCoord) });
const point = (at: LonLat) => ({ type: "Point", coordinates: roundCoord(at) });

const inBox = (coords: LonLat[], b: Bounds) =>
  coords.some(([lon, lat]) => lon >= b.minLon && lon <= b.maxLon && lat >= b.minLat && lat <= b.maxLat);

/** Date (YYYY-MM-DD, UTC) of the OSM extract's replication timestamp. */
async function extractDate(): Promise<string> {
  const info = (await Bun.file(EXTRACT_INFO).json()) as { osm_replication_timestamp?: string };
  const ts = info.osm_replication_timestamp;
  if (!ts || Number.isNaN(Date.parse(ts))) throw new Error(`${EXTRACT_INFO}: no osm_replication_timestamp`);
  return new Date(ts).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Joins lines that share an end vertex (reversing where needed) until no two lines touch end to end. */
function chainLines(lines: LonLat[][]): LonLat[][] {
  const same = (a: LonLat, b: LonLat) => a[0] === b[0] && a[1] === b[1];
  const out = lines.map((l) => [...l]);
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i++) {
      for (let j = i + 1; j < out.length && !merged; j++) {
        const a = out[i], b = out[j];
        const joined =
          same(a.at(-1)!, b[0]) ? [...a, ...b.slice(1)] :
          same(a.at(-1)!, b.at(-1)!) ? [...a, ...[...b].reverse().slice(1)] :
          same(a[0], b.at(-1)!) ? [...b, ...a.slice(1)] :
          same(a[0], b[0]) ? [...[...b].reverse(), ...a.slice(1)] : undefined;
        if (joined) { out[i] = joined; out.splice(j, 1); merged = true; }
      }
    }
  }
  return out;
}

const lineLengthM = (coords: LonLat[]) => coords.slice(1).reduce((s, c, i) => s + haversineM(coords[i], c), 0);

/** The point halfway along a line (by length): a label point that lies on the street. */
function midpoint(coords: LonLat[]): LonLat {
  let left = lineLengthM(coords) / 2;
  for (let i = 1; i < coords.length; i++) {
    const d = haversineM(coords[i - 1], coords[i]);
    if (d >= left && d > 0) {
      const t = left / d;
      return [coords[i - 1][0] + t * (coords[i][0] - coords[i - 1][0]), coords[i - 1][1] + t * (coords[i][1] - coords[i - 1][1])];
    }
    left -= d;
  }
  return coords.at(-1)!;
}

/** The vertex nearest to the mean of the given vertices: a label point that lies on the street. */
function labelAnchor(coords: LonLat[]): LonLat {
  const mean: LonLat = [coords.reduce((s, c) => s + c[0], 0) / coords.length, coords.reduce((s, c) => s + c[1], 0) / coords.length];
  return coords.reduce((best, c) => (haversineM(c, mean) < haversineM(best, mean) ? c : best));
}

/**
 * One label point per street: the street's pieces chained, labelled halfway along the
 * longest chain. `metres` is the street's total length in the pieces.
 */
function streetLabels(pieces: { street: string; coords: LonLat[] }[], extra: Props = {}): Feature[] {
  const byStreet = new Map<string, LonLat[][]>();
  for (const p of pieces) (byStreet.get(p.street) ?? byStreet.set(p.street, []).get(p.street)!).push(p.coords);
  return [...byStreet].map(([street, lines]) => {
    const longest = chainLines(lines).reduce((a, b) => (lineLengthM(b) > lineLengthM(a) ? b : a));
    return {
      type: "Feature", geometry: point(midpoint(longest)),
      properties: { street, short: shortName(street), metres: Math.round(lines.reduce((s, l) => s + lineLengthM(l), 0)), ...extra },
    };
  });
}

/** Concatenates consecutive pieces of one path, dropping the shared vertex. */
function joinInOrder(pieces: LonLat[][]): LonLat[] {
  return pieces.flatMap((p, i) => (i === 0 ? p : p.slice(1)));
}

/**
 * A path's edges as one line in travel order. openedRoutes gives the edges in order
 * but not the direction each is ridden, so each edge is turned to start at the node
 * where the previous one ended; the first starts at the node it does not share with the second.
 */
function pathLine(edges: Edge[]): LonLat[] {
  const [first, second] = edges;
  let at = second && (first.from === second.from || first.from === second.to) ? first.to : first.from;
  return joinInOrder(edges.map((e) => {
    if (e.from !== at && e.to !== at) throw new Error(`opened route: edge ${e.from}-${e.to} does not continue from node ${at}`);
    const forward = e.from === at;
    at = forward ? e.to : e.from;
    return forward ? e.coords : [...e.coords].reverse();
  }));
}

// ---------------------------------------------------------------------------
// Shared layers
// ---------------------------------------------------------------------------

function pedestrianZone(ways: WayFeature[]): FC {
  const ped = ways.filter((w) => w.properties.highway === PEDESTRIAN && w.properties.name === OXFORD_STREET && inPedWindow(w.geometry.coordinates));
  // Ways chained end to end, so the dash pattern runs on instead of restarting at every way.
  return fc(chainLines(ped.map((w) => w.geometry.coordinates)).map((coords) => ({
    type: "Feature", geometry: line(coords), properties: { ways: ped.length },
  })));
}

// ---------------------------------------------------------------------------
// Fix frequency
// ---------------------------------------------------------------------------

interface StreetCount { street: string; count: number }
interface FrequencyData {
  runs: string[]; // relative paths of the counted gap-closing files
  ways: FC; // count per way, motor-traffic ways plus any way that appears
  labels: FC; // one label point per street with >= FREQUENCY_LABEL_MIN_COUNT appearances and a counted way in the frame
  maxWayCount: number;
  /** Every street with an appearance, most frequent first (ties in code-unit order of the name). */
  streets: StreetCount[];
  /** Oxford Street: runs that convert any stretch of it, and those that convert its pedestrianised stretch. */
  oxford: { count: number; pedestrianised: number };
}

async function frequency(today: WayFeature[], frame: Bounds): Promise<FrequencyData> {
  const files = [...new Bun.Glob(GAP_RUN_GLOB).scanSync({ cwd: BEST_EVIDENCE_RESULTS })].map((f) => f.replaceAll("\\", "/")).sort();
  if (files.length === 0) throw new Error(`no gap-closing runs match ${GAP_RUN_GLOB} in ${BEST_EVIDENCE_RESULTS}`);
  // One run file per row of runs.csv, or results/ is half regenerated (a stale or missing run would skew the counts).
  const runRows = parseCsv(await Bun.file(RUNS_CSV).text()).length;
  if (files.length !== runRows) {
    throw new Error(`${files.length} gap-closing runs match ${GAP_RUN_GLOB}, but ${relative(ROOT, RUNS_CSV)} has ${runRows} rows`);
  }
  const wayCount = new Map<number, number>();
  const streetCount = new Map<string, number>();
  let oxfordPedestrianised = 0;
  for (const file of files) {
    const features = ((await Bun.file(join(BEST_EVIDENCE_RESULTS, file)).json()) as FC).features
      .filter((f) => f.properties.solution === UNION_SOLUTION);
    for (const id of new Set(features.map((f) => f.properties.way_id as number))) wayCount.set(id, (wayCount.get(id) ?? 0) + 1);
    // A street counts where the run converts a stretch of it; a crossing carries the name
    // of the road it crosses ("Crossing at Oxford Street") but converts no street, so it
    // colours its way on the map without counting as an appearance of that street.
    const links = features.filter((f) => f.properties.fragment !== CROSSING_FRAGMENT);
    for (const s of new Set(links.map((f) => f.properties.street as string))) streetCount.set(s, (streetCount.get(s) ?? 0) + 1);
    // The pedestrianised stretch can only be converted where the run lets bicycles through it (--allow-oxford).
    if (features.some((f) => f.properties.street === OXFORD_STREET && f.properties.highway === PEDESTRIAN &&
      inPedWindow(f.geometry.coordinates as LonLat[]))) oxfordPedestrianised++;
  }
  await checkFrequencyCsv(streetCount, files.length);
  const byId = new Map(today.map((w) => [w.properties["@id"], w]));
  const missingWayIds = [...wayCount.keys()].filter((id) => !byId.has(id));
  if (missingWayIds.length > 0) throw new Error(`union way ids not in today's ways (stale data/lts?): ${missingWayIds.join(" ")}`);
  const ways = today.filter((w) => inBox(w.geometry.coordinates, BBOX) &&
    (wayCount.has(w.properties["@id"]) || MOTOR_HIGHWAYS.has(w.properties.highway as string)));
  const features: Feature[] = ways.map((w) => ({
    type: "Feature",
    geometry: line(w.geometry.coordinates),
    properties: { way_id: w.properties["@id"], name: w.properties.name ?? null, count: wayCount.get(w.properties["@id"]) ?? 0 },
  }));
  // Draw order: low counts first so the strongest ways sit on top.
  features.sort((a, b) => (a.properties.count as number) - (b.properties.count as number));

  const labels: Feature[] = [];
  const inFrame = ([lon, lat]: LonLat) => lon >= frame.minLon && lon <= frame.maxLon && lat >= frame.minLat && lat <= frame.maxLat;
  for (const [street, count] of streetCount) {
    if (count < FREQUENCY_LABEL_MIN_COUNT) continue;
    // Anchor on the street's most-counted ways inside the frame (a street partly outside is labelled where it shows).
    const own = ways.filter((w) => w.properties.name === street && wayCount.has(w.properties["@id"]) && w.geometry.coordinates.some(inFrame));
    if (own.length === 0) throw new Error(`fix-frequency: ${street} (${count} runs) has no counted way in the frame; widen FREQUENCY_FRAME`);
    const top = Math.max(...own.map((w) => wayCount.get(w.properties["@id"])!));
    const anchor = labelAnchor(own.filter((w) => wayCount.get(w.properties["@id"]) === top).flatMap((w) => w.geometry.coordinates).filter(inFrame));
    labels.push({ type: "Feature", geometry: point(anchor), properties: { street, short: shortName(street), count } });
  }
  const streets = [...streetCount].map(([street, count]) => ({ street, count }))
    .sort((a, b) => b.count - a.count || byCodeUnit(a.street, b.street));
  return {
    runs: files.map((f) => relative(ROOT, join(BEST_EVIDENCE_RESULTS, f)).replaceAll("\\", "/")),
    ways: fc(features), labels: fc(labels), maxWayCount: Math.max(...wayCount.values()), streets,
    oxford: { count: streetCount.get(OXFORD_STREET) ?? 0, pedestrianised: oxfordPedestrianised },
  };
}

/** The run's own frequency table must give every street the count found here, over the same number of runs, or one of the two is stale. */
async function checkFrequencyCsv(streetCount: Map<string, number>, runs: number): Promise<void> {
  const where = relative(ROOT, FREQUENCY_CSV);
  const rows = parseCsv(await Bun.file(FREQUENCY_CSV).text());
  const listed = new Map(rows.map((r) => [r[FREQ_COLS.street], Number(r[FREQ_COLS.count])]));
  const off = [...new Set([...listed.keys(), ...streetCount.keys()])]
    .filter((s) => (listed.get(s) ?? 0) !== (streetCount.get(s) ?? 0))
    .map((s) => `${s} ${listed.get(s) ?? 0} there, ${streetCount.get(s) ?? 0} here`);
  const totals = new Set(rows.map((r) => Number(r[FREQ_COLS.runs])));
  if (off.length > 0 || totals.size !== 1 || !totals.has(runs)) {
    throw new Error(`${where} disagrees with the ${runs} runs counted (runs column ${[...totals].join("/")}): ${off.join("; ")}`);
  }
}

// ---------------------------------------------------------------------------
// Stress map
// ---------------------------------------------------------------------------

function ltsWays(ways: WayFeature[]): FC {
  const features: Feature[] = ways.filter((w) => inBox(w.geometry.coordinates, BBOX)).map((w): Feature => {
    // The map colours LTS 1-4 and greys LTS 0; any other value would be drawn in a wrong colour, so stop here.
    const lts = w.properties["@lts"];
    if (!Number.isInteger(lts) || (lts as number) < LTS_MIN || (lts as number) > LTS_MAX) {
      throw new Error(`way ${w.properties["@id"]}: @lts ${JSON.stringify(lts)} outside ${LTS_MIN}-${LTS_MAX}`);
    }
    return { type: "Feature", geometry: line(w.geometry.coordinates), properties: { way_id: w.properties["@id"], lts: lts as number } };
  });
  // Draw order: unrideable first, then LTS 1 -> 4, so stressful streets are not hidden under quiet ones.
  features.sort((a, b) => (a.properties.lts as number) - (b.properties.lts as number));
  return fc(features);
}

/**
 * Whether the grading has a low-stress path (route.ts connectivity) per trip, from the
 * ways drawn; the sensitivity summary's columns for the same grading must agree.
 */
async function connectivity(volume: Volume, ways: WayFeature[]): Promise<Record<string, boolean>> {
  const computed = lowStressConnectivity(ways);
  const row = parseCsv(await Bun.file(SENSITIVITY_SUMMARY_CSV).text()).filter((r) => r.name === BEST_EVIDENCE &&
    r.table === modeName(VOLUME_MODES[volume]) && r.scenario === SCENARIO_TODAY &&
    r.allow_oxford === String(HEADLINE_RUN.allowOxford) && r.contraflow === String(HEADLINE_RUN.contraflow));
  if (row.length !== 1) throw new Error(`${relative(ROOT, SENSITIVITY_SUMMARY_CSV)}: ${row.length} ${BEST_EVIDENCE} rows for ${volume}, expected 1`);
  return Object.fromEntries(Object.keys(TRIPS).map((trip) => {
    const col = connectedCol(trip);
    if (computed[col] !== row[0][col]) throw new Error(`${volume} ${trip}: ${col} ${computed[col]} on the ways drawn, ${row[0][col]} in the summary`);
    return [trip, computed[col] === CONNECTED];
  }));
}

/** Who published a count point: DfT (results/dft/) or TfL, Camden or Westminster (results/published-counts/). */
const COUNT_SOURCES = ["dft", "published"] as const;
type CountSource = (typeof COUNT_SOURCES)[number];
/** Years of the count points shown, per source: one year per point; DfT years may be stale or estimated. */
interface CountYears { points: number; minYear: number; maxYear: number; stale: number; estimated: number }
interface CountData { points: FC; years: Record<CountSource, CountYears>; staleBefore: number }
/** adt_source values that carry a count point's figure: on its own way, or along its road. */
const COUNT_ADT_SOURCES = new Set(["count", "road"]);

/**
 * The count points the grading uses: those whose figure sets the volume of a way graded
 * by the Furth table (on the point's own way or carried along its road). A point that
 * loses to a newer one on its way, or lies on a way no table row grades, is not drawn.
 */
function usedCountPoints(ways: WayFeature[]): Set<string> {
  return new Set(ways.filter((w) => furthTableRule(String(w.properties["@lts_rule"])) && COUNT_ADT_SOURCES.has(String(w.properties.adt_source)))
    .map((w) => String(w.properties.adt_count_point)));
}

async function countPoints(ways: Record<Volume, WayFeature[]>): Promise<CountData> {
  const [low, ...others] = VOLUMES.map((v) => usedCountPoints(ways[v]));
  // Both readings share the counts (the tables differ only in their guesses), so one ring layer serves both panels.
  for (const ids of others) {
    if (ids.size !== low.size || [...ids].some((id) => !low.has(id))) throw new Error("stress-map: the two readings use different count points");
  }
  const located = new Map<string, Feature>();
  for (const r of parseCsv(await Bun.file(MATCHED_CSV).text()).filter((r) => r.matched === YES)) {
    located.set(r.count_point_id, { type: "Feature", geometry: point([Number(r.longitude), Number(r.latitude)]), properties: {
      id: r.count_point_id, source: "dft", road: r.road_name, year: Number(r.year), estimated: r.estimation_method !== COUNTED,
      all_motor_vehicles: Number(r.all_motor_vehicles),
    } });
  }
  for (const r of parseCsv(await Bun.file(PUBLISHED_MATCHED_CSV).text())) {
    if (located.has(r.id)) throw new Error(`count id ${r.id} is both a DfT and a published count`);
    located.set(r.id, { type: "Feature", geometry: point([Number(r.lon), Number(r.lat)]), properties: {
      id: r.id, source: "published", road: r.street, year: Number(r.year), estimated: false, hours: Number(r.hours),
      all_motor_vehicles: Number(r.all_motor_vehicles),
    } });
  }
  const missing = [...low].filter((id) => !located.has(id));
  if (missing.length > 0) throw new Error(`count points the grading uses but neither results file lists: ${missing.join(" ")}`);
  // In the study bbox, like the ways drawn.
  const points = [...low].sort(byCodeUnit).map((id) => located.get(id)!).filter((p) => inBox([p.geometry.coordinates as LonLat], BBOX));
  const years = Object.fromEntries(COUNT_SOURCES.map((source) => {
    const ps = points.filter((p) => p.properties.source === source).map((p) => p.properties);
    const ys = ps.map((p) => p.year as number);
    return [source, {
      points: ps.length, minYear: Math.min(...ys), maxYear: Math.max(...ys),
      stale: ys.filter((y) => y < STALE_BEFORE_YEAR).length, estimated: ps.filter((p) => p.estimated).length,
    }];
  })) as Record<CountSource, CountYears>;
  return { points: fc(points), years, staleBefore: STALE_BEFORE_YEAR };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const ROUTE_KINDS = ["confident", "cautious-low", "cautious-high"] as const;
export type RouteKind = (typeof ROUTE_KINDS)[number];
const ROUTE_SOURCES: Record<RouteKind, { mode: LtsMode; rider: string }> = {
  confident: { mode: VOLUME_MODES.low, rider: "confident" },
  "cautious-low": { mode: VOLUME_MODES.low, rider: "cautious" },
  "cautious-high": { mode: VOLUME_MODES.high, rider: "cautious" },
};
interface RouteData {
  trip: string;
  routes: FC;
  distanceM: Record<RouteKind, number>;
  /** The confident path's longest streets (Oxford Street aside), one label point each, in travel order. */
  confidentLabels: FC;
  /** The cautious rider's weights on LTS 3 and LTS 4 metres (the same under both readings). */
  cautiousWeights: { lts3: number; lts4: number };
}

interface RouteFile extends FC { properties: { distance_m: number; mult_lts3: number; mult_lts4: number } }

/** The confident path's CONFIDENT_LABELS longest named streets other than Oxford Street, in travel order. */
function confidentStreetLabels(route: RouteFile): FC {
  const pieces = route.features.filter((f) => typeof f.properties.name === "string" && f.properties.name !== OXFORD_STREET)
    .map((f) => ({ street: f.properties.name as string, coords: f.geometry.coordinates as LonLat[] }));
  const order = [...new Set(pieces.map((p) => p.street))];
  const metres = (f: Feature) => f.properties.metres as number;
  return fc(streetLabels(pieces).sort((a, b) => metres(b) - metres(a)).slice(0, CONFIDENT_LABELS)
    .sort((a, b) => order.indexOf(a.properties.street as string) - order.indexOf(b.properties.street as string)));
}

async function routes(trip: string): Promise<RouteData> {
  const features: Feature[] = [];
  const distanceM = {} as Record<RouteKind, number>;
  let confidentLabels = fc([]);
  const weights = new Set<string>();
  for (const kind of ROUTE_KINDS) {
    const { mode, rider } = ROUTE_SOURCES[kind];
    const route = (await Bun.file(join(bestEvidenceDir(mode, SCENARIO_TODAY), `${trip}-${rider}.geojson`)).json()) as RouteFile;
    distanceM[kind] = route.properties.distance_m;
    if (kind === "confident") confidentLabels = confidentStreetLabels(route);
    else weights.add(`${route.properties.mult_lts3}/${route.properties.mult_lts4}`);
    // One line per route (its way pieces are in travel order and direction), so the
    // offset, casing and caps run on instead of restarting at every way.
    features.push({
      type: "Feature",
      geometry: line(joinInOrder(route.features.map((f) => f.geometry.coordinates as LonLat[]))),
      properties: { kind, trip, distance_m: route.properties.distance_m },
    });
  }
  if (weights.size !== 1) throw new Error(`${trip}: the cautious routes use different weights (${[...weights].join(", ")})`);
  const [lts3, lts4] = [...weights][0].split("/").map(Number);
  return { trip, routes: fc(features), distanceM, confidentLabels, cautiousWeights: { lts3, lts4 } };
}

// ---------------------------------------------------------------------------
// The streets to convert, one set per side of Oxford Street (union of both
// directions, two-way tracks, Oxford Street closed: scripts/lts/side-comparison.ts)
// ---------------------------------------------------------------------------

export interface FixData {
  volume: Volume;
  side: Side;
  unionM: number; // converted metres (links + crossings), from side-comparison.csv
  converted: FC; // every converted edge, links and crossings (fragment = "crossing")
  labels: FC; // one label point per converted street (crossings are not named)
  route: FC; // the low-stress path each direction takes once the set is converted, on its side
  pathM: Record<string, number>;
  budgetM: Record<string, number>;
  shortestM: Record<string, number>; // the shortest (any-LTS) path the budget is derived from
}

/** The best-evidence row of side-comparison.csv for this reading and side; it must be solved. */
function sideRow(rows: Record<string, string>[], volume: Volume, side: Side): Record<string, string> {
  const hits = rows.filter((r) => r.grading === BEST_EVIDENCE && r.table === modeName(VOLUME_MODES[volume]) && r.side === side);
  const where = relative(ROOT, SIDE_CSV);
  if (hits.length !== 1) throw new Error(`${where}: ${hits.length} ${BEST_EVIDENCE} rows for ${volume} ${side}, expected 1`);
  if (hits[0].status !== SIDE_SOLVED) throw new Error(`${where}: ${volume} ${side}: ${hits[0].status}`);
  return hits[0];
}

async function sideFix(volume: Volume, side: Side, ways: WayFeature[], row: Record<string, string>): Promise<FixData> {
  const dir = sideDir(VOLUME_MODES[volume], side);
  const unionM = Number(row[SIDE_UNION_COL]);
  if (!Number.isFinite(unionM) || unionM <= 0) throw new Error(`${volume} ${side}: bad ${SIDE_UNION_COL} ${row[SIDE_UNION_COL]}`);
  // The comparison table and the run's own CSV must agree, or results/ is half regenerated.
  const csvPath = gapClosingCsv(dir, HEADLINE_RUN.allowOxford, HEADLINE_RUN.contraflow);
  const unionRow = parseCsv(await Bun.file(csvPath).text()).find((r) => r.direction === UNION_DIRECTION && r.solution === UNION_SOLUTION);
  if (!unionRow) throw new Error(`${relative(ROOT, csvPath)}: no union row`);
  if (Number(unionRow.converted_m) !== unionM) throw new Error(`${volume} ${side}: union ${unionRow.converted_m} m in its run, ${unionM} m in the comparison`);
  const union = await headlineUnion(dir);
  // The route the set opens, on the side's own network, as the comparison measured it (best-evidence.ts, openedRoutes).
  const opened: OpenedRoute[] = openedRoutes(ways, union, forbiddenWays(ways, side));
  const pathM: Record<string, number> = {}, budgetM: Record<string, number> = {}, shortestM: Record<string, number> = {};
  const route: Feature[] = opened.map((r) => {
    if (Math.round(r.pathM) !== Number(row[routeCol(r.trip)])) {
      throw new Error(`${volume} ${side} ${r.trip}: rebuilt route ${Math.round(r.pathM)} m, ${row[routeCol(r.trip)]} m in the comparison`);
    }
    if (r.pathM > r.budgetM) throw new Error(`${volume} ${side} ${r.trip}: route ${r.pathM} m exceeds budget ${r.budgetM} m`);
    [pathM[r.trip], budgetM[r.trip], shortestM[r.trip]] = [r.pathM, r.budgetM, r.l4M];
    return { type: "Feature", geometry: line(pathLine(r.edges.map((e) => e.edge))), properties: { trip: r.trip, side, path_m: Math.round(r.pathM) } };
  });
  const links = union.filter((f) => f.properties.fragment !== CROSSING_FRAGMENT);
  return {
    volume, side, unionM,
    converted: fc(union.map((f) => ({ type: "Feature", geometry: line(f.geometry.coordinates), properties: { ...f.properties, side } }))),
    labels: fc(streetLabels(links.map((f) => ({ street: f.properties.street as string, coords: f.geometry.coordinates })), { volume, side })),
    route: fc(route), pathM, budgetM, shortestM,
  };
}

// ---------------------------------------------------------------------------
// Calm patches (stress-map): the calm streets a cautious rider can reach from each
// trip end riding only calm streets, on the generous grading (every street with no
// traffic figure calm), so what still cuts the ends off is counted or modelled traffic
// ---------------------------------------------------------------------------

/**
 * The study's main reading is the busy one: a street with no traffic figure is not counted
 * as calm. The quiet one, every such street quiet, is the low end (even then some of them
 * are not calm).
 */
export const MAIN_READING: Volume = "high";
/**
 * The stress map's grading: the best-evidence robustness check guesses-zero
 * (scripts/lts/robustness.ts), every remaining class guess at no traffic, so every
 * street with no traffic figure is calm.
 */
const GENEROUS_CHECK = "guesses-zero";
const GENEROUS_MODE = VOLUME_MODES[MAIN_READING];
const generousWays = () => bestEvidenceWays(SCENARIO_TODAY, GENEROUS_MODE, { classDefaults: zeroDefaults(GENEROUS_MODE.table as FurthTable) });
const ROBUSTNESS_CSV = join(BEST_EVIDENCE_RESULTS, "robustness.csv");
/**
 * Street classes of the stress map, by what the grade rests on. A street graded by the
 * Furth table on a class default ("no traffic figure") is never called calm: on this
 * grading it is passable, but drawn apart. Stressful streets with a figure are too busy
 * by count or TfL's model; a few with no figure are stressful anyway, by their lanes.
 */
export const CALM_KINDS = { busy: "busy", layout: "layout", calm: "calm", unknown: "unknown", none: "none" } as const;
export type CalmKind = (typeof CALM_KINDS)[keyof typeof CALM_KINDS];
/** Classes measured in km for the report, those a rider can use or meets as a barrier (not the ways closed to cycling). */
const MEASURED_KINDS = [CALM_KINDS.busy, CALM_KINDS.layout, CALM_KINDS.calm, CALM_KINDS.unknown] as const;
/** Streets reported per patch by describe(): its longest streets and the longest stressful streets at its edge. */
const PATCH_STREETS_REPORTED = 6;
/** Stretches of the long trip shorter than this are left out of describe()'s street list. */
const LONG_TRIP_REPORT_MIN_M = 40;
/** Metres by which a sum of feature lengths may differ from the same total rounded to the metre. */
const ROUNDING_SLACK_M = 1;

interface Patch {
  end: string;
  /** The snapped start node (route.ts snap, as gap-closing.ts snaps the trip ends) and its distance from the trip end. */
  startNode: number;
  snapM: number;
  nodes: Set<number>;
  edges: Set<number>;
  /** The patch's edges, drawn as a band under the streets (each street keeps its own class colour). */
  band: FC;
  /** Metres of the patch by class: evidenced calm against no traffic figure. */
  metres: Record<CalmKind, number>;
  /** Longest streets in the patch, and the longest stressful streets that touch it: what bounds it. */
  streets: { street: string; m: number }[];
  borders: { street: string; m: number }[];
  /** Metres of the patch's border that is stressful by its lanes only, with no traffic figure (the subtitle needs none). */
  borderLayoutM: number;
}
interface CalmMapData {
  /** Every rideable edge in the bbox by class (property `kind`), plus the ways closed to cycling. */
  ways: FC;
  patches: Patch[];
  /** Metres per class of the edges inside the map frame. */
  frameMetres: Record<CalmKind, number>;
  /** Nodes both patches reach, and the shortest straight-line gap between their nodes (metres, with its two ends). */
  sharedNodes: number;
  /** Nodes the two ends would share if the streets stressful by their lanes alone (no traffic figure) were passable too: none means the measured streets alone keep the ends apart. */
  sharedIfLayoutPassable: number;
  gap: { m: number; from: LonLat; to: LonLat };
  /** Per trip: a calm path on this grading (the robustness run has none, and the title says so). */
  connected: Record<string, boolean>;
  /** Named major barrier streets inside the stress-map frame, one label point each. */
  wall: FC;
}

const isCalm = (e: Edge) => e.lts <= LOW_STRESS_MAX_LTS;
/** Every node and edge reachable from `start` along passable arcs (default: calm, LTS <= LOW_STRESS_MAX_LTS), one-way rules as the graph has them. */
function calmReach(g: Graph, start: number, passable: (e: Edge) => boolean = isCalm): { nodes: Set<number>; edges: Set<number> } {
  const nodes = new Set([start]);
  const edges = new Set<number>();
  for (const queue = [start]; queue.length > 0; ) {
    for (const arc of g.adj.get(queue.pop()!) ?? []) {
      const e = g.edges[arc.edge];
      if (!passable(e)) continue;
      edges.add(arc.edge);
      const next = arc.reverse ? e.from : e.to;
      if (!nodes.has(next)) { nodes.add(next); queue.push(next); }
    }
  }
  return { nodes, edges };
}

/** Metres per street label (route.ts label) over the given edges, longest first. */
function metresByStreet(g: Graph, edges: Iterable<number>): { street: string; m: number }[] {
  const m = new Map<string, number>();
  for (const i of edges) m.set(label(g.edges[i].way), (m.get(label(g.edges[i].way)) ?? 0) + g.edges[i].lengthM);
  return [...m].map(([street, metres]) => ({ street, m: Math.round(metres) })).sort((a, b) => b.m - a.m || byCodeUnit(a.street, b.street));
}

/** The class of a rideable edge on the generous grading: stressful or calm, and whether its grade rests on a traffic figure. */
function calmKind(e: Edge): CalmKind {
  // Graded by the Furth table on a class default: no traffic figure behind the grade.
  const noFigure = furthTableRule(String(e.way["@lts_rule"])) !== undefined && e.way.adt_source === CLASS_DEFAULT_SOURCE;
  if (e.lts > LOW_STRESS_MAX_LTS) return noFigure ? CALM_KINDS.layout : CALM_KINDS.busy;
  return noFigure ? CALM_KINDS.unknown : CALM_KINDS.calm;
}

/** Metres per class over the given edges. */
function metresByKind(g: Graph, edges: Iterable<number>): Record<CalmKind, number> {
  const m = Object.fromEntries(Object.values(CALM_KINDS).map((k) => [k, 0])) as Record<CalmKind, number>;
  for (const i of edges) m[calmKind(g.edges[i])] += g.edges[i].lengthM;
  return m;
}

async function calmMap(frame: Bounds): Promise<CalmMapData> {
  const ways = await generousWays();
  const g = buildGraph(ways);
  const patches: Patch[] = Object.keys(POINTS).map((end) => {
    const s = snap(g, POINTS[end], LOW_STRESS_MAX_LTS);
    const { nodes, edges } = calmReach(g, s.node);
    const borders = g.edges.flatMap((e, i) => (e.lts >= HIGH_STRESS_MIN_LTS && (nodes.has(e.from) || nodes.has(e.to)) ? [i] : []));
    return {
      end, startNode: s.node, snapM: Math.round(s.distM), nodes, edges,
      band: fc([...edges].map((i): Feature => ({ type: "Feature", geometry: line(g.edges[i].coords), properties: { end } }))),
      metres: metresByKind(g, edges), streets: metresByStreet(g, edges), borders: metresByStreet(g, borders),
      borderLayoutM: metresByKind(g, borders)[CALM_KINDS.layout],
    };
  });
  const [a, b] = patches;
  const sharedNodes = [...a.nodes].filter((n) => b.nodes.has(n)).length;
  const measuredOnly = (e: Edge) => isCalm(e) || calmKind(e) === CALM_KINDS.layout;
  const [wideA, wideB] = patches.map((x) => calmReach(g, x.startNode, measuredOnly).nodes);
  const sharedIfLayoutPassable = [...wideA].filter((n) => wideB.has(n)).length;
  let gap = { m: Infinity, from: [0, 0] as LonLat, to: [0, 0] as LonLat };
  for (const na of a.nodes) {
    const pa = g.nodeCoord.get(na)!;
    for (const nb of b.nodes) {
      const pb = g.nodeCoord.get(nb)!;
      const m = haversineM(pa, pb);
      if (m < gap.m) gap = { m: Math.round(m), from: pa, to: pb };
    }
  }
  const features: Feature[] = [
    ...ways.filter((w) => w.properties["@lts"] === LTS_MIN && inBox(w.geometry.coordinates, BBOX))
      .map((w): Feature => ({ type: "Feature", geometry: line(w.geometry.coordinates), properties: { kind: CALM_KINDS.none } })),
    ...g.edges.filter((e) => inBox(e.coords, BBOX))
      .map((e): Feature => ({ type: "Feature", geometry: line(e.coords), properties: { kind: calmKind(e), lts: e.lts, name: e.way.name ?? null } })),
  ];
  const frameMetres = metresByKind(g, g.edges.flatMap((e, i) => (inBox(e.coords, frame) ? [i] : [])));
  // The connectivity of the ways drawn must agree with the robustness run's columns.
  const computed = lowStressConnectivity(ways);
  const row = parseCsv(await Bun.file(ROBUSTNESS_CSV).text()).find((r) => r.name === GENEROUS_CHECK && r.table === modeName(GENEROUS_MODE));
  if (!row) throw new Error(`${relative(ROOT, ROBUSTNESS_CSV)}: no ${GENEROUS_CHECK} row for ${modeName(GENEROUS_MODE)}`);
  const connected = Object.fromEntries(Object.keys(TRIPS).map((trip) => {
    const col = connectedCol(trip);
    if (computed[col] !== row[col]) throw new Error(`${GENEROUS_CHECK} ${trip}: ${col} ${computed[col]} on the ways drawn, ${row[col]} in the robustness run`);
    return [trip, computed[col] === CONNECTED];
  }));
  // Major recognisable barrier streets inside the stress-map frame, spanning north, south and central barriers.
  const stressAnchors = new Set([
    "Wigmore Street", "Mortimer Street", OXFORD_STREET, "Park Lane", "Regent Street", "Brook Street", "Great Marlborough Street",
  ]);
  const anchorPieces = g.edges
    .filter((e) => typeof e.way.name === "string" && stressAnchors.has(e.way.name) && e.lts >= HIGH_STRESS_MIN_LTS && inBox(e.coords, frame))
    .map((e) => ({ street: e.way.name as string, coords: e.coords }));
  return {
    ways: fc(features), patches, frameMetres, sharedNodes, sharedIfLayoutPassable, gap, connected,
    wall: fc(streetLabels(anchorPieces)),
  };
}

// ---------------------------------------------------------------------------
// Options chart: what a calm route would take, main reading
// ---------------------------------------------------------------------------

/** The run that lets bicycles back through the pedestrianised Oxford Street (two-way tracks allowed), main reading, today. */
const REOPEN_RUN = { allowOxford: true, contraflow: true } as const;
export interface OptionsData {
  /** Union converted metres of the reopening run, from runs.csv, and its split: on Oxford Street (zone and open ends) and on other streets, from the run's own GeoJSON. */
  reopen: { totalM: number; oxfordM: number; otherM: number; csv: string; geojson: string };
}

async function optionsData(): Promise<OptionsData> {
  const mode = VOLUME_MODES[MAIN_READING];
  const rows = parseCsv(await Bun.file(RUNS_CSV).text()).filter((r) => r.table === modeName(mode) && r.scenario === SCENARIO_TODAY &&
    r.allow_oxford === String(REOPEN_RUN.allowOxford) && r.contraflow === String(REOPEN_RUN.contraflow));
  if (rows.length !== 1) throw new Error(`${relative(ROOT, RUNS_CSV)}: ${rows.length} rows for the reopening run, expected 1`);
  const totalM = Number(rows[0].union_converted_m);
  const geojson = gapClosingGeojson(bestEvidenceDir(mode, SCENARIO_TODAY), REOPEN_RUN.allowOxford, REOPEN_RUN.contraflow);
  const union = ((await Bun.file(geojson).json()) as FC).features.filter((f) => f.properties.solution === UNION_SOLUTION);
  const metres = (fs: Feature[]) => fs.reduce((sum, f) => sum + (f.properties.length_m as number), 0);
  const allM = metres(union);
  // runs.csv rounds the union to the metre; the run's features must add up to it.
  if (Math.abs(allM - totalM) > ROUNDING_SLACK_M) throw new Error(`reopening run: features add up to ${allM} m, runs.csv says ${totalM} m`);
  const oxfordM = metres(union.filter((f) => f.properties.street === OXFORD_STREET));
  return { reopen: { totalM, oxfordM, otherM: allM - oxfordM, csv: relative(ROOT, RUNS_CSV), geojson: relative(ROOT, geojson) } };
}

// ---------------------------------------------------------------------------
// Evidence map: where the traffic figure behind each street to convert comes from
// ---------------------------------------------------------------------------

/** How firm a stretch's traffic figure is, firmest first: counted (on the street or carried along its road), TfL's model, none. */
export const FIRMNESS = ["counted", "model", "none"] as const;
export type Firmness = (typeof FIRMNESS)[number];
const FIRMNESS_OF: Record<string, Firmness> = { count: "counted", road: "counted", laei: "model", "class-default": "none" };
export interface EvidenceData {
  /** Per side: the converted edges with their firmness, and the metres per firmness. */
  sides: Record<Side, { converted: FC; metres: Record<Firmness, number> }>;
}

function evidenceData(fix: Record<Side, FixData>, ways: WayFeature[]): EvidenceData {
  const source = new Map(ways.map((w) => [w.properties["@id"], String(w.properties.adt_source)]));
  return {
    sides: Object.fromEntries(SIDES.map((side) => {
      const features = fix[side].converted.features.map((f): Feature => {
        const firmness = FIRMNESS_OF[source.get(f.properties.way_id as number) ?? ""];
        if (!firmness) throw new Error(`evidence: way ${f.properties.way_id} has adt_source ${source.get(f.properties.way_id as number)}`);
        return { ...f, properties: { ...f.properties, firmness } };
      });
      const metres = Object.fromEntries(FIRMNESS.map((k) => [k, features.filter((f) => f.properties.firmness === k)
        .reduce((sum, f) => sum + (f.properties.length_m as number), 0)])) as Record<Firmness, number>;
      return [side, { converted: fc(features), metres }];
    })) as EvidenceData["sides"],
  };
}

// ---------------------------------------------------------------------------
// Long trip: two routes SpokePlan returned for a longer ride across the West End
// (inputs/spokeplan-routes/README.md), named from the study's OSM ways where the
// extract covers them, and the confident route's overlap with the southern route's
// streets to convert
// ---------------------------------------------------------------------------

/** The saved routes: SpokePlan's own output, not regenerated here. */
const SPOKEPLAN_ROUTES = join(ROOT, "inputs", "spokeplan-routes");
/** SpokePlan's Road preset and its City preset (inputs/spokeplan-routes/README.md). */
export const LONG_TRIP_RIDERS = ["road", "city"] as const;
export type LongTripRider = (typeof LONG_TRIP_RIDERS)[number];
const longTripFile = (rider: LongTripRider) => join(SPOKEPLAN_ROUTES, `hammersmith-russell-square-${rider}.geojson`);
/** The route is walked in steps of this many metres to name its streets and find its overlap. */
const LONG_TRIP_STEP_M = 5;
/** A step is named after the nearest study way within this distance; farther (or outside the extract's bbox) it is unnamed. */
const STREET_MATCH_M = 15;
/** Name of a stretch the extract does not cover or no way lies close to. */
export const UNNAMED_STRETCH = "";
/**
 * A step runs along a converted street when a converted edge lies within this distance
 * and runs within this angle of the step (either way along it), so crossing one does not count.
 */
const OVERLAP_MAX_M = 8;
const OVERLAP_MAX_ANGLE_DEG = 30;
const DEG_PER_HALF_TURN = 180;

interface LongTripRoute {
  rider: LongTripRider;
  line: FC;
  /** The planner's own distance (metres, the file's `distance`) and the length measured here. */
  plannerM: number;
  measuredM: number;
  /** Consecutive stretches by street name in travel order (UNNAMED_STRETCH where unnamed), with a label point on the longest stretch of each name. */
  stretches: { street: string; m: number }[];
  labels: FC;
}
interface LongTripData {
  routes: Record<LongTripRider, LongTripRoute>;
  start: LonLat;
  finish: LonLat;
  /** The southern route's converted edges the Road route runs along, and the metres it runs along them per street. */
  overlap: { converted: FC; metres: { street: string; m: number }[]; totalM: number };
}

/** Bearing of a to b in a local projection, degrees, folded to 0..180 (a street runs both ways). */
function axisDeg(a: LonLat, b: LonLat): number {
  const kx = Math.cos((a[1] * Math.PI) / DEG_PER_HALF_TURN);
  const deg = (Math.atan2(b[1] - a[1], (b[0] - a[0]) * kx) * DEG_PER_HALF_TURN) / Math.PI;
  return ((deg % DEG_PER_HALF_TURN) + DEG_PER_HALF_TURN) % DEG_PER_HALF_TURN;
}
const axisDiff = (x: number, y: number) => { const d = Math.abs(x - y); return Math.min(d, DEG_PER_HALF_TURN - d); };

/** The route walked in LONG_TRIP_STEP_M steps: each step's midpoint, length and axis. */
function steps(coords: LonLat[]): { at: LonLat; m: number; axis: number }[] {
  const out: { at: LonLat; m: number; axis: number }[] = [];
  for (let i = 1; i < coords.length; i++) {
    const [a, b] = [coords[i - 1], coords[i]];
    const len = haversineM(a, b);
    const n = Math.max(1, Math.ceil(len / LONG_TRIP_STEP_M));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      out.push({ at: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], m: len / n, axis: axisDeg(a, b) });
    }
  }
  return out;
}

async function longTrip(ways: WayFeature[], southern: FC): Promise<LongTripData> {
  // The study ways as segments in a coarse grid, for naming the steps.
  const CELL_DEG = 0.001;
  const cell = ([lon, lat]: LonLat) => `${Math.floor(lon / CELL_DEG)},${Math.floor(lat / CELL_DEG)}`;
  const grid = new Map<string, { seg: LonLat[]; name: string }[]>();
  for (const w of ways) {
    const name = typeof w.properties.name === "string" ? w.properties.name : UNNAMED_STRETCH;
    const c = w.geometry.coordinates;
    for (let i = 1; i < c.length; i++) {
      const item = { seg: [c[i - 1], c[i]], name };
      for (const k of new Set([cell(c[i - 1]), cell(c[i])])) (grid.get(k) ?? grid.set(k, []).get(k)!).push(item);
    }
  }
  const nameAt = (p: LonLat): string => {
    if (!inBox([p], BBOX)) return UNNAMED_STRETCH;
    const [gx, gy] = [Math.floor(p[0] / CELL_DEG), Math.floor(p[1] / CELL_DEG)];
    let best = { d: STREET_MATCH_M, name: UNNAMED_STRETCH };
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const s of grid.get(`${gx + i},${gy + j}`) ?? []) {
        const d = pointToLineM(p, s.seg);
        if (d < best.d) best = { d, name: s.name };
      }
    }
    return best.name;
  };
  const routes = {} as Record<LongTripRider, LongTripRoute>;
  const coordsOf = {} as Record<LongTripRider, LonLat[]>;
  for (const rider of LONG_TRIP_RIDERS) {
    const f = (await Bun.file(longTripFile(rider)).json()) as { geometry: { coordinates: number[][] }; properties: { distance: number } };
    // Coordinates are lon, lat, elevation; the map needs lon, lat.
    const coords = f.geometry.coordinates.map(([lon, lat]): LonLat => [lon, lat]);
    coordsOf[rider] = coords;
    const stretches: { street: string; m: number; at: LonLat[] }[] = [];
    for (const s of steps(coords)) {
      const street = nameAt(s.at);
      const last = stretches.at(-1);
      if (last && last.street === street) { last.m += s.m; last.at.push(s.at); } else stretches.push({ street, m: s.m, at: [s.at] });
    }
    const longest = new Map<string, LonLat[]>();
    for (const x of stretches) if (x.street !== UNNAMED_STRETCH && x.at.length > (longest.get(x.street)?.length ?? 0)) longest.set(x.street, x.at);
    routes[rider] = {
      rider, plannerM: f.properties.distance,
      measuredM: coords.slice(1).reduce((sum, c, i) => sum + haversineM(coords[i], c), 0),
      line: fc([{ type: "Feature", geometry: line(coords), properties: { rider } }]),
      stretches: stretches.map(({ street, m }) => ({ street, m })),
      labels: fc([...longest].map(([street, at]) => ({ type: "Feature", geometry: point(at[Math.floor(at.length / 2)]), properties: { street, short: shortName(street), metres: at.length * LONG_TRIP_STEP_M } }))),
    };
  }
  // Overlap: the Road route's steps that run along one of the southern route's converted edges.
  const edges = southern.features.map((f, i) => ({ i, coords: f.geometry.coordinates as LonLat[], street: f.properties.street as string }));
  const used = new Set<number>();
  const metres = new Map<string, number>();
  for (const s of steps(coordsOf.road)) {
    const hit = edges.find((e) => e.coords.slice(1).some((c, k) => pointToLineM(s.at, [e.coords[k], c]) <= OVERLAP_MAX_M &&
      axisDiff(axisDeg(e.coords[k], c), s.axis) <= OVERLAP_MAX_ANGLE_DEG));
    if (!hit) continue;
    used.add(hit.i);
    metres.set(hit.street, (metres.get(hit.street) ?? 0) + s.m);
  }
  const coords = coordsOf.road;
  return {
    routes, start: coords[0], finish: coords.at(-1)!,
    overlap: {
      converted: fc(southern.features.filter((_, i) => used.has(i))),
      metres: [...metres].map(([street, m]) => ({ street, m })).sort((a, b) => b.m - a.m),
      totalM: [...metres.values()].reduce((a, b) => a + b, 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Everything, written to data/figures/
// ---------------------------------------------------------------------------

export interface FigureData {
  extractDate: string;
  pedZone: FC;
  frequency: FrequencyData;
  lts: Record<Volume, FC>;
  /** Per reading and trip: a low-stress path as the streets stand. */
  connected: Record<Volume, Record<string, boolean>>;
  counts: CountData;
  calm: CalmMapData;
  options: OptionsData;
  evidence: EvidenceData;
  longTrip: LongTripData;
  routes: RouteData[];
  fix: Record<Volume, Record<Side, FixData>>;
}

export async function prepareFigureData(): Promise<FigureData> {
  const ways = { low: await bestEvidenceWays(SCENARIO_TODAY, VOLUME_MODES.low), high: await bestEvidenceWays(SCENARIO_TODAY, VOLUME_MODES.high) };
  const sideRows = parseCsv(await Bun.file(SIDE_CSV).text());
  const fix = {} as Record<Volume, Record<Side, FixData>>;
  for (const v of VOLUMES) {
    fix[v] = {} as Record<Side, FixData>;
    for (const s of SIDES) fix[v][s] = await sideFix(v, s, ways[v], sideRow(sideRows, v, s));
  }
  const data: FigureData = {
    extractDate: await extractDate(),
    pedZone: pedestrianZone(ways.low),
    frequency: await frequency(ways.low, FREQUENCY_FRAME),
    lts: { low: ltsWays(ways.low), high: ltsWays(ways.high) },
    connected: { low: await connectivity("low", ways.low), high: await connectivity("high", ways.high) },
    counts: await countPoints(ways),
    calm: await calmMap(CALM_FRAME),
    options: await optionsData(),
    evidence: evidenceData(fix[MAIN_READING], ways[MAIN_READING]),
    longTrip: await longTrip(ways[MAIN_READING], fix[MAIN_READING]["south-only"].converted),
    routes: await Promise.all(Object.keys(TRIPS).map(routes)),
    fix,
  };
  await mkdir(FIGURES_DATA, { recursive: true });
  const layers: Record<string, FC> = {
    "ped-zone": data.pedZone,
    "fix-frequency-ways": data.frequency.ways,
    "fix-frequency-labels": data.frequency.labels,
    "stress-map-low": data.lts.low,
    "stress-map-high": data.lts.high,
    "stress-map-countpoints": data.counts.points,
    "stress-map-calm-ways": data.calm.ways,
    "stress-map-calm-wall": data.calm.wall,
    ...Object.fromEntries(LONG_TRIP_RIDERS.map((r) => [`long-trip-${r}`, data.longTrip.routes[r].line])),
    "long-trip-overlap": data.longTrip.overlap.converted,
    ...Object.fromEntries(data.calm.patches.map((x) => [`stress-map-calm-patch-${x.end}`, x.band])),
    ...Object.fromEntries(SIDES.map((s) => [`evidence-${s}`, data.evidence.sides[s].converted])),
    ...Object.fromEntries(data.routes.flatMap((r) => [[`routes-${r.trip}`, r.routes], [`routes-${r.trip}-labels`, r.confidentLabels]])),
    ...Object.fromEntries(VOLUMES.flatMap((v) => SIDES.flatMap((s) => [
      [`fix-${v}-${s}-converted`, data.fix[v][s].converted],
      [`fix-${v}-${s}-labels`, data.fix[v][s].labels],
      [`fix-${v}-${s}-route`, data.fix[v][s].route],
    ]))),
  };
  for (const [name, layer] of Object.entries(layers)) await writeFile(join(FIGURES_DATA, `${name}.geojson`), JSON.stringify(layer));
  return data;
}

/** Console summary of the prepared data (also printed by render.ts). */
export function describe(d: FigureData): string {
  const f = d.frequency;
  const y = d.counts.years;
  const out = [
    `OSM extract ${d.extractDate}; pedestrianised Oxford Street: ${d.pedZone.features[0]?.properties.ways ?? 0} ways in ${d.pedZone.features.length} chained lines`,
    `fix-frequency: ${f.runs.length} best-evidence gap-closing runs (${UNION_SOLUTION}), max per way ${f.maxWayCount}`,
    ...f.streets.slice(0, TOP_STREETS_REPORTED).map((s, i) => `  ${i + 1}. ${s.street}: ${s.count} of ${f.runs.length}`),
    `  Oxford Street: ${f.oxford.pedestrianised} of its ${f.oxford.count} convert the pedestrianised stretch; labels: ${f.labels.features.map((l) => l.properties.street).join(", ")}`,
    `stress-map: ${d.lts.low.features.length} ways per panel; low-stress connected ${VOLUMES.map((v) => `${v} ${JSON.stringify(d.connected[v])}`).join(", ")}; ` +
      `${d.counts.points.features.length} count points used: ` +
      COUNT_SOURCES.map((s) => `${s} ${y[s].points} (${y[s].minYear}-${y[s].maxYear}, ${y[s].stale} before ${d.counts.staleBefore}, ${y[s].estimated} estimated)`).join(", "),
    `stress-map calm (${GENEROUS_CHECK}): connected ${JSON.stringify(d.calm.connected)}, ${d.calm.sharedNodes} nodes in both patches (${d.calm.sharedIfLayoutPassable} with lane-only streets passable), closest ${d.calm.gap.m} m apart ` +
      `(${d.calm.gap.from.map((c) => c.toFixed(5)).join(",")} to ${d.calm.gap.to.map((c) => c.toFixed(5)).join(",")}); wall: ${d.calm.wall.features.map((l) => `${l.properties.street} ${l.properties.metres as number}`).join(", ")}`,
    `  in the frame, km: ${MEASURED_KINDS.map((k) => `${k} ${(d.calm.frameMetres[k] / M_PER_KM).toFixed(2)}`).join(", ")}`,
    ...d.calm.patches.map((p) => `  patch ${p.end}: ${MEASURED_KINDS.map((k) => `${k} ${(p.metres[k] / M_PER_KM).toFixed(2)} km`).join(", ")}, ` +
      `${p.edges.size} edges, start snapped ${p.snapM} m, border stressful by lanes only ${Math.round(p.borderLayoutM)} m; ` +
      `streets ${p.streets.slice(0, PATCH_STREETS_REPORTED).map((x) => `${x.street} ${x.m}`).join(", ")}; ` +
      `bounded by ${p.borders.slice(0, PATCH_STREETS_REPORTED).map((x) => `${x.street} ${x.m}`).join(", ")}`),
    `options: reopening run ${d.options.reopen.totalM} m (${d.options.reopen.csv}), Oxford Street ${d.options.reopen.oxfordM.toFixed(1)} m, other streets ${d.options.reopen.otherM.toFixed(1)} m (${d.options.reopen.geojson})`,
    ...SIDES.map((side) => `evidence ${side}: ${FIRMNESS.map((k) => `${k} ${d.evidence.sides[side].metres[k].toFixed(1)} m`).join(", ")}`),
    ...LONG_TRIP_RIDERS.map((r) => { const x = d.longTrip.routes[r]; return `long-trip ${r}: planner ${x.plannerM} m, measured ${x.measuredM.toFixed(0)} m; ` +
      x.stretches.filter((t) => t.m >= LONG_TRIP_REPORT_MIN_M).map((t) => `${t.street || "(not named)"} ${Math.round(t.m)}`).join(" > "); }),
    `long-trip overlap with the southern route's streets to convert: ${Math.round(d.longTrip.overlap.totalM)} m: ${d.longTrip.overlap.metres.map((x) => `${x.street} ${Math.round(x.m)}`).join(", ")}`,
    ...d.routes.map((r) => `routes ${r.trip}: ${ROUTE_KINDS.map((k) => `${k} ${r.distanceM[k]} m`).join(", ")}; ` +
      `confident labels: ${r.confidentLabels.features.map((l) => `${l.properties.street} ${l.properties.metres as number} m`).join(", ")}`),
    ...VOLUMES.flatMap((v) => SIDES.map((s) => {
      const x = d.fix[v][s];
      const trips = Object.keys(x.pathM).map((t) => `${t} path ${Math.round(x.pathM[t])} m <= budget ${Math.round(x.budgetM[t])} m`);
      return `fix ${v} ${s}: union ${x.unionM} m, ${x.converted.features.length} edges, streets ${x.labels.features.map((l) => l.properties.street).join(", ")}; ${trips.join(", ")}`;
    })),
  ];
  return out.join("\n");
}

if (import.meta.main) console.log(describe(await prepareFigureData()));
