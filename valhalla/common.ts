// Shared Valhalla settings: the study's scenarios and their container names.
export const VALHALLA_SCENARIOS = ["today", "wigmore-track", "full-closure"] as const;
const CONTAINER_PREFIX = "valhalla-";
export const containerName = (scenario: string) => `${CONTAINER_PREFIX}${scenario}`;
/** The study's own container names; cleanup touches only these, never other valhalla-* containers. */
export const STUDY_CONTAINERS: readonly string[] = VALHALLA_SCENARIOS.map(containerName);
