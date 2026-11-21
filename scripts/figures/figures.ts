// The article figures as data: title, legend and map panels with their MapLibre
// layers, built from the prepared data (data.ts). Every number printed on a figure
// is read from that data; page.ts turns a Figure into HTML and render.ts captures it.
import { OXFORD_FULL_WINDOW, type LonLat } from "../lts/common";
import { LOW_STRESS_MAX_RATIO } from "../lts/route";
import {
  CALM_KINDS, FIRMNESS, FREQUENCY_LABEL_MIN_COUNT, LONG_TRIP_RIDERS, MAIN_READING, OXFORD_STREET, ROUTE_KINDS, SIDES, VOLUMES,
  type CalmKind, type LongTripRider, type FC, type Feature, type FigureData, type Firmness, type FixData, type RouteKind, type Side, type Volume,
} from "./data";
import { swatch, type Figure, type Layer, type LegendItem, type Panel } from "./page";
import {
  CALM_COLORS, CALM_FRAME, CALM_WIDTHS, CAUTIOUS, CONFIDENT_COLOR, CONVERT, CORRIDOR_FRAME, COUNT_RAMP, CREDIT, DIRECTION_OFFSET_PX, FREQUENCY_FRAME, HERO_PAGE, INK,
  LTS_CASING, LTS_COLORS, LTS_WIDTHS, MAP_FONT_BOLD, MARKER, OG_PAGE, OG_TYPE, FIRMNESS_COLORS, LONG_TRIP_PLACES, OPENED_ROUTE_COLOR, PATCH_TINTS, REOPEN_COLORS, PED_ZONE, STRESS_FRAME,
  LAYOUT, TRIP_ENDS, TYPE, type EndPoint, UNRIDEABLE_COLOR, UNRIDEABLE_WIDTH, VIEWPORT, WIDTH, ZERO_COUNT_COLOR, type Bounds,
} from "./style";

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Significant figures of a distance printed on a figure. */
const KM_SIG_FIGS = 2;
const M_PER_KM = 1000;
/** A distance in km to KM_SIG_FIGS significant figures ("1.1 km"): figures never print metres to the unit. */
const km = (m: number) => `${Number((m / M_PER_KM).toPrecision(KM_SIG_FIGS))} km`;
/** A distance in whole km, or to one significant figure below 1 km, for a range in a title ("1 to 2 km"). */
/** A distance in km to one decimal, for parts that must add up visibly ("1.1 km" and "0.6 km"). */
const KM_TENTH_DECIMALS = 1;
const kmTenths = (m: number) => `${(m / M_PER_KM).toFixed(KM_TENTH_DECIMALS)} km`;
/** Below a km a length reads better in metres, rounded to this many ("about 80 m"); from a km up, as km(). */
const SHORT_LENGTH_STEP_M = 10;
const shortLength = (m: number) => (m < M_PER_KM ? `${Math.round(m / SHORT_LENGTH_STEP_M) * SHORT_LENGTH_STEP_M} m` : km(m));
const roughKm = (m: number) => (m >= M_PER_KM ? Math.round(m / M_PER_KM) : Number((m / M_PER_KM).toPrecision(1)));
const footer = (d: FigureData) => [`OpenStreetMap extract of ${d.extractDate}`, CREDIT];
/** Names in running text: "A", "A and B", "A, B and C". */
const listOf = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

// ---------------------------------------------------------------------------
// Layer builders
// ---------------------------------------------------------------------------

/** Street labels stay on one line up to this width (ems). */
const LABEL_MAX_WIDTH_EM = 24;
const LABEL_HALO_PX = 3;
const ROUND_LINE = { "line-cap": "round", "line-join": "round" };
const LABEL_PAINT = { "text-color": INK.primary, "text-halo-color": INK.white, "text-halo-width": LABEL_HALO_PX };

/** A line with a white casing underneath (casing 0: none), so it separates from the basemap and from lines it crosses. */
function casedLine(id: string, source: string, color: unknown, width: unknown, extra: { filter?: unknown; offset?: number; casing?: number } = {}): Layer[] {
  const filter = extra.filter ? { filter: extra.filter } : {};
  const offset = extra.offset ? { "line-offset": extra.offset } : {};
  const casing = extra.casing ?? WIDTH.wayCasing;
  const casingWidth = typeof width === "number" ? width + 2 * casing : ["+", width, 2 * casing];
  const main: Layer = { id, type: "line", source, ...filter, layout: ROUND_LINE, paint: { "line-color": color, "line-width": width, ...offset } };
  if (casing === 0) return [main];
  return [
    { id: `${id}-casing`, type: "line", source, ...filter, layout: ROUND_LINE, paint: { "line-color": INK.white, "line-width": casingWidth, ...offset } },
    main,
  ];
}

/**
 * Street names (feature property `text`) where the page placed them (labels.ts, page.ts):
 * the properties `anchor` and `offset` carry the placement, so MapLibre draws every one.
 */
function streetLabelLayers(source: string, size: number): Layer[] {
  return [
    { id: `${source}-leaders`, type: "line", source: `${source}-leaders`, layout: ROUND_LINE,
      paint: { "line-color": INK.primary, "line-width": WIDTH.leader } },
    { id: `${source}-text`, type: "symbol", source,
      layout: { "text-field": ["get", "text"], "text-font": MAP_FONT_BOLD, "text-size": size, "text-max-width": LABEL_MAX_WIDTH_EM,
        "text-anchor": ["get", "anchor"], "text-offset": ["array", "number", 2, ["get", "offset"]], "text-allow-overlap": true },
      paint: LABEL_PAINT },
  ];
}

/** Thin route lines, each direction offset to its own side, drawn over the streets they use. */
const openedRouteLayer = (id: string, source: string): Layer =>
  casedLine(id, source, OPENED_ROUTE_COLOR, WIDTH.openedRoute, { offset: DIRECTION_OFFSET_PX, casing: 0 })[0];

const PED_SOURCE = "ped-zone";
function pedZoneLayers(): Layer[] {
  return [
    { id: "ped-zone-casing", type: "line", source: PED_SOURCE, layout: { "line-cap": "butt", "line-join": "round" },
      paint: { "line-color": INK.white, "line-width": PED_ZONE.casingWidth } },
    { id: "ped-zone", type: "line", source: PED_SOURCE, layout: { "line-cap": "butt", "line-join": "round" },
      paint: { "line-color": PED_ZONE.color, "line-width": PED_ZONE.width, "line-dasharray": [...PED_ZONE.dash] } },
  ];
}

const inBounds = ([lon, lat]: LonLat, b: Bounds) => lon >= b.minLon && lon <= b.maxLon && lat >= b.minLat && lat <= b.maxLat;
/** The trip ends inside a frame: a marker outside it is neither drawn nor in the legend. */
const endsIn = (b: Bounds, ends: readonly EndPoint[] = TRIP_ENDS) => ends.filter((e) => inBounds(e.at, b));

const ENDS_SOURCE = "trip-ends";
const tripEnds = (b: Bounds, ends: readonly EndPoint[] = TRIP_ENDS): FC => ({
  type: "FeatureCollection",
  features: endsIn(b, ends).map((e) => ({ type: "Feature", geometry: { type: "Point", coordinates: e.at }, properties: { id: e.id, name: e.name, anchor: e.anchor } })),
});
/** A trip end's role in a one-direction panel ("Start", "Finish"), keyed by the end's id and printed under its marker. */
type EndRoles = Record<string, string>;
const ROLES_SOURCE = "trip-end-roles";
const tripEndRoles = (b: Bounds, roles: EndRoles, ends: readonly EndPoint[] = TRIP_ENDS): FC => ({
  type: "FeatureCollection",
  features: endsIn(b, ends).filter((e) => roles[e.id]).map((e) => ({ type: "Feature", geometry: { type: "Point", coordinates: e.at }, properties: { text: roles[e.id], rank: 0 } })),
});
/** Gap between the marker's edge and the role printed beside it, CSS pixels. */
const ROLE_GAP_PX = 3;
/**
 * The role is placed by the page like a street label, at one of eight spots around its
 * marker (under it where that is free), the one that covers the fewest of the panel's
 * lines, before the street labels so they keep clear of it. The spots lie this far out
 * so the diagonal ones too clear the marker's square box (radius times the square root of 2).
 */
