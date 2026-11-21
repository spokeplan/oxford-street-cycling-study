// Matches the published traffic counts (inputs/published-counts/counts.csv) to OSM
// ways of the `today` scenario (data/lts/today-ways.geojson, re-extracted first, as
// scripts/dft/match-countpoints.ts does) for the best-evidence run.
// Rule: the nearest motor road within MATCH_RADIUS_M of the point whose OSM name
// equals the count's `street` (case and surrounding spaces ignored); failing that,
// the nearest such way of a class in NAMED_ONLY_HIGHWAYS. Name agreement is
// required: unlike a DfT point, a published count names its street and nothing
// else, so the nearest road of another name is never taken. A point with no such
// way, a duplicate id, or a count, period, year or carriageway that is not valid
// stops the script with every offending row listed.
// The count is used as published, like a DfT street total: all_motor_vehicles is
// the whole carriageway (`carriageway` says whether the street is one-way or two-way
// at the site) over `hours` (12, 16 or 24), not expanded to a day, so a 12- or
// 16-hour count is a lower bound of the day.
// Writes results/published-counts/counts-matched.csv (the input columns plus the
// matched way, its distance, the other ways of that name within the radius and a
// note when the way is no longer a motor road).
// Usage: bun scripts/published-counts/match.ts [<counts.csv>]   (default inputs/published-counts/counts.csv)
import { mkdir, writeFile } from "node:fs/promises";
import { MATCH_RADIUS_M, MOTOR_HIGHWAYS, groupBy, parseCsv, toCsv } from "../dft/common";
import { pointToLineM, waysPath, type LonLat, type WayFeature } from "../lts/common";
import { extractGraph } from "../lts/extract-graph";
import { COUNT_HOURS, PUBLISHED_COLUMNS, PUBLISHED_COUNTS_CSV, PUBLISHED_MATCHED_CSV, PUBLISHED_RESULTS } from "./common";

const SCENARIO = "today";
const DISTANCE_DECIMALS = 1;
// Classes accepted when no motor road of the name is near: a street closed to motor
// traffic since the count (the west side of Gordon Square is highway=pedestrian).
// The count then grades nothing: such ways stop at the permission rules or m13
// before the volume table, and the road rule does not carry counts from them.
const NAMED_ONLY_HIGHWAYS = new Set(["pedestrian", "busway"]);
const CARRIAGEWAYS = ["one-way", "two-way"];
const normalise = (s: unknown) => String(s ?? "").trim().toLowerCase();

const input = process.argv[2] ?? PUBLISHED_COUNTS_CSV;
const rows = parseCsv(await Bun.file(input).text());
const missing = PUBLISHED_COLUMNS.filter((c) => rows.length > 0 && !(c in rows[0]));
if (rows.length === 0 || missing.length > 0) throw new Error(`${input}: no rows, or columns missing: ${missing.join(" ")}`);

await extractGraph(SCENARIO);
const ways = ((await Bun.file(waysPath(SCENARIO)).json()) as { features: WayFeature[] }).features
  .filter((f) => MOTOR_HIGHWAYS.has(String(f.properties.highway)) || NAMED_ONLY_HIGHWAYS.has(String(f.properties.highway)));
const isMotor = (f: WayFeature) => MOTOR_HIGHWAYS.has(String(f.properties.highway));

const errors: string[] = [];
for (const [id, dup] of groupBy(rows, (r) => r.id)) if (dup.length > 1) errors.push(`${id}: id used ${dup.length} times`);
const out: Record<string, string>[] = [];
for (const r of rows) {
  const at: LonLat = [Number(r.lon), Number(r.lat)];
  const bad = [
    ...(r.id.trim() === "" ? ["empty id"] : []),
    ...(at.every(Number.isFinite) && r.lon !== "" && r.lat !== "" ? [] : [`lon/lat "${r.lon}", "${r.lat}"`]),
    ...(r.all_motor_vehicles !== "" && Number(r.all_motor_vehicles) >= 0 ? [] : [`all_motor_vehicles "${r.all_motor_vehicles}"`]),
    ...((COUNT_HOURS as readonly number[]).includes(Number(r.hours)) ? [] : [`hours "${r.hours}" (allowed ${COUNT_HOURS.join(", ")})`]),
    ...(Number.isInteger(Number(r.year)) && r.year !== "" ? [] : [`year "${r.year}"`]),
    ...(CARRIAGEWAYS.includes(r.carriageway) ? [] : [`carriageway "${r.carriageway}" (allowed ${CARRIAGEWAYS.join(", ")})`]),
  ];
  if (bad.length > 0) {
    errors.push(`${r.id} (${r.street}): ${bad.join(", ")}`);
    continue;
  }
  const named = ways
    .filter((f) => normalise(f.properties.name) === normalise(r.street))
    .map((f) => ({ f, d: pointToLineM(at, f.geometry.coordinates) }))
    .filter((c) => c.d <= MATCH_RADIUS_M)
    .sort((a, b) => a.d - b.d || a.f.properties["@id"] - b.f.properties["@id"]);
  const hit = named.find((c) => isMotor(c.f)) ?? named[0];
  if (!hit) {
    errors.push(`${r.id} (${r.street} at ${r.lon},${r.lat}): no way named "${r.street}" within ${MATCH_RADIUS_M} m`);
    continue;
  }
  const others = named.filter((c) => c !== hit);
  out.push({
    ...r,
    way_id: String(hit.f.properties["@id"]), way_name: String(hit.f.properties.name), way_highway: String(hit.f.properties.highway),
    way_ref: String(hit.f.properties.ref ?? ""), distance_m: hit.d.toFixed(DISTANCE_DECIMALS),
    other_same_name_ways: others.map((c) => `${c.f.properties["@id"]}@${c.d.toFixed(0)}m`).join(" "),
    match_note: isMotor(hit.f) ? "" : `no motor road of the name within ${MATCH_RADIUS_M} m: highway=${hit.f.properties.highway}, the count grades nothing`,
  });
}
if (errors.length > 0) throw new Error(`${input}: ${errors.length} point(s) not matched:\n  ${errors.join("\n  ")}`);

await mkdir(PUBLISHED_RESULTS, { recursive: true });
const columns = [...PUBLISHED_COLUMNS, "way_id", "way_name", "way_highway", "way_ref", "distance_m", "other_same_name_ways", "match_note"];
await writeFile(PUBLISHED_MATCHED_CSV, toCsv(columns, out));
const notMotor = out.filter((r) => r.match_note !== "").map((r) => r.id);
console.log(`${out.length} published counts matched to ${new Set(out.map((r) => r.way_id)).size} ways` +
  `${notMotor.length > 0 ? `, ${notMotor.length} of them to a way that is no longer a motor road (${notMotor.join(" ")})` : ""} -> ${PUBLISHED_MATCHED_CSV}`);
