const DEFAULT_LAGOS_COORDINATE = {
  latitude: 6.5244,
  longitude: 3.3792,
};

const ZONE_COORDINATES = [
  { match: ['victoria island', 'vi'], latitude: 6.4281, longitude: 3.4219 },
  { match: ['lekki'], latitude: 6.4698, longitude: 3.5852 },
  { match: ['ikoyi'], latitude: 6.4541, longitude: 3.4346 },
  { match: ['yaba'], latitude: 6.5095, longitude: 3.3711 },
  { match: ['surulere'], latitude: 6.4969, longitude: 3.3537 },
  { match: ['mainland'], latitude: 6.5244, longitude: 3.3792 },
  { match: ['lagos island'], latitude: 6.4549, longitude: 3.4246 },
];

const toNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsedValue = Number.parseFloat(value);

    if (Number.isFinite(parsedValue)) {
      return parsedValue;
    }
  }

  return null;
};

const getCoordinateCandidate = (container: unknown) => {
  if (!container || typeof container !== 'object') {
    return null;
  }

  const candidate = container as Record<string, unknown>;
  const latitude = toNumber(candidate.latitude ?? candidate.lat);
  const longitude = toNumber(candidate.longitude ?? candidate.lng ?? candidate.lon);

  if (latitude === null || longitude === null) {
    return null;
  }

  return { latitude, longitude };
};

export const getZoneCoordinate = (zone: string | null | undefined) => {
  if (!zone) {
    return DEFAULT_LAGOS_COORDINATE;
  }

  const normalizedZone = zone.trim().toLowerCase();
  const matchedZone = ZONE_COORDINATES.find((entry) =>
    entry.match.some((token) => normalizedZone.includes(token))
  );

  if (!matchedZone) {
    return DEFAULT_LAGOS_COORDINATE;
  }

  return {
    latitude: matchedZone.latitude,
    longitude: matchedZone.longitude,
  };
};

export const resolveDispatchRiderCoordinate = (data: Record<string, unknown>, zone?: string | null) => {
  const directCoordinate = getCoordinateCandidate({
    latitude: data.latitude ?? data.lat,
    longitude: data.longitude ?? data.lng ?? data.lon,
  });

  if (directCoordinate) {
    return {
      ...directCoordinate,
      isPrecise: true,
    };
  }

  const nestedCoordinate =
    getCoordinateCandidate(data.location) ??
    getCoordinateCandidate(data.coordinates) ??
    getCoordinateCandidate(data.currentLocation) ??
    getCoordinateCandidate(data.lastKnownLocation) ??
    getCoordinateCandidate(data.position);

  if (nestedCoordinate) {
    return {
      ...nestedCoordinate,
      isPrecise: true,
    };
  }

  return {
    ...getZoneCoordinate(zone),
    isPrecise: false,
  };
};
