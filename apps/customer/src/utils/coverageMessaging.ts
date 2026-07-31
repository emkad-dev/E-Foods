export const COVERAGE_COMING_SOON_TITLE = 'FEASTY is coming soon to your area';

export const COVERAGE_COMING_SOON_COPY =
  'We are not delivering here yet, so ordering is switched off. Browse the full menu in the meantime — ordering opens the moment a restaurant near you goes live.';

export const COVERAGE_UNAVAILABLE_TAG = 'Not available yet';

export const describeNearestKitchen = (nearestOrderableKm: number | null) => {
  if (nearestOrderableKm === null || !Number.isFinite(nearestOrderableKm)) {
    return null;
  }

  return `Our nearest kitchen is about ${Math.round(nearestOrderableKm)}km away.`;
};
