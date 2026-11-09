/**
 * Run with: node --test --experimental-strip-types apps/customer/src/services/readCache.test.ts
 *
 * Guards the defect from order c7655e4a: a realtime change landing inside the
 * cache window re-read the cached pre-change copy and the screen stayed stale.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReadCache } from './readCache.ts';

const setup = () => {
  let clock = 1_000;
  const cache = createReadCache({ ttlMs: 12_000, now: () => clock });
  return { cache, advance: (ms: number) => (clock += ms) };
};

const counter = (values: string[]) => {
  let calls = 0;
  return { fetcher: async () => values[calls++] ?? 'extra', calls: () => calls };
};

test('non-fresh reads inside the TTL are served from the cache', async () => {
  const { cache, advance } = setup();
  const rpc = counter(['a', 'b']);
  assert.equal(await cache.read('k', rpc.fetcher), 'a');
  advance(11_999);
  assert.equal(await cache.read('k', rpc.fetcher), 'a');
  assert.equal(rpc.calls(), 1);
  advance(2);
  assert.equal(await cache.read('k', rpc.fetcher), 'b');
});

test('concurrent non-fresh reads share one request', async () => {
  const { cache } = setup();
  const rpc = counter(['a', 'b']);
  const [x, y] = await Promise.all([cache.read('k', rpc.fetcher), cache.read('k', rpc.fetcher)]);
  assert.deepEqual([x, y], ['a', 'a']);
  assert.equal(rpc.calls(), 1);
});

test('a fresh read bypasses the cached copy and refreshes it', async () => {
  const { cache, advance } = setup();
  const rpc = counter(['before', 'after']);
  assert.equal(await cache.read('k', rpc.fetcher), 'before');
  advance(500);
  assert.equal(await cache.read('k', rpc.fetcher, { fresh: true }), 'after');
  // The refreshed value is what ordinary reads now see.
  assert.equal(await cache.read('k', rpc.fetcher), 'after');
  assert.equal(rpc.calls(), 2);
});

test('a fresh read does not join an in-flight request that started earlier', async () => {
  const { cache } = setup();
  const rpc = counter(['old', 'new']);
  const first = cache.read('k', rpc.fetcher, { fresh: true });
  const second = cache.read('k', rpc.fetcher, { fresh: true });
  assert.deepEqual(await Promise.all([first, second]), ['old', 'new']);
  assert.equal(rpc.calls(), 2);
});

test('an older response cannot overwrite or replace a newer one', async () => {
  const { cache } = setup();
  let releaseOld!: (v: string) => void;
  const oldRequest = cache.read('k', () => new Promise<string>((r) => (releaseOld = r)), { fresh: true });
  const newer = await cache.read('k', async () => 'new', { fresh: true });
  assert.equal(newer, 'new');
  releaseOld('old');
  // The late caller is handed the newer data, and the cache keeps it.
  assert.equal(await oldRequest, 'new');
  assert.equal(await cache.read('k', async () => 'unexpected'), 'new');
});

test('a request started before clear() does not repopulate the cache', async () => {
  const { cache } = setup();
  let releaseOld!: (v: string) => void;
  const pending = cache.read('k', () => new Promise<string>((r) => (releaseOld = r)));
  cache.clear();
  releaseOld('pre-clear');
  assert.equal(await pending, 'pre-clear');
  assert.equal(await cache.read('k', async () => 'post-clear'), 'post-clear');
});

test('keys are independent', async () => {
  const { cache } = setup();
  assert.equal(await cache.read('a', async () => '1'), '1');
  assert.equal(await cache.read('b', async () => '2'), '2');
});
