// Street-label placement for the figure pages. MapLibre's own placement drops a
// label that collides, and hand-placed leaders break whenever the results change,
// so each page places its street labels itself, greedily and deterministically:
// highest rank first, each label takes the cheapest free spot among eight positions
// around its point and, failing those, positions further out joined by a leader line.
// "Free" means clear of the panel edge, the label and overlay boxes, the trip-end
// markers and names, and the labels and leaders already placed; "cheap" means
// covering few of the data lines (sampled points) and other labels' points.
// placeLabels runs in the page: page.ts embeds it with Function.prototype.toString,
// so it must stay self-contained (no imports or module-level references at runtime).

export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface LabelPoint { x: number; y: number; text: string; rank: number }
export interface Placement {
  /** MapLibre text-anchor: the side of the text nearest its point. */
  anchor: string;
  /** MapLibre text-offset, ems. */
  offset: [number, number];
  /** Where the label moved, CSS pixels from its point, or null: placed beside the point, no leader. */
  displace: [number, number] | null;
  /** The label's box (text and halo), CSS pixels in the map. */
  box: Box;
}
type Spot = Omit<Placement, "box">;
export interface PlaceInput {
  points: LabelPoint[];
  size: number; // text size, CSS pixels
  font: string; // CSS font of the measuring canvas (the map glyphs are close to it; widthFactor covers the rest)
  widthFactor: number;
  halo: number; // CSS pixels around the text that count as the label
  obstacles: Box[];
  samples: { x: number; y: number }[];
  view: { width: number; height: number; edge: number };
  radialEm: number;
  leaderRadiiEm: number[];
  leaderAngles: number;
  /** Cost of a leader, in covered samples, plus one per em of leader length. */
  leaderCost: number;
  /** Cost of covering another label's point, in covered samples. */
  pointCost: number;
}

/** One placement per point (in input order), or null where no free spot was found. */
export function placeLabels(input: PlaceInput): (Placement | null)[] {
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.font = input.font;
  const { size, halo } = input;
  // MapLibre lays a text line out 1.2 em tall.
  const height = size * 1.2 + 2 * halo;
  const DIAGONAL = Math.SQRT1_2;
  // Direction from the point to the text for each anchor (y down).
  const DIRECT: [string, number, number][] = [
    ["top", 0, 1], ["bottom", 0, -1], ["left", 1, 0], ["right", -1, 0],
    ["top-left", DIAGONAL, DIAGONAL], ["top-right", -DIAGONAL, DIAGONAL], ["bottom-left", DIAGONAL, -DIAGONAL], ["bottom-right", -DIAGONAL, -DIAGONAL],
  ];
  // A leader direction whose component is below this (cos 67.5 deg) is treated as zero when choosing the anchor.
  const AXIS_MIN = 0.38;
  const SEGMENT_STEP_PX = 3;

  const boxAt = (x: number, y: number, w: number, anchor: string): Box => {
    const x0 = anchor.endsWith("left") ? x : anchor.endsWith("right") ? x - w : x - w / 2;
    const y0 = anchor.startsWith("top") ? y : anchor.startsWith("bottom") ? y - height : y - height / 2;
    return { x0, y0, x1: x0 + w, y1: y0 + height };
  };
  const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const inside = (b: Box, x: number, y: number) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
  const inView = (b: Box) => b.x0 >= input.view.edge && b.y0 >= input.view.edge &&
    b.x1 <= input.view.width - input.view.edge && b.y1 <= input.view.height - input.view.edge;

  const placedBoxes: Box[] = [];
  const leaders: [number, number, number, number][] = [];
  const segmentHits = (s: [number, number, number, number], boxes: Box[]) => {
    const n = Math.max(1, Math.ceil(Math.hypot(s[2] - s[0], s[3] - s[1]) / SEGMENT_STEP_PX));
    for (let i = 0; i <= n; i++) {
      const x = s[0] + ((s[2] - s[0]) * i) / n, y = s[1] + ((s[3] - s[1]) * i) / n;
      if (boxes.some((b) => inside(b, x, y))) return true;
    }
    return false;
  };

  const out: (Placement | null)[] = input.points.map(() => null);
  const order = input.points.map((_, i) => i).sort((a, b) => input.points[b].rank - input.points[a].rank || a - b);
  for (const i of order) {
    const p = input.points[i];
    const w = ctx.measureText(p.text).width * input.widthFactor + 2 * halo;
    let best: { cost: number; placement: Spot; box: Box; leader: [number, number, number, number] | null } | null = null;
    const consider = (box: Box, placement: Spot, base: number, leader: [number, number, number, number] | null) => {
      if (!inView(box) || input.obstacles.some((o) => overlaps(o, box)) || placedBoxes.some((o) => overlaps(o, box))) return;
      if (leaders.some((s) => segmentHits(s, [box]))) return;
      if (leader && segmentHits(leader, [...placedBoxes, ...input.obstacles])) return;
      const covered = input.samples.filter((s) => inside(box, s.x, s.y)).length;
      const points = input.points.filter((q, j) => j !== i && inside(box, q.x, q.y)).length;
      const cost = base + covered + points * input.pointCost;
      if (!best || cost < best.cost) best = { cost, placement, box, leader };
    };
    for (const [anchor, dx, dy] of DIRECT) {
      const r = input.radialEm * size;
      consider(boxAt(p.x + dx * r, p.y + dy * r, w, anchor), { anchor, offset: [dx * input.radialEm, dy * input.radialEm], displace: null }, 0, null);
    }
    for (const rEm of input.leaderRadiiEm) {
      for (let k = 0; k < input.leaderAngles; k++) {
        const angle = (2 * Math.PI * k) / input.leaderAngles;
        const ux = Math.cos(angle), uy = Math.sin(angle);
        const h = ux > AXIS_MIN ? "left" : ux < -AXIS_MIN ? "right" : "";
        const v = uy > AXIS_MIN ? "top" : uy < -AXIS_MIN ? "bottom" : "";
        const anchor = v && h ? `${v}-${h}` : v || h;
        const x = p.x + ux * rEm * size, y = p.y + uy * rEm * size;
        consider(boxAt(x, y, w, anchor), { anchor, offset: [0, 0], displace: [x - p.x, y - p.y] }, input.leaderCost + rEm, [p.x, p.y, x, y]);
      }
    }
    if (best === null) continue;
    const chosen: { placement: Spot; box: Box; leader: [number, number, number, number] | null } = best;
    out[i] = { ...chosen.placement, box: chosen.box };
    placedBoxes.push(chosen.box);
    if (chosen.leader) leaders.push(chosen.leader);
  }
  return out;
}
