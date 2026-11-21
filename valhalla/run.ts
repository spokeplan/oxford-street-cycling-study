// Starts Valhalla (gis-ops image) for one scenario on port 8002.
// Usage: bun valhalla/run.ts <scenario> <path-to-pbf>
//   e.g. bun valhalla/run.ts today data/greater-london-latest.osm.pbf
// Each scenario gets its own valhalla/custom_files-<scenario>/ dir so tiles of
// different scenarios coexist on disk; only one container runs at a time.
import { existsSync, linkSync, copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { STUDY_CONTAINERS, containerName } from "./common";

// gis-ops image (Valhalla 3.5.1) pinned by digest: the study ran on the image
// that was :latest at the time, and a later push to the tag could change routes.
const IMAGE = "ghcr.io/gis-ops/docker-valhalla/valhalla@sha256:060da5b92e6024a67f65135c236d918b021d63e73d1808a0d55b7e7cbd17240c";
const PORT = 8002;
const STATUS_URL = `http://localhost:${PORT}/status`;
const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 60 * 60 * 1000;
// The service crashed with "Too many open files" (ZeroMQ ipc_listener) at the
// default ulimit with one worker per host core; cap both.
const NOFILE_LIMIT = 65536;
const SERVER_THREADS = 4;

const [scenario, pbfArg] = process.argv.slice(2);
if (!scenario || !pbfArg) {
  console.error("Usage: bun valhalla/run.ts <scenario> <path-to-pbf>");
  process.exit(1);
}
const ROOT = join(import.meta.dir, "..");
const pbf = resolve(ROOT, pbfArg);
if (!existsSync(pbf)) throw new Error(`PBF not found: ${pbf}`);

const customDir = join(import.meta.dir, `custom_files-${scenario}`);
mkdirSync(customDir, { recursive: true });
// The image builds from every *.pbf it finds, so keep exactly one in the dir.
for (const f of readdirSync(customDir).filter((f) => f.endsWith(".pbf") && f !== basename(pbf))) {
  throw new Error(`Unexpected PBF ${f} in ${customDir}; remove it first`);
}
const target = join(customDir, basename(pbf));
if (!existsSync(target)) {
  try { linkSync(pbf, target); } catch { copyFileSync(pbf, target); }
}

const sh = (cmd: string[]) => Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
const name = containerName(scenario);
// Remove the study's own containers (and this scenario's) so the port is free;
// other containers, even ones named valhalla-*, are left alone.
const ours = new Set([...STUDY_CONTAINERS, name]);
const existing = sh(["docker", "ps", "-a", "--format", "{{.Names}}"]).stdout.toString().split(/\r?\n/)
  .filter((n) => ours.has(n));
for (const old of existing) {
  console.log(`Removing container ${old}`);
  sh(["docker", "rm", "-f", old]);
}

const args = [
  "docker", "run", "-d", "--name", name, "-p", `${PORT}:8002`,
  "--ulimit", `nofile=${NOFILE_LIMIT}:${NOFILE_LIMIT}`,
  "-v", `${customDir}:/custom_files`,
  "-e", `server_threads=${SERVER_THREADS}`,
  "-e", "use_tiles_ignore_pbf=False",
  "-e", "force_rebuild=False",
  "-e", "build_elevation=False",
  "-e", "build_admins=False",
  "-e", "build_time_zones=False",
  "-e", "build_transit=False",
  "-e", "build_tar=True",
  "-e", "serve_tiles=True",
  IMAGE,
];
console.log(args.join(" "));
const run = sh(args);
if (run.exitCode !== 0) throw new Error(run.stderr.toString());

const t0 = Date.now();
while (Date.now() - t0 < MAX_WAIT_MS) {
  await Bun.sleep(POLL_INTERVAL_MS);
  const state = sh(["docker", "inspect", "-f", "{{.State.Running}}", name]).stdout.toString().trim();
  if (state !== "true") {
    console.error(sh(["docker", "logs", "--tail", "50", name]).stderr.toString());
    throw new Error(`Container ${name} exited`);
  }
  try {
    const res = await fetch(STATUS_URL);
    if (res.ok) {
      const secs = Math.round((Date.now() - t0) / 1000);
      console.log(`Valhalla '${scenario}' ready after ${secs} s:`, await res.json());
      process.exit(0);
    }
  } catch { /* not up yet */ }
}
throw new Error("Timed out waiting for Valhalla");
