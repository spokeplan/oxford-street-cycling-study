// The figure model and its HTML page: title, legend, map panels (MapLibre GL JS
// over the OpenFreeMap basemap, inline GeoJSON), notes and the credit footer.
// The page script fits each panel to its frame, adds the layers, checks that every
// label was placed and that no text overflows, and sets window.__done for render.ts.
import type { FC } from "./data";
import { placeLabels } from "./labels";
import {
  BASEMAP_FIRST_LABEL_LAYER, BASEMAP_STYLE, FONT_STACK, HIDDEN_BASEMAP_LAYERS, INK, LAYOUT, MAPLIBRE_CSS, MAPLIBRE_JS,
  MARKER, PED_ZONE, TYPE, VIEWPORT, WIDTH, type Bounds,
} from "./style";

export type Layer = Record<string, unknown> & { id: string };
export interface Panel {
  id: string;
  label?: string; // HTML, shown in a box in the panel's top-left corner (the map frame starts below it)
  overlay?: string; // HTML, shown in a box at the panel's bottom-left (the map frame ends above it)
  bounds: Bounds;
  sources: Record<string, FC>;
  /** Street-label sources the page places itself (labels.ts); each gets a `<source>-leaders` line source. */
  labels: LabelSpec[];
  /** Trip-end markers drawn from the source `trip-ends`, which labels keep clear of. */
  ends: { source: string; radius: number; nameSize: number; nameOffsetEm: number; nameMaxWidthEm: number };
  lines: Layer[]; // inserted below the basemap labels
  symbols: Layer[]; // above the data lines, below the trip ends
  top: Layer[]; // above the trip ends
  checkLayers: string[]; // symbol layers whose every feature in view must be placed (label collisions)
}
/**
 * Point labels (property `text`) placed by the page: `rank` names the numeric property
 * that sets the order (highest first), `avoid` the line sources a label should not cover.
 * The layer reads the placement from the properties `anchor` and `offset`.
 */
interface LabelSpec {
  source: string; size: number; rank: string; avoid: string[];
  /** Distance of the positions beside the point, ems (default LABEL_PLACEMENT.radialEm): a label beside a marker keeps clear of it. */
  radialEm?: number;
}
export type LegendItem =
  | {
    kind: "line"; color: string; width: number; casing?: number; pair?: { offset: number; under?: { color: string; width: number } };
    label: string;
  }
  | { kind: "dash"; label: string }
  | { kind: "ring"; color: string; radius: number; strokeWidth: number; label: string }
  | { kind: "ends"; ids: string[]; label: string }
  /** Shaded areas side by side under one label (the stress map's two reach areas). */
  | { kind: "bands"; colors: string[]; label: string }
  | { kind: "ramp"; title: string; steps: { color: string; label: string }[] };

/** What a figure is captured as: press PNG + WebP and a web WebP, or a social card (JPEG + PNG at one pixel per CSS pixel). */
type Output = "article" | "card";
export interface Figure {
  name: string;
  output: Output;
  title: string;
  subtitle?: string;
  legend: LegendItem[];
  notes?: string[]; // small lines under the legend (may name the method)
  caption?: string[]; // small lines under the panels (may name the method)
  /** Credit footer, one line each (the extract date, the credit): together they are wider than a page. */
  footer: string[];
  panels: Panel[];
  /** A chart instead of map panels (no panels): an SVG of the given height, CSS pixels, drawn at the page width less its padding. */
  chart?: { svg: string; height: number };
  /** Fixed page in CSS pixels (the panels fill the height left); default VIEWPORT.width wide, as tall as the frames need. */
  page?: { width: number; height: number };
  /** Panels side by side (default) or stacked, each full width. */
  stacked?: boolean;
  /** Type overrides for a page of another size (overlay: the panel callout's text). */
  type?: { title?: number; footer?: number; overlay?: number };
}

/**
 * A line of plain text a reader sees, where it is printed, and whether it is headline
 * text (title, subtitle, legend, panel label, callout) or a small note or caption line.
 */
export interface PrintedText { where: string; text: string; headline: boolean }

