// Shared paths and rules of the through-traffic classifier (scripts/through/):
// which OSM ways and nodes general motor traffic may use, and the speeds that
// turn a way's length into a travel time.
import { join } from "node:path";
import { speedLimitMph } from "../lts/classify";
import { DATA, ROOT } from "../lts/common";

export const THROUGH_DATA = join(DATA, "through");
export const THROUGH_RESULTS = join(ROOT, "results", "through");
/** Per way: drivable or why not, and the through measures (scripts/through/run.ts). */
export const THROUGH_WAYS_CSV = join(THROUGH_RESULTS, "ways.csv");
export const SCENARIO = "today";

type Tags = Record<string, unknown>;
const str = (t: Tags, k: string) => (typeof t[k] === "string" ? (t[k] as string) : undefined);

// Highway classes open to general motor traffic, with a free speed (km/h) each:
// the class speeds of the OSRM car profile (Project OSRM, profiles/car.lua,
// `speeds.highway`), capped at the posted limit (scripts/lts/classify.ts, 20 mph
// where untagged). With 20 mph almost everywhere in the area the cap flattens the
// main classes to the limit, and minor streets stay slower (OSRM's 25 km/h for
// residential and unclassified streets, 15 for service roads, 10 for living streets).
export const CLASS_SPEED_KMH: Record<string, number> = {
  motorway: 90, motorway_link: 45, trunk: 85, trunk_link: 40, primary: 65, primary_link: 30, secondary: 55, secondary_link: 25,
  tertiary: 40, tertiary_link: 20, unclassified: 25, residential: 25, living_street: 10, service: 15, road: 25,
};
// Main roads for the structural measure: their own network, not the streets between them.
export const MAIN_HIGHWAYS = new Set(["motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link"]);
// Classes of the validation set and of the applied tables (minor streets).
export const MINOR_HIGHWAYS = new Set(["residential", "living_street", "unclassified", "tertiary", "tertiary_link", "service"]);
const KMH_PER_MPH = 1.609344;
const M_PER_S_PER_KMH = 1 / 3.6;

// Access keys from the most to the least specific (OSM access hierarchy for a car),
// and the values that bar through motor traffic. "destination", "delivery" and the
// like admit a car only to reach the street itself, never to pass through.
const ACCESS_KEYS = ["motorcar", "motor_vehicle", "vehicle", "access"];
const NO_THROUGH_ACCESS = new Set([
  "no", "private", "destination", "delivery", "customers", "permit", "agricultural", "forestry", "emergency", "use_sidepath", "permissive_no",
]);
const OPEN_ACCESS = new Set(["yes", "permissive", "designated"]);
/** The most specific access value a car reads, or undefined when none is tagged. */
const carAccess = (t: Tags) => ACCESS_KEYS.map((k) => str(t, k)).find((v) => v !== undefined);

/** Why a way is not open to through motor traffic, or undefined when it is. */
export function closedReason(t: Tags): string | undefined {
  const hw = str(t, "highway") ?? "";
  if (!(hw in CLASS_SPEED_KMH)) return `highway=${hw}`;
  if (str(t, "area") === "yes") return "area";
  const access = carAccess(t);
  if (access !== undefined && NO_THROUGH_ACCESS.has(access)) return `access ${access}`;
  if (str(t, "oneway") === "reversible") return "oneway=reversible";
  return undefined;
}

// Motor-traffic one-way values (oneway:bicycle does not count).
const ONEWAY_YES = new Set(["yes", "true", "1"]);
const IMPLIED_ONEWAY_JUNCTIONS = new Set(["roundabout", "circular"]);
/** Directions a car may drive along the way's drawing order. */
export function carDirections(t: Tags): { forward: boolean; backward: boolean } {
  const oneway = str(t, "oneway:motor_vehicle") ?? str(t, "oneway") ?? "";
  if (oneway === "-1") return { forward: false, backward: true };
  const implied = IMPLIED_ONEWAY_JUNCTIONS.has(str(t, "junction") ?? "") || str(t, "highway") === "motorway";
  return ONEWAY_YES.has(oneway) || (implied && oneway !== "no") ? { forward: true, backward: false } : { forward: true, backward: true };
}

/** Free speed in metres per second: the class speed capped at the posted limit. */
export function speedMs(t: Tags): number {
  const cls = CLASS_SPEED_KMH[str(t, "highway") ?? ""];
  return Math.min(cls, speedLimitMph(t) * KMH_PER_MPH) * M_PER_S_PER_KMH;
}

// Node barriers a car passes (the barrier whitelist of the OSRM car profile, plus
// kerb, which on a carriageway node marks a crossing for people on foot, and
// swing_gate, a gate like any other); any other barrier value stops a car. A
// passable barrier still stops a car when the node's own access tags bar it
// (a gate with access=private), and any barrier gives way when they admit it
// (a bollard with motor_vehicle=yes).
const PASSABLE_BARRIERS = new Set([
  "cattle_grid", "border_control", "toll_booth", "sally_port", "gate", "lift_gate", "swing_gate", "no", "entrance", "height_restrictor", "arch", "kerb",
]);

/** Why a node stops a car, or undefined when a car may pass it. */
export function nodeStopReason(t: Tags): string | undefined {
  const access = carAccess(t);
  if (access !== undefined && OPEN_ACCESS.has(access)) return undefined;
  if (access !== undefined && NO_THROUGH_ACCESS.has(access)) return `node access ${access}`;
  const barrier = str(t, "barrier");
  return barrier !== undefined && !PASSABLE_BARRIERS.has(barrier) ? `barrier=${barrier}` : undefined;
}
