// Sensitivity runs of the gap-closing analysis (docs/lts.md, "Sensitivity runs").
// Each one changes the grading of the headline furth2017 tables in one respect,
// then reruns, unchanged, the low-stress connectivity test (route.ts) and the
// gap-closing search (gap-closing.ts) on the regraded ways:
//   uk-ltn120                  - ways graded by the Furth mixed-traffic table are
//                                regraded by the UK limit for cycling in mixed traffic
//   back-streets-750           - uncounted back streets carry BACK_STREET_FLOOR_ADT
//   uncounted-zero             - every class-default volume is UNCOUNTED_ADT (lower bound)
//   great-chapel-traffic-free  - Great Chapel Street closed to motor traffic (LTS 1)
//   best-evidence              - volumes from every count and model flow available
//                                (published counts, LAEI 2022), class defaults only
//                                where none is, and Great Chapel Street traffic-free
// Summary rows: two-way tracks allowed, pedestrianised Oxford Street not rideable
// (HEADLINE_RUN), scenario today unless the sensitivity lists more. They are not
// part of results/lts/gap-closing-summary.csv.
// Writes results/lts/sensitivity-summary.csv, the runs' gap-closing files under
// results/lts/sensitivity/<name>/<table>/<scenario>/, and for the runs over all 32
// headline variants (great-chapel-traffic-free, best-evidence)
// results/lts/sensitivity/<name>/frequency.csv. scripts/lts/best-evidence.ts adds
// the best-evidence run's own tables.
// Usage: bun scripts/lts/sensitivity.ts   (after the main runs: bun scripts/lts/run-all.ts)
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { toCsv } from "../dft/common";
import { NOT_RIDEABLE, classifyWays, speedLimitMph, type Lts } from "./classify";
import {
  LTS_RESULTS, POINTS, SCENARIOS, TRIPS, byCodeUnit, classifiedPath, isFurthTable, modeName, resultsDir, tripPrefix, waysPath,
  type FurthTable, type LtsMode, type WayFeature,
} from "./common";
import {
  CROSSING_FRAGMENT, GAP_RESULT_FIELDS, GAP_VARIANTS, HEADLINE_GAP_MODES, HEADLINE_RUN, UNION_SOLUTION,
  gapClosingGeojson, solveGapClosing, type GapResult,
} from "./gap-closing";
import { buildGraph, connectivity, csvField } from "./route";
import { sideUnions } from "./sides";
import { CLASS_DEFAULTS, wayVolumes, type VolumeOptions } from "./volume";

export const SENSITIVITY_RESULTS = join(LTS_RESULTS, "sensitivity");
export const SCENARIO_TODAY = "today";

// --- uk-ltn120 ---------------------------------------------------------------
// Department for Transport, Local Transport Note 1/20 "Cycle Infrastructure Design"
// (2020), paragraph 7.1.1 and Figure 4.1
// (https://assets.publishing.service.gov.uk/media/5ffa1f96d3bf7f65d9e35825/cycle-infrastructure-design-ltn-1-20.pdf):
// "Most people ... will not feel comfortable on-carriageways with more than 2,500
// vehicles per day and speeds of more than 20 mph. These values should be regarded
// as desirable upper limits for inclusive cycling within the carriageway."
const LTN120_MAX_ADT = 2500; // vehicles/day, both directions (the guidance's flow has no one-way factor)
const LTN120_MAX_MPH = 20;
// Within both limits: suitable for most people, LTS 2; otherwise LTS 3.
const LTN120_WITHIN_LTS: Lts = 2;
const LTN120_OVER_LTS: Lts = 3;
// Ways graded by a row of the Furth 2017 mixed-traffic table (classify.ts): rule
// "f17/<row>/...", also behind the painted-lane prefix "f17-blocked-lane+". A painted
// lane that the mixed-traffic block grades by an earlier row (e.g. f17-blocked-lane+m13,
// a pedestrian street with bicycle permission) and every other way keep their grade.
const FURTH_TABLE_RULE = "f17/";
const BLOCKED_LANE_PREFIX = "f17-blocked-lane+";
/** The Furth-table rule ("f17/<row>/<band>/<col>") a way was graded by, painted-lane prefix removed; undefined for any other rule. */
export function furthTableRule(rule: string): string | undefined {
  const r = rule.startsWith(BLOCKED_LANE_PREFIX) ? rule.slice(BLOCKED_LANE_PREFIX.length) : rule;
  return r.startsWith(FURTH_TABLE_RULE) ? r : undefined;
}
const gradedByFurthTable = (rule: string) => furthTableRule(rule) !== undefined;

