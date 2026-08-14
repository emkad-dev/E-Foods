import { DEFAULT_DISPATCH_WEIGHTS, parseDispatchWeights } from './dispatchWeights.ts';

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

Deno.test('parseDispatchWeights accepts a valid numeric pair', () => {
  const parsed = parseDispatchWeights({ distance: 0.3, load: 2 });
  expectEqual(parsed.load, 2, 'load');
  expectEqual(parsed.distance, 0.3, 'distance');
});

Deno.test('parseDispatchWeights falls back to defaults on garbage', () => {
  for (const raw of [null, undefined, 'x', 42, {}, { load: 'a' }, { distance: 0.15, load: -1 }, { distance: 200, load: 1 }]) {
    const parsed = parseDispatchWeights(raw);
    expectEqual(parsed.load, DEFAULT_DISPATCH_WEIGHTS.load, `load for ${JSON.stringify(raw)}`);
    expectEqual(parsed.distance, DEFAULT_DISPATCH_WEIGHTS.distance, `distance for ${JSON.stringify(raw)}`);
  }
});

// This is the review finding this file exists to cover: Number(null) === 0,
// Number('') === 0, and Number(false) === 0 are all finite and within
// [0, 100], so a naive `Number(record.load)` conversion (the shape
// parsePricingConfig uses) would silently accept `{ load: null }` as
// `load: 0` - disabling load weighting entirely, so the nearest rider wins
// regardless of how many orders anyone else is carrying, rather than
// falling back to the intended default of 1.0.
Deno.test('parseDispatchWeights rejects null/empty-string/boolean fields rather than coercing them to 0', () => {
  const casesThatMustFallBackWhole = [
    { distance: 0.15, load: null },
    { distance: 0.15, load: '' },
    { distance: 0.15, load: false },
    { distance: 0.15, load: undefined },
    { distance: null, load: 1 },
    { distance: '', load: 1 },
    { distance: false, load: 1 },
  ];

  for (const raw of casesThatMustFallBackWhole) {
    const parsed = parseDispatchWeights(raw);
    expectEqual(parsed.load, DEFAULT_DISPATCH_WEIGHTS.load, `load must fall back to the default (not 0) for ${JSON.stringify(raw)}`);
    expectEqual(parsed.distance, DEFAULT_DISPATCH_WEIGHTS.distance, `distance must fall back to the default (not 0) for ${JSON.stringify(raw)}`);
  }
});

Deno.test('parseDispatchWeights still rejects a numeric-looking string (no implicit coercion at all)', () => {
  const parsed = parseDispatchWeights({ distance: 0.15, load: '2' });
  expectEqual(parsed.load, DEFAULT_DISPATCH_WEIGHTS.load, 'a string load is rejected, not parsed as a number');
});