const roleLabel = (size: number, avoid: string[]) => ({
  source: ROLES_SOURCE, size, rank: "rank", avoid, radialEm: ((MARKER.abRadius + MARKER.abStroke + ROLE_GAP_PX) * Math.SQRT2) / size,
});
/** Name offset from the marker centre, ems: clear of the marker radius. */
const END_NAME_OFFSET_EM = 1.1;
/** Trip-end names wrap at this width, ems ("Tottenham Court Road" on two lines). */
const END_NAME_MAX_WIDTH_EM = 10;
/** The marker letter is this many CSS pixels smaller than the trip-end names, so it fits inside the disc. */
const END_LETTER_SHRINK_PX = 4;
function tripEndLayers(nameSize: number): Layer[] {
  return [
    { id: "ends-circle", type: "circle", source: ENDS_SOURCE,
      paint: { "circle-radius": MARKER.abRadius, "circle-color": INK.primary, "circle-stroke-color": INK.white, "circle-stroke-width": MARKER.abStroke } },
    { id: "ends-letter", type: "symbol", source: ENDS_SOURCE,
      // Placed (so other labels keep clear of the marker) but never hidden; the padding covers the circle.
      layout: { "text-field": ["get", "id"], "text-font": MAP_FONT_BOLD, "text-size": TYPE.abLabel - END_LETTER_SHRINK_PX, "text-allow-overlap": true,
        "text-padding": MARKER.abRadius },
      paint: { "text-color": INK.white } },
    { id: "ends-name", type: "symbol", source: ENDS_SOURCE,
      layout: { "text-field": ["get", "name"], "text-font": MAP_FONT_BOLD, "text-size": nameSize, "text-anchor": ["get", "anchor"],
        "text-offset": ["match", ["get", "anchor"],
          "right", ["literal", [-END_NAME_OFFSET_EM, 0]], "left", ["literal", [END_NAME_OFFSET_EM, 0]], ["literal", [0, -END_NAME_OFFSET_EM]]],
        "text-max-width": END_NAME_MAX_WIDTH_EM, "text-allow-overlap": true },
      paint: LABEL_PAINT },
  ];
}

type PanelSpec = Omit<Panel, "labels" | "ends" | "top" | "checkLayers"> & Partial<Pick<Panel, "labels" | "top" | "checkLayers">>;
/** Every panel carries the pedestrianised Oxford Street and the trip ends in its frame (the study's, unless given) on top of its own layers. */
function panel(p: PanelSpec, d: FigureData, endNameSize: number = TYPE.abLabel, endRoles: EndRoles = {}, ends: readonly EndPoint[] = TRIP_ENDS): Panel {
  const lineSources = [...new Set([...p.lines.map((l) => l.source as string), PED_SOURCE])];
  const roles = Object.keys(endRoles).length > 0;
  return {
    ...p,
    sources: { ...p.sources, [PED_SOURCE]: d.pedZone, [ENDS_SOURCE]: tripEnds(p.bounds, ends), [ROLES_SOURCE]: tripEndRoles(p.bounds, endRoles, ends) },
    // Labels keep off the pedestrianised Oxford Street too.
    labels: [...(roles ? [roleLabel(endNameSize, lineSources)] : []), ...(p.labels ?? []).map((l) => ({ ...l, avoid: [...l.avoid, PED_SOURCE] }))],
    ends: { source: ENDS_SOURCE, radius: MARKER.abRadius, nameSize: endNameSize, nameOffsetEm: END_NAME_OFFSET_EM, nameMaxWidthEm: END_NAME_MAX_WIDTH_EM },
    lines: [...p.lines, ...pedZoneLayers()],
    symbols: [...p.symbols, ...tripEndLayers(endNameSize)],
    top: [...(p.top ?? []), ...(roles ? streetLabelLayers(ROLES_SOURCE, endNameSize) : [])],
    checkLayers: [...(p.checkLayers ?? []), "ends-name"],
  };
}

/** A frame that any coordinate widens: boundsOf(EMPTY_FRAME, ...) is the collections' bounding box. */
const EMPTY_FRAME: Bounds = { minLon: Infinity, maxLon: -Infinity, minLat: Infinity, maxLat: -Infinity };
/** Margin added to a data frame (fix and routes panels) on each side, as a fraction of its width (lon) and height (lat). */
const FIX_FRAME_MARGIN = { lon: 0.02, lat: 0.15 };
/**
 * Margin of the frames that show both sides of Oxford Street (lead image, fix-minimum):
 * their routes already span the corridor from north to south, so a little room for the
 * labels at the top and bottom edges suffices, which keeps the lead image's scale and the
 * two stacked fix-minimum maps short enough for the web.
 */
const BOTH_SIDES_MARGIN = { lon: 0.02, lat: 0.04 };
const withMargin = (b: Bounds, m: { lon: number; lat: number }): Bounds => {
  const dLon = (b.maxLon - b.minLon) * m.lon, dLat = (b.maxLat - b.minLat) * m.lat;
  return { minLon: b.minLon - dLon, maxLon: b.maxLon + dLon, minLat: b.minLat - dLat, maxLat: b.maxLat + dLat };
};
/** The frame widened to take in every coordinate of the collections. */
function boundsOf(frame: Bounds, ...collections: FC[]): Bounds {
  const b = { ...frame };
  const walk = (c: unknown): void => {
    if (typeof (c as number[])[0] === "number") {
      const [lon, lat] = c as LonLat;
      b.minLon = Math.min(b.minLon, lon); b.maxLon = Math.max(b.maxLon, lon);
      b.minLat = Math.min(b.minLat, lat); b.maxLat = Math.max(b.maxLat, lat);
    } else (c as unknown[]).forEach(walk);
  };
  for (const fc of collections) for (const f of fc.features) walk(f.geometry.coordinates);
  return b;
}

const panelLabel = (title: string, ...notes: string[]) => `<b>${title}</b>${notes.map((n) => `<span class="row">${n}</span>`).join("")}`;
const PED_LEGEND: LegendItem = { kind: "dash", label: "Oxford Street, pedestrianised, no cycling" };
/** Legend entry of the A/B markers in the frames shown, none if no marker is in frame. */
function endsLegend(...frames: Bounds[]): LegendItem[] {
  const ids = TRIP_ENDS.filter((e) => frames.some((b) => inBounds(e.at, b))).map((e) => e.id);
  return ids.length === 0 ? [] : [{ kind: "ends", ids, label: ids.length === 1 ? "Trip end" : "Trip ends" }];
}
const withFeatures = (c: FC, features: Feature[]): FC => ({ ...c, features });
/** The collection with each feature's `text` set (the property street-label layers show). */
const withText = (c: FC, text: (f: Feature) => string): FC =>
  withFeatures(c, c.features.map((f) => ({ ...f, properties: { ...f.properties, text: text(f) } })));

/**
 * The two readings of the grading: the streets still guessed are those with no count
 * and no modelled flow ("no traffic figure"), assumed quiet or busy.
 */
