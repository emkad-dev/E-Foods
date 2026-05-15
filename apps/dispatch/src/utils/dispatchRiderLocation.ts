import { defaultNigeriaCoordinate, getNigeriaAreaCoordinate } from '../constants/nigeriaLocations';

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
    return defaultNigeriaCoordinate;
  }
  return getNigeriaAreaCoordinate(zone, undefined);
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
    ...getNigeriaAreaCoordinate(
      typeof data.region === 'string' && data.region.trim() ? data.region : zone,
      typeof data.lga === 'string' && data.lga.trim()
        ? data.lga
        : typeof data.currentAddress === 'string' && data.currentAddress.trim()
          ? data.currentAddress
          : undefined
    ),
    isPrecise: false,
  };
};
