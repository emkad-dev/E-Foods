// Dispatch scoring weights: tunable via `PlatformSettings` (`id = 'dispatchWeights'`)
// without a deploy. Mirrors pricing.ts's split from platformSettings.ts — this
// file holds the pure, DB-free type/defaults/parser so it can be unit-tested
// directly; the loader that reads PlatformSettings, caches, and never throws
// lives in platformSettings.ts (`loadDispatchWeights`), matching
// `loadPricingConfig` exactly.

export interface DispatchWeights {
  load: number;
  distance: number;
}

export const DEFAULT_DISPATCH_WEIGHTS: DispatchWeights = {
  load: 1.0,
  distance: 0.15,
};

// Bounds keep a mistyped admin value from corrupting the scorer: a non-finite
// weight (e.g. a stray string) would make `score = w*x` NaN, and NaN
// comparisons are always false, so "lowest wins" degrades into whatever
// order the candidates happened to load in - silently reintroducing the
// unexplainable randomness this task exists to remove. A wildly out-of-range
// weight (e.g. distance: 99999) would have the same practical effect by
// making one factor always dominate regardless of load. Out-of-range configs
// fall back to the default pair whole, same as parsePricingConfig.
//
// Unlike parsePricingConfig, this requires each field to already be a JS
// `number` rather than coercing with `Number(...)` first. `Number(null)`,
// `Number('')`, and `Number(false)` are all `0` - finite and in range - so a
// naive `Number(record.load)` would silently accept `{ load: null }` as
// `load: 0`, which disables load weighting entirely (the nearest rider wins
// regardless of how many orders anyone else is carrying) rather than
// falling back to the intended default of 1.0. The blast radius of that
// class of bug is worse here than in parsePricingConfig - a mistyped
// pricing field changes a receipt, a mistyped dispatch weight changes who
// gets paid to make the delivery - so this parser is intentionally stricter
// than the one it was modelled on rather than copying its coercion as-is.
export const parseDispatchWeights = (raw: unknown): DispatchWeights => {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_DISPATCH_WEIGHTS;
  }

  const record = raw as Record<string, unknown>;
  const load = record.load;
  const distance = record.distance;

  const valid =
    typeof load === 'number' && Number.isFinite(load) && load >= 0 && load <= 100 &&
    typeof distance === 'number' && Number.isFinite(distance) && distance >= 0 && distance <= 100;

  return valid ? { load, distance } : DEFAULT_DISPATCH_WEIGHTS;
};
