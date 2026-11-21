// Validates the through-traffic measures (results/through/ways.csv, run.ts) as
// predictors of whether a minor street's motor flow is over or under its calm
// threshold, and applies them to the streets the best-evidence run still guesses.
// Changes no grading: it reads the best-evidence grading (scripts/lts/sensitivity.ts,
// bestEvidenceWays, scenario today, furth2017-low; a way with a count on it grades
// the same under either table).
//
// Validation set: every way of a minor class (MINOR_HIGHWAYS) whose volume is a
// count on the way itself (adt_source count: DfT or published, not carried), and
// whose grading row has a finite calm threshold (best-evidence.ts, calmThreshold:
// the highest ADT that still grades LTS 2, over 1.5 on a one-way way). Label: busy
// when the count, as it stands, is over the threshold.
// Predictors of "busy": the quiet and the busy class guess (scripts/lts/volume.ts),
// membership of the LAEI major-road network and its flow over the threshold, and
// the through measures: on a fastest path (and with at least k trips), within a
// detour tolerance of a fastest path (and with at least k trips), the least detour
// ratio under a threshold, structural; and "all busy", the base rate.
// A predictor with a free parameter is scored by leave-one-out: each way is
// predicted with the parameter that is most accurate on the others (ties: the
// first in grid order).
// Writes under results/through/: validation.csv (the set, labels, predictions),
// summary.csv (the set by class, one-way and LAEI membership: over and under),
// predictors.csv (confusion matrices, accuracy, both error rates), flows.csv
// (counted flows by predicted class and one-way), guess-split.csv (the streets
// on a class guess by each measure's classes) and side-routes.csv (the guessed
// streets of the four best-evidence side-comparison solutions, with their classes).
// Usage: bun scripts/through/validate.ts   (after run.ts, and the best-evidence and side-comparison runs)
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { YES, parseCsv, toCsv } from "../dft/common";
import { LAEI_WAYS_CSV } from "../laei/common";
import { calmThreshold, headlineUnion, openedRoutes } from "../lts/best-evidence";
import { isMotorOneway } from "../lts/classify";
import { DEFAULT_SPEED_COL, classifiedPath, haversineM, modeName, type LtsMode, type WayFeature } from "../lts/common";
import { HEADLINE_GAP_MODES } from "../lts/gap-closing";
import { BEST_EVIDENCE, SCENARIO_TODAY, SENSITIVITY_RESULTS, bestEvidenceWays, furthTableRule } from "../lts/sensitivity";
import { SIDES, forbiddenWays } from "../lts/sides";
import { CLASS_DEFAULTS } from "../lts/volume";
import { PUBLISHED_MATCHED_CSV } from "../published-counts/common";
import { MINOR_HIGHWAYS, THROUGH_RESULTS, THROUGH_WAYS_CSV } from "./common";
import { TOLERANCES } from "./measures";

const LOW: LtsMode = { table: "furth2017-low", speedCol: DEFAULT_SPEED_COL };
// Labels this close to the threshold (a factor either way) are counted as marginal.
const MARGINAL_FACTOR = 1.5;
// Grid of the trip-count threshold k (at least k through trips).
const K_GRID = [1, 2, 3, 5, 10, 20, 50, 100, 200, 500, 1000, 1500, 2000];
// Grid of the detour-ratio threshold: 1 to RATIO_GRID_MAX in steps of RATIO_GRID_STEP.
const RATIO_GRID_STEP = 0.005;
const RATIO_GRID_MAX = 1.1;
const RATIO_GRID = Array.from({ length: Math.round((RATIO_GRID_MAX - 1) / RATIO_GRID_STEP) + 1 }, (_, i) => (1 + i * RATIO_GRID_STEP).toFixed(3));
const BUSY = "busy", CALM = "calm";
const RATE_DECIMALS = 3;
const M_PER_KM = 1000;
const KM_DECIMALS = 2;
const NOT_DRIVABLE = "not drivable";

const through = new Map(parseCsv(await Bun.file(THROUGH_WAYS_CSV).text()).map((r) => [Number(r.way_id), r]));
const laei = new Map(parseCsv(await Bun.file(LAEI_WAYS_CSV).text()).filter((r) => r.matched === YES).map((r) => [Number(r.way_id), Number(r.adt)]));
const hoursOf = new Map(parseCsv(await Bun.file(PUBLISHED_MATCHED_CSV).text()).map((r) => [r.id, r.hours]));
const graded = await bestEvidenceWays(SCENARIO_TODAY, LOW);
const baseClass = (hw: string) => hw.replace(/_link$/, "");

