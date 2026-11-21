// Shared look of the article figures: page sizes, palette, line widths, type,
// map frames, the credit line and the words kept out of titles and legends.
// figures.ts and page.ts read only these constants.
//
// One palette across the figures (dataviz method; validated with that skill's
// validate_palette.js against the positron basemap background, #f2f3f0):
// - low-stress / cautious / calm = blues; busy / "street to convert" = warm;
//   the confident rider's shortest path = neutral dark grey; pedestrianised
//   Oxford Street = dashed mid grey.
// - streets to convert on the northern route (orange) and the southern route
//   (magenta) plus the route blue, --pairs all: CVD worst pair dE 13.3, normal-vision 20.1;
// - stress map LTS 1, LTS 2, LTS 3 (light blue, blue, orange), --pairs all:
//   CVD worst pair dE 19.1, normal-vision 19.2;
// - cautious-route blues (light, dark): dE 23.9; each against the grey confident path >= 18.7;
// - busy magenta against the dashed zone grey: CVD dE 10.8 (a darker grey fell to 3.6);
// - frequency ramp, --ordinal: monotone lightness, adjacent dL >= 0.06, light end 2.06:1.
// Orange and the light blue sit below 3:1 on the basemap, so every coloured line
// has a white casing and a legend entry, and the converted streets are named on the map.
import { POINTS, type LonLat } from "../lts/common";
import type { Side } from "../lts/sides";

/**
 * Body figures: browser viewport in CSS pixels. Every page is VIEWPORT.width wide; its
 * height follows from the map frames and the screenshot is clipped to it, so
 * VIEWPORT.height is only the tallest page allowed (fix-minimum, two full-width maps
 * of the whole corridor stacked, is the tallest). Captured at DEVICE_SCALE_FACTOR
 * (press PNG/WebP) and again at one image pixel per CSS pixel (web WebP).
 */
export const VIEWPORT = { width: 1600, height: 2600 } as const;
export const DEVICE_SCALE_FACTOR = 2;
/** Lead image: a fixed page, captured like the body figures. */
export const HERO_PAGE = { width: 1600, height: 900 } as const;
/** Social-card (Open Graph) image: a fixed page captured at one image pixel per CSS pixel. */
export const OG_PAGE = { width: 1200, height: 630 } as const;
/** WebP quality for the web copies and JPEG quality for the social card (0-100, Chromium encoder). */
export const WEBP_QUALITY = 90;
export const JPEG_QUALITY = 85;

// MapLibre GL JS, pinned (ES module build; v6 ships no UMD bundle) and loaded from a CDN.
const MAPLIBRE_VERSION = "6.16.0";
export const MAPLIBRE_JS = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.mjs`;
export const MAPLIBRE_CSS = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`;
// OpenFreeMap vector style, no API key. Positron: a light, low-chroma basemap that keeps overlays legible.
export const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
/** First symbol layer of positron: data lines go below it, so basemap street names stay on top of them. */
export const BASEMAP_FIRST_LABEL_LAYER = "waterway_line_label";
/** Basemap layers hidden in every figure: city-scale place names ("London") that sit on the data. A name the style lacks is reported as a warning. */
export const HIDDEN_BASEMAP_LAYERS = ["label_city", "label_city_capital", "label_town", "label_village", "label_state", "label_country_1", "label_country_2", "label_country_3"];
/** Glyph stacks served by OpenFreeMap. */
export const MAP_FONT_BOLD = ["Noto Sans Bold"];

/**
 * Credit line on every image, in this one form (figures/README.md quotes it). "Powered by
 * TfL Open Data" is the attribution TfL's open-data licence asks for its counts and flows.
 */
export const CREDIT =
  "© OpenStreetMap contributors · basemap © OpenFreeMap, OpenMapTiles · Contains public sector information licensed under the Open Government Licence v3.0 · Powered by TfL Open Data · spokeplan.com";

/**
 * Jargon kept out of titles, subtitles, legends, panel labels and map labels (the
 * small notes and footer may use it): render.ts refuses a figure whose text has one.
 */
export const JARGON = /\b(LTS|Furth|gap-closing|union|contraflow|variants?)\b/i;
/**
 * Kept out of every line a reader sees (title, subtitle, legend, panel labels, callouts,
 * notes): two thoughts read better as two sentences. render.ts refuses a figure that has one.
 */
