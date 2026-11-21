// Step 1: export every way with a highway tag inside the study BBOX to GeoJSON,
// keeping all tags plus the OSM node ids of every vertex (needed to find the
// nodes that ways share). osmium-tool in Docker, same image as retag-scenario.ts:
//   extract --bbox (complete ways) -> tags-filter w/highway
//   -> add-locations-to-ways as OPL (way lines carry node ids + coordinates)
//   -> parsed in Bun -> data/lts/<scenario>-ways.geojson
// `osmium export` was not used because its GeoJSON drops the vertex node ids.
// Usage: bun scripts/lts/extract-graph.ts <scenario>
import { mkdir, writeFile } from "node:fs/promises";
import { BBOX, DATA, LTS_DATA, OSMIUM_IMAGE, SCENARIOS, requireScenario, waysPath, type LonLat, type WayFeature } from "./common";

function osmium(...args: string[]): void {
  const cmd = ["docker", "run", "--rm", "-v", `${DATA}:/data`, OSMIUM_IMAGE, "osmium", ...args];
  console.log("$", cmd.join(" "));
  const p = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(p.stderr.toString());
}

// OPL escapes special characters as %<hex codepoint>% (e.g. space -> %20%).
const unescapeOpl = (s: string) => s.replace(/%([0-9a-fA-F]+)%/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));

export async function extractGraph(scenario: string): Promise<string> {
  await mkdir(LTS_DATA, { recursive: true });
  const bboxPbf = `/data/lts/${scenario}-bbox.osm.pbf`;
  const highwayPbf = `/data/lts/${scenario}-highways.osm.pbf`;
  const opl = `lts/${scenario}-ways.opl`;
  const bbox = `${BBOX.minLon},${BBOX.minLat},${BBOX.maxLon},${BBOX.maxLat}`;
  osmium("extract", "-b", bbox, "-s", "complete_ways", `/data/${SCENARIOS[scenario]}`, "-o", bboxPbf, "--overwrite");
  osmium("tags-filter", bboxPbf, "w/highway", "-o", highwayPbf, "--overwrite");
  osmium("add-locations-to-ways", highwayPbf, "-f", "opl", "-o", `/data/${opl}`, "--overwrite");

  const features: WayFeature[] = [];
  for (const line of (await Bun.file(`${DATA}/${opl}`).text()).split("\n")) {
    if (!line.startsWith("w")) continue;
    const fields = new Map(line.split(" ").map((f) => [f[0], f.slice(1)] as const));
    const tags: Record<string, string> = {};
    for (const kv of (fields.get("T") ?? "").split(",").filter(Boolean)) {
      const [k, v = ""] = kv.split("=");
      tags[unescapeOpl(k)] = unescapeOpl(v);
    }
    if (!tags.highway) continue;
    const nodeIds: number[] = [];
    const coords: LonLat[] = [];
    for (const ref of (fields.get("N") ?? "").split(",").filter(Boolean)) {
      const m = ref.match(/^n(\d+)x([-\d.]+)y([-\d.]+)$/);
      if (!m) continue; // node outside the extract (no location): drop the vertex
      nodeIds.push(Number(m[1]));
      coords.push([Number(m[2]), Number(m[3])]);
    }
    if (nodeIds.length < 2) continue;
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: { "@id": Number(line.slice(1, line.indexOf(" "))), "@nodes": nodeIds, ...tags },
    });
  }
  const out = waysPath(scenario);
  await writeFile(out, JSON.stringify({ type: "FeatureCollection", features }));
  console.log(`${scenario}: ${features.length} highway ways -> ${out}`);
  return out;
}

if (import.meta.main) {
  await extractGraph(requireScenario(process.argv[2], "bun scripts/lts/extract-graph.ts <scenario>"));
}
