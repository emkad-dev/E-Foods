import { bboxToString, isInsideBBox, type BBox } from './bbox.ts';
import { asText, joinLabel } from './label.ts';
import type { GeocodeResult } from './types.ts';

const LOCATIONIQ_URL = 'https://api.locationiq.com/v1/autocomplete';

// Documented autocomplete parameters: key, q, limit, viewbox (lon1,lat1,lon2,lat2),
// bounded=1 (hard restriction to the viewbox), countrycodes, format.
export const buildLocationIqUrl = (key: string, q: string, limit: number, box: BBox): string => {
  const url = new URL(LOCATIONIQ_URL);
  url.searchParams.set('key', key);
  url.searchParams.set('q', q);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('viewbox', bboxToString(box));
  url.searchParams.set('bounded', '1');
  url.searchParams.set('countrycodes', 'ng');
  url.searchParams.set('format', 'json');
  return url.toString();
};

type LocationIqItem = {
  lat?: unknown;
  lon?: unknown;
  display_name?: unknown;
  address?: Record<string, unknown>;
};

export const locationIqLabel = (item: LocationIqItem): string => {
  const address = item.address ?? {};
  const road = asText(address.road);
  const houseNumber = asText(address.house_number);
  const built = joinLabel([
    asText(address.name),
    road && houseNumber ? `${houseNumber} ${road}` : road,
    asText(address.suburb) ?? asText(address.neighbourhood),
    asText(address.city) ?? asText(address.town) ?? asText(address.village),
    asText(address.state),
  ]);
  if (built) return built;
  // Without a structured address, fall back to the provider's own line minus
  // the trailing country, which every result shares.
  const display = asText(item.display_name);
  return display ? joinLabel(display.split(',').filter((part) => part.trim() !== 'Nigeria')) : '';
};

const toNumber = (value: unknown): number =>
  typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;

export const normalizeLocationIq = (body: unknown, box: BBox, limit: number): GeocodeResult[] => {
  if (!Array.isArray(body)) return [];
  const results: GeocodeResult[] = [];
  const seen = new Set<string>();
  for (const item of body as LocationIqItem[]) {
    // LocationIQ sends coordinates as strings.
    const latitude = toNumber(item?.lat);
    const longitude = toNumber(item?.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    if (!isInsideBBox(box, latitude, longitude)) continue;
    const label = locationIqLabel(item);
    if (!label) continue;
    const key = `${label.toLowerCase()}|${latitude.toFixed(4)}|${longitude.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ label, latitude, longitude });
    if (results.length >= limit) break;
  }
  return results;
};