const NO_FIGURE = "streets with no traffic figure";
const NO_FIGURE_CAPITALISED = `${NO_FIGURE[0].toUpperCase()}${NO_FIGURE.slice(1)}`;
const READING: Record<Volume, string> = { low: "quiet", high: "busy" };
/** The low end of the readings (data.ts MAIN_READING says why the busy one is the main one). */
const LOW_END_READING: Volume = "low";
/** The readings in the order the figures give them: the main one first. */
const READINGS_MAIN_FIRST: Volume[] = [MAIN_READING, LOW_END_READING];
/** Headings of the fix-minimum panels, one per reading (busy: the main reading, quiet: the low end). */
const READING_HEADING: Record<Volume, string> = {
  high: `${NO_FIGURE_CAPITALISED} not counted as calm`,
  low: "If every street with no traffic figure were quiet",
};
/** The lead image's statement of the reading it draws, and how its callout introduces the low end. */
const MAIN_READING_STATED = `${NO_FIGURE_CAPITALISED} are not counted as calm`;
const LOW_END_IF = "If all of them were quiet";
/** The two sets of streets to convert, one per side of Oxford Street. */
const SIDE_NAME: Record<Side, string> = { "north-only": "Northern route", "south-only": "Southern route" };
const sets = (d: FigureData, v: Volume): FixData[] => SIDES.map((s) => d.fix[v][s]);
/** Converted-street swatch in the colour of a side's set. */
const convertSwatch = (side: Side) => swatch({ kind: "line", color: CONVERT[side], width: WIDTH.converted, casing: WIDTH.wayCasing, label: "" });
/**
 * The legend of the maps that draw the two sets: each marking on its own, drawn as on the
 * map (the opened route's two lines run beside a converted street, not over it, so the
 * street's colour in the legend is the colour on the map).
 */
const SETS_LEGEND: LegendItem[] = [
  ...SIDES.map((s): LegendItem => ({ kind: "line", color: CONVERT[s], width: WIDTH.converted, casing: WIDTH.wayCasing, label: `${SIDE_NAME[s]}: streets to convert` })),
  { kind: "line", color: OPENED_ROUTE_COLOR, width: WIDTH.openedRoute, pair: { offset: Math.abs(DIRECTION_OFFSET_PX) }, label: "The calm route each one opens, one line per direction" },
];

/** Metres within which a budget counts as equal to ratio x shortest (floating-point slack). */
const BUDGET_SLACK_M = 1e-6;
/** The budget is max(ratio x shortest, shortest + fixed metres); a "% longer" claim needs the ratio to bind for every trip and volume. */
function percentLonger(d: FigureData, name: string): number {
  for (const x of VOLUMES.flatMap((v) => sets(d, v))) {
    for (const trip of Object.keys(x.budgetM)) {
      if (Math.abs(x.budgetM[trip] - LOW_STRESS_MAX_RATIO * x.shortestM[trip]) > BUDGET_SLACK_M) {
        throw new Error(`${name} ${x.volume} ${x.side} ${trip}: budget ${x.budgetM[trip]} m is not ${LOW_STRESS_MAX_RATIO} x shortest; the subtitle would be wrong`);
      }
    }
  }
  return Math.round((LOW_STRESS_MAX_RATIO - 1) * 100);
}

// ---------------------------------------------------------------------------
// Lead image: the northern and the southern set on one map, main reading (its
// callout gives the low end's lengths too)
// ---------------------------------------------------------------------------

/** Converted-street labels of the sets, one per street (a street in two sets is named once, where it is longer). */
function setLabels(xs: FixData[]): FC {
  const best = new Map<string, Feature>();
  for (const f of xs.flatMap((x) => x.labels.features)) {
    const prev = best.get(f.properties.street as string);
    if (!prev || (f.properties.metres as number) > (prev.properties.metres as number)) best.set(f.properties.street as string, f);
  }
  return withText({ type: "FeatureCollection", features: [...best.values()] }, (f) => f.properties.short as string);
}

/** Sources of the sets drawn in a panel: each side's converted streets and the route it opens. */
const setSources = (xs: FixData[]): Record<string, FC> =>
  Object.fromEntries(xs.flatMap((x) => [[`converted-${x.side}`, x.converted], [`route-${x.side}`, x.route]]));
/** Converted streets first, the opened routes as thin lines on top, each direction offset to its own side. */
const setLines = (xs: FixData[]): Layer[] => [
  ...xs.flatMap((x) => casedLine(`converted-${x.side}`, `converted-${x.side}`, CONVERT[x.side], WIDTH.converted)),
  ...xs.map((x) => openedRouteLayer(`route-${x.side}`, `route-${x.side}`)),
];

/** The title's range spans the sets drawn ("about 2 km" when both round alike). */
function heroTitle(d: FigureData): string {
  const lengths = sets(d, MAIN_READING).map((x) => x.unionM);
  const [lo, hi] = [roughKm(Math.min(...lengths)), roughKm(Math.max(...lengths))];
  const range = lo === hi ? `about ${lo} km` : `${lo} to ${hi} km`;
  return `A calm route from Marble Arch to Tottenham Court Road: ${range} of street to convert`;
}

function fixHero(d: FigureData, card: boolean): Figure {
  const shown = sets(d, MAIN_READING);
  // The frame: both sets, the routes they open and the trip ends, with a thin margin for the labels at its edges.
  const bounds = withMargin(boundsOf(EMPTY_FRAME, ...shown.flatMap((x) => [x.converted, x.route]), tripEnds(CORRIDOR_FRAME)), BOTH_SIDES_MARGIN);
  // Each number says which route its colour is, so a cropped image still reads.
  const figs = shown.map((x) =>
    `<div class="fig">${convertSwatch(x.side)}<div><span class="lead">${SIDE_NAME[x.side]}:</span>` +
    `<strong>about ${km(x.unionM)}</strong><span>of street to convert</span></div></div>`).join("");
  const aside = `<div class="aside"><b>${MAIN_READING_STATED}.</b> ${LOW_END_IF}: ` +
    `${listOf(sets(d, LOW_END_READING).map((x) => `${SIDE_NAME[x.side].toLowerCase()} about ${km(x.unionM)}`))}.</div>`;
  // The card's key: one entry per colour with its length, large enough to read at half size, and the reading under it.
  const key = shown.map((x) => `<span class="item">${convertSwatch(x.side)}<span><b>${SIDE_NAME[x.side]}:</b> about ${km(x.unionM)}</span></span>`).join("");
  const sources = setSources(shown);
  const pct = percentLonger(d, "fix-hero");
  // Keep the lead image clean: name only the main anchor streets mentioned in the text (fix-minimum names every street).
  const HERO_STREETS = [...EVIDENCE_STREETS, "Portman Square", "Cavendish Square"];
  const allLabels = setLabels(shown);
  const parkLaneEdge = shown.flatMap((x) => x.converted.features).find((f) => f.properties.street === "Park Lane");
  const parkLaneLabel: Feature[] = parkLaneEdge
    ? [{
        type: "Feature",
        geometry: { type: "Point", coordinates: (parkLaneEdge.geometry.coordinates as LonLat[])[0] },
        properties: { street: "Park Lane", short: "Park Lane", text: "Park Lane", metres: 100 },
      }]
    : [];
  const heroLabels = withFeatures(allLabels, [
    ...allLabels.features.filter((f) => HERO_STREETS.includes(f.properties.street as string)),
    ...parkLaneLabel,
  ]);
  const heroLegend: LegendItem[] = [
    ...SIDES.map((s): LegendItem => ({ kind: "line", color: CONVERT[s], width: WIDTH.converted, casing: WIDTH.wayCasing, label: `${SIDE_NAME[s]} (to convert)` })),
    { kind: "line", color: OPENED_ROUTE_COLOR, width: WIDTH.openedRoute, pair: { offset: Math.abs(DIRECTION_OFFSET_PX) }, label: "Calm route opened (both ways)" },
    { kind: "dash", label: "Oxford Street (no cycling)" },
  ];
  return {
    name: card ? "fix-hero-og" : "fix-hero",
    output: card ? "card" : "article",
    title: heroTitle(d),
    subtitle: card ? undefined : `Streets to convert so a cautious rider can ride both ways, at most ${pct}% further than the shortest route`,
    // The card is seen small: its key alone, no legend row.
    legend: card ? [] : heroLegend,
    footer: footer(d),
    page: card ? OG_PAGE : HERO_PAGE,
    type: card ? { title: OG_TYPE.title, footer: OG_TYPE.footer, overlay: OG_TYPE.key } : undefined,
    panels: [panel({
      id: "main", bounds,
      overlay: card ? `<div class="key">${key}</div><p class="keynote">${MAIN_READING_STATED}</p>` : `<div class="figs">${figs}${aside}</div>`,
      // The card is seen small: no street names, only the trip ends.
      sources: card ? sources : { ...sources, labels: heroLabels },
      lines: setLines(shown),
      labels: card ? [] : [{ source: "labels", size: TYPE.mapLabel, rank: "metres", avoid: Object.keys(sources) }],
      symbols: card ? [] : streetLabelLayers("labels", TYPE.mapLabel),
    }, d, card ? OG_TYPE.abLabel : TYPE.abLabel)],
  };
}

