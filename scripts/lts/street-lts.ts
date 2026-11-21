// Sanity check: LTS assigned to the corridor streets, one row per
// (scenario, street, LTS) with total metres. Pavements (footway=sidewalk) carry
// the street name too and are left out. For the furth2017 tables, `adt` gives the
// ADT range (vehicles/day, before the one-way factor) and `adt_source` the metres
// per volume source (count / road / class-default; docs/lts.md, section 4c).
// Writes results/lts/<mode>/street-lts.csv.
// Usage: bun scripts/lts/street-lts.ts [--table <table>] [--speed-col 25|lt20]
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_MODE, MODE_USAGE, byCodeUnit, classifiedPath, haversineM, modeName, parseMode, resultsDir, type LtsMode, type WayFeature } from "./common";

// Corridor bbox (lon/lat degrees), tighter than the routing bbox so that
// same-named streets elsewhere (e.g. Brook Street, Bayswater) are not counted.
const CORRIDOR = { minLon: -0.165, maxLon: -0.125, minLat: 51.508, maxLat: 51.522 };
const STREETS = [
  "Wigmore Street", "Mortimer Street", "Brook Street", "New Cavendish Street", "Great Marlborough Street",
  "George Street", "North Row", "Seymour Street", "Oxford Street", "Charlotte Street",
];
// Oxford Street sections by longitude: the pedestrianised part runs from
// Orchard Street to just east of Oxford Circus. Under the closure scenarios the
// west and east sections are closed too, so every corridor street is listed for
// them (the rows other than Oxford Street should match today's). These label edges
// test a way's midpoint; they are not OXFORD_PED_WINDOW (scripts/lts/common.ts), which
// tests every vertex, and switching to it would move ways between the labelled sections.
const OXFORD_CLOSED_WEST_LON = -0.1538;
const OXFORD_CLOSED_EAST_LON = -0.1407;
const CLOSURE_SCENARIOS = new Set(["full-closure", "full-closure-sealed"]);
const SCENARIO_STREETS: Record<string, string[]> = {
  today: STREETS,
  "wigmore-track": ["Wigmore Street"],
  ...Object.fromEntries([...CLOSURE_SCENARIOS].map((s) => [s, STREETS])),
};
const NOT_RIDEABLE_LABEL = "X";

function streetLabel(name: string, midLon: number, scenario: string): string {
  if (name !== "Oxford Street") return name;
  const state = CLOSURE_SCENARIOS.has(scenario) ? "closed" : "open";
  if (midLon < OXFORD_CLOSED_WEST_LON) return `Oxford Street west (${state})`;
  if (midLon > OXFORD_CLOSED_EAST_LON) return `Oxford Street east (${state})`;
  return "Oxford Street (pedestrianised)";
}

interface Group {
  m: number;
  ways: number;
  rules: Set<string>;
  highways: Set<string>;
  adts: number[];
  sourceM: Map<string, number>;
}

/** "a" or "a-b" over the distinct ADT values; empty when the table has no volumes. */
function adtRange(adts: number[]): string {
  if (adts.length === 0) return "";
  const lo = Math.min(...adts), hi = Math.max(...adts);
  return lo === hi ? String(lo) : `${lo}-${hi}`;
}

export async function streetLts(mode: LtsMode = DEFAULT_MODE) {
  const table = modeName(mode);
  const rows = ["table,scenario,street,lts,metres,ways,rules,highway,adt,adt_source"];
  for (const [scenario, streets] of Object.entries(SCENARIO_STREETS)) {
    const fc = (await Bun.file(classifiedPath(scenario, mode)).json()) as { features: WayFeature[] };
    const groups = new Map<string, Group>();
    for (const f of fc.features) {
      const p = f.properties;
      if (!streets.includes(p.name as string) || p.footway === "sidewalk") continue;
      const c = f.geometry.coordinates;
      const mid = c[Math.floor(c.length / 2)];
      if (mid[0] < CORRIDOR.minLon || mid[0] > CORRIDOR.maxLon || mid[1] < CORRIDOR.minLat || mid[1] > CORRIDOR.maxLat) continue;
      let m = 0;
      for (let i = 1; i < c.length; i++) m += haversineM(c[i - 1], c[i]);
      const lts = p["@lts"] === 0 ? NOT_RIDEABLE_LABEL : String(p["@lts"]);
      const key = `${streetLabel(p.name as string, mid[0], scenario)}\t${lts}`;
      const g: Group = groups.get(key) ?? { m: 0, ways: 0, rules: new Set(), highways: new Set(), adts: [], sourceM: new Map() };
      g.m += m;
      g.ways++;
      g.rules.add(p["@lts_rule"] as string);
      g.highways.add(p.highway as string);
      if (typeof p.adt === "number") {
        g.adts.push(p.adt);
        const source = String(p.adt_source);
        g.sourceM.set(source, (g.sourceM.get(source) ?? 0) + m);
      }
      groups.set(key, g);
    }
    // Locale-independent order, so the table is the same on every machine.
    for (const [key, g] of [...groups].sort(([a], [b]) => byCodeUnit(a, b))) {
      const [street, lts] = key.split("\t");
      const sources = [...g.sourceM].sort().map(([s, m]) => `${s}:${Math.round(m)}`).join(" ");
      rows.push([
        table, scenario, street, lts, Math.round(g.m), g.ways, [...g.rules].sort().join(" "), [...g.highways].sort().join(" "),
        adtRange(g.adts), sources,
      ].join(","));
    }
  }
  const dir = resultsDir(mode);
  await mkdir(dir, { recursive: true });
  const out = join(dir, "street-lts.csv");
  await writeFile(out, rows.join("\n") + "\n");
  console.log(rows.join("\n"));
  console.log(`-> ${out}`);
}

if (import.meta.main) {
  await streetLts(parseMode(process.argv, `bun scripts/lts/street-lts.ts ${MODE_USAGE}`));
}
