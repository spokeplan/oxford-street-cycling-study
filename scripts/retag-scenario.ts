// Builds a scenario extract from data/greater-london-latest.osm.pbf (the full
// extract, or the committed study-area cut after `download-extract.ts --from-inputs`;
// both give the same retagged ways) by retagging the ways of one street. Scenarios:
//   wigmore-track: every Wigmore Street way (highway=*, inside its bbox) gets
//     cycleway=track + cycleway:both=track, all other tags kept.
//   full-closure: this study's full-length closure assumption (Marble Arch to
//     Tottenham Court Road pedestrianised, no cycling; see docs/lts.md). Every still-rideable
//     Oxford Street carriageway way (see CARRIAGEWAY_HIGHWAYS; includes the
//     vehicle=no primary_link pieces at Oxford Circus) inside its bbox becomes
//     highway=pedestrian + bicycle=dismount + motor_vehicle=no, with its
//     oneway/lanes/cycleway/bus/psv and vehicle:conditional tags removed. Ways
//     already highway=pedestrian and the sidewalks (highway=footway) are left
//     untouched. Cross-streets stay open where they meet the street at shared nodes.
//   full-closure-sealed: sensitivity variant of full-closure that also retags,
//     the same way, the short unnamed median links that cross the closed
//     carriageway (SEALED_CROSSING_WAY_IDS, selected by id).
// Pipeline (osmium-tool in Docker):
//   tags-filter (ways + their nodes, small XML; plus getid for id-selected ways)
//   -> edit in Bun -> .osc (modify) -> osmium apply-changes original.pbf changes.osc
//   -> scenario.pbf
// Writes data/<output> and results/scenario-<scenario>.json.
// Usage: bun scripts/retag-scenario.ts [wigmore-track|full-closure|full-closure-sealed]  (default wigmore-track)
import { rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { OSMIUM_IMAGE, OXFORD_FULL_WINDOW, SEALED_CROSSING_WAY_IDS } from "./lts/common";

const ROOT = join(import.meta.dir, "..");
const DATA = join(ROOT, "data");
const SOURCE = "greater-london-latest.osm.pbf";
const DEFAULT_SCENARIO = "wigmore-track";

type Tags = Record<string, string>;
// lon/lat degrees, WGS84
interface Bbox { minLon: number; maxLon: number; minLat: number; maxLat: number }

interface Scenario {
  output: string; // file name inside data/
  selectionXml: string;
  changesOsc: string;
  streetName: string;
  bbox: Bbox; // a way is selected when any of its nodes lies inside
  /** Extra way filter on top of name + highway=* + bbox. */
  selects: (tags: Tags) => boolean;
  /** Ways selected by id regardless of name, filter and bbox (fetched with osmium getid). */
  extraWayIds?: readonly string[];
  newTags: Tags; // set, overwriting existing values
  /** Further keys removed from a selected way (keys in newTags are always replaced). */
  drops: (key: string) => boolean;
  /** Per-way entry of the results JSON. */
  wayRecord: (id: string, tags: Tags, lons: number[]) => Record<string, unknown>;
  /** "selector" entry of the results JSON. */
  selector: Record<string, unknown>;
  /** Extra top-level results JSON fields, written after new_tags. */
  extra?: Record<string, unknown>;
}

const WIGMORE_BBOX: Bbox = { minLon: -0.16, maxLon: -0.14, minLat: 51.512, maxLat: 51.52 };
// Marble Arch to Tottenham Court Road (OXFORD_FULL_WINDOW, shared with gap-closing's --allow-oxford).
const OXFORD_BBOX: Bbox = { ...OXFORD_FULL_WINDOW, minLat: 51.51, maxLat: 51.52 };
// Oxford Street full closure: carriageway highway values that are still
// rideable today (footway sidewalks and the existing pedestrian ways are not in
// the set). primary_link covers the vehicle=no pieces across Oxford Circus.
const CARRIAGEWAY_HIGHWAYS = ["primary", "primary_link", "secondary", "tertiary", "unclassified", "residential"];
// Keys removed together with their ":"-suffixed variants (e.g. oneway:bicycle,
// lanes:forward, bus:lanes, psv:lanes); every cycleway* key is removed too.
const DROPPED_KEY_ROOTS = ["oneway", "lanes", "bus", "psv"];
const DROPPED_KEY_PREFIX = "cycleway";
// Night-time vehicle access on the bus-only piece west of Orchard Street
// (vehicle:conditional=yes @ ...) would reopen the pedestrian way to cycling
// in conditional-aware routers; the full closure has no such window.
const DROPPED_KEYS_EXACT = ["vehicle:conditional"];

const fullClosure = (output: string, changesOsc: string, extraWayIds?: readonly string[]): Scenario => ({
  output,
  selectionXml: "oxford-street-ways.osm",
  changesOsc,
  streetName: "Oxford Street",
  bbox: OXFORD_BBOX,
  selects: (tags) => CARRIAGEWAY_HIGHWAYS.includes(tags.highway),
  extraWayIds,
  newTags: { highway: "pedestrian", bicycle: "dismount", motor_vehicle: "no" },
  drops: (k) =>
    k.startsWith(DROPPED_KEY_PREFIX) || DROPPED_KEYS_EXACT.includes(k) ||
    DROPPED_KEY_ROOTS.some((r) => k === r || k.startsWith(`${r}:`)),
  wayRecord: (id, tags, lons) => ({
    id,
    old_highway: tags.highway,
    min_lon: Math.min(...lons),
    max_lon: Math.max(...lons),
    old_tags: tags,
  }),
  selector: { name: "Oxford Street", highway: CARRIAGEWAY_HIGHWAYS, bbox: OXFORD_BBOX, ...(extraWayIds ? { way_ids: extraWayIds } : {}) },
  extra: { dropped_keys: [...DROPPED_KEY_ROOTS.map((r) => `${r}, ${r}:*`), `${DROPPED_KEY_PREFIX}*`, ...DROPPED_KEYS_EXACT] },
});

const SCENARIOS: Record<string, Scenario> = {
  "wigmore-track": {
    output: "greater-london-wigmore-track.osm.pbf",
    selectionXml: "wigmore-street-ways.osm",
    changesOsc: "wigmore-track.osc",
    streetName: "Wigmore Street",
    bbox: WIGMORE_BBOX,
    selects: () => true,
    newTags: { cycleway: "track", "cycleway:both": "track" },
    drops: () => false,
    wayRecord: (id, tags) => ({
      id,
      highway: tags.highway,
      old_cycleway_tags: Object.fromEntries(Object.entries(tags).filter(([k]) => k.startsWith("cycleway"))),
    }),
    selector: { name: "Wigmore Street", highway: "*", bbox: WIGMORE_BBOX },
  },
  "full-closure": fullClosure("greater-london-full-closure.osm.pbf", "full-closure.osc"),
  "full-closure-sealed": fullClosure(
    "greater-london-full-closure-sealed.osm.pbf", "full-closure-sealed.osc", SEALED_CROSSING_WAY_IDS.map(String)),
};

const scenarioName = process.argv[2] ?? DEFAULT_SCENARIO;
const sc = SCENARIOS[scenarioName];
if (!sc) {
  console.error(`Usage: bun scripts/retag-scenario.ts [${Object.keys(SCENARIOS).join("|")}]`);
  process.exit(1);
}

function osmium(...args: string[]): string {
  const cmd = ["docker", "run", "--rm", "-v", `${DATA}:/data`, OSMIUM_IMAGE, "osmium", ...args];
  console.log("$", cmd.join(" "));
  const p = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(p.stderr.toString());
  return p.stdout.toString();
}

const attr = (s: string, name: string) => s.match(new RegExp(` ${name}="([^"]*)"`))?.[1];
const xmlEscape = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const xmlUnescape = (s: string) =>
  s.replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&");
const TAG_LINE = /<tag k="([^"]*)" v="([^"]*)"\/>/;

// 1. The street's ways with their referenced nodes (for the bbox test).
osmium("tags-filter", `/data/${SOURCE}`, `w/name=${sc.streetName}`, "-f", "osm", "-o", `/data/${sc.selectionXml}`, "--overwrite");
let xml = await Bun.file(join(DATA, sc.selectionXml)).text();
// Id-selected ways (with their nodes, -r) appended to the same XML text for parsing.
const extraWayIds = new Set(sc.extraWayIds ?? []);
const extraXml = `${scenarioName}-extra-ways.osm`;
if (extraWayIds.size > 0) {
  osmium("getid", "-r", `/data/${SOURCE}`, ...[...extraWayIds].map((id) => `w${id}`), "-f", "osm", "-o", `/data/${extraXml}`, "--overwrite");
  xml += await Bun.file(join(DATA, extraXml)).text();
}

const nodes = new Map<string, { lon: number; lat: number }>();
for (const m of xml.matchAll(/<node\s[^>]*>/g)) {
  nodes.set(attr(m[0], "id")!, { lon: Number(attr(m[0], "lon")), lat: Number(attr(m[0], "lat")) });
}
const inBbox = ({ lon, lat }: { lon: number; lat: number }) =>
  lon >= sc.bbox.minLon && lon <= sc.bbox.maxLon && lat >= sc.bbox.minLat && lat <= sc.bbox.maxLat;

// osmium's XML writer emits one <way ...>...</way> block per way, one tag/nd per line.
const retagged: Record<string, unknown>[] = [];
const retaggedIds = new Set<string>();
const modified: string[] = [];
for (const m of xml.matchAll(/<way\s[^>]*>[\s\S]*?<\/way>/g)) {
  const block = m[0];
  const tags: Tags = Object.fromEntries(
    [...block.matchAll(new RegExp(TAG_LINE.source, "g"))].map((t) => [xmlUnescape(t[1]), xmlUnescape(t[2])]),
  );
  const id = attr(block, "id")!;
  const byId = extraWayIds.has(id);
  if (!byId && (tags.name !== sc.streetName || !tags.highway || !sc.selects(tags))) continue;
  const refs = [...block.matchAll(/<nd ref="(\d+)"\/>/g)].map((r) => r[1]);
  if (!byId && !refs.some((r) => nodes.has(r) && inBbox(nodes.get(r)!))) continue;
  if (retaggedIds.has(id)) continue;

  const lons = refs.filter((r) => nodes.has(r)).map((r) => nodes.get(r)!.lon);
  retagged.push(sc.wayRecord(id, tags, lons));
  retaggedIds.add(id);

  // Drop the tags we overwrite or remove, append the new ones, and bump the
  // version so apply-changes deterministically prefers the modified object.
  const version = Number(attr(block, "version") ?? 0);
  let edited = block
    .replace(/(<way\s[^>]*\sversion=")(\d+)"/, `$1${version + 1}"`)
    .split("\n")
    .filter((line) => {
      const k = line.match(TAG_LINE)?.[1];
      if (k === undefined) return true;
      const key = xmlUnescape(k);
      return !(key in sc.newTags) && !sc.drops(key);
    })
    .join("\n");
  const newTagLines = Object.entries(sc.newTags).map(([k, v]) => `    <tag k="${xmlEscape(k)}" v="${xmlEscape(v)}"/>`);
  edited = edited.replace(/\n\s*<\/way>$/, `\n${newTagLines.join("\n")}\n  </way>`);
  modified.push(edited);
}
if (retagged.length === 0) throw new Error("No ways matched; check the scenario's streetName / bbox / selects");
const missing = [...extraWayIds].filter((id) => !retaggedIds.has(id));
if (missing.length > 0) throw new Error(`Id-selected ways not found: ${missing.join(", ")}`);

const osc = `<?xml version="1.0" encoding="UTF-8"?>\n<osmChange version="0.6" generator="retag-scenario.ts">\n<modify>\n${modified.join("\n")}\n</modify>\n</osmChange>\n`;
await writeFile(join(DATA, sc.changesOsc), osc);

// 2. Apply to the source extract. The output is removed first: it may be
// hard-linked into valhalla/custom_files-<scenario>, and osmium's --overwrite
// would write through the link.
rmSync(join(DATA, sc.output), { force: true });
osmium("apply-changes", `/data/${SOURCE}`, `/data/${sc.changesOsc}`, "-o", `/data/${sc.output}`, "--overwrite");

// 3. Verify: count retagged ways that carry every new tag and none of the
// removed keys in the output. OPL way line: "w<id> v<n> ... T<k>=<v>,<k>=<v> N<refs>",
// with special characters escaped as %<hex>%.
const decodeOpl = (s: string) => s.replace(/%([0-9a-fA-F]+)%/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
let check = osmium("tags-filter", `/data/${sc.output}`, `w/name=${sc.streetName}`, "-R", "-f", "opl", "-o", "-");
if (extraWayIds.size > 0) {
  check += osmium("getid", `/data/${sc.output}`, ...[...extraWayIds].map((id) => `w${id}`), "-f", "opl", "-o", "-");
}
let verified = 0;
for (const line of check.split("\n")) {
  if (!line.startsWith("w")) continue;
  const id = line.slice(1, line.indexOf(" "));
  if (!retaggedIds.has(id)) continue;
  const tagField = line.split(" ").find((f) => f.startsWith("T"))?.slice(1) ?? "";
  const tags: Tags = Object.fromEntries(
    tagField.split(",").filter(Boolean).map((kv) => kv.split("=").map(decodeOpl) as [string, string]),
  );
  const hasNew = Object.entries(sc.newTags).every(([k, v]) => tags[k] === v);
  const noDropped = !Object.keys(tags).some((k) => !(k in sc.newTags) && sc.drops(k));
  if (hasNew && noDropped) verified++;
}
if (verified < retagged.length) {
  throw new Error(`Only ${verified} of ${retagged.length} retagged ways carry the new tags in data/${sc.output}; the scenario extract is wrong`);
}

const result = {
  source_pbf: `data/${SOURCE}`,
  output_pbf: `data/${sc.output}`,
  selector: sc.selector,
  new_tags: sc.newTags,
  ...sc.extra,
  ways_retagged: retagged.length,
  ways_verified_in_output: verified,
  ways: retagged,
};
await writeFile(join(ROOT, "results", `scenario-${scenarioName}.json`), JSON.stringify(result, null, 2) + "\n");
console.log(`Retagged ${retagged.length} ways, verified ${verified} in output`);