export const LTN120_DESCRIPTION = `ways graded by the Furth mixed-traffic table regraded by LTN 1/20 para 7.1.1: LTS ${LTN120_WITHIN_LTS} when ADT <= ${LTN120_MAX_ADT} and limit <= ${LTN120_MAX_MPH} mph, else LTS ${LTN120_OVER_LTS}`;

/** Furth-table ways regraded by motor flow and speed limit alone (no one-way factor, no lane rows). */
export function ltn120(ways: WayFeature[]): WayFeature[] {
  return ways.map((f) => {
    const p = f.properties;
    if (!gradedByFurthTable(String(p["@lts_rule"]))) return f;
    if (typeof p.adt !== "number") throw new Error(`way ${p["@id"]}: graded by the Furth table without an adt`);
    const within = p.adt <= LTN120_MAX_ADT && speedLimitMph(p) <= LTN120_MAX_MPH;
    return {
      ...f,
      properties: { ...p, "@lts": within ? LTN120_WITHIN_LTS : LTN120_OVER_LTS, "@lts_rule": within ? "ltn120/within-limits" : "ltn120/over-limits" },
    };
  });
}

// --- back-streets-750 --------------------------------------------------------
// Class-default volume (vehicles/day) for uncounted back streets, the top of the
// Furth 2017 table's lowest ADT band. Reason: the one Soho back street with a DfT
// count, D'Arblay Street (count point 942336), carries about 400 a day, and four of
// the seven minor-road count points matched to unclassified ways in the study bbox
// carry under 1,000 (results/dft/countpoints-matched.csv). Tertiary and above keep
// the table's low or high default.
export const BACK_STREET_FLOOR_ADT = 750;
export const BACK_STREET_CLASSES = ["residential", "living_street", "service", "unclassified"];

/** The mode's furth2017 table; throws for any other table. */
function furthTable(mode: LtsMode): FurthTable {
  if (!isFurthTable(mode.table)) throw new Error(`${mode.table}: not a furth2017 table`);
  return mode.table;
}

/** The scenario's ways graded by the mode's furth2017 table with these volume options. */
async function gradedWays(scenario: string, mode: LtsMode, options: VolumeOptions): Promise<WayFeature[]> {
  const table = furthTable(mode);
  const ways = ((await Bun.file(waysPath(scenario)).json()) as { features: WayFeature[] }).features;
  await classifyWays(ways, mode, await wayVolumes(ways, table, options));
  return ways;
}

/** The table's class defaults with the back-street classes lowered to the floor. */
export const backStreetDefaults = (table: FurthTable) =>
  ({ ...CLASS_DEFAULTS[table], ...Object.fromEntries(BACK_STREET_CLASSES.map((c) => [c, BACK_STREET_FLOOR_ADT])) });

/** The scenario's ways graded by the table with the back-street class defaults lowered to the floor. */
const backStreets750 = (scenario: string, mode: LtsMode) => gradedWays(scenario, mode, { classDefaults: backStreetDefaults(furthTable(mode)) });

// --- uncounted-zero ----------------------------------------------------------
// The lower bound of the analysis: every way whose volume is a class default (no
// count on it or carried along its road) carries no motor traffic, of every highway
// class; counts and the road rule are unchanged. What the counted streets alone do.
// The low and high tables differ only in their class defaults, so with all of them
// at zero the two gradings are identical by construction (checked in uncountedZero).
export const UNCOUNTED_ADT = 0;
/** Every class default of the table at UNCOUNTED_ADT. */
export const zeroDefaults = (table: FurthTable) => Object.fromEntries(Object.keys(CLASS_DEFAULTS[table]).map((c) => [c, UNCOUNTED_ADT]));
/** Grading of each check and scenario under the first table run, to check the other table against. */
const firstTableGrading = new Map<string, string>();