// ---------------------------------------------------------------------------
// The streets each route would need converted, one panel per reading
// ---------------------------------------------------------------------------

/** Route swatch in a panel label: width, height and corner radius, CSS pixels. */
const PANEL_SWATCH = { w: 26, h: 6, radius: 2 } as const;
const panelSwatch = (color: string) =>
  `<i style="display:inline-block;width:${PANEL_SWATCH.w}px;height:${PANEL_SWATCH.h}px;border-radius:${PANEL_SWATCH.radius}px;background:${color}"></i>`;

function fixMinimum(d: FigureData): Figure {
  const pct = percentLonger(d, "fix-minimum");
  // One frame for both panels: every set, the routes they open and the trip ends, with
  // a margin for labels, so both readings are at one scale.
  const bounds = withMargin(boundsOf(EMPTY_FRAME, ...VOLUMES.flatMap((v) => sets(d, v).flatMap((x) => [x.converted, x.route])), tripEnds(CORRIDOR_FRAME)), BOTH_SIDES_MARGIN);
  const volumePanel = (v: Volume) => {
    const xs = sets(d, v);
    const sources = setSources(xs);
    return panel({
      id: v, label: panelLabel(READING_HEADING[v], ...xs.map((x) => `${panelSwatch(CONVERT[x.side])}${SIDE_NAME[x.side]}: about ${km(x.unionM)} of street to convert`)),
      bounds,
      sources: { ...sources, labels: setLabels(xs) },
      lines: setLines(xs),
      labels: [{ source: "labels", size: TYPE.mapLabel, rank: "metres", avoid: Object.keys(sources) }],
      symbols: streetLabelLayers("labels", TYPE.mapLabel),
    }, d);
  };
  return {
    name: "fix-minimum",
    output: "article",
    // Stacked, each panel full width: side by side, half the scale leaves no free spot
    // for about a third of the street names (two sets of a dozen streets per panel).
    stacked: true,
    title: "The streets each route would need converted",
    subtitle: `The shortest length of street to convert so a cautious rider can ride both ways, at most ${pct}% further than the shortest route`,
    legend: [
      ...SETS_LEGEND, PED_LEGEND, ...endsLegend(bounds),
    ],
    caption: [
      "Method: Furth 2017 LTS on today’s network. Traffic from counts (DfT, TfL, Camden, Westminster), then TfL’s modelled flows (LAEI 2022), then the low or high class default.",
      "Each set is the union of both directions’ smallest gap-closing sets, the search kept to one side of Oxford Street. Converted one-way streets may become two-way tracks (contraflow).",
      "Oxford Street’s pedestrianised stretch stays closed. Crossings count in the totals and show as short stubs.",
    ],
    footer: footer(d),
    // The main reading on top, the low end below.
    panels: READINGS_MAIN_FIRST.map(volumePanel),
  };
}

// ---------------------------------------------------------------------------
// Fix frequency
// ---------------------------------------------------------------------------

/** Equal classes of the run count N, one per ramp step: 1..N/k, ..., ((k-1)N/k)+1..N (floored). */
function countClasses(n: number): { min: number; max: number }[] {
  const tops = COUNT_RAMP.map((_, k) => Math.floor((n * (k + 1)) / COUNT_RAMP.length));
  return tops.map((max, k) => ({ min: k === 0 ? 1 : tops[k - 1] + 1, max }));
}

/** Footnote mark on the frequency map: Oxford Street, whose count includes runs that reopen its pedestrianised stretch. */
const OXFORD_MARK = "†";
/** Each count class of the frequency map draws its ways this many CSS pixels wider than the class below. */
const COUNT_WIDTH_STEP_PX = 1;

/** Title and subtitle of the frequency map: they name the most frequent streets. */
function frequencyHeadline(f: FigureData["frequency"], n: number): { title: string; subtitle: string } {
  if (f.streets.length === 0) throw new Error("fix-frequency: no street in any answer; nothing to name");
  const most = f.streets[0].count;
  const top = f.streets.filter((s) => s.count === most).map((s) => s.street);
  const verb = top.length === 1 ? "is" : "are";
  if (most === n) return { title: `${listOf(top)} ${verb} in every answer`, subtitle: `How often each street is among the streets to convert, across the ${n} answers` };
  return { title: "No single street is in every answer", subtitle: `${listOf(top)} ${verb} in ${most} of the ${n}` };
}

function fixFrequency(d: FigureData): Figure {
  const f = d.frequency;
  const n = f.runs.length;
  const classes = countClasses(n);
  const color = ["step", ["get", "count"], ZERO_COUNT_COLOR, ...classes.flatMap((c, k) => [c.min, COUNT_RAMP[k]])];
  const width = ["step", ["get", "count"], WIDTH.wayBase, ...classes.flatMap((c, k) => [c.min, WIDTH.wayData + k * COUNT_WIDTH_STEP_PX])];
  const { title, subtitle } = frequencyHeadline(f, n);
  const labelled = new Set(f.labels.features.map((l) => l.properties.street as string));
  const mark = (street: string) => (street === OXFORD_STREET ? OXFORD_MARK : "");
  const labels = withText(f.labels, (l) => `${l.properties.short as string} · ${l.properties.count as number}/${n}${mark(l.properties.street as string)}`);
  return {
    name: "fix-frequency",
    output: "article",
    title,
    subtitle,
    legend: [
      { kind: "ramp", title: `In how many of the ${n} answers`, steps: [
        { color: ZERO_COUNT_COLOR, label: "0" },
        ...classes.map((c, k) => ({ color: COUNT_RAMP[k], label: c.min === c.max ? `${c.min}` : `${c.min}–${c.max}` })),
      ] },
      PED_LEGEND, ...endsLegend(FREQUENCY_FRAME),
    ],
    notes: [
      `The ${n} answers: Furth 2017 LTS, ${NO_FIGURE} quiet or busy × today and three street layouts × Oxford Street closed or reopened × with or without two-way tracks.`,
      `Traffic from counts, then TfL’s modelled flows (LAEI 2022), then the guess. Labels: streets in ${FREQUENCY_LABEL_MIN_COUNT} or more of the ${n} answers, as “street · answers/${n}”.`,
      ...(labelled.has(OXFORD_STREET)
        ? [`${OXFORD_MARK} Oxford St: its count includes answers that reopen the pedestrianised stretch to cycling (${f.oxford.pedestrianised} of ${f.oxford.count}) and junction links at its open ends.`]
        : []),
    ],
    footer: footer(d),
    panels: [panel({
      id: "main", bounds: FREQUENCY_FRAME,
      // `counted`: the ways in any run, not drawn on their own, only kept clear of labels where possible.
      sources: { ways: f.ways, counted: withFeatures(f.ways, f.ways.features.filter((w) => (w.properties.count as number) > 0)), labels },
      labels: [{ source: "labels", size: TYPE.mapLabel, rank: "count", avoid: ["counted"] }],
      lines: [
        { id: "ways-zero", type: "line", source: "ways", filter: ["==", ["get", "count"], 0], layout: ROUND_LINE,
          paint: { "line-color": ZERO_COUNT_COLOR, "line-width": WIDTH.wayBase } },
        ...casedLine("ways-count", "ways", color, width, { filter: [">", ["get", "count"], 0] }),
      ],
      symbols: streetLabelLayers("labels", TYPE.mapLabel),
    }, d)],
  };
}

