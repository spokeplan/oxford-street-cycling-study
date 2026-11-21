// Checks of the LAEI flows matched to OSM ways (results/laei/ways-matched.csv,
// scripts/laei/match-links.ts), reported in docs/lts.md ("Best-evidence run"):
//   dft-comparison.csv        every matched way that also carries a DfT count (the
//                             count scripts/lts/volume.ts would use: latest year, then
//                             closest snap), with the LAEI / count ratio
//   published-comparison.csv  the same against the published counts
//                             (results/published-counts/counts-matched.csv), with the
//                             count's hours and year; a 12- or 16-hour count leaves out
//                             the night, so there the ratio runs high
//   comparison-summary.csv    per count source and class group (MINOR_CLASSES, the
//                             rest major, all): ways, median ratio, ways within each FACTORS
//   streets.csv               the matched flow per street name, length-weighted over
//                             its matched ways, with the lowest and highest way and link flow
//   minor-high-flow.csv       residential, unclassified, service and living-street ways
//                             matched to a flow above MINOR_HIGH_ADT: candidates for a
//                             false match, checked by hand
//   outliers.csv              matched ways whose flow differs by more than OUTLIER_FACTOR
//                             from the length-weighted flow of the other matched ways of
//                             their name: mostly short pieces at junctions, where a link
//                             can carry a single turning movement
// All under results/laei/.
// Usage: bun scripts/laei/validate.ts   (after match-links.ts, scripts/dft/match-countpoints.ts and scripts/published-counts/match.ts)
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MATCHED_CSV, YES, groupBy, parseCsv, supersedes, toCsv } from "../dft/common";
import { byCodeUnit } from "../lts/common";
import { PUBLISHED_MATCHED_CSV } from "../published-counts/common";
import { LAEI_RESULTS, LAEI_WAYS_CSV } from "./common";

// Ratio bands of the comparisons (a factor either way).
const FACTORS = [1.5, 2];
const RATIO_DECIMALS = 3;
// Class groups of the comparisons: minor streets (by base class, _link removed) and the rest.
const MINOR_CLASSES = new Set(["residential", "unclassified", "tertiary", "living_street", "service"]);
const MINOR = "minor", MAJOR = "major", ALL = "all";
const classGroup = (highway: string) => (MINOR_CLASSES.has(highway.replace(/_link$/, "")) ? MINOR : MAJOR);
// False-match candidates: these classes above this flow (vehicles per day).
const FALSE_MATCH_CLASSES = new Set(["residential", "unclassified", "service", "living_street"]);
const MINOR_HIGH_ADT = 10000;
// A way's flow this many times above or below the rest of its street's.
const OUTLIER_FACTOR = 3;

type Row = Record<string, string>;
const matched = parseCsv(await Bun.file(LAEI_WAYS_CSV).text()).filter((r) => r.matched === YES);

/** Per way id, the count volume.ts would use from these rows (latest year, then closest snap). */
function countsByWay(rows: Row[]): Map<number, Row> {
  const out = new Map<number, Row>();
  const key = (r: Row) => ({ year: Number(r.year), distM: Number(r.distance_m) });
  for (const r of rows) {
    const prev = out.get(Number(r.way_id));
    if (supersedes(key(r), prev && key(prev))) out.set(Number(r.way_id), r);
  }
  return out;
}

/** Matched ways with a count in `counts`, with the LAEI / count ratio and the count's own columns. */
function compare(counts: Map<number, Row>, columns: (c: Row) => Record<string, string>) {
  return matched.flatMap((w) => {
    const c = counts.get(Number(w.way_id));
    if (!c) return [];
    const { count_adt, ...rest } = columns(c);
    return [{
      way_id: w.way_id, name: w.name, ref: w.ref, highway: w.highway, class_group: classGroup(w.highway), oneway: w.oneway, way_m: w.way_m,
      ...rest, count_adt, laei_adt: w.adt, ratio: (Number(w.adt) / Number(count_adt)).toFixed(RATIO_DECIMALS),
    }];
  });
}