/** Returns the ways; throws unless they grade exactly as the other table's ways did for the same check and scenario. */
export function checkTablesAgree(check: string, scenario: string, table: string, ways: WayFeature[]): WayFeature[] {
  const grading = JSON.stringify(ways.map((f) => [f.properties["@id"], f.properties["@lts"], f.properties["@lts_rule"], f.properties.adt ?? null]));
  const key = `${check} ${scenario}`;
  const first = firstTableGrading.get(key);
  if (first === undefined) firstTableGrading.set(key, grading);
  else if (first !== grading) throw new Error(`${key}: ${table} grades differently from the other furth2017 table`);
  return ways;
}

/** The scenario's ways graded by the table with every class default at UNCOUNTED_ADT; throws unless both tables agree. */
const uncountedZero = async (scenario: string, mode: LtsMode) =>
  checkTablesAgree("uncounted-zero", scenario, mode.table, await gradedWays(scenario, mode, { classDefaults: zeroDefaults(furthTable(mode)) }));

// --- great-chapel-traffic-free -----------------------------------------------
// Great Chapel Street, Soho: its four OSM ways (the whole street in the extract).
// Westminster City Council's project page "Great Chapel Street - Pedestrianisation"
// (https://www.westminstertransportationservices.co.uk/projects/project_details.php?id=627,
// read 2026-11-14) says the street "was pedestrianised as part of measures
// introduced during the Covid-19 pandemic" and "has operated successfully as a
// traffic-free space"; works to make it permanent are on site from 7 September to
// 4 December 2026. OpenStreetMap carried motor_vehicle=no on all four ways until
// changeset 181301075 of 14 April 2026 removed the tag without a source, so the
// extract grades it as a street open to traffic. It has no count.
const GREAT_CHAPEL_STREET = "Great Chapel Street";
const GREAT_CHAPEL_STREET_WAY_IDS: readonly number[] = [33096425, 1414470432, 628701125, 1245985425];
// Graded as rule m17 grades motor_vehicle=no (docs/lts.md, section 4).
const TRAFFIC_FREE_LTS: Lts = 1;
const SIDEWALK = "sidewalk";

/** The ways with Great Chapel Street at LTS 1; throws unless the ids are exactly the street's rideable ways. */
export function greatChapelTrafficFree(ways: WayFeature[]): WayFeature[] {
  const street = ways.filter((f) => f.properties.name === GREAT_CHAPEL_STREET && f.properties.footway !== SIDEWALK && f.properties["@lts"] !== NOT_RIDEABLE);
  const ids = street.map((f) => f.properties["@id"]).sort();
  if (ids.join() !== [...GREAT_CHAPEL_STREET_WAY_IDS].sort().join()) {
    throw new Error(`${GREAT_CHAPEL_STREET}: rideable ways ${ids.join(" ")}, expected ${GREAT_CHAPEL_STREET_WAY_IDS.join(" ")}`);
  }
  return ways.map((f) => (GREAT_CHAPEL_STREET_WAY_IDS.includes(f.properties["@id"])
    ? { ...f, properties: { ...f.properties, "@lts": TRAFFIC_FREE_LTS, "@lts_rule": "sens/motor-traffic-free" } }
    : f));
}

// --- best-evidence -----------------------------------------------------------
// Replaces the class-default guess with evidence wherever there is any: published
// counts join the DfT counts (and are carried along their road like them), then
// the LAEI 2022 modelled flow, and only the ways left take the table's low or high
// class default (scripts/lts/volume.ts, bestEvidence). Great Chapel Street is
// graded traffic-free on top (see great-chapel-traffic-free).
export const BEST_EVIDENCE = "best-evidence";

/**
 * The scenario's ways graded by the table with best-evidence volumes, Great Chapel
 * Street at LTS 1. `options` vary the volumes for the robustness checks (scripts/lts/robustness.ts).
 */
export async function bestEvidenceWays(scenario: string, mode: LtsMode, options: Omit<VolumeOptions, "bestEvidence"> = {}): Promise<WayFeature[]> {
  return greatChapelTrafficFree(await gradedWays(scenario, mode, { ...options, bestEvidence: true }));
}

// -----------------------------------------------------------------------------

