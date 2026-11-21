// Paths and columns of the published traffic counts (inputs/published-counts/,
// see inputs/README.md and inputs/published-counts/README.md): motor-vehicle counts
// on single streets published by TfL, Camden and Westminster, used by the
// best-evidence run (docs/lts.md).
import { join } from "node:path";
import { ROOT } from "../lts/common";
import { INPUTS } from "../inputs";

/** Subdirectory of inputs/ with the counts, their README and the figures not used (other-figures.csv). */
export const PUBLISHED_INPUTS_DIR = "published-counts";
export const PUBLISHED_COUNTS_CSV = join(INPUTS, PUBLISHED_INPUTS_DIR, "counts.csv");
export const PUBLISHED_RESULTS = join(ROOT, "results", "published-counts");
/** The counts with the OSM way each is matched to, read by scripts/lts/volume.ts. */
export const PUBLISHED_MATCHED_CSV = join(PUBLISHED_RESULTS, "counts-matched.csv");

/** Columns of counts.csv. all_motor_vehicles is the count over `hours`, not expanded to a day. */
export const PUBLISHED_COLUMNS = [
  "id", "street", "section", "lon", "lat", "carriageway", "all_motor_vehicles", "hours", "year", "survey_date", "method",
  "publisher", "document", "url", "page", "licence", "note",
] as const;
/** Count periods the file may use (hours). */
export const COUNT_HOURS = [12, 16, 24] as const;
