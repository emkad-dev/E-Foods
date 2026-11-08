/**
 * The area FEASTY serves today (Badagry to Ibadan, covering every live
 * restaurant), as `minLon,minLat,maxLon,maxLat`.
 *
 * The geocode Worker restricts suggestions to this box through its
 * `SERVICE_BBOX` var (cloudflare/geocode/wrangler.jsonc), which is config so it
 * can be widened without an app update. The customer app uses the same box to
 * filter what the Android device geocoder returns, since that geocoder is not
 * restricted at all. serviceArea.test.ts fails if the two drift apart, so widen
 * both together.
 *
 * Imports nothing: it runs under Deno, Node's test runner and Metro alike.
 */

export type ServiceAreaBox = { minLon: number; minLat: number; maxLon: number; maxLat: number };

export const SERVICE_AREA_BBOX: ServiceAreaBox = { minLon: 2.6, minLat: 6.2, maxLon: 4.4, maxLat: 7.9 };

/** The Worker's `SERVICE_BBOX` string for the same box. */
export const SERVICE_AREA_BBOX_STRING = [
  SERVICE_AREA_BBOX.minLon,
  SERVICE_AREA_BBOX.minLat,
  SERVICE_AREA_BBOX.maxLon,
  SERVICE_AREA_BBOX.maxLat,
].join(',');

/** Inclusive on every edge. Non-finite input is outside. */
export const isInsideServiceArea = (latitude: number, longitude: number, box: ServiceAreaBox = SERVICE_AREA_BBOX) =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  latitude >= box.minLat &&
  latitude <= box.maxLat &&
  longitude >= box.minLon &&
  longitude <= box.maxLon;