interface Sensitivity {
  name: string;
  description: string;
  scenarios: string[];
  /** Every headline variant (GAP_VARIANTS) instead of HEADLINE_RUN only, and a frequency table. */
  allVariants: boolean;
  /** Both side-constrained unions as further union candidates (scripts/lts/sides.ts), best-evidence only. */
  sideUnions?: boolean;
  /** Also write <name>/runs.csv: every run's per-direction minima, union and the union candidate that won (union_method). */
  runsTable?: boolean;
  /** The regraded ways of one scenario, given the table's classified ways (left untouched). */
  regrade: (classified: WayFeature[], scenario: string, mode: LtsMode) => Promise<WayFeature[]>;
}

const SENSITIVITIES: Sensitivity[] = [
  {
    name: "uk-ltn120",
    description: LTN120_DESCRIPTION,
    scenarios: [SCENARIO_TODAY],
    allVariants: false,
    regrade: async (classified) => ltn120(classified),
  },
  {
    name: "back-streets-750",
    description: `class-default ADT of ${BACK_STREET_CLASSES.join(", ")} ways set to ${BACK_STREET_FLOOR_ADT}; tertiary and above keep the table's default`,
    scenarios: [SCENARIO_TODAY],
    allVariants: false,
    regrade: async (_classified, scenario, mode) => backStreets750(scenario, mode),
  },
  {
    name: "uncounted-zero",
    description: `class-default ADT of every highway class set to ${UNCOUNTED_ADT} (counts and the road rule unchanged): the lower bound; low and high tables identical by construction`,
    scenarios: [SCENARIO_TODAY],
    allVariants: false,
    regrade: async (_classified, scenario, mode) => uncountedZero(scenario, mode),
  },
  {
    name: "great-chapel-traffic-free",
    description: `${GREAT_CHAPEL_STREET} (ways ${GREAT_CHAPEL_STREET_WAY_IDS.join(" ")}) closed to motor traffic: LTS ${TRAFFIC_FREE_LTS}`,
    scenarios: Object.keys(SCENARIOS),
    allVariants: true,
    regrade: async (classified) => greatChapelTrafficFree(classified),
  },
  {
    name: BEST_EVIDENCE,
    description: `volume sources count (DfT and published), road, laei (LAEI 2022 modelled flow), class-default (the table's); ${GREAT_CHAPEL_STREET} closed to motor traffic: LTS ${TRAFFIC_FREE_LTS}`,
    scenarios: Object.keys(SCENARIOS),
    allVariants: true,
    sideUnions: true,
    runsTable: true,
    regrade: async (_classified, scenario, mode) => bestEvidenceWays(scenario, mode),
  },
];

/** Result columns of runs.csv (runsTable). */
const RUNS_FIELDS = [
  "ab_min_converted_m", "ba_min_converted_m", "union_converted_m", "union_links_m", "union_crossings_m", "union_method", "union_streets",
] as const;

const SUMMARY_HEADER = [
  "name", "table", "scenario", "allow_oxford", "contraflow", "description", "ways_regraded",
  ...Object.keys(TRIPS).flatMap((trip) => [`${tripPrefix(trip)}_l2_m`, `${tripPrefix(trip)}_connected_lowstress`]),
  ...GAP_RESULT_FIELDS,
];

/** Ways whose LTS differs between the two gradings (matched by way id). */
export function regradedCount(before: WayFeature[], after: WayFeature[]): number {
  const lts = new Map(before.map((f) => [f.properties["@id"], f.properties["@lts"]]));
  return after.filter((f) => lts.get(f.properties["@id"]) !== f.properties["@lts"]).length;
}

/** Per trip, the low-stress path length and the connectivity verdict (route.ts, connectivity), as summary columns. */
export function lowStressConnectivity(ways: WayFeature[]): Record<string, string> {
  const g = buildGraph(ways);
  return Object.fromEntries(Object.entries(TRIPS).flatMap(([trip, [from, to]]) => {
    const c = connectivity(g, POINTS[from], POINTS[to]);
    return [[`${tripPrefix(trip)}_l2_m`, c.l2_m], [`${tripPrefix(trip)}_connected_lowstress`, c.connected_lowstress]];
  }));
}

/** Streets a run converts in its both-directions set: its union features minus crossings (the fix-frequency rule of scripts/figures/data.ts). */
async function unionStreets(geojson: string): Promise<Set<string>> {
  const { features } = (await Bun.file(geojson).json()) as { features: { properties: Record<string, unknown> }[] };
  return new Set(features.filter((f) => f.properties.solution === UNION_SOLUTION && f.properties.fragment !== CROSSING_FRAGMENT)
    .map((f) => f.properties.street as string));
}

