// Renders the article figures: one self-contained HTML page per figure (page.ts:
// inline GeoJSON from data.ts, MapLibre GL JS from a CDN, OpenFreeMap basemap),
// served from a local HTTP server (MapLibre cannot start its web worker on a file://
// page), opened in headless Chromium (chromium.ts) and captured once every map is idle.
// An article figure goes to figures/<name>.png and .webp at DEVICE_SCALE_FACTOR (press)
// and figures/<name>-<width>.webp at one pixel per CSS pixel (web); a social card to
// figures/<name>.jpg and .png at one pixel per CSS pixel.
// Usage: bun scripts/figures/render.ts <name|all>   (names: see FIGURES in figures.ts)
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT } from "../lts/common";
import { startChromium, type Tab } from "./chromium";
import { FIGURES_DATA, describe, prepareFigureData } from "./data";
import { FIGURES } from "./figures";
import { html, pageSize, printedText, type Figure } from "./page";
import { DEVICE_SCALE_FACTOR, JARGON, JPEG_QUALITY, SEMICOLON, VIEWPORT, WEBP_QUALITY } from "./style";

const FIGURES_DIR = join(ROOT, "figures");
/** Longest wait for a figure's maps to load and go idle, milliseconds. */
const RENDER_TIMEOUT_MS = 180_000;
/** Device scale factor of the web copy and the social card: one image pixel per CSS pixel. */
const WEB_SCALE_FACTOR = 1;
/** File suffix of the web copy, its width in pixels. */
const WEB_SUFFIX = `-${VIEWPORT.width * WEB_SCALE_FACTOR}`;
// Software WebGL (SwiftShader) so the output does not depend on the machine's GPU.
const CHROMIUM_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const TILE_HOST = "tiles.openfreemap.org";
const HTTP_ERROR_MIN = 400;
const BYTES_PER_KB = 1024;

interface Written { file: string; width: number; height: number; bytes: number }
interface RenderResult { name: string; files: Written[]; seconds: number; errors: string[]; warnings: string[]; tileFailures: string[]; report: unknown }
interface PageDone { errors: string[]; warnings: string[]; report: unknown; height: number }

/**
 * Wording rules: titles, subtitles, legends, panel labels and callouts are plain language
 * (the method's terms stay in the notes and footer), and no line a reader sees has a semicolon.
 */
function wordingErrors(fig: Figure): string[] {
  return printedText(fig).flatMap(({ where, text, headline }) => [
    ...(headline && JARGON.test(text) ? [`${fig.name}: jargon in ${where}: "${text}"`] : []),
    ...(text.includes(SEMICOLON) ? [`${fig.name}: semicolon in ${where} (split it into sentences): "${text}"`] : []),
  ]);
}

/** Loads the figure page at the given device scale factor and waits until every map is idle. */
async function loadFigure(tab: Tab, origin: string, fig: Figure, deviceScaleFactor: number): Promise<PageDone> {
  await tab.setViewport({ ...pageSize(fig), deviceScaleFactor });
  await tab.goto(`${origin}/${fig.name}.html`);
  await tab.waitFor("window.__done", RENDER_TIMEOUT_MS);
  return tab.evaluate<PageDone>("window.__done");
}

