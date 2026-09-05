/**
 * Run with: node --test --experimental-strip-types apps/customer/src/services/catalogCache.test.ts
 *
 * publicRestaurantReadModel.ts uses this module (catalogCache.ts) for every
 * customerGetRestaurantList / customerGetRestaurantDetail call, keyed on
 * `${action}:${JSON.stringify(data)}`. These tests exercise the same cache
 * module the real read model calls through, standing in for the parts of
 * publicRestaurantReadModel.ts that cannot be imported under plain Node
 * (it pulls in expo-constants / @supabase/supabase-js, which need
 * Expo/Metro's module resolution — see the failed `import('expo-constants')`
 * this was verified against).
 *
 * Covers Task 6's requirement: opening a restaurant issues exactly one
 * detail request, and no menu is ever held for a restaurant that was never
 * opened.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callWithCache, createCatalogCacheStore, type CatalogCacheTtl } from './catalogCache.ts';

const TTL: CatalogCacheTtl = { freshMs: 30_000, staleMs: 6 * 60 * 60_000 };

type RestaurantCard = { id: string };
type RestaurantDetail = { id: string; menu: { category: string; items: unknown[] }[] };

const listKey = () => 'customerGetRestaurantList:{}';
const detailKey = (id: string) => `customerGetRestaurantDetail:${JSON.stringify({ restaurantId: id })}`;

// Mirrors getRestaurantList()/getRestaurantDetail() in publicRestaurantReadModel.ts:
// a card list carries no menu; a detail fetch carries the one restaurant's menu.
const makeFetchers = () => {
  let listCalls = 0;
  const detailCalls = new Map<string, number>();

  const fetchList = async (ids: string[]): Promise<{ restaurants: RestaurantCard[] }> => {
    listCalls += 1;
    return { restaurants: ids.map((id) => ({ id })) };
  };

  const fetchDetail = async (id: string): Promise<{ restaurant: RestaurantDetail }> => {
    detailCalls.set(id, (detailCalls.get(id) ?? 0) + 1);
    return { restaurant: { id, menu: [{ category: 'Mains', items: [{ id: `${id}-item`, name: 'Jollof' }] }] } };
  };

  return {
    fetchList,
    fetchDetail,
    listCallCount: () => listCalls,
    detailCallCount: (id: string) => detailCalls.get(id) ?? 0,
  };
};

// --- exactly one detail request per restaurant open ---

test('opening a restaurant issues exactly one detail request', async () => {
  const store = createCatalogCacheStore();
  const fetchers = makeFetchers();

  await callWithCache(store, detailKey('rest-a'), () => fetchers.fetchDetail('rest-a'), TTL);

  assert.equal(fetchers.detailCallCount('rest-a'), 1);
});

test('re-opening the same restaurant while the entry is fresh does not issue a second request', async () => {
  const store = createCatalogCacheStore();
  const fetchers = makeFetchers();

  const open = () => callWithCache(store, detailKey('rest-a'), () => fetchers.fetchDetail('rest-a'), TTL);

  await open();
  await open();
  await open();

  assert.equal(fetchers.detailCallCount('rest-a'), 1);
});

test('concurrent opens of the same restaurant collapse onto a single in-flight request', async () => {
  const store = createCatalogCacheStore();
  const fetchers = makeFetchers();

  const open = () => callWithCache(store, detailKey('rest-a'), () => fetchers.fetchDetail('rest-a'), TTL);

  await Promise.all([open(), open(), open()]);

  assert.equal(fetchers.detailCallCount('rest-a'), 1);
});

test('opening three different restaurants issues exactly one request per restaurant', async () => {
  const store = createCatalogCacheStore();
  const fetchers = makeFetchers();

  const open = (id: string) => callWithCache(store, detailKey(id), () => fetchers.fetchDetail(id), TTL);

  await open('rest-a');
  await open('rest-b');
  await open('rest-c');
  // Re-opening one already-open restaurant must not add a request for it,
  // and must not add one for any other restaurant either.
  await open('rest-a');

  assert.equal(fetchers.detailCallCount('rest-a'), 1);
  assert.equal(fetchers.detailCallCount('rest-b'), 1);
  assert.equal(fetchers.detailCallCount('rest-c'), 1);
});

// --- never holds menus for unopened restaurants ---

test('a card-list fetch never populates a per-restaurant detail (menu) cache entry', async () => {
  const store = createCatalogCacheStore();
  const fetchers = makeFetchers();

  await callWithCache(store, listKey(), () => fetchers.fetchList(['rest-a', 'rest-b', 'rest-c']), TTL);

  // The list response describes three restaurants, but none of them were
  // "opened" (no detail request was made for any of them) — so no menu-
  // carrying entry exists for any of them.
  assert.equal(store.entries.has(detailKey('rest-a')), false);
  assert.equal(store.entries.has(detailKey('rest-b')), false);
  assert.equal(store.entries.has(detailKey('rest-c')), false);
  assert.equal(fetchers.detailCallCount('rest-a'), 0);
});

test('opening one restaurant holds only that restaurant\'s menu, not any other\'s', async () => {
  const store = createCatalogCacheStore();
  const fetchers = makeFetchers();

  await callWithCache(store, listKey(), () => fetchers.fetchList(['rest-a', 'rest-b', 'rest-c']), TTL);
  await callWithCache(store, detailKey('rest-b'), () => fetchers.fetchDetail('rest-b'), TTL);

  const heldDetailKeys = [...store.entries.keys()].filter((key) => key.startsWith('customerGetRestaurantDetail:'));
  assert.deepEqual(heldDetailKeys, [detailKey('rest-b')]);

  const cachedDetail = store.entries.get(detailKey('rest-b'))?.value as { restaurant: RestaurantDetail };
  assert.equal(cachedDetail.restaurant.menu.length > 0, true);

  // The list cache entry itself never carries menu data for anyone.
  const cachedList = store.entries.get(listKey())?.value as { restaurants: RestaurantCard[] };
  for (const card of cachedList.restaurants) {
    assert.equal('menu' in card, false);
  }
});
