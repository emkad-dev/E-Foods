export type BBox = { minLon: number; minLat: number; maxLon: number; maxLat: number };

// SERVICE_BBOX is "minLon,minLat,maxLon,maxLat". Returns null when malformed so
// the Worker can answer 503 (a config problem) instead of querying unrestricted.
export const parseBBox = (raw: string | undefined): BBox | null => {
  if (!raw) return null;
  const parts = raw.split(',').map((part) => part.trim());
  if (parts.length !== 4 || parts.some((part) => part === '')) return null;
  const [minLon, minLat, maxLon, maxLat] = parts.map(Number);
  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return null;
  if (minLon >= maxLon || minLat >= maxLat) return null;
  if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) return null;
  return { minLon, minLat, maxLon, maxLat };
};

export const bboxToString = (box: BBox): string =>
  `${box.minLon},${box.minLat},${box.maxLon},${box.maxLat}`;

export const isInsideBBox = (box: BBox, latitude: number, longitude: number): boolean =>
  latitude >= box.minLat &&
  latitude <= box.maxLat &&
  longitude >= box.minLon &&
  longitude <= box.maxLon;
