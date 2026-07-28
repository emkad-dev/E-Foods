export const COVERAGE_COMING_SOON_TITLE = 'FEASTY is coming soon to your area';

export const COVERAGE_COMING_SOON_COPY =
  'We are not delivering here yet, so ordering is switched off. Browse the full menu in the meantime — ordering opens the moment a restaurant near you goes live.';

export const COVERAGE_UNAVAILABLE_TAG = 'Not available yet';

export const describeNearestKitchen = (nearestDeliverableKm: number | null) => {
  if (nearestDeliverableKm === null || !Number.isFinite(nearestDeliverableKm)) {
    return null;
  }

  return `Our nearest kitchen is about ${Math.round(nearestDeliverableKm)}km away.`;
};
