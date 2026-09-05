// Coarse state-centre coordinates used when an applicant gives a state but no
// precise location. Never used to override a real coordinate — only as a
// fallback so a rider/restaurant record always has a plottable position.

import { sanitizeText } from './rpc/coercion.ts';

export const DEFAULT_NIGERIA_COORDINATE = { latitude: 9.0765, longitude: 7.3986 };

export const NIGERIA_STATE_CENTERS: Record<string, { latitude: number; longitude: number }> = {
  Abia: { latitude: 5.532, longitude: 7.486 },
  Adamawa: { latitude: 9.326, longitude: 12.398 },
  'Akwa Ibom': { latitude: 5.037, longitude: 7.912 },
  Anambra: { latitude: 6.21, longitude: 7.067 },
  Bauchi: { latitude: 10.315, longitude: 9.844 },
  Bayelsa: { latitude: 4.926, longitude: 6.267 },
  Benue: { latitude: 7.731, longitude: 8.539 },
  Borno: { latitude: 11.833, longitude: 13.151 },
  'Cross River': { latitude: 4.958, longitude: 8.326 },
  Delta: { latitude: 5.704, longitude: 5.934 },
  Ebonyi: { latitude: 6.265, longitude: 8.013 },
  Edo: { latitude: 6.338, longitude: 5.625 },
  Ekiti: { latitude: 7.719, longitude: 5.311 },
  Enugu: { latitude: 6.458, longitude: 7.546 },
  'Federal Capital Territory': { latitude: 9.0765, longitude: 7.3986 },
  Gombe: { latitude: 10.29, longitude: 11.17 },
  Imo: { latitude: 5.484, longitude: 7.035 },
  Jigawa: { latitude: 12.228, longitude: 9.562 },
  Kaduna: { latitude: 10.511, longitude: 7.438 },
  Kano: { latitude: 12.002, longitude: 8.592 },
  Katsina: { latitude: 12.985, longitude: 7.617 },
  Kebbi: { latitude: 12.451, longitude: 4.197 },
  Kogi: { latitude: 7.801, longitude: 6.739 },
  Kwara: { latitude: 8.496, longitude: 4.542 },
  Lagos: { latitude: 6.5244, longitude: 3.3792 },
  Nasarawa: { latitude: 8.537, longitude: 8.322 },
  Niger: { latitude: 9.93, longitude: 5.598 },
  Ogun: { latitude: 7.161, longitude: 3.35 },
  Ondo: { latitude: 7.252, longitude: 5.193 },
  Osun: { latitude: 7.771, longitude: 4.556 },
  Oyo: { latitude: 7.378, longitude: 3.947 },
  Plateau: { latitude: 9.8965, longitude: 8.8583 },
  Rivers: { latitude: 4.8156, longitude: 7.0498 },
  Sokoto: { latitude: 13.06, longitude: 5.237 },
  Taraba: { latitude: 7.999, longitude: 10.774 },
  Yobe: { latitude: 11.747, longitude: 11.966 },
  Zamfara: { latitude: 12.17, longitude: 6.664 },
};

const normalizeNigeriaStateName = (state: string) => {
  const normalized = sanitizeText(state);
  if (!normalized) {
    return null;
  }

  const nextValue = normalized.toLowerCase();
  if (nextValue === 'fct' || nextValue === 'abuja' || nextValue === 'fct-abuja') {
    return 'Federal Capital Territory';
  }

  if (nextValue === 'nassarawa') {
    return 'Nasarawa';
  }

  return (
    Object.keys(NIGERIA_STATE_CENTERS).find((candidate) => candidate.toLowerCase() === nextValue) ?? normalized
  );
};

export const getNigeriaAreaCoordinate = (state: string) => {
  const normalizedState = normalizeNigeriaStateName(state);
  return (normalizedState && NIGERIA_STATE_CENTERS[normalizedState]) || DEFAULT_NIGERIA_COORDINATE;
};