const dft = compare(countsByWay(parseCsv(await Bun.file(MATCHED_CSV).text()).filter((r) => r.matched === YES)), (c) => ({
  count_id: c.count_point_id, hours: "", year: c.year, estimation_method: c.estimation_method, count_adt: c.all_motor_vehicles,
}));
const published = compare(countsByWay(parseCsv(await Bun.file(PUBLISHED_MATCHED_CSV).text())), (c) => ({
  count_id: c.id, hours: c.hours, year: c.year, estimation_method: c.method, count_adt: c.all_motor_vehicles,
}));
await writeFile(join(LAEI_RESULTS, "dft-comparison.csv"), toCsv(Object.keys(dft[0]), dft));
await writeFile(join(LAEI_RESULTS, "published-comparison.csv"), toCsv(Object.keys(published[0]), published));

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const summary = ([["dft", dft], ["published", published]] as const).flatMap(([source, rows]) =>
  [ALL, MINOR, MAJOR].map((group) => {
    const ratios = rows.filter((r) => group === ALL || r.class_group === group).map((r) => Number(r.ratio));
    return {
      source, class_group: group, ways: ratios.length, median_ratio: ratios.length ? median(ratios).toFixed(RATIO_DECIMALS) : "",
      ...Object.fromEntries(FACTORS.map((k) => [`within_factor_${k}`, ratios.filter((r) => r >= 1 / k && r <= k).length])),
    };
  }));
await writeFile(join(LAEI_RESULTS, "comparison-summary.csv"), toCsv(Object.keys(summary[0]), summary));
for (const s of summary) console.log(`LAEI / ${s.source} counts, ${s.class_group}: ${s.ways} ways, median ${s.median_ratio}`);

// Matched flow per street name.
const byName = [...groupBy(matched.filter((w) => w.name), (w) => w.name)].sort(([a], [b]) => byCodeUnit(a, b));
const weighted = (ws: Row[]) => ws.reduce((s, w) => s + Number(w.adt) * Number(w.way_m), 0) / ws.reduce((s, w) => s + Number(w.way_m), 0);
const streets = byName.map(([name, ws]) => {
  const nums = (k: string) => ws.map((w) => Number(w[k]));
  return {
    street: name, ways: ws.length, matched_m: ws.reduce((s, w) => s + Number(w.way_m), 0), adt_length_weighted: Math.round(weighted(ws)),
    way_adt_min: Math.min(...nums("adt")), way_adt_max: Math.max(...nums("adt")),
    link_flow_min: Math.min(...nums("flow_min")), link_flow_max: Math.max(...nums("flow_max")),
  };
});
await writeFile(join(LAEI_RESULTS, "streets.csv"), toCsv(Object.keys(streets[0]), streets));

// False-match candidates and outliers.
const minorHigh = matched.filter((w) => FALSE_MATCH_CLASSES.has(w.highway) && Number(w.adt) > MINOR_HIGH_ADT);
await writeFile(join(LAEI_RESULTS, "minor-high-flow.csv"), toCsv(Object.keys(matched[0]), minorHigh));
const outliers = byName.flatMap(([, ws]) => ws.flatMap((w) => {
  const rest = ws.filter((o) => o !== w);
  if (rest.length === 0) return [];
  const street = weighted(rest);
  const factor = Number(w.adt) / street;
  return factor > OUTLIER_FACTOR || factor < 1 / OUTLIER_FACTOR ? [{ ...w, street_adt: Math.round(street), factor: factor.toFixed(RATIO_DECIMALS) }] : [];
}));
await writeFile(join(LAEI_RESULTS, "outliers.csv"), toCsv(Object.keys(outliers[0] ?? { ...matched[0], street_adt: "", factor: "" }), outliers));
console.log(`${streets.length} streets with a matched flow; ${minorHigh.length} minor ways above ${MINOR_HIGH_ADT}; ` +
  `${outliers.length} ways off their street's flow by more than a factor of ${OUTLIER_FACTOR} -> ${LAEI_RESULTS}`);
