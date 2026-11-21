// Node tags for the driving graph: the ways GeoJSON (scripts/lts/extract-graph.ts)
// carries way tags and node ids only, so the nodes with a barrier or an access tag
// are read from the scenario's bbox extract (data/lts/<scenario>-bbox.osm.pbf,
// complete ways) with the pinned osmium image, as OPL, into data/through/.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DATA, OSMIUM_IMAGE } from "../lts/common";
import { THROUGH_DATA } from "./common";

// Node keys that can stop or admit a car.
const NODE_FILTERS = ["n/barrier", "n/motor_vehicle", "n/motorcar", "n/vehicle", "n/access"];

// OPL escapes special characters as %<hex codepoint>% (e.g. space -> %20%).
const unescapeOpl = (s: string) => s.replace(/%([0-9a-fA-F]+)%/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));

/** Tags of every node in the scenario's bbox extract that has a barrier or access tag, by node id. */
export async function nodeTags(scenario: string): Promise<Map<number, Record<string, string>>> {
  await mkdir(THROUGH_DATA, { recursive: true });
  const opl = `through/${scenario}-nodes.opl`;
  const cmd = [
    "docker", "run", "--rm", "-v", `${DATA}:/data`, OSMIUM_IMAGE, "osmium", "tags-filter", `/data/lts/${scenario}-bbox.osm.pbf`,
    ...NODE_FILTERS, "-f", "opl", "-o", `/data/${opl}`, "--overwrite",
  ];
  const p = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(p.stderr.toString());
  const out = new Map<number, Record<string, string>>();
  for (const line of (await Bun.file(join(DATA, opl)).text()).split("\n")) {
    if (!line.startsWith("n")) continue;
    const fields = new Map(line.split(" ").map((f) => [f[0], f.slice(1)] as const));
    const tags: Record<string, string> = {};
    for (const kv of (fields.get("T") ?? "").split(",").filter(Boolean)) {
      const [k, v = ""] = kv.split("=");
      tags[unescapeOpl(k)] = unescapeOpl(v);
    }
    out.set(Number(fields.get("n")), tags);
  }
  return out;
}
