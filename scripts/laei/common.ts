// Shared paths, source URLs and field names for the LAEI 2022 traffic-flow steps
// (scripts/laei/download.ts, scripts/laei/match-links.ts).
// Source: London Atmospheric Emissions Inventory (LAEI) 2022, Greater London
// Authority and Transport for London, London Datastore, Open Government Licence v3.0.
import { join } from "node:path";
import { DATA, ROOT } from "../lts/common";

export const LAEI_DATA = join(DATA, "laei");
export const LAEI_RESULTS = join(ROOT, "results", "laei");
/** Per OSM way: the LAEI flow matched to it, read by scripts/lts/volume.ts. */
export const LAEI_WAYS_CSV = join(LAEI_RESULTS, "ways-matched.csv");

export const LAEI_LANDING = "https://data.london.gov.uk/dataset/london-atmospheric-emissions-inventory-laei-2022-2lg5g";
export const LAEI_METHODOLOGY = "https://data.london.gov.uk/download/2lg5g/5me/LAEI%202022%20-%20Methodology%20Report.pdf";
/** "Supporting Information - Major and Minor Roads Traffic Data - GIS" (not committed; its SHA-256 is in inputs/SHA256SUMS). */
export const LAEI_ZIP = "LAEI2022-Traffic-Flows-and-Speeds-Major-and-Minor-Roads-GIS.zip";
export const LAEI_ZIP_URL = `https://data.london.gov.uk/download/2lg5g/95w/${LAEI_ZIP}`;
/** The major-roads link layer inside the archive (the minor roads are 1 km grid cells, no links). */
export const LAEI_GPKG = "LAEI2022-major-roads-flows-and-speeds.gpkg";
export const LAEI_TABLE = "major-roads-vehicle-flows-and-speeds";

/**
 * The flow columns: annual average daily flow, vehicles per day, one per vehicle
 * type. Their sum is all motor vehicles, the classes DfT's all_motor_vehicles adds
 * up (two-wheelers, cars and taxis, buses and coaches, LGVs, HGVs). Checked: the
 * sum x link length x 365 over all links is 38.77 billion vehicle-km, the Major
 * Roads total of the LAEI 2022 Methodology Report (section 5.2.3.2). Each link is
 * one OS road link (TOID) carrying all its traffic, so a two-way single
 * carriageway link holds both directions and a carriageway of a dual road or a
 * one-way street holds its own flow (docs/lts.md, "Best-evidence run").
 */
export const LAEI_FLOW_COLUMNS = [
  "AADF.motorcycles", "AADF.taxis", "AADF.cars", "AADF.phvs", "AADF.lgvs", "AADF.hgvs.rigid", "AADF.hgvs.articulated",
  "AADF.tfl.buses", "AADF.non.tfl.buses", "AADF.coaches",
] as const;