/** Per street: in how many runs' both-directions sets it appears, main runs against this sensitivity's. */
async function frequencyCsv(runs: { main: string; sensitivity: string }[]): Promise<string> {
  const counts = new Map<string, { main: number; sensitivity: number }>();
  const count = (street: string, key: "main" | "sensitivity") => {
    const c = counts.get(street) ?? { main: 0, sensitivity: 0 };
    c[key]++;
    counts.set(street, c);
  };
  for (const run of runs) {
    for (const s of await unionStreets(run.main)) count(s, "main");
    for (const s of await unionStreets(run.sensitivity)) count(s, "sensitivity");
  }
  const rows = [...counts].sort(([a, x], [b, y]) => y.main - x.main || y.sensitivity - x.sensitivity || byCodeUnit(a, b))
    .map(([street, c]) => [street, c.main, c.sensitivity, runs.length].map(csvField).join(","));
  return ["street,main_runs,sensitivity_runs,runs", ...rows].join("\n") + "\n";
}

export async function sensitivityAll() {
  const rows: string[] = [SUMMARY_HEADER.join(",")];
  for (const s of SENSITIVITIES) {
    const frequencyRuns: { main: string; sensitivity: string }[] = [];
    const runRows: Record<string, string | number>[] = [];
    for (const mode of HEADLINE_GAP_MODES) {
      const table = modeName(mode);
      for (const scenario of s.scenarios) {
        const classified = ((await Bun.file(classifiedPath(scenario, mode)).json()) as { features: WayFeature[] }).features;
        const ways = await s.regrade(classified, scenario, mode);
        const regraded = regradedCount(classified, ways);
        const conn = lowStressConnectivity(ways);
        console.log(`${s.name} ${scenario} [${table}]: ${regraded} ways regraded; low-stress connected ${JSON.stringify(conn)}`);
        const outDir = join(SENSITIVITY_RESULTS, s.name, table, scenario);
        for (const { allowOxford, contraflow } of s.allVariants ? GAP_VARIANTS : [HEADLINE_RUN]) {
          const result: GapResult = await solveGapClosing({
            scenario, table: `${s.name}/${table}`, ways, allowOxford, contraflow, outDir, constrainedUnions: s.sideUnions ? sideUnions(ways) : undefined,
          });
          runRows.push({
            table, scenario, allow_oxford: String(allowOxford), contraflow: String(contraflow),
            ...Object.fromEntries(RUNS_FIELDS.map((k) => [k, result[k]])),
          });
          frequencyRuns.push({
            main: gapClosingGeojson(resultsDir(mode, scenario), allowOxford, contraflow),
            sensitivity: gapClosingGeojson(outDir, allowOxford, contraflow),
          });
          if (allowOxford !== HEADLINE_RUN.allowOxford || contraflow !== HEADLINE_RUN.contraflow) continue;
          const row: Record<string, string | number> = {
            name: s.name, table, scenario, allow_oxford: String(allowOxford), contraflow: String(contraflow),
            description: s.description, ways_regraded: regraded, ...conn, ...result,
          };
          rows.push(SUMMARY_HEADER.map((h) => csvField(row[h])).join(","));
        }
      }
    }
    if (s.runsTable) {
      const out = join(SENSITIVITY_RESULTS, s.name, "runs.csv");
      await writeFile(out, toCsv(Object.keys(runRows[0]), runRows));
      console.log(`${s.name}: ${runRows.length} runs -> ${out}`);
    }
    if (s.allVariants) {
      const out = join(SENSITIVITY_RESULTS, s.name, "frequency.csv");
      await writeFile(out, await frequencyCsv(frequencyRuns));
      console.log(`${s.name}: street frequency over ${frequencyRuns.length} runs -> ${out}`);
    }
  }
  await mkdir(LTS_RESULTS, { recursive: true });
  const out = join(LTS_RESULTS, "sensitivity-summary.csv");
  await writeFile(out, rows.join("\n") + "\n");
  console.log(`-> ${out}`);
}

if (import.meta.main) await sensitivityAll();
