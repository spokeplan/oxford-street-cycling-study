// The two sides of Oxford Street for side-constrained gap-closing searches
// (scripts/lts/side-comparison.ts, and the union candidates of the best-evidence
// and robustness runs, GapRun.constrainedUnions in gap-closing.ts).
// The side line is the straight line between the trip ends (POINTS A and B), which
// sit at the two ends of Oxford Street, so it follows the street. `north-only`
// forbids every way lying wholly more than SIDE_MARGIN_M south of the line,
// `south-only` every way lying wholly more than SIDE_MARGIN_M north of it; ways on
// or crossing the band stay (a cross street's first block from Oxford Street stays
// on both sides).
import { M_PER_DEG_LAT, POINTS, type LonLat, type WayFeature } from "./common";

// Half-width (metres) of the band along the side line that both sides keep. It
// keeps the trip-end snap nodes (B's lies 12 m south of the line) and the junction
// mouths at both ends, and stays well under the distance to the first parallel
// streets either side (Wigmore Street to the north, Brook and Grosvenor Streets to
// the south, roughly 150 m from Oxford Street). Oxford Street bows north of the
// line, up to 76 m in the middle, so its middle counts as north.
const SIDE_MARGIN_M = 30;
export const NORTH = "north-only";
export const SIDES = [NORTH, "south-only"] as const;
export type Side = (typeof SIDES)[number];

/** Signed distance (metres) of a point from the A-B line, positive north (left of A->B, which runs west to east). */
function sideOf(p: LonLat): number {
  const [a, b] = [POINTS.A, POINTS.B];
  const kx = M_PER_DEG_LAT * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  const [bx, by] = [(b[0] - a[0]) * kx, (b[1] - a[1]) * M_PER_DEG_LAT];
  const [px, py] = [(p[0] - a[0]) * kx, (p[1] - a[1]) * M_PER_DEG_LAT];
  return (bx * py - by * px) / Math.hypot(bx, by);
}

/** Ids of the ways a side may not use: those lying wholly beyond the margin on the other side. */
export function forbiddenWays(ways: WayFeature[], side: Side): Set<number> {
  const beyond = side === NORTH ? (d: number) => d < -SIDE_MARGIN_M : (d: number) => d > SIDE_MARGIN_M;
  return new Set(ways.filter((f) => f.geometry.coordinates.every((c) => beyond(sideOf(c)))).map((f) => f.properties["@id"]));
}

/** Both sides as union candidates of a gap-closing run (GapRun.constrainedUnions); union_method names the side. */
export const sideUnions = (ways: WayFeature[]) => SIDES.map((side) => ({ method: side, forbiddenWays: forbiddenWays(ways, side) }));
