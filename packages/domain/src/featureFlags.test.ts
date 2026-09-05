import assert from 'node:assert/strict';
import test from 'node:test';
import { isFeatureEnabled, listFeatureFlagKeys, normalizeFeatureFlagMap } from './featureFlags.ts';

test('normalizeFeatureFlagMap keeps the same keys for row and object inputs', () => {
  const rows = normalizeFeatureFlagMap([
    { description: 'Dark launch', enabled: true, key: 'risky_flow' },
    { description: 'Keep off', enabled: false, key: 'slow_lane' },
    { description: 'Blank key is ignored', enabled: true, key: '   ' },
  ]);
  const objectMap = normalizeFeatureFlagMap({
    risky_flow: true,
    slow_lane: false,
  });

  assert.deepEqual(listFeatureFlagKeys(rows), ['risky_flow', 'slow_lane']);
  assert.deepEqual(listFeatureFlagKeys(objectMap), ['risky_flow', 'slow_lane']);
  assert.deepEqual(rows, objectMap);
});

test('missing feature flags resolve closed', () => {
  assert.equal(isFeatureEnabled(undefined, 'missing_flag'), false);
  assert.equal(isFeatureEnabled(null, 'missing_flag'), false);
  assert.equal(isFeatureEnabled({}, 'missing_flag'), false);
});

test('known feature flags return their boolean value', () => {
  const flags = normalizeFeatureFlagMap({
    promo_composer_v2: true,
    risky_flow: false,
  });

  assert.equal(isFeatureEnabled(flags, 'promo_composer_v2'), true);
  assert.equal(isFeatureEnabled(flags, 'risky_flow'), false);
});