export const SEMICOLON = ";";

// Ink and chrome (dataviz reference palette, light mode).
export const INK = {
  primary: "#0b0b0b",
  secondary: "#52514e",
  muted: "#898781",
  hairline: "#e1e0d9",
  surface: "#fcfcfb",
  white: "#ffffff",
} as const;

/** Streets to convert: the northern route's set (orange) and the southern route's (deep magenta), on one side of Oxford Street each. */
export const CONVERT: Record<Side, string> = { "north-only": "#eb6834", "south-only": "#b0245c" };
/** The low-stress route a converted set opens: a dark blue, thin, over the converted streets. */
export const OPENED_ROUTE_COLOR = "#1c5cab";
/** Confident rider's shortest path: neutral dark grey. */
export const CONFIDENT_COLOR = "#3d3c39";
/** Cautious rider's route if the streets with no traffic figure are quiet (light blue) or busy (dark blue). */
export const CAUTIOUS = { low: "#6da7ec", high: "#1c5cab" } as const;

/** Stress classes: LTS 1-2 two blues (calm), LTS 3 orange (busy), LTS 4 dark orange; width grows with stress too. */
export const LTS_COLORS: Record<1 | 2 | 3 | 4, string> = { 1: "#6da7ec", 2: "#256abf", 3: "#eb6834", 4: "#8a3410" };
export const LTS_WIDTHS: Record<1 | 2 | 3 | 4, number> = { 1: 2, 2: 2.4, 3: 3, 4: 4 };
/** White casing on each side of a stress-map way (thinner than WIDTH.wayCasing: the map is dense). */
export const LTS_CASING = 1;
/**
 * Single stress map. Each trip end's reach is a wide band under the streets, in its hue
 * (Marble Arch blue #1c5cab, Tottenham Court Road teal #00918a; with the LTS 3 orange,
 * --pairs all: CVD worst pair dE 11.1, normal-vision 17.9) mixed at about a third into the
 * basemap background, opaque so crossing bands do not darken. The streets over it keep
 * the colour of what their grade rests on: stressful (the LTS 3 orange, by count or model,
 * and the few streets stressful by their lanes alone), calm by evidence (the LTS 2 blue), no
 * traffic figure (a light neutral, recessive, but darker and wider than the no-cycling grey).
 */
export const PATCH_TINTS = { A: "#a7bed8", B: "#9dd1cc" } as const;
export const CALM_COLORS = { busy: LTS_COLORS[3], calm: LTS_COLORS[2], unknown: "#a9a7a0" } as const;
/**
 * Evidence map: how firm the traffic figure behind a street to convert is, one blue
 * ramp, dark (counted) to light (no figure), clear of the routes' orange and magenta.
 * validate_palette.js --ordinal: monotone lightness, adjacent dL >= 0.06, light end 2.21:1.
 */
export const FIRMNESS_COLORS = { counted: "#0b3466", model: "#2f6dbf", none: "#7aa8e3" } as const;
/** Options chart: the reopened pedestrian zone's two segments, neutral greys (on Oxford Street dark, other streets light). */
export const REOPEN_COLORS = { oxford: "#3d3c39", other: "#a8a6a0" } as const;
export const CALM_WIDTHS = { band: 22, busy: 2.2, calm: 1.8, unknown: 1.4 } as const;
/** Not rideable by bicycle (LTS 0): a light neutral, recessive, thinner than LTS 1. */
export const UNRIDEABLE_COLOR = "#c3c2b7";
export const UNRIDEABLE_WIDTH = 1.2;
/** Motor-traffic ways that never appear in a solution: close to the basemap roads. */
export const ZERO_COUNT_COLOR = "#cfcec7";
/** Orange ordinal ramp for appearance-count classes, light (few) to dark (most). */
export const COUNT_RAMP = ["#f39360", "#e0662f", "#b84b1c", "#8a3410"] as const;

// Pedestrianised, no-cycling Oxford Street: mid grey, dashed, on a white casing.
export const PED_ZONE = { color: INK.muted, width: 4, casingWidth: 8, dash: [2, 1.4] } as const;