// --- predictors: name, parameter grid, and the busy prediction per way for a parameter.
interface Predictor { name: string; grid: (string | number)[]; busy: (w: Record<string, unknown>, param: string | number) => boolean }
const tr = (w: Record<string, unknown>) => through.get(w["@id"] as number);
const num = (w: Record<string, unknown>, k: string) => Number(tr(w)?.[k] ?? 0);
const PREDICTORS: Predictor[] = [
  { name: "all busy", grid: [""], busy: () => true },
  { name: "quiet guess", grid: [""], busy: (w) => CLASS_DEFAULTS["furth2017-low"][baseClass(String(w.highway))] > Number(w.threshold) },
  { name: "busy guess", grid: [""], busy: (w) => CLASS_DEFAULTS["furth2017-high"][baseClass(String(w.highway))] > Number(w.threshold) },
  { name: "in LAEI network", grid: [""], busy: (w) => laei.has(w["@id"] as number) },
  { name: "LAEI flow over threshold", grid: [""], busy: (w) => (laei.get(w["@id"] as number) ?? 0) > Number(w.threshold) },
  { name: "on a fastest path", grid: [""], busy: (w) => num(w, "fastest_pairs") > 0 },
  { name: "on fastest paths of >= k trips", grid: K_GRID, busy: (w, k) => num(w, "fastest_pairs") >= Number(k) },
  ...TOLERANCES.map((t): Predictor => ({ name: `within ${t} of a fastest path`, grid: [""], busy: (w) => num(w, `near_pairs_${t}`) > 0 })),
  { name: "detour ratio <= r", grid: RATIO_GRID, busy: (w, r) => tr(w)?.detour_ratio !== "" && tr(w) !== undefined && num(w, "detour_ratio") <= Number(r) },
  {
    name: "within tolerance of a fastest path for >= k trips", grid: TOLERANCES.flatMap((t) => K_GRID.map((k) => `${t}:${k}`)),
    busy: (w, p) => {
      const [t, k] = String(p).split(":");
      return num(w, `near_pairs_${t}`) >= Number(k);
    },
  },
  { name: "structural", grid: [""], busy: (w) => tr(w)?.structural === YES || tr(w)?.structural === "main" },
];

// --- validation set.
/** A graded way's properties with the fields read here. */
type Counted = Record<string, unknown> & { "@id": number; adt: number; oneway: boolean };
type Labelled = Counted & { threshold: number; label: string };
const set = graded.flatMap((f): Labelled[] => {
  const p = f.properties;
  if (!MINOR_HIGHWAYS.has(String(p.highway)) || p.adt_source !== "count") return [];
  const threshold = calmThreshold(p);
  if (threshold === undefined || !Number.isFinite(threshold)) return [];
  return [{ ...p, adt: p.adt as number, threshold, label: (p.adt as number) > threshold ? BUSY : CALM, oneway: isMotorOneway(p) }];
});

interface Score { tp: number; fn: number; fp: number; tn: number }
const score = (pairs: { label: string; busy: boolean }[]): Score => {
  const s = { tp: 0, fn: 0, fp: 0, tn: 0 };
  for (const { label, busy } of pairs) {
    if (label === BUSY) busy ? s.tp++ : s.fn++;
    else busy ? s.fp++ : s.tn++;
  }
  return s;
};
const accuracy = (s: Score) => (s.tp + s.tn) / (s.tp + s.fn + s.fp + s.tn);
/** The grid value most accurate on these ways (first on a tie). */
const bestParam = (pr: Predictor, ways: typeof set) => pr.grid.reduce((best, p) => {
  const acc = (q: string | number) => accuracy(score(ways.map((w) => ({ label: w.label, busy: pr.busy(w, q) }))));
  return acc(p) > acc(best) ? p : best;
});
const rate = (a: number, b: number) => (a + b > 0 ? (a / (a + b)).toFixed(RATE_DECIMALS) : "");
const scoreRow = (predictor: string, parameter: string | number, evaluation: string, s: Score) => ({
  predictor, parameter, evaluation, ways: s.tp + s.fn + s.fp + s.tn, busy_called_busy: s.tp, busy_called_calm: s.fn, calm_called_busy: s.fp, calm_called_calm: s.tn,
  accuracy: accuracy(s).toFixed(RATE_DECIMALS), calm_called_busy_rate: rate(s.fp, s.tn), busy_called_calm_rate: rate(s.fn, s.tp),
});
const chosen = new Map<string, string | number>();
const predictorRows = PREDICTORS.flatMap((pr) => {
  const full = bestParam(pr, set);
  chosen.set(pr.name, full);
  const inSample = scoreRow(pr.name, full, pr.grid.length > 1 ? "in-sample (chosen on all)" : "fixed", score(set.map((w) => ({ label: w.label, busy: pr.busy(w, full) }))));
  if (pr.grid.length === 1) return [inSample];
  const loo = set.map((w, i) => ({ label: w.label, busy: pr.busy(w, bestParam(pr, set.filter((_, j) => j !== i))) }));
  return [inSample, scoreRow(pr.name, "per fold", "leave-one-out", score(loo))];
});
await writeFile(join(THROUGH_RESULTS, "predictors.csv"), toCsv(Object.keys(predictorRows[0]), predictorRows));

