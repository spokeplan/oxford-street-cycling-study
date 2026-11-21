// British National Grid (OSGB36, EPSG:27700) eastings/northings to WGS84 lon/lat,
// for the LAEI road links (scripts/laei/match-links.ts).
// Source: Ordnance Survey, "A Guide to Coordinate Systems in Great Britain"
// (https://www.ordnancesurvey.co.uk/documents/resources/guide-coordinate-systems-great-britain.pdf):
// the inverse Transverse Mercator projection of its annex C, then the OSGB36 to
// WGS84 Helmert transformation of section 6.6 (its WGS84 to OSGB36 parameters with
// the signs reversed). The guide gives the Helmert step an accuracy of a few metres
// (OSTN15, the exact transformation, needs a national grid file); matching to OSM
// ways tolerates that (MATCH_DIST_M in match-links.ts).
import type { LonLat } from "../lts/common";

// Airy 1830 ellipsoid (OSGB36), metres.
const AIRY_A = 6377563.396;
const AIRY_B = 6356256.909;
// National Grid projection: scale factor on the central meridian, true origin and false origin.
const F0 = 0.9996012717;
const LAT0_DEG = 49;
const LON0_DEG = -2;
const E0 = 400000;
const N0 = -100000;
// GRS80 ellipsoid (the guide's WGS84 / ETRS89 datum), metres.
const WGS84_A = 6378137;
const WGS84_B = 6356752.31414;
// Helmert OSGB36 -> WGS84: translations (m), scale (ppm), rotations (arc seconds).
const TX = 446.448, TY = -125.157, TZ = 542.06;
const SCALE_PPM = -20.4894;
const RX_SEC = 0.1502, RY_SEC = 0.247, RZ_SEC = 0.8421;
// Iteration stops: meridional arc to 0.01 mm, latitude to about 1e-12 radians (well under a millimetre).
const ARC_TOLERANCE_M = 1e-5;
const LAT_TOLERANCE_RAD = 1e-12;
const PPM = 1e-6;
const ARCSEC_PER_DEG = 3600;

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Developed meridional arc from the true origin to latitude lat (annex C, equation C3). */
function meridionalArc(lat: number): number {
  const n = (AIRY_A - AIRY_B) / (AIRY_A + AIRY_B);
  const lat0 = rad(LAT0_DEG);
  const d = lat - lat0, s = lat + lat0;
  return AIRY_B * F0 * (
    (1 + n + (5 / 4) * n ** 2 + (5 / 4) * n ** 3) * d
    - (3 * n + 3 * n ** 2 + (21 / 8) * n ** 3) * Math.sin(d) * Math.cos(s)
    + ((15 / 8) * n ** 2 + (15 / 8) * n ** 3) * Math.sin(2 * d) * Math.cos(2 * s)
    - (35 / 24) * n ** 3 * Math.sin(3 * d) * Math.cos(3 * s)
  );
}

/** Easting/northing to OSGB36 latitude/longitude in radians (annex C, equations C6 to C9). */
function gridToOsgb36(e: number, n: number): [number, number] {
  const e2 = 1 - AIRY_B ** 2 / AIRY_A ** 2;
  let lat = rad(LAT0_DEG);
  let m = 0;
  do {
    lat += (n - N0 - m) / (AIRY_A * F0);
    m = meridionalArc(lat);
  } while (Math.abs(n - N0 - m) >= ARC_TOLERANCE_M);
  const sin = Math.sin(lat), cos = Math.cos(lat), tan = Math.tan(lat);
  const nu = (AIRY_A * F0) / Math.sqrt(1 - e2 * sin ** 2);
  const rho = (AIRY_A * F0 * (1 - e2)) / (1 - e2 * sin ** 2) ** 1.5;
  const eta2 = nu / rho - 1;
  const vii = tan / (2 * rho * nu);
  const viii = (tan / (24 * rho * nu ** 3)) * (5 + 3 * tan ** 2 + eta2 - 9 * tan ** 2 * eta2);
  const ix = (tan / (720 * rho * nu ** 5)) * (61 + 90 * tan ** 2 + 45 * tan ** 4);
  const x = 1 / (cos * nu);
  const xi = (1 / (6 * cos * nu ** 3)) * (nu / rho + 2 * tan ** 2);
  const xii = (1 / (120 * cos * nu ** 5)) * (5 + 28 * tan ** 2 + 24 * tan ** 4);
  const xiia = (1 / (5040 * cos * nu ** 7)) * (61 + 662 * tan ** 2 + 1320 * tan ** 4 + 720 * tan ** 6);
  const de = e - E0;
  return [
    lat - vii * de ** 2 + viii * de ** 4 - ix * de ** 6,
    rad(LON0_DEG) + x * de - xi * de ** 3 + xii * de ** 5 - xiia * de ** 7,
  ];
}

/** Latitude/longitude (radians) on an ellipsoid to Earth-centred cartesian coordinates, height 0. */
function toCartesian(lat: number, lon: number, a: number, b: number): [number, number, number] {
  const e2 = 1 - b ** 2 / a ** 2;
  const nu = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return [nu * Math.cos(lat) * Math.cos(lon), nu * Math.cos(lat) * Math.sin(lon), (1 - e2) * nu * Math.sin(lat)];
}

/** British National Grid easting/northing (metres) to WGS84 [lon, lat] in degrees. */
export function bngToWgs84(e: number, n: number): LonLat {
  const [lat1, lon1] = gridToOsgb36(e, n);
  const [x1, y1, z1] = toCartesian(lat1, lon1, AIRY_A, AIRY_B);
  const s = 1 + SCALE_PPM * PPM;
  const [rx, ry, rz] = [RX_SEC, RY_SEC, RZ_SEC].map((r) => rad(r / ARCSEC_PER_DEG));
  const x = TX + s * x1 - rz * y1 + ry * z1;
  const y = TY + rz * x1 + s * y1 - rx * z1;
  const z = TZ - ry * x1 + rx * y1 + s * z1;
  // Cartesian to latitude on WGS84 by iteration (guide, annex B, equations B5 and B6).
  const e2 = 1 - WGS84_B ** 2 / WGS84_A ** 2;
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - e2));
  for (let prev = Infinity; Math.abs(lat - prev) > LAT_TOLERANCE_RAD; ) {
    prev = lat;
    const nu = WGS84_A / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    lat = Math.atan2(z + e2 * nu * Math.sin(lat), p);
  }
  return [deg(Math.atan2(y, x)), deg(lat)];
}