// ---------------------------------------------------------------------------
// Stress map
// ---------------------------------------------------------------------------

const LTS_LEVELS = [1, 2, 3, 4] as const;
/** The stress map's thin lines and rings are drawn this many CSS pixels larger in the legend, where a short swatch must still show its colour. */
const LEGEND_WIDEN_PX = 1;
/** Plain-language names of the stress levels (Furth 2017: who each level suits). */
const LTS_NAMES: Record<(typeof LTS_LEVELS)[number], string> = {
  1: "Calmest, fit for children",
  2: "Calm, fit for a cautious adult",
  3: "Stressful, confident riders only",
  4: "Very stressful",
};

/** The two-panel stress map, one panel per reading (linked from docs/article-notes.md). */
function stressMapReadings(d: FigureData): Figure {
  // The title says no reading has a low-stress way through; check that against the grading drawn.
  const through = VOLUMES.flatMap((v) => Object.entries(d.connected[v]).filter(([, yes]) => yes).map(([trip]) => `${v} ${trip}`));
  if (through.length > 0) throw new Error(`stress-map: a low-stress path exists (${through.join(", ")}); the title would be wrong`);
  // data.ts rejects any LTS outside 0-4, so the fallback colour is never drawn.
  const ltsColor = ["match", ["get", "lts"], 1, LTS_COLORS[1], 2, LTS_COLORS[2], 3, LTS_COLORS[3], 4, LTS_COLORS[4], INK.primary];
  const ltsWidth = ["match", ["get", "lts"], 1, LTS_WIDTHS[1], 2, LTS_WIDTHS[2], 3, LTS_WIDTHS[3], 4, LTS_WIDTHS[4], WIDTH.wayBase];
  const present = new Set(VOLUMES.flatMap((v) => d.lts[v].features.map((f) => f.properties.lts as number)));
  const volumePanel = (v: Volume) => panel({
    id: v, label: panelLabel(`${NO_FIGURE_CAPITALISED} assumed ${READING[v]}`), bounds: STRESS_FRAME,
    sources: { ways: d.lts[v], counts: d.counts.points },
    lines: [
      { id: "unrideable", type: "line", source: "ways", filter: ["==", ["get", "lts"], 0], layout: ROUND_LINE,
        paint: { "line-color": UNRIDEABLE_COLOR, "line-width": UNRIDEABLE_WIDTH } },
      ...casedLine("lts", "ways", ltsColor, ltsWidth, { filter: [">", ["get", "lts"], 0], casing: LTS_CASING }),
    ],
    symbols: [{ id: "counts", type: "circle", source: "counts",
      paint: { "circle-radius": MARKER.countPointRadius, "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": INK.secondary, "circle-stroke-width": MARKER.countPointStroke } }],
  }, d);
  const { dft, published } = d.counts.years;
  const yearRule = dft.estimated > 0 ? `latest counted year per point (latest estimate for the ${dft.estimated} never counted)` : "latest counted year per point";
  return {
    name: "stress-map-readings",
    output: "article",
    title: "No low-stress way through: stressful streets wall off Marble Arch from Tottenham Court Road",
    subtitle: `Left: ${NO_FIGURE} assumed ${READING.low}. Right: assumed ${READING.high}`,
    legend: [
      // A level no way has is left out of the legend (the caption says why for LTS 4).
      ...LTS_LEVELS.filter((l) => present.has(l))
        .map((l): LegendItem => ({ kind: "line", color: LTS_COLORS[l], width: LTS_WIDTHS[l] + LEGEND_WIDEN_PX, casing: LTS_CASING, label: LTS_NAMES[l] })),
      { kind: "line", color: UNRIDEABLE_COLOR, width: UNRIDEABLE_WIDTH + LEGEND_WIDEN_PX, label: "No cycling" },
      { kind: "ring", color: INK.secondary, radius: MARKER.countPointRadius + LEGEND_WIDEN_PX, strokeWidth: MARKER.countPointStroke, label: "Traffic count" },
      PED_LEGEND, ...endsLegend(STRESS_FRAME),
    ],
    caption: [
      `Stress: Furth 2017 Level of Traffic Stress, LTS 1 and 2 blue, LTS 3 orange${present.has(4) ? ", LTS 4 dark orange" : ""}.`,
      "Traffic: a count on the street or carried along its road, else TfL’s modelled flow (LAEI 2022), else the low or high class default volume.",
      `Traffic counts: ${dft.points} DfT count points, ${yearRule}, ${dft.minYear}–${dft.maxYear}, ${dft.stale} predate ${d.counts.staleBefore}. ` +
        `${published.points} published counts (TfL, Camden, Westminster), ${published.minYear}–${published.maxYear}.`,
      ...(present.has(4) ? [] : ["No street is graded LTS 4 here: almost every street is 20 mph, and the Furth 2017 columns read at 20 mph have no LTS 4."]),
    ],
    footer: footer(d),
    panels: VOLUMES.map(volumePanel),
  };
}

/**
 * The single stress map, on the generous grading: every street keeps the colour of what its
 * grade rests on (too busy by count or TfL's model, calm by evidence, no traffic figure),
 * and each trip end's reach is a shaded area under the streets, so a reader sees how much
 * of each area is unknown.
 */
