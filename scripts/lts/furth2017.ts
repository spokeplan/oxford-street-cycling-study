// Mixed-traffic criteria of Peter Furth, "Level of Traffic Stress Criteria for
// Road Segments, version 2.0, June 2017"
// (https://peterfurth.sites.northeastern.edu/files/2014/05/LTS-Tables-v2-June-1.pdf).
// Transcribed in docs/lts.md, section 4c. Pure table lookup; the OSM tag
// interpretation (lanes, speed, one-way, volume) lives in classify.ts.
import { DEFAULT_SPEED_COL, type SpeedCol } from "./common";

type Level = 1 | 2 | 3 | 4;
/** Table rows: unlaned two-way street, 1 / 2 / 3+ through lanes per direction. */
export type FurthRow = "unlaned" | "1" | "2" | "3+";

// Prevailing-speed columns: upper bound in mph and label (<=20, 25, 30, 35, 40, 45, 50+).
const SPEED_COLS: { maxMph: number; label: string }[] = [
  { maxMph: 20, label: "le20" }, { maxMph: 25, label: "25" }, { maxMph: 30, label: "30" }, { maxMph: 35, label: "35" },
  { maxMph: 40, label: "40" }, { maxMph: 45, label: "45" }, { maxMph: Infinity, label: "50+" },
];
const LE20_COL = 0;
const COL_25 = 1;
// A UK 20 mph limit: prevailing speed taken as 20-25 mph, so by default it reads the 25 mph column.
const UK_20_MPH = 20;

// Effective-ADT bands per row: upper bound (inclusive) and LTS per speed column.
interface Band {
  maxAdt: number;
  label: string;
  lts: [Level, Level, Level, Level, Level, Level, Level];
}
const TABLE: Record<FurthRow, Band[]> = {
  unlaned: [
    { maxAdt: 750, label: "0-750", lts: [1, 1, 2, 2, 3, 3, 3] },
    { maxAdt: 1500, label: "751-1500", lts: [1, 1, 2, 3, 3, 3, 4] },
    { maxAdt: 3000, label: "1501-3000", lts: [2, 2, 2, 3, 4, 4, 4] },
    { maxAdt: Infinity, label: "3000+", lts: [2, 3, 3, 3, 4, 4, 4] },
  ],
  "1": [
    { maxAdt: 750, label: "0-750", lts: [1, 1, 2, 2, 3, 3, 3] },
    { maxAdt: 1500, label: "751-1500", lts: [2, 2, 2, 3, 3, 3, 4] },
    { maxAdt: 3000, label: "1501-3000", lts: [2, 3, 3, 3, 4, 4, 4] },
    { maxAdt: Infinity, label: "3000+", lts: [3, 3, 3, 3, 4, 4, 4] },
  ],
  "2": [
    { maxAdt: 8000, label: "0-8000", lts: [3, 3, 3, 3, 4, 4, 4] },
    { maxAdt: Infinity, label: "8001+", lts: [3, 3, 4, 4, 4, 4, 4] },
  ],
  "3+": [{ maxAdt: Infinity, label: "any", lts: [3, 3, 4, 4, 4, 4, 4] }],
};

/** Table footnote: effective ADT = ADT on two-way roads, 1.5 x ADT on one-way roads. */
export const ONE_WAY_ADT_FACTOR = 1.5;

/** Highest LTS that counts as low stress (the connectivity test's LTS 1-2 network). */
const CALM_MAX_LTS: Level = 2;
/** True when `label` names a row of the table. */
export const isFurthRow = (label: string): label is FurthRow => Object.hasOwn(TABLE, label);

/**
 * The calm threshold of a row and speed column (its label in rule ids): the highest
 * effective ADT that still grades LTS <= 2, Infinity when every band does, undefined
 * when none does (volume cannot make the way calm). The bands rise in LTS with ADT.
 */
export function calmMaxEffectiveAdt(row: FurthRow, colLabel: string): number | undefined {
  const col = SPEED_COLS.findIndex((c) => c.label === colLabel);
  if (col < 0) throw new Error(`unknown Furth 2017 speed column ${colLabel}`);
  const calm = TABLE[row].filter((b) => b.lts[col] <= CALM_MAX_LTS);
  return calm.length === 0 ? undefined : calm.at(-1)!.maxAdt;
}

/** LTS and rule id ("f17/<row>/<adt band>/<speed col>") for a row, effective ADT and speed limit in mph. */
export function furthLts(row: FurthRow, effectiveAdt: number, limitMph: number, speedCol: SpeedCol): { lts: Level; rule: string } {
  let col = SPEED_COLS.findIndex((c) => limitMph <= c.maxMph);
  if (col === LE20_COL && limitMph === UK_20_MPH && speedCol === DEFAULT_SPEED_COL) col = COL_25;
  const band = TABLE[row].find((b) => effectiveAdt <= b.maxAdt)!;
  return { lts: band.lts[col], rule: `f17/${row}/${band.label}/${SPEED_COLS[col].label}` };
}