const validationRows = set.map((w) => ({
  way_id: w["@id"], name: w.name ?? "", highway: w.highway, oneway: w.oneway ? YES : "no", count_id: w.adt_count_point, count_year: w.adt_count_year,
  hours: hoursOf.get(String(w.adt_count_point)) ?? "DfT AADF", adt: w.adt, threshold: Math.round(w.threshold), label: w.label,
  marginal: (w.adt as number) <= w.threshold * MARGINAL_FACTOR && (w.adt as number) >= w.threshold / MARGINAL_FACTOR ? YES : "no",
  ...Object.fromEntries(PREDICTORS.map((pr) => [pr.name, pr.busy(w, chosen.get(pr.name)!) ? BUSY : CALM])),
}));
await writeFile(join(THROUGH_RESULTS, "validation.csv"), toCsv(Object.keys(validationRows[0]), validationRows));

// --- counted flows by predicted class: the validation set, and every counted way of any class.
const quartiles = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) => {
    const i = (s.length - 1) * q, lo = Math.floor(i);
    return Math.round(s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo));
  };
  return s.length ? { q1: at(0.25), median: at(0.5), q3: at(0.75) } : { q1: "", median: "", q3: "" };
};
const counted = graded.filter((f) => f.properties.adt_source === "count")
  .map((f): Counted => ({ ...f.properties, adt: f.properties.adt as number, oneway: isMotorOneway(f.properties) }));
const THROUGH_PREDICTORS = PREDICTORS.filter((pr) => !pr.name.includes("guess") && !pr.name.includes("LAEI") && pr.name !== "all busy");
const flowRows = ([["validation set", set], ["all counted ways", counted]] as const).flatMap(([group, ways]) =>
  THROUGH_PREDICTORS.flatMap((pr) => [BUSY, CALM].flatMap((cls) => [true, false].map((oneway) => {
    const flows = ways.filter((w) => w.oneway === oneway && (pr.busy(w, chosen.get(pr.name)!) ? BUSY : CALM) === cls).map((w) => w.adt as number);
    return { group, predictor: pr.name, parameter: chosen.get(pr.name)!, predicted: cls === BUSY ? "through" : "not through", oneway: oneway ? YES : "no", ways: flows.length, ...quartiles(flows) };
  }))));
await writeFile(join(THROUGH_RESULTS, "flows.csv"), toCsv(Object.keys(flowRows[0]), flowRows));

// --- applied: the streets the best-evidence run still guesses.
const lengthM = (f: WayFeature) => f.geometry.coordinates.slice(1).reduce((s, p, i) => s + haversineM(f.geometry.coordinates[i], p), 0);
const classOf = (pr: Predictor, w: Record<string, unknown>) => (tr(w)?.drivable !== YES ? NOT_DRIVABLE : pr.busy(w, chosen.get(pr.name)!) ? "through" : "not through");
// The ways the main run grades by the Furth table (as coverage.csv of best-evidence.ts) that still carry a guess.
const mainGraded = new Set(((await Bun.file(classifiedPath(SCENARIO_TODAY, LOW)).json()) as { features: WayFeature[] }).features
  .filter((f) => furthTableRule(String(f.properties["@lts_rule"]))).map((f) => f.properties["@id"]));