/** Every line a reader sees except the credit footer, as plain text (render.ts checks the wording). */
export function printedText(fig: Figure): PrintedText[] {
  const strip = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const headline = (where: string, text: string): PrintedText => ({ where, text: strip(text), headline: true });
  const small = (where: string, text: string): PrintedText => ({ where, text: strip(text), headline: false });
  return [
    headline("title", fig.title),
    ...(fig.subtitle ? [headline("subtitle", fig.subtitle)] : []),
    ...fig.legend.map((l) => headline("legend", l.kind === "ramp" ? `${l.title} ${l.steps.map((s) => s.label).join(" ")}` : l.label)),
    ...fig.panels.flatMap((p) => [
      ...(p.label ? [headline(`panel ${p.id} label`, p.label)] : []),
      ...(p.overlay ? [headline(`panel ${p.id} callout`, p.overlay)] : []),
    ]),
    ...(fig.notes ?? []).map((n) => small("note", n)),
    ...(fig.caption ?? []).map((c) => small("note", c)),
  ];
}

// Label placement (labels.ts), in CSS pixels or ems of the label size.
const LABEL_PLACEMENT = {
  // The map glyphs (Noto Sans Bold) run wider than the system sans the page measures with.
  widthFactor: 1.08,
  halo: 3,
  edge: 6,
  radialEm: 0.7,
  leaderRadiiEm: [2.2, 3.2, 4.4, 5.8],
  leaderAngles: 24,
  leaderCost: 8,
  pointCost: 20,
  // Line samples every this many pixels along the avoided sources.
  sampleStepPx: 5,
} as const;

/** Padding between the frame and the panel edge when fitting the bounds, CSS pixels. */
const FIT_PADDING_PX = 36;
/** Inset of a panel's label and overlay boxes from the panel edge, CSS pixels. */
const BOX_INSET_PX = 12;
/** Gap between a panel's label or overlay box and its map frame, CSS pixels. */
const BOX_GAP_PX = 10;
/** MapLibre lays a text line out this many ems tall. */
const MAP_LINE_HEIGHT_EM = 1.2;
/** Rounding slack when comparing laid-out sizes (scroll vs client width, content vs page height), CSS pixels. */
const LAYOUT_SLACK_PX = 1;
/** Gap between the swatch and the text of a callout key entry, and between entries, CSS pixels. */
const KEY_SWATCH_GAP_PX = 10;
const KEY_ENTRY_GAP_PX = 32;
/** Width of a callout's aside column (the text wraps inside it), ems of the callout text. */
const ASIDE_WIDTH_EM = 22;

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

