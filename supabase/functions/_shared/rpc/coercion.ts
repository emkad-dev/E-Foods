// Scalar coercion primitives for RPC payloads.
//
// Every value that reaches an RPC handler arrives as untrusted JSON, so the
// handlers never read a field directly — they run it through one of these
// coercions first. Extracted verbatim from app-rpc/index.ts; the behaviour of
// each function is load-bearing for response shapes and 400 messages.

export type JsonObject = Record<string, unknown>;

export const nowIso = () => new Date().toISOString();

export const toSortableTimestamp = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
};

export const sanitizeText = (value: unknown, fallback = '') =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

export const sanitizeOptionalText = (value: unknown) => {
  const nextValue = sanitizeText(value);
  return nextValue || null;
};

export const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

// `fallback` is generic so a caller can ask for a non-numeric miss value -
// dispatch's rider ping wants `null` for "no accuracy reported" rather than
// a sentinel 0. Defaulting F to number keeps every existing call site's
// return type exactly `number`.
export const parseNumber = <F = number>(value: unknown, fallback: number | F = 0): number | F => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
};

export const parseInteger = (value: unknown, fallback = 0) => {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }

  return fallback;
};

// Identical to the local helper app-rpc used to declare; re-exported from the
// pricing module so the money rounding rule has exactly one definition.
export { roundCurrency } from '../pricing.ts';

export const buildNameKey = (value: string) =>
  sanitizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
