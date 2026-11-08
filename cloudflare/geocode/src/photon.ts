import { bboxToString, isInsideBBox, type BBox } from './bbox.ts';
import { asText, joinLabel } from './label.ts';
import type { GeocodeResult } from './types.ts';

const PHOTON_URL = 'https://photon.komoot.io/api/';

// Photon documents q, limit, bbox (minLon,minLat,maxLon,maxLat) and lang. `lang`
// is left out: komoot's public instance only accepts a few languages and a
// rejected value would turn into a 400 for every search.
export const buildPhotonUrl = (q: string, limit: number, box: BBox): string => {
  const url = new URL(PHOTON_URL);
  url.searchParams.set('q', q);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('bbox', bboxToString(box));
  return url.toString();
};

type PhotonFeature = {
  geometry?: { coordinates?: unknown };
  properties?: Record<string, unknown>;
};

// name, street, district-or-locality, city, state: the order people say an
// address in. A house number rides with its street.
export const photonLabel = (props: Record<string, unknown>): string => {
  const street = asText(props.street);
  const houseNumber = asText(props.housenumber);
  return joinLabel([
    asText(props.name),
    street && houseNumber ? `${houseNumber} ${street}` : street,
    asText(props.district) ?? asText(props.locality),
    asText(props.city),
    asText(props.state),
  ]);
};

// Anything malformed is skipped rather than failing the whole response, and
// the box is re-checked in case the provider ignores it.
export const normalizePhoton = (body: unknown, box: BBox, limit: number): GeocodeResult[] => {
  const features = (body as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  const results: GeocodeResult[] = [];
  const seen = new Set<string>();
  for (const feature of features as PhotonFeature[]) {
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const [longitude, latitude] = coords;
    if (typeof longitude !== 'number' || typeof latitude !== 'number') continue;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
    if (!isInsideBBox(box, latitude, longitude)) continue;
    const label = photonLabel(feature.properties ?? {});
    if (!label) continue;
    const key = `${label.toLowerCase()}|${latitude.toFixed(4)}|${longitude.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ label, latitude, longitude });
    if (results.length >= limit) break;
  }
  return results;
};