async function renderFigure(tab: Tab, origin: string, fig: Figure): Promise<RenderResult> {
  const started = performance.now();
  await writeFile(join(FIGURES_DATA, `${fig.name}.html`), html(fig));
  // Basemap tile, glyph and style requests that fail or return an HTTP error.
  const tileFailures: string[] = [];
  const urls = new Map<string, string>();
  const offs = [
    tab.on("Network.requestWillBeSent", (p) => urls.set(p.requestId as string, (p.request as { url: string }).url)),
    tab.on("Network.responseReceived", (p) => {
      const r = p.response as { url: string; status: number };
      if (r.url.includes(TILE_HOST) && r.status >= HTTP_ERROR_MIN) tileFailures.push(`${r.status} ${r.url}`);
    }),
    tab.on("Network.loadingFailed", (p) => {
      const url = urls.get(p.requestId as string) ?? "";
      if (url.includes(TILE_HOST)) tileFailures.push(`${p.errorText as string} ${url}`);
    }),
  ];
  const files: Written[] = [];
  const write = async (file: string, data: Buffer, scale: number, clip: { width: number; height: number }) => {
    await writeFile(join(FIGURES_DIR, file), data);
    files.push({ file, width: clip.width * scale, height: clip.height * scale, bytes: data.length });
  };
  try {
    if (fig.output === "card") {
      const done = await loadFigure(tab, origin, fig, WEB_SCALE_FACTOR);
      const clip = pageSize(fig);
      await write(`${fig.name}.jpg`, await tab.screenshot("jpeg", JPEG_QUALITY, clip), WEB_SCALE_FACTOR, clip);
      await write(`${fig.name}.png`, await tab.screenshot("png", undefined, clip), WEB_SCALE_FACTOR, clip);
      return { name: fig.name, files, seconds: (performance.now() - started) / 1000, errors: done.errors, warnings: done.warnings, tileFailures, report: done.report };
    }
    const done = await loadFigure(tab, origin, fig, DEVICE_SCALE_FACTOR);
    // The page is as wide as its size and as tall as its content; capture just that.
    const clip = { width: pageSize(fig).width, height: Math.min(done.height, pageSize(fig).height) };
    await write(`${fig.name}.png`, await tab.screenshot("png", undefined, clip), DEVICE_SCALE_FACTOR, clip);
    await write(`${fig.name}.webp`, await tab.screenshot("webp", WEBP_QUALITY, clip), DEVICE_SCALE_FACTOR, clip);
    // The web copy: the same page and clip, one image pixel per CSS pixel. The page lays
    // itself out again, so its height and checks are compared with the press pass.
    const web = await loadFigure(tab, origin, fig, WEB_SCALE_FACTOR);
    const webErrors = web.height === done.height ? [] : [`web copy page height ${web.height} px differs from ${done.height} px`];
    await write(`${fig.name}${WEB_SUFFIX}.webp`, await tab.screenshot("webp", WEBP_QUALITY, clip), WEB_SCALE_FACTOR, clip);
    return {
      name: fig.name, files, seconds: (performance.now() - started) / 1000,
      errors: [...done.errors, ...web.errors.filter((e) => !done.errors.includes(e)), ...webErrors],
      warnings: done.warnings, tileFailures, report: done.report,
    };
  } finally {
    for (const off of offs) off();
  }
}

async function main() {
  const arg = process.argv[2];
  const names = arg === "all" ? Object.keys(FIGURES) : arg && arg in FIGURES ? [arg] : undefined;
  if (!names) {
    console.error(`Usage: bun scripts/figures/render.ts <${[...Object.keys(FIGURES), "all"].join("|")}>`);
    process.exit(1);
  }
  const started = performance.now();
  const data = await prepareFigureData();
  console.log(describe(data));
  const figures = names.map((name) => FIGURES[name](data));
  const wording = figures.flatMap(wordingErrors);
  if (wording.length) {
    for (const e of wording) console.error(e);
    process.exit(1);
  }
  await mkdir(FIGURES_DIR, { recursive: true });
  // Serves only the generated figure pages from data/figures/.
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch: (req) => {
      const name = new URL(req.url).pathname.slice(1).replace(/.html$/, "");
      return name in FIGURES ? new Response(Bun.file(join(FIGURES_DATA, `${name}.html`))) : new Response("Not found", { status: 404 });
    },
  });
  const browser = await startChromium(CHROMIUM_ARGS, { ...VIEWPORT, deviceScaleFactor: DEVICE_SCALE_FACTOR });
  browser.tab.on("Runtime.exceptionThrown", (p) => console.error(`page error: ${JSON.stringify(p.exceptionDetails)}`));
  let failed = false;
  try {
    for (const fig of figures) {
      const r = await renderFigure(browser.tab, server.url.origin, fig);
      const kb = (b: number) => `${Math.round(b / BYTES_PER_KB)} KB`;
      console.log(`${r.name}: ${r.files.map((f) => `${f.file} ${f.width} x ${f.height} px ${kb(f.bytes)}`).join(", ")}; ${r.seconds.toFixed(1)} s, report ${JSON.stringify(r.report)}`);
      for (const w of r.warnings) console.warn(`  ${r.name}: warning: ${w}`);
      for (const e of [...r.errors, ...r.tileFailures]) console.warn(`  ${r.name}: ${e}`);
      failed ||= r.errors.length > 0 || r.tileFailures.length > 0 || r.warnings.length > 0;
    }
  } finally {
    await browser.close();
    await server.stop();
  }
  console.log(`total ${((performance.now() - started) / 1000).toFixed(1)} s`);
  if (failed) process.exit(1);
}

await main();