// Line widths in CSS pixels. The output is shown at about half its CSS width in an
// article column, so widths are roughly twice a normal web map's to survive the downscale.
export const WIDTH = {
  wayBase: 1.6, // grey context ways (count 0, unrideable)
  wayData: 4, // coloured ways (count > 0)
  wayCasing: 2, // white casing added on each side of a coloured way
  route: 6,
  converted: 12, // wide enough to show the street colour beside the two offset route directions drawn on it
  openedRoute: 2, // opened low-stress route, a thin uncased line drawn over the converted streets
  leader: 1.5, // leader line from a displaced label to its true point
} as const;
/**
 * Sideways offset of each direction of a route, CSS pixels. MapLibre offsets to the
 * right of the drawing direction, so a negative value puts A -> B and B -> A each on
 * its own left (keep-left traffic), on opposite sides of a shared street. Each line runs
 * along the edge of a converted street's band, on its white casing, so the band's colour
 * reads unmixed and matches its legend swatch.
 */
export const DIRECTION_OFFSET_PX = -(WIDTH.converted + WIDTH.openedRoute) / 2;
export const MARKER = { abRadius: 16, abStroke: 3, countPointRadius: 4, countPointStroke: 1.6 } as const;

// HTML chrome (title, legend, footer) in the system sans. Legend and label type is at
// least 22 CSS px, so >= 11 px when the 1600 px page is shown 760 px wide.
export const FONT_STACK = `system-ui, -apple-system, "Segoe UI", sans-serif`;
export const TYPE = {
  title: 40, subtitle: 24, legend: 22, panel: 24, panelNote: 22, note: 17, footer: 15,
  mapLabel: 22, abLabel: 24, heroNumber: 60, heroText: 22,
} as const;
/** Social card type: the card is shown about 500 px wide, so the title is large and the credit small. */
export const OG_TYPE = { title: 46, footer: 12, abLabel: 22, key: 28 } as const;
export const LAYOUT = { pad: 28, footerHeight: 44, panelGap: 12 } as const;

/** A trip end on a map: the marker letter, the name beside it, and anchor, the MapLibre text-anchor (the side of the name that faces the marker). */
export interface EndPoint { id: string; name: string; at: LonLat; anchor: "left" | "right" }
/** The study's trip ends (scripts/lts/route.ts POINTS) and their labels. */
export const TRIP_ENDS: EndPoint[] = [
  { id: "A", name: "Marble Arch", at: POINTS.A, anchor: "right" },
  { id: "B", name: "Tottenham Court Road", at: POINTS.B, anchor: "left" },
];

// Map frames (WGS84 degrees). A body panel is fitted to its frame at the panel width and
// the page height follows from the frame's aspect; a fixed page fits its frame inside.
export interface Bounds { minLon: number; maxLon: number; minLat: number; maxLat: number }
/** Default frame: the corridor between the trip ends. */
export const CORRIDOR_FRAME: Bounds = { minLon: -0.165, maxLon: -0.125, minLat: 51.508, maxLat: 51.522 };
/** Frequency map: the recurring streets, from Park Lane at Marble Arch to Soho and Tottenham Court Road. */
export const FREQUENCY_FRAME: Bounds = { minLon: -0.162, maxLon: -0.1255, minLat: 51.508, maxLat: 51.5195 };
/**
 * Places named on the long-trip map by hand (WGS84 degrees): the parks, at a point inside
 * each (the study's extract has no park areas and the basemap prints no park names at that
 * zoom), and two streets of the City route that lie outside the study's ways, at a point on
 * each. Those street names were read from the full OSM extract along the route
 * (data/greater-london-latest.osm.pbf, its highway ways within 15 m and parallel).
 */
export const LONG_TRIP_PLACES: { name: string; at: LonLat }[] = [
  { name: "Hyde Park", at: [-0.1655, 51.5075] },
  { name: "Green Park", at: [-0.1425, 51.5045] },
  { name: "St James’s Park", at: [-0.1335, 51.5027] },
  { name: "Constitution Hill", at: [-0.1465, 51.5025] },
  { name: "Birdcage Walk", at: [-0.1345, 51.5006] },
];
/** Stress map: the corridor with a margin, not the whole study bbox. */
export const STRESS_FRAME: Bounds = { minLon: -0.168, maxLon: -0.122, minLat: 51.507, maxLat: 51.523 };
/** Single stress map: both calm patches and the gap between them (the Marble Arch patch runs on into Hyde Park and Bayswater, cut at the frame). */
export const CALM_FRAME: Bounds = { minLon: -0.163, maxLon: -0.1275, minLat: 51.5065, maxLat: 51.519 };