const guessed = graded.filter((f) => f.properties.adt_source === "class-default" && mainGraded.has(f.properties["@id"]));
const totalM = guessed.reduce((s, f) => s + lengthM(f), 0);
const splitRows = THROUGH_PREDICTORS.flatMap((pr) => ["through", "not through", NOT_DRIVABLE].map((cls) => {
  const m = guessed.filter((f) => classOf(pr, f.properties) === cls).reduce((s, f) => s + lengthM(f), 0);
  return { predictor: pr.name, parameter: chosen.get(pr.name)!, class: cls, km: (m / M_PER_KM).toFixed(KM_DECIMALS), share: (m / totalM).toFixed(RATE_DECIMALS) };
}));
await writeFile(join(THROUGH_RESULTS, "guess-split.csv"), toCsv(Object.keys(splitRows[0]), splitRows));

const sideRows: Record<string, unknown>[] = [];
for (const mode of HEADLINE_GAP_MODES) {
  const ways = await bestEvidenceWays(SCENARIO_TODAY, mode);
  const props = new Map(ways.map((f) => [f.properties["@id"], f.properties]));
  for (const side of SIDES) {
    const union = await headlineUnion(join(SENSITIVITY_RESULTS, "side-comparison", BEST_EVIDENCE, modeName(mode), side));
    const parts = new Map<string, number>([["converted", 0]]);
    const metres = new Map<string, number>();
    const add = (part: string, wayId: number, m: number) => metres.set(`${part}|${wayId}`, (metres.get(`${part}|${wayId}`) ?? 0) + m);
    for (const f of union) add("converted", f.properties.way_id as number, f.properties.length_m as number);
    for (const r of openedRoutes(ways, union, forbiddenWays(ways, side))) {
      parts.set(`route ${r.trip}`, 0);
      for (const { edge, converted } of r.edges) if (!converted) add(`route ${r.trip}`, edge.way["@id"], edge.lengthM);
    }
    for (const [key, m] of [...metres].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const [part, id] = key.split("|");
      const w = props.get(Number(id))!;
      if (w.adt_source !== "class-default") continue;
      sideRows.push({
        table: modeName(mode), side, part, way_id: id, street: w.name ?? `(${w.highway})`, metres: Math.round(m), highway: w.highway,
        oneway: isMotorOneway(w) ? YES : "no", guess_adt: w.adt, lts: w["@lts"],
        ...Object.fromEntries(THROUGH_PREDICTORS.map((pr) => [pr.name, classOf(pr, w)])),
      });
    }
  }
}
await writeFile(join(THROUGH_RESULTS, "side-routes.csv"), toCsv(Object.keys(sideRows[0]), sideRows));

// --- the validation set by group: how many ways are over and under their calm threshold.
const groups: [string, (w: Labelled) => boolean][] = [
  ["all", () => true],
  ...[...new Set(set.map((w) => baseClass(String(w.highway))))].sort().map((c): [string, (w: Labelled) => boolean] => [`class ${c}`, (w) => baseClass(String(w.highway)) === c]),
  ["one-way", (w) => w.oneway], ["two-way", (w) => !w.oneway],
  ["in the LAEI network", (w) => laei.has(w["@id"])], ["not in the LAEI network", (w) => !laei.has(w["@id"])],
];
const summaryRows = groups.map(([group, test]) => {
  const ws = set.filter(test);
  return { group, ways: ws.length, over_threshold: ws.filter((w) => w.label === BUSY).length, under_threshold: ws.filter((w) => w.label === CALM).length };
});
await writeFile(join(THROUGH_RESULTS, "summary.csv"), toCsv(Object.keys(summaryRows[0]), summaryRows));

const marginal = validationRows.filter((r) => r.marginal === YES).length;
console.log(`validation set ${set.length} ways (${set.filter((w) => w.label === BUSY).length} busy, ${marginal} within a factor of ${MARGINAL_FACTOR}); ` +
  `${(totalM / M_PER_KM).toFixed(1)} km on a guess -> ${THROUGH_RESULTS}`);
for (const r of predictorRows) console.log(`${r.predictor} [${r.evaluation}, ${r.parameter}]: accuracy ${r.accuracy}, calm called busy ${r.calm_called_busy_rate}, busy called calm ${r.busy_called_calm_rate}`);
