import {
  RIDER_LIVE_TTL_MS,
  buildRiderLocationUpsert,
  isRiderLocationLive,
  joinRankedRiders,
  mergeRiderLiveLocation,
  type RankedRiderRow,
} from './riderLocation.ts';

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
};

const expectJsonEqual = (actual: unknown, expected: unknown, label: string) => {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${label}: expected ${expectedJson}, got ${actualJson}`);
  }
};

const NOW_ISO = '2026-07-29T12:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);

Deno.test('buildRiderLocationUpsert maps fields to snake_case columns', () => {
  expectJsonEqual(
    buildRiderLocationUpsert('rider-1', 6.5244, 3.3792, 12.5, NOW_ISO),
    {
      rider_id: 'rider-1',
      latitude: 6.5244,
      longitude: 3.3792,
      accuracy: 12.5,
      updated_at: NOW_ISO,
    },
    'upsert row'
  );
});

Deno.test('buildRiderLocationUpsert allows a null accuracy', () => {
  expectEqual(
    buildRiderLocationUpsert('rider-1', 6.5, 3.3, null, NOW_ISO).accuracy,
    null,
    'null accuracy'
  );
});

Deno.test('isRiderLocationLive includes a ping inside the TTL', () => {
  const updatedAt = new Date(NOW_MS - (RIDER_LIVE_TTL_MS - 1_000)).toISOString();
  expectEqual(isRiderLocationLive(updatedAt, NOW_MS), true, 'inside ttl');
});

Deno.test('isRiderLocationLive excludes a ping outside the TTL', () => {
  const updatedAt = new Date(NOW_MS - (RIDER_LIVE_TTL_MS + 1_000)).toISOString();
  expectEqual(isRiderLocationLive(updatedAt, NOW_MS), false, 'outside ttl');
});

Deno.test('isRiderLocationLive treats the exact boundary as stale', () => {
  const updatedAt = new Date(NOW_MS - RIDER_LIVE_TTL_MS).toISOString();
  expectEqual(isRiderLocationLive(updatedAt, NOW_MS), false, 'exact boundary');
});

Deno.test('isRiderLocationLive rejects missing or unparseable timestamps', () => {
  expectEqual(isRiderLocationLive(null, NOW_MS), false, 'null');
  expectEqual(isRiderLocationLive(undefined, NOW_MS), false, 'undefined');
  expectEqual(isRiderLocationLive('not-a-date', NOW_MS), false, 'garbage');
});

Deno.test('isRiderLocationLive tolerates a future timestamp from clock skew', () => {
  // now - parsed is negative for a future stamp, which is < ttl and would read
  // as live. That is the desired behaviour: clock skew should not blank the map.
  const updatedAt = new Date(NOW_MS + 10_000).toISOString();
  expectEqual(isRiderLocationLive(updatedAt, NOW_MS), true, 'future stamp tolerated');
});

Deno.test('mergeRiderLiveLocation prefers a live fix over the durable columns', () => {
  const rider = {
    id: 'rider-1',
    latitude: 1,
    longitude: 2,
    updatedAt: '2026-07-29T11:00:00.000Z',
  };
  const live = {
    rider_id: 'rider-1',
    latitude: 6.5244,
    longitude: 3.3792,
    accuracy: 10,
    updated_at: new Date(NOW_MS - 5_000).toISOString(),
  };
  const merged = mergeRiderLiveLocation(rider, live, NOW_MS);
  expectEqual(merged.latitude, 6.5244, 'latitude');
  expectEqual(merged.longitude, 3.3792, 'longitude');
  expectEqual(merged.updatedAt, live.updated_at, 'updatedAt');
});

Deno.test('mergeRiderLiveLocation keeps durable columns when the live fix is stale', () => {
  const rider = {
    id: 'rider-1',
    latitude: 1,
    longitude: 2,
    updatedAt: '2026-07-29T11:00:00.000Z',
  };
  const live = {
    rider_id: 'rider-1',
    latitude: 6.5244,
    longitude: 3.3792,
    accuracy: 10,
    updated_at: new Date(NOW_MS - (RIDER_LIVE_TTL_MS + 1_000)).toISOString(),
  };
  const merged = mergeRiderLiveLocation(rider, live, NOW_MS);
  expectEqual(merged.latitude, 1, 'latitude falls back');
  expectEqual(merged.longitude, 2, 'longitude falls back');
  expectEqual(merged.updatedAt, '2026-07-29T11:00:00.000Z', 'updatedAt falls back');
});

Deno.test('mergeRiderLiveLocation keeps durable columns when there is no live row', () => {
  const rider = {
    id: 'rider-1',
    latitude: 1,
    longitude: 2,
    updatedAt: '2026-07-29T11:00:00.000Z',
  };
  const merged = mergeRiderLiveLocation(rider, undefined, NOW_MS);
  expectEqual(merged.latitude, 1, 'latitude');
  expectEqual(merged.longitude, 2, 'longitude');
});

const rankedRow = (riderId: string, metres: number, latitude = 6.5, longitude = 3.3): RankedRiderRow => ({
  rider_id: riderId,
  latitude,
  longitude,
  metres,
});

Deno.test('joinRankedRiders preserves the geo query ordering, not map ordering', () => {
  const ranked = [rankedRow('c', 100), rankedRow('a', 500), rankedRow('b', 900)];
  // Deliberately inserted in a different order from `ranked`.
  const ridersById = new Map([
    ['a', { id: 'a' }],
    ['b', { id: 'b' }],
    ['c', { id: 'c' }],
  ]);
  const joined = joinRankedRiders(ranked, ridersById);
  expectJsonEqual(
    joined.map((entry) => entry.rider.id),
    ['c', 'a', 'b'],
    'ordering'
  );
});

Deno.test('joinRankedRiders skips ranked riders with no profile row', () => {
  const ranked = [rankedRow('ghost', 100), rankedRow('real', 200)];
  const ridersById = new Map([['real', { id: 'real' }]]);
  const joined = joinRankedRiders(ranked, ridersById);
  expectEqual(joined.length, 1, 'orphan dropped');
  expectEqual(joined[0].rider.id, 'real', 'survivor');
});

Deno.test('joinRankedRiders overlays the live coordinates onto the profile row', () => {
  const ranked = [rankedRow('a', 100, 6.4550, 3.4210)];
  const ridersById = new Map([['a', { id: 'a', latitude: 1, longitude: 2 }]]);
  const joined = joinRankedRiders(ranked, ridersById);
  expectEqual(joined[0].rider.latitude, 6.4550, 'latitude overlaid');
  expectEqual(joined[0].rider.longitude, 3.4210, 'longitude overlaid');
});

Deno.test('joinRankedRiders rounds metres to whole numbers', () => {
  const ranked = [rankedRow('a', 1234.567)];
  const ridersById = new Map([['a', { id: 'a' }]]);
  expectEqual(joinRankedRiders(ranked, ridersById)[0].metres, 1235, 'rounded');
});

Deno.test('joinRankedRiders returns an empty list for empty input', () => {
  expectEqual(joinRankedRiders([], new Map()).length, 0, 'empty');
});

Deno.test('joinRankedRiders does not mutate the profile rows it is given', () => {
  const rider = { id: 'a', latitude: 1, longitude: 2 };
  joinRankedRiders([rankedRow('a', 100, 9.9, 8.8)], new Map([['a', rider]]));
  expectEqual(rider.latitude, 1, 'original untouched');
});

Deno.test('mergeRiderLiveLocation does not mutate the input rider', () => {
  const rider = {
    id: 'rider-1',
    latitude: 1,
    longitude: 2,
    updatedAt: '2026-07-29T11:00:00.000Z',
  };
  const live = {
    rider_id: 'rider-1',
    latitude: 6.5244,
    longitude: 3.3792,
    accuracy: 10,
    updated_at: new Date(NOW_MS - 5_000).toISOString(),
  };
  mergeRiderLiveLocation(rider, live, NOW_MS);
  expectEqual(rider.latitude, 1, 'original untouched');
});