function stressMap(d: FigureData): Figure {
  const c = d.calm;
  // The title says no calm way through and that measured streets alone keep the ends apart; check both.
  const through = Object.entries(c.connected).filter(([, yes]) => yes).map(([trip]) => trip);
  if (c.sharedNodes > 0 || c.sharedIfLayoutPassable > 0 || through.length > 0) {
    throw new Error(`stress-map: the ends share ${c.sharedNodes} nodes (${c.sharedIfLayoutPassable} with lane-only streets passable), calm paths ${through.join(", ") || "none"}; the title would be wrong`);
  }
  const ofKind = (kind: CalmKind) => withFeatures(c.ways, c.ways.features.filter((f) => f.properties.kind === kind));
  const bandSource = (end: string) => `reach-${end}`;
  const sources: Record<string, FC> = {
    ...Object.fromEntries(Object.values(CALM_KINDS).map((k) => [k, ofKind(k)])),
    ...Object.fromEntries(c.patches.map((x) => [bandSource(x.end), x.band])),
    // A wall street named like a trip end (the road called Marble Arch) is left unlabelled: the trip end's own name already sits there.
    labels: withText(withFeatures(c.wall, c.wall.features.filter((f) => !TRIP_ENDS.some((e) => e.name === f.properties.street))),
      (f) => f.properties.short as string),
  };
  const plain = (id: string, source: string, color: string, width: number): Layer =>
    ({ id, type: "line", source, layout: ROUND_LINE, paint: { "line-color": color, "line-width": width } });
  const tint = (end: string) => PATCH_TINTS[end as keyof typeof PATCH_TINTS];
  return {
    name: "stress-map",
    output: "article",
    title: "No calm way through: busy streets cut Marble Arch off from Tottenham Court Road",
    subtitle: "Even assuming every unmeasured grey street is quiet, the blue and teal zones never meet",
    // Five entries, kept short: the no-cycling ways and the trip ends are on the map but need no key.
    legend: [
      { kind: "bands", colors: c.patches.map((x) => tint(x.end)), label: "Reachable from each end without touching an orange street" },
      { kind: "line", color: CALM_COLORS.busy, width: CALM_WIDTHS.busy + LEGEND_WIDEN_PX, label: "Too busy (count or TfL model)" },
      { kind: "line", color: CALM_COLORS.calm, width: CALM_WIDTHS.calm + LEGEND_WIDEN_PX, label: "Calm on the evidence" },
      { kind: "line", color: CALM_COLORS.unknown, width: CALM_WIDTHS.unknown + LEGEND_WIDEN_PX, label: "No traffic figure" },
      { kind: "dash", label: "Oxford Street (no cycling)" },
    ],
    caption: [
      `${NO_FIGURE_CAPITALISED} have neither a count nor a modelled flow. The study’s main reading does not count them as calm.`,
      "Method: Furth 2017 LTS on today’s network, traffic from counts (DfT, TfL, Camden, Westminster) and TfL’s modelled flows (LAEI 2022).",
      `About ${roughKm(c.frameMetres[CALM_KINDS.layout])} km of the orange is stressful by its lane layout and has no traffic figure. Reach runs forward from each trip end, keeping to one-way rules, with unmeasured streets treated as passable.`,
    ],
    footer: footer(d),
    panels: [panel({
      id: "main", bounds: CALM_FRAME, sources,
      // Reach bands first, every street over them, the measured streets last so they read as the wall.
      lines: [
        ...c.patches.map((x) => plain(`${bandSource(x.end)}-band`, bandSource(x.end), tint(x.end), CALM_WIDTHS.band)),
        plain(CALM_KINDS.none, CALM_KINDS.none, UNRIDEABLE_COLOR, UNRIDEABLE_WIDTH),
        plain(CALM_KINDS.unknown, CALM_KINDS.unknown, CALM_COLORS.unknown, CALM_WIDTHS.unknown),
        plain(CALM_KINDS.calm, CALM_KINDS.calm, CALM_COLORS.calm, CALM_WIDTHS.calm),
        // Stressful by lanes alone: drawn like the rest of the orange, the note says how much of it there is.
        plain(CALM_KINDS.layout, CALM_KINDS.layout, CALM_COLORS.busy, CALM_WIDTHS.busy),
        plain(CALM_KINDS.busy, CALM_KINDS.busy, CALM_COLORS.busy, CALM_WIDTHS.busy),
      ],
      // Labels keep off the reach areas; the measured streets are everywhere, so avoiding them would push every label far out on a leader.
      labels: [{ source: "labels", size: TYPE.mapLabel, rank: "metres", avoid: c.patches.map((x) => bandSource(x.end)) }],
      symbols: streetLabelLayers("labels", TYPE.mapLabel),
    }, d)],
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const ROUTE_STYLE: Record<RouteKind, { color: string; offset: number; legend: string; short: string }> = {
  confident: { color: CONFIDENT_COLOR, offset: 0, legend: "Confident rider, shortest path", short: "confident" },
  // "Busy" here is the reading of the streets with no traffic figure, not a street's grade.
  "cautious-low": { color: CAUTIOUS.low, offset: WIDTH.route, legend: `Cautious rider, if ${NO_FIGURE} are ${READING.low}`, short: `cautious, if ${NO_FIGURE} are ${READING.low}` },
  "cautious-high": { color: CAUTIOUS.high, offset: -WIDTH.route, legend: `Cautious rider, if ${NO_FIGURE} are ${READING.high}`, short: `cautious, if ${NO_FIGURE} are ${READING.high}` },
};
/** White casing on each side of a route line, CSS pixels (thinner than WIDTH.wayCasing: three routes share streets). */
const ROUTE_CASING_PX = 1.5;
const TRIP_TITLE: Record<string, string> = {
  "A-B": "Eastbound: Marble Arch to Tottenham Court Road",
  "B-A": "Westbound: Tottenham Court Road to Marble Arch",
};
/** Both panels show A on the left and B on the right, so each names its start and finish at the markers. A trip id is "<from>-<to>". */
const tripRoles = (trip: string): EndRoles => {
  const [from, to] = trip.split("-");
  return { [from]: "Start", [to]: "Finish" };
};

function routesFigure(d: FigureData): Figure {
  // Both panels share one frame: every route and the trip ends, with the same margins as the fix panels.
  const bounds = withMargin(boundsOf(EMPTY_FRAME, ...d.routes.map((r) => r.routes), tripEnds(CORRIDOR_FRAME)), FIX_FRAME_MARGIN);
  const w = d.routes[0].cautiousWeights;
  return {
    name: "routes",
    output: "article",
    title: "Where the study’s routing sends a confident and a cautious rider today",
    subtitle: "Shortest paths on open map data, not SpokePlan’s routes",
    legend: [
      ...ROUTE_KINDS.map((k): LegendItem => ({ kind: "line", color: ROUTE_STYLE[k].color, width: WIDTH.route, casing: ROUTE_CASING_PX, label: ROUTE_STYLE[k].legend })),
      PED_LEGEND, ...endsLegend(bounds),
    ],
    caption: [
      "Method: Furth 2017 LTS on today’s network. Traffic from counts, then TfL’s modelled flows (LAEI 2022), then the low or high class default.",
      `The cautious rider counts LTS 3 metres ×${w.lts3} and LTS 4 ×${w.lts4}. Street names: the confident path’s longest streets, Oxford Street aside. Routes that share a street are drawn side by side.`,
    ],
    footer: footer(d),
    panels: d.routes.map((r) => panel({
      id: r.trip,
      label: panelLabel(TRIP_TITLE[r.trip], ...ROUTE_KINDS.map((k) => `${panelSwatch(ROUTE_STYLE[k].color)}${ROUTE_STYLE[k].short} ${km(r.distanceM[k])}`)),
      bounds,
      sources: {
        ...Object.fromEntries(ROUTE_KINDS.map((k) => [k, withFeatures(r.routes, r.routes.features.filter((f) => f.properties.kind === k))])),
        labels: withText(r.confidentLabels, (f) => f.properties.short as string),
      },
      // Widest-offset routes first; the confident route (no offset) on top.
      lines: [...ROUTE_KINDS].reverse().flatMap((k) => casedLine(`route-${k}`, k, ROUTE_STYLE[k].color, WIDTH.route, { offset: ROUTE_STYLE[k].offset, casing: ROUTE_CASING_PX })),
      labels: [{ source: "labels", size: TYPE.mapLabel, rank: "metres", avoid: [...ROUTE_KINDS] }],
      symbols: streetLabelLayers("labels", TYPE.mapLabel),
    }, d, TYPE.abLabel, tripRoles(r.trip))),
  };
}

// ---------------------------------------------------------------------------
// Options chart: what a calm route would take, main reading
// ---------------------------------------------------------------------------

/**
 * Options chart geometry, CSS pixels: each row is its name line with the bar under it;
 * room kept right of the longest bar for its value; the gap before a value; text sizes.
 */
const CHART = { valueRoomW: 230, barH: 46, nameGap: 12, rowGap: 34, valueGap: 14, nameSize: 26, descSize: 22, valueSize: 28, segSize: 21, segPad: 12 } as const;
/** Text width estimate for fitting a segment label inside its segment, ems per character (bold system sans, generous). */
const CHART_CHAR_EM = 0.6;
/** Baseline of the value and segment labels within the bar, as a fraction of the bar height. */
const CHART_BAR_BASELINE = 0.68;

interface ChartRow { name: string; desc: string; segments: { m: number; color: string; label?: string; ink?: string }[] }

/** Horizontal bars, one row per option (name line above its bar), a value label at each bar's end and a label inside each named segment. */
function barChart(rows: ChartRow[], width: number): { svg: string; height: number } {
  const maxM = Math.max(...rows.map((r) => r.segments.reduce((s, x) => s + x.m, 0)));
  const scale = (width - CHART.valueRoomW) / maxM;
  const rowH = CHART.nameSize + CHART.nameGap + CHART.barH + CHART.rowGap;
  const body = rows.map((r, i) => {
    const top = i * rowH;
    const barY = top + CHART.nameSize + CHART.nameGap;
    let x = 0;
    const segs = r.segments.map((seg) => {
      const w = seg.m * scale;
      const fits = seg.label !== undefined && seg.label.length * CHART_CHAR_EM * CHART.segSize + 2 * CHART.segPad <= w;
      if (seg.label !== undefined && !fits) throw new Error(`options: segment label "${seg.label}" does not fit its ${Math.round(w)} px`);
      const out = `<rect x="${x}" y="${barY}" width="${w}" height="${CHART.barH}" fill="${seg.color}"/>` +
        (seg.label ? `<text x="${x + CHART.segPad}" y="${barY + CHART.barH * CHART_BAR_BASELINE}" font-size="${CHART.segSize}" font-weight="600" fill="${seg.ink ?? INK.white}">${seg.label}</text>` : "");
      x += w;
      return out;
    }).join("");
    const total = r.segments.reduce((s, seg) => s + seg.m, 0);
    return `<text x="0" y="${top + CHART.nameSize}" font-size="${CHART.nameSize}" font-weight="700" fill="${INK.primary}">${r.name}` +
      `<tspan font-size="${CHART.descSize}" font-weight="400" fill="${INK.secondary}"> · ${r.desc}</tspan></text>` + segs +
      `<text x="${x + CHART.valueGap}" y="${barY + CHART.barH * CHART_BAR_BASELINE}" font-size="${CHART.valueSize}" font-weight="700" fill="${INK.primary}">about ${km(total)}</text>`;
  }).join("");
  const height = rows.length * rowH - CHART.rowGap;
  return { svg: `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`, height };
}

function optionsChart(d: FigureData): Figure {
  const pct = percentLonger(d, "options");
  const [north, south] = sets(d, MAIN_READING);
  const r = d.options.reopen;
  const rows: ChartRow[] = [
    { name: SIDE_NAME[north.side], desc: "streets north of Oxford Street", segments: [{ m: north.unionM, color: CONVERT[north.side] }] },
    { name: SIDE_NAME[south.side], desc: "streets south of Oxford Street", segments: [{ m: south.unionM, color: CONVERT[south.side] }] },
    { name: "Bikes back through the pedestrian zone", desc: "on a cycle track, both ways", segments: [
      { m: r.oxfordM, color: REOPEN_COLORS.oxford, label: `on Oxford Street, ${kmTenths(r.oxfordM)}` },
      { m: r.otherM, color: REOPEN_COLORS.other, label: `other streets, ${kmTenths(r.otherM)}`, ink: INK.primary },
    ] },
  ];
  return {
    name: "options",
    output: "article",
    title: "Three ways to a calm route: how much street each would convert",
    subtitle: `Street to convert so a cautious rider can ride both ways, at most ${pct}% further than the shortest route`,
    legend: [],
    notes: [`${NO_FIGURE_CAPITALISED} are not counted as calm.`],
    caption: [
      "Method: Furth 2017 LTS on today’s network, traffic from counts and TfL’s modelled flows. Northern and southern route: the search kept to one side of Oxford Street.",
      "Pedestrian zone: the search may also convert Oxford Street’s pedestrianised stretch to a two-way cycle track. Converted one-way streets may become two-way tracks.",
    ],
    footer: footer(d),
    chart: barChart(rows, VIEWPORT.width - 2 * LAYOUT.pad),
    panels: [],
  };
}

// ---------------------------------------------------------------------------
// Evidence map: where the traffic figure behind each street to convert comes from
// ---------------------------------------------------------------------------

/** Streets named on the evidence map. */
const EVIDENCE_STREETS = [
  "Wigmore Street", "Mortimer Street", OXFORD_STREET, "Upper Brook Street", "Brook Street", "Great Marlborough Street", "Noel Street", "Soho Square",
];
/** Each class in the evidence key, after a route's name. */
const FIRMNESS_KEY: Record<Firmness, string> = { counted: "counted", model: "TfL’s model", none: "no traffic figure" };
const FIRMNESS_LEGEND: Record<Firmness, string> = {
  counted: "Counted, on the street or along the same road", model: "TfL’s model", none: "No traffic figure",
};
/** The title's claim needs each route's firmest-named class to carry more than this share of its metres. */
const EVIDENCE_MAJORITY = 0.5;
/** Colour swatch before each class in the evidence key, CSS pixels. */
const KEY_DOT_PX = 16;

function evidenceMap(d: FigureData): Figure {
  const xs = sets(d, MAIN_READING);
  const [north, south] = xs.map((x) => d.evidence.sides[x.side].metres);
  const share = (m: Record<Firmness, number>, k: Firmness) => m[k] / FIRMNESS.reduce((s, f) => s + m[f], 0);
  if (share(north, "counted") <= EVIDENCE_MAJORITY || share(south, "model") <= EVIDENCE_MAJORITY) {
    throw new Error(`evidence: counted share north ${share(north, "counted")}, model share south ${share(south, "model")}; the title would be wrong`);
  }
  // The lead image's frame, so the two maps line up.
  const bounds = withMargin(boundsOf(EMPTY_FRAME, ...xs.flatMap((x) => [x.converted, x.route]), tripEnds(CORRIDOR_FRAME)), BOTH_SIDES_MARGIN);
  const all = setLabels(xs);
  const missing = EVIDENCE_STREETS.filter((s) => !all.features.some((f) => f.properties.street === s));
  if (missing.length > 0) throw new Error(`evidence: no street to convert named ${missing.join(", ")}`);
  const labels = withFeatures(all, all.features.filter((f) => EVIDENCE_STREETS.includes(f.properties.street as string)));
  const source = (side: Side) => `evidence-${side}`;
  const sources: Record<string, FC> = Object.fromEntries(xs.map((x) => [source(x.side), d.evidence.sides[x.side].converted]));
  const color = ["match", ["get", "firmness"], ...FIRMNESS.flatMap((k) => [k, FIRMNESS_COLORS[k]]), INK.primary];
  const dot = (k: Firmness) => `<i style="display:inline-block;width:${KEY_DOT_PX}px;height:${KEY_DOT_PX}px;border-radius:2px;background:${FIRMNESS_COLORS[k]};margin:0 6px 0 14px"></i>`;
  const key = xs.map((x) => {
    const m = d.evidence.sides[x.side].metres;
    return `<div><b>${SIDE_NAME[x.side]}, about ${km(x.unionM)}:</b>${FIRMNESS.map((k) => `${dot(k)}${FIRMNESS_KEY[k]} about ${shortLength(m[k])}`).join("")}</div>`;
  }).join("");
  return {
    name: "evidence",
    output: "article",
    title: "The northern route rests on counts, the southern on TfL’s model",
    subtitle: "The streets each route would convert, by where the traffic figure behind each stretch comes from",
    legend: [
      ...FIRMNESS.map((k): LegendItem => ({ kind: "line", color: FIRMNESS_COLORS[k], width: WIDTH.converted, casing: WIDTH.wayCasing, label: FIRMNESS_LEGEND[k] })),
      PED_LEGEND, ...endsLegend(bounds),
    ],
    caption: [
      `${NO_FIGURE_CAPITALISED} are not counted as calm.`,
      "Counted: a DfT or published count (TfL, Camden, Westminster) on the street or carried along the same road. TfL’s model: the London Atmospheric Emissions Inventory 2022 flows.",
    ],
    footer: footer(d),
    panels: [panel({
      id: "main", bounds, overlay: key,
      sources: { ...sources, labels },
      lines: xs.flatMap((x) => casedLine(source(x.side), source(x.side), color, WIDTH.converted)),
      labels: [{ source: "labels", size: TYPE.mapLabel, rank: "metres", avoid: Object.keys(sources) }],
      symbols: streetLabelLayers("labels", TYPE.mapLabel),
    }, d)],
  };
}

// ---------------------------------------------------------------------------
// Long trip: SpokePlan's Road and City routes across the West End
// ---------------------------------------------------------------------------

/** Streets named on the long-trip map, per route: each must be on its route in the study's extract. */
const LONG_TRIP_LABELS: Record<LongTripRider, string[]> = {
  road: ["West Carriage Drive", "Upper Brook Street", "Brook Street", "Great Marlborough Street"],
  city: ["Victoria Embankment", "Drury Lane"],
};
/** The two routes: SpokePlan's Road preset (the confident rider's grey) and its City preset (the cautious rider's blue). */
const LONG_TRIP_STYLE: Record<LongTripRider, { color: string; offset: number; name: string }> = {
  road: { color: CONFIDENT_COLOR, offset: 0, name: "Road preset" },
  // Beside the Road route where the two share a street.
  city: { color: CAUTIOUS.high, offset: WIDTH.route, name: "City preset" },
};
/** The two ends of the long trip, named as the article names them; the marker letter is S (start) and F (finish). */
const LONG_TRIP_END_NAMES = { start: "Hammersmith", finish: "Russell Square" } as const;
const LONG_TRIP_IDS = { start: "S", finish: "F" } as const;

function longTripFigure(d: FigureData): Figure {
  const t = d.longTrip;
  const routeCoords = (r: LongTripRider) => t.routes[r].line.features[0].geometry.coordinates as LonLat[];
  // The title says the City route goes round the West End: across Oxford Street's length, it stays south of the Road route.
  const across = (r: LongTripRider) => routeCoords(r).filter(([lon]) => lon >= OXFORD_FULL_WINDOW.minLon && lon <= OXFORD_FULL_WINDOW.maxLon).map(([, lat]) => lat);
  const cityNorth = Math.max(...across("city")), roadSouth = Math.min(...across("road"));
  if (!(cityNorth < roadSouth)) throw new Error(`long-trip: across the West End the City route reaches ${cityNorth}, the Road route dips to ${roadSouth}; the title would be wrong`);
  if (t.overlap.totalM === 0) throw new Error("long-trip: the Road route uses none of the southern route's streets; drop the underlay and its legend entry");
  const ends: EndPoint[] = [
    { id: LONG_TRIP_IDS.start, name: LONG_TRIP_END_NAMES.start, at: t.start, anchor: "right" },
    { id: LONG_TRIP_IDS.finish, name: LONG_TRIP_END_NAMES.finish, at: t.finish, anchor: "left" },
  ];
  const bounds = withMargin(boundsOf(EMPTY_FRAME, ...LONG_TRIP_RIDERS.map((r) => t.routes[r].line)), FIX_FRAME_MARGIN);
  const labels = LONG_TRIP_RIDERS.flatMap((r) => {
    const fs = t.routes[r].labels.features.filter((f) => LONG_TRIP_LABELS[r].includes(f.properties.street as string));
    const missing = LONG_TRIP_LABELS[r].filter((s) => !fs.some((f) => f.properties.street === s));
    if (missing.length > 0) throw new Error(`long-trip: the ${r} route does not run along ${missing.join(", ")} in the study's extract`);
    return fs;
  });
  // The places named by hand (parks, and City-route streets outside the study's ways), ranked above the other names so they keep their spot.
  const parks: Feature[] = LONG_TRIP_PLACES.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: p.at }, properties: { street: p.name, short: p.name, metres: Infinity } }));
  const key = LONG_TRIP_RIDERS.map((r) => `<div><b>${LONG_TRIP_STYLE[r].name}:</b> ${kmTenths(t.routes[r].plannerM)}</div>`).join("");
  const routeSource = (r: LongTripRider) => `route-${r}`;
  const OVERLAP_SOURCE = "southern-streets";
  return {
    name: "long-trip",
    output: "article",
    title: "A longer trip: the City route goes round the West End",
    subtitle: "SpokePlan’s routes from Hammersmith to Russell Square: its Road preset and its City preset",
    legend: [
      ...LONG_TRIP_RIDERS.map((r): LegendItem => ({ kind: "line", color: LONG_TRIP_STYLE[r].color, width: WIDTH.route, casing: ROUTE_CASING_PX, label: LONG_TRIP_STYLE[r].name })),
      { kind: "line", color: CONVERT["south-only"], width: WIDTH.converted, casing: WIDTH.wayCasing, label: "Streets the southern route would convert" },
      PED_LEGEND,
    ],
    caption: ["Routes as returned by SpokePlan on 16 November 2026. They are the planner’s own routes, not the study’s grading."],
    footer: footer(d),
    panels: [panel({
      id: "main", bounds, overlay: key,
      sources: {
        [OVERLAP_SOURCE]: t.overlap.converted,
        ...Object.fromEntries(LONG_TRIP_RIDERS.map((r) => [routeSource(r), t.routes[r].line])),
        labels: withText({ type: "FeatureCollection", features: [...parks, ...labels] }, (f) => f.properties.short as string),
      },
      // The southern route's streets under the Road route, then the City route, the Road route on top.
      lines: [
        ...casedLine(OVERLAP_SOURCE, OVERLAP_SOURCE, CONVERT["south-only"], WIDTH.converted),
        ...[...LONG_TRIP_RIDERS].reverse().flatMap((r) => casedLine(routeSource(r), routeSource(r), LONG_TRIP_STYLE[r].color, WIDTH.route, { casing: ROUTE_CASING_PX, offset: LONG_TRIP_STYLE[r].offset })),
      ],
      labels: [{ source: "labels", size: TYPE.mapLabel, rank: "metres", avoid: [OVERLAP_SOURCE, ...LONG_TRIP_RIDERS.map(routeSource)] }],
      symbols: streetLabelLayers("labels", TYPE.mapLabel),
    }, d, TYPE.abLabel, {}, ends)],
  };
}

export const FIGURES: Record<string, (d: FigureData) => Figure> = {
  "fix-hero": (d) => fixHero(d, false),
  "fix-hero-og": (d) => fixHero(d, true),
  "fix-minimum": fixMinimum,
  "stress-map": stressMap,
  "stress-map-readings": stressMapReadings,
  options: optionsChart,
  evidence: evidenceMap,
  "long-trip": longTripFigure,
  "fix-frequency": fixFrequency,
  routes: routesFigure,
};