/** Legend swatch box, CSS pixels. */
const SWATCH_W = 48;
const SWATCH_H = 24;
/** Gap between a line swatch's round caps and the box edge, CSS pixels. */
const SWATCH_INSET_PX = 4;
/** Swatch of an A/B trip-end marker: a dark disc with a white letter; radius, letter size, gap between discs and margin, CSS pixels. */
const END_SWATCH_R = 11;
const END_SWATCH_FONT = 14;
const END_SWATCH_GAP = 4;
const END_SWATCH_MARGIN = 1;
/** Swatch of one shaded area in a "bands" entry: width and height, CSS pixels (the gap is END_SWATCH_GAP). */
const BAND_SWATCH_W = 34;
const BAND_SWATCH_H = 18;
/** Baseline shift, in ems, that centres a capital letter vertically on a point. */
const CAP_CENTRE_EM = 0.36;
export function swatch(item: Exclude<LegendItem, { kind: "ramp" }>): string {
  const y = SWATCH_H / 2;
  const svg = (body: string, w = SWATCH_W) => `<svg width="${w}" height="${SWATCH_H}" viewBox="0 0 ${w} ${SWATCH_H}">${body}</svg>`;
  const hline = (stroke: string, width: number, at: number) =>
    `<line x1="${SWATCH_INSET_PX + width / 2}" y1="${at}" x2="${SWATCH_W - SWATCH_INSET_PX - width / 2}" y2="${at}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"/>`;
  switch (item.kind) {
    case "line":
      // Same widths as the map layers, CSS pixels; the casing as drawn on the map (white, on each side).
      if (item.pair) {
        // Two directions offset to either side, drawn over the line they run on.
        const p = item.pair;
        return svg((p.under ? hline(INK.white, p.under.width + 2 * WIDTH.wayCasing, y) + hline(p.under.color, p.under.width, y) : "") +
          hline(item.color, item.width, y - p.offset) + hline(item.color, item.width, y + p.offset));
      }
      return svg((item.casing ? hline(INK.white, item.width + 2 * item.casing, y) : "") + hline(item.color, item.width, y));
    case "dash": {
      const dash = PED_ZONE.dash.map((x) => x * PED_ZONE.width).join(" ");
      return svg(`<line x1="0" y1="${y}" x2="${SWATCH_W}" y2="${y}" stroke="${INK.white}" stroke-width="${PED_ZONE.casingWidth}"/>` +
        `<line x1="0" y1="${y}" x2="${SWATCH_W}" y2="${y}" stroke="${PED_ZONE.color}" stroke-width="${PED_ZONE.width}" stroke-dasharray="${dash}"/>`);
    }
    case "ring":
      return svg(`<circle cx="${SWATCH_W / 2}" cy="${y}" r="${item.radius}" fill="none" stroke="${item.color}" stroke-width="${item.strokeWidth}"/>`);
    case "bands": {
      const step = BAND_SWATCH_W + END_SWATCH_GAP;
      return svg(item.colors.map((c, i) => `<rect x="${i * step}" y="${(SWATCH_H - BAND_SWATCH_H) / 2}" width="${BAND_SWATCH_W}" height="${BAND_SWATCH_H}" rx="${BAND_SWATCH_H / 2}" fill="${c}"/>`).join(""),
        item.colors.length * step - END_SWATCH_GAP);
    }
    case "ends": {
      const step = 2 * END_SWATCH_R + END_SWATCH_GAP;
      const w = item.ids.length * step;
      return svg(item.ids.map((id, i) => {
        const cx = END_SWATCH_R + END_SWATCH_MARGIN + i * step;
        return `<circle cx="${cx}" cy="${y}" r="${END_SWATCH_R}" fill="${INK.primary}"/>` +
          `<text x="${cx}" y="${y + END_SWATCH_FONT * CAP_CENTRE_EM}" font-size="${END_SWATCH_FONT}" font-weight="700" fill="${INK.white}" text-anchor="middle">${id}</text>`;
      }).join(""), w);
    }
  }
}
export function legendHtml(items: LegendItem[]): string {
  return items.map((item) => item.kind === "ramp"
    ? `<span class="ramp"><b>${item.title}</b>${item.steps.map((s) => `<span class="step"><i style="background:${s.color}"></i>${s.label}</span>`).join("")}</span>`
    : `<span class="item">${swatch(item)}${item.label}</span>`).join("");
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/** JSON safe to embed in an inline <script>. */
const scriptJson = (v: unknown) => JSON.stringify(v).replaceAll("<", "\\u003c");

/** Width and the tallest allowed height of the figure's page, CSS pixels. */
export const pageSize = (fig: Figure) => fig.page ?? VIEWPORT;

export function html(fig: Figure): string {
  const panels = fig.panels.map((p) => ({
    id: p.id, bounds: p.bounds, sources: p.sources, labels: p.labels, ends: p.ends, lines: p.lines, symbols: p.symbols, top: p.top, checkLayers: p.checkLayers,
  }));
  const size = pageSize(fig);
  const fixed = fig.page !== undefined;
  const titleSize = fig.type?.title ?? TYPE.title;
  const footerSize = fig.type?.footer ?? TYPE.footer;
  const overlaySize = fig.type?.overlay ?? TYPE.heroText;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${fig.title}</title>
<link rel="stylesheet" href="${MAPLIBRE_CSS}">
<style>
  * { box-sizing: border-box; margin: 0; }
  html { background: ${INK.surface}; }
  body { width: ${size.width}px; ${fixed ? `height: ${size.height}px;` : ""} overflow: hidden; background: ${INK.surface};
    font-family: ${FONT_STACK}; color: ${INK.primary}; display: flex; flex-direction: column; padding: 0 ${LAYOUT.pad}px; }
  header { padding-top: 20px; padding-bottom: 12px; flex: none; }
  h1 { font-size: ${titleSize}px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.15; text-wrap: balance; }
  .sub { font-size: ${TYPE.subtitle}px; color: ${INK.secondary}; margin-top: 6px; white-space: nowrap; }
  .legend { padding: 4px 0 12px; flex: none; }
  .items { display: flex; flex-wrap: wrap; gap: 8px 30px; align-items: center; font-size: ${TYPE.legend}px; color: ${INK.primary}; }
  .item { display: inline-flex; align-items: center; gap: 8px; }
  .items .ramp { display: inline-flex; align-items: center; gap: 4px; }
  .items .ramp b { font-weight: 600; margin-right: 12px; }
  .items .step { display: inline-flex; flex-direction: column; align-items: center; font-size: ${TYPE.legend}px; color: ${INK.secondary}; }
  .items .step i { display: block; width: 76px; height: 12px; border-radius: 2px; margin-bottom: 3px; }
  .note { font-size: ${TYPE.note}px; color: ${INK.secondary}; margin-top: 6px; white-space: nowrap; }
  main { display: flex; ${fig.stacked ? "flex-direction: column;" : ""} gap: ${LAYOUT.panelGap}px; ${fixed ? "flex: 1 1 auto; min-height: 0;" : "flex: none;"} }
  .panel { flex: 1; position: relative; border-radius: 4px; overflow: hidden; outline: 1px solid ${INK.hairline}; }
  .map { position: absolute; inset: 0; }
  .plabel, .overlay { position: absolute; left: ${BOX_INSET_PX}px; z-index: 2; background: rgba(255,255,255,0.94); border-radius: 4px;
    padding: 10px 14px; line-height: 1.35; color: ${INK.secondary}; box-shadow: 0 0 0 1px rgba(11,11,11,0.10); white-space: nowrap; }
  .plabel { top: ${BOX_INSET_PX}px; font-size: ${TYPE.panelNote}px; }
  .plabel b { display: block; font-size: ${TYPE.panel}px; color: ${INK.primary}; }
  .plabel b .aside { font-weight: 400; font-size: ${TYPE.panelNote}px; color: ${INK.secondary}; }
  .plabel .row { display: flex; align-items: center; gap: 8px; }
  .overlay { bottom: ${BOX_INSET_PX}px; font-size: ${overlaySize}px; color: ${INK.primary}; }
  .overlay .key { display: flex; gap: ${KEY_ENTRY_GAP_PX}px; align-items: center; }
  .overlay .key .item { gap: ${KEY_SWATCH_GAP_PX}px; }
  .overlay .figs { display: flex; gap: 36px; align-items: center; }
  .overlay .fig { display: flex; align-items: center; gap: 14px; }
  .overlay .fig strong { display: block; font-size: ${TYPE.heroNumber}px; line-height: 1; font-weight: 700; letter-spacing: -0.02em; }
  .overlay .fig span { display: block; color: ${INK.secondary}; }
  .overlay .fig .lead { color: ${INK.primary}; font-weight: 600; }
  .overlay .aside { white-space: normal; width: ${ASIDE_WIDTH_EM}em; padding-left: 28px; border-left: 1px solid ${INK.hairline}; color: ${INK.secondary}; }
  .overlay .aside b { display: block; color: ${INK.primary}; font-weight: 600; }
  .overlay .keynote { color: ${INK.secondary}; margin-top: 4px; }
  .overlay .items { flex-direction: column; align-items: flex-start; gap: 8px; padding-left: 28px; border-left: 1px solid ${INK.hairline}; }
  .caption { font-size: ${TYPE.note}px; line-height: 1.5; color: ${INK.secondary}; padding-top: 10px; white-space: nowrap; flex: none; }
  footer { min-height: ${LAYOUT.footerHeight}px; flex: none; display: flex; flex-direction: column; justify-content: center; font-size: ${footerSize}px; line-height: 1.3;
    color: ${INK.secondary}; ${fixed && size.width < VIEWPORT.width ? "padding: 6px 0;" : "white-space: nowrap;"} }
</style></head>
<body>
<header><h1>${fig.title}</h1>${fig.subtitle ? `<p class="sub">${fig.subtitle}</p>` : ""}</header>
${fig.legend.length || fig.notes?.length ? `<div class="legend"><div class="items">${legendHtml(fig.legend)}</div>${(fig.notes ?? []).map((n) => `<p class="note">${n}</p>`).join("")}</div>` : ""}
<main>${fig.chart ? `<div class="chart" style="height:${fig.chart.height}px">${fig.chart.svg}</div>` : ""}${fig.panels.map((p) => `<div class="panel" id="panel-${p.id}">${p.label ? `<div class="plabel">${p.label}</div>` : ""}${p.overlay ? `<div class="overlay">${p.overlay}</div>` : ""}<div class="map" id="map-${p.id}"></div></div>`).join("")}</main>
${fig.caption ? `<div class="caption">${fig.caption.map((c) => `<p>${c}</p>`).join("")}</div>` : ""}
<footer>${fig.footer.map((l) => `<p>${l}</p>`).join("")}</footer>
<script type="module">
import { Map } from ${JSON.stringify(MAPLIBRE_JS)};
const PANELS = ${scriptJson(panels)};
const FIXED = ${fixed};
const STACKED = ${fig.stacked === true};
const PAD = ${FIT_PADDING_PX};
const GAP = ${BOX_GAP_PX};
const INSET = ${BOX_INSET_PX};
const LINE_HEIGHT_EM = ${MAP_LINE_HEIGHT_EM};
const SLACK = ${LAYOUT_SLACK_PX};
/** Clearance around a trip-end marker: its radius plus its white stroke. */
const END_STROKE = ${MARKER.abStroke};
const errors = [];
const warnings = [];
const report = {};

const placeLabels = ${placeLabels.toString()};
const PLACEMENT = ${JSON.stringify(LABEL_PLACEMENT)};
const LABEL_FONT = (size) => "700 " + size + "px " + ${JSON.stringify(FONT_STACK)};
const measureCtx = document.createElement("canvas").getContext("2d");

/**
 * Size of a trip-end name and its offset from the marker centre, CSS pixels. A name wider
 * than its max width wraps onto two lines, split where the longer line is shortest
 * (MapLibre balances its lines the same way).
 */
function endName(p, f) {
  measureCtx.font = LABEL_FONT(p.ends.nameSize);
  const width = (t) => measureCtx.measureText(t).width * PLACEMENT.widthFactor;
  const maxW = p.ends.nameMaxWidthEm * p.ends.nameSize;
  const words = f.properties.name.split(" ");
  let w = width(f.properties.name), lines = 1;
  if (w > maxW && words.length > 1) {
    lines = 2;
    w = Math.min(...words.slice(1).map((_, i) => Math.max(width(words.slice(0, i + 1).join(" ")), width(words.slice(i + 1).join(" ")))));
  }
  return { w, h: lines * p.ends.nameSize * LINE_HEIGHT_EM, off: p.ends.nameOffsetEm * p.ends.nameSize };
}

// Fit: the frame sits below the panel's label box and above its overlay box, and its
// sides leave room for the trip-end names (the frame holds the markers, not their
// names). A page without a fixed size makes each panel as tall as its frame needs at
// the panel width (Web Mercator), so the panel shows its frame and no more.
const mercX = (lon) => (lon * Math.PI) / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
/** Rounds of widening the side padding until every end name fits; each round only grows it, a few suffice. */
const SIDE_PADDING_ROUNDS = 8;
const fits = {};
for (const p of PANELS) {
  const el = document.getElementById("panel-" + p.id);
  const label = el.querySelector(".plabel");
  const overlay = el.querySelector(".overlay");
  const top = label ? label.offsetTop + label.offsetHeight + GAP : PAD;
  const bottom = overlay ? overlay.offsetHeight + INSET + GAP : PAD;
  const width = el.clientWidth;
  const dx = mercX(p.bounds.maxLon) - mercX(p.bounds.minLon), dy = mercY(p.bounds.maxLat) - mercY(p.bounds.minLat);
  const scaleAt = (left, right) => Math.min((width - left - right) / dx, FIXED ? (el.clientHeight - top - bottom) / dy : Infinity);
  let left = PAD, right = PAD;
  for (let round = 0; round < SIDE_PADDING_ROUNDS; round++) {
    const s = scaleAt(left, right);
    const slack = (width - left - right - dx * s) / 2;
    let growL = 0, growR = 0;
    for (const f of p.sources[p.ends.source].features) {
      const x = left + slack + (mercX(f.geometry.coordinates[0]) - mercX(p.bounds.minLon)) * s;
      const n = endName(p, f);
      if (f.properties.anchor === "right") growL = Math.max(growL, PLACEMENT.edge - (x - n.off - n.w));
      if (f.properties.anchor === "left") growR = Math.max(growR, x + n.off + n.w - (width - PLACEMENT.edge));
    }
    if (growL <= 0 && growR <= 0) break;
    left += Math.max(0, Math.ceil(growL)); right += Math.max(0, Math.ceil(growR));
  }
  fits[p.id] = { padding: { top, bottom, left, right }, height: top + dy * scaleAt(left, right) + bottom };
}
// Side by side, the panels share the tallest one's height; stacked, each takes its own.
if (!FIXED && STACKED) for (const p of PANELS) Object.assign(document.getElementById("panel-" + p.id).style, { flex: "none", height: Math.ceil(fits[p.id].height) + "px" });
if (!FIXED && !STACKED && PANELS.length > 0) document.querySelector("main").style.height = Math.ceil(Math.max(...Object.values(fits).map((f) => f.height))) + "px";
const pageHeight = FIXED ? ${size.height} : Math.ceil(document.body.getBoundingClientRect().height);
if (!FIXED && pageHeight > window.innerHeight) errors.push("page " + pageHeight + " px is taller than the viewport " + window.innerHeight + " px");
if (FIXED && document.body.scrollHeight > pageHeight + SLACK) errors.push("content " + document.body.scrollHeight + " px overflows the page " + pageHeight + " px");
for (const p of PANELS) {
  const el = document.getElementById("panel-" + p.id), f = fits[p.id].padding;
  if (FIXED && el.clientHeight < f.top + f.bottom + 2 * PAD) errors.push(p.id + ": panel too short for its boxes");
}

/** Box of a map element in the panel's map coordinates (CSS pixels from its top-left). */
function boxOf(el, mapEl) {
  const r = el.getBoundingClientRect(), m = mapEl.getBoundingClientRect();
  return { x0: r.left - m.left, y0: r.top - m.top, x1: r.right - m.left, y1: r.bottom - m.top };
}

/** Boxes of each trip-end marker and its name at the current camera, map coordinates. */
function endBoxes(map, p) {
  return p.sources[p.ends.source].features.map((f) => {
    const c = map.project(f.geometry.coordinates);
    const r = p.ends.radius + END_STROKE;
    const { w, h, off } = endName(p, f);
    const x0 = f.properties.anchor === "left" ? c.x + off : f.properties.anchor === "right" ? c.x - off - w : c.x - w / 2;
    return { marker: { x0: c.x - r, y0: c.y - r, x1: c.x + r, y1: c.y + r }, name: { x0, y0: c.y - h / 2, x1: x0 + w, y1: c.y + h / 2 } };
  });
}

/** Places the panel's label sources (labels.ts) at the final camera; adds each one's leader source. */
function placePanelLabels(map, p) {
  const mapEl = map.getContainer();
  const canvas = map.getCanvas();
  const obstacles = [...mapEl.parentElement.querySelectorAll(".plabel, .overlay")].map((el) => boxOf(el, mapEl));
  obstacles.push(...endBoxes(map, p).flatMap((e) => [e.marker, e.name]));
  for (const spec of p.labels) {
    const samples = [];
    for (const id of spec.avoid) {
      for (const f of p.sources[id].features) {
        const lines = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.type === "MultiLineString" ? f.geometry.coordinates : [];
        for (const coords of lines) {
          const px = coords.map((c) => map.project(c));
          for (let i = 1; i < px.length; i++) {
            const n = Math.max(1, Math.ceil(Math.hypot(px[i].x - px[i - 1].x, px[i].y - px[i - 1].y) / PLACEMENT.sampleStepPx));
            for (let k = 0; k < n; k++) samples.push({ x: px[i - 1].x + ((px[i].x - px[i - 1].x) * k) / n, y: px[i - 1].y + ((px[i].y - px[i - 1].y) * k) / n });
          }
        }
      }
    }
    const data = p.sources[spec.source];
    const points = data.features.map((f) => {
      const c = map.project(f.geometry.coordinates);
      return { x: c.x, y: c.y, text: f.properties.text, rank: f.properties[spec.rank] ?? 0 };
    });
    const placed = placeLabels({
      points, size: spec.size, font: LABEL_FONT(spec.size), widthFactor: PLACEMENT.widthFactor, halo: PLACEMENT.halo,
      obstacles, samples, view: { width: canvas.clientWidth, height: canvas.clientHeight, edge: PLACEMENT.edge },
      radialEm: spec.radialEm ?? PLACEMENT.radialEm, leaderRadiiEm: PLACEMENT.leaderRadiiEm, leaderAngles: PLACEMENT.leaderAngles,
      leaderCost: PLACEMENT.leaderCost, pointCost: PLACEMENT.pointCost,
    });
    const leaders = [];
    data.features.forEach((f, i) => {
      const pl = placed[i];
      if (!pl) { errors.push(p.id + ": no free spot for label " + f.properties.text); f.properties.anchor = "center"; f.properties.offset = [0, 0]; return; }
      // Later sources keep clear of the labels placed here.
      obstacles.push(pl.box);
      f.properties.anchor = pl.anchor;
      f.properties.offset = pl.offset;
      if (pl.displace) {
        const from = f.geometry.coordinates;
        const at = map.project(from);
        const to = map.unproject([at.x + pl.displace[0], at.y + pl.displace[1]]);
        f.geometry = { type: "Point", coordinates: [to.lng, to.lat] };
        leaders.push({ type: "Feature", geometry: { type: "LineString", coordinates: [from, [to.lng, to.lat]] }, properties: {} });
      }
    });
    p.sources[spec.source + "-leaders"] = { type: "FeatureCollection", features: leaders };
  }
}

async function render(p) {
  const padding = fits[p.id].padding;
  const map = new Map({
    container: "map-" + p.id, style: ${JSON.stringify(BASEMAP_STYLE)},
    bounds: [[p.bounds.minLon, p.bounds.minLat], [p.bounds.maxLon, p.bounds.maxLat]],
    fitBoundsOptions: { padding },
    interactive: false, attributionControl: false, fadeDuration: 0,
    canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
  });
  map.on("error", (e) => errors.push(p.id + ": " + (e.error && e.error.message ? e.error.message : String(e))));
  await new Promise((resolve) => map.once("load", resolve));
  for (const id of ${JSON.stringify(HIDDEN_BASEMAP_LAYERS)}) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
    else warnings.push(p.id + ": basemap layer " + id + " (HIDDEN_BASEMAP_LAYERS) is not in the style; nothing hidden");
  }
  placePanelLabels(map, p);
  for (const [id, data] of Object.entries(p.sources)) map.addSource(id, { type: "geojson", data });
  for (const layer of p.lines) map.addLayer(layer, ${JSON.stringify(BASEMAP_FIRST_LABEL_LAYER)});
  for (const layer of [...p.symbols, ...p.top]) map.addLayer(layer);
  await new Promise((resolve) => map.once("idle", resolve));
  // Every label of a checked layer whose point is in view must have been placed.
  const view = map.getBounds();
  const placed = {};
  for (const id of p.checkLayers) {
    const key = (f) => JSON.stringify(f.properties);
    const rendered = new Set(map.queryRenderedFeatures({ layers: [id] }).map(key));
    const filter = map.getFilter(id);
    const inView = new Set(map.querySourceFeatures(map.getLayer(id).source, filter ? { filter } : {})
      .filter((f) => f.geometry.type !== "Point" || view.contains(f.geometry.coordinates)).map(key));
    const missing = [...inView].filter((x) => !rendered.has(x));
    placed[id] = { placed: rendered.size, total: inView.size };
    for (const m of missing) errors.push(p.id + ": label not placed in " + id + ": " + m);
  }
  report[p.id] = { zoom: Math.round(map.getZoom() * 100) / 100, placed };
}
for (const el of document.querySelectorAll(".sub, .note, .caption p, footer, .plabel, .overlay")) {
  if (el.scrollWidth > el.clientWidth + SLACK) errors.push("text overflows: " + el.tagName + " " + el.className);
}
Promise.all(PANELS.map(render)).then(
  () => { window.__done = { errors, warnings, report, height: pageHeight }; },
  (e) => { window.__done = { errors: [...errors, String(e)], warnings, report, height: pageHeight }; },
);
</script>
</body></html>
`;
}
