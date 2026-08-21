import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';
import { DEFAULT_PRICING_CONFIG } from '../_shared/pricing.ts';
import {
  hasAvailableMenuItem,
  isRestaurantRowPaused,
  paginateRestaurants,
  sortRestaurantsByLocation,
  toRestaurantCard,
  toRestaurantDetail,
  type RestaurantRow,
} from './catalog.ts';

const FIXED_NOW = new Date('2026-08-21T12:00:00.000Z');
const PAST_ISO = '2026-08-21T11:00:00.000Z';
const FUTURE_ISO = '2026-08-21T13:00:00.000Z';

const baseRow = (overrides: Partial<RestaurantRow> = {}): RestaurantRow => ({
  id: 'rest-1',
  name: 'Test Kitchen',
  cuisine: 'Nigerian',
  cuisines: ['nigerian', 'grill'],
  image: null,
  logoImage: null,
  deliveryFee: 500,
  deliveryRadiusKm: 5,
  deliveryTime: '25-35 min',
  latitude: 6.46,
  longitude: 3.39,
  minOrder: 1000,
  supportsDelivery: true,
  supportsPickup: true,
  isOpen: true,
  isPublished: true,
  updatedAt: '2026-08-01T00:00:00.000Z',
  menu: [{ category: 'Mains', items: [{ id: 'i1', name: 'Jollof', price: 2000, isAvailable: true }] }],
  ratingAverage: null,
  ratingCount: 0,
  ...overrides,
});

// --- card projection: no `menu` key at all ---

Deno.test('toRestaurantCard response has no menu key', () => {
  const card = toRestaurantCard(baseRow());
  assertFalse('menu' in card, 'card must not carry a menu field');
});

Deno.test('toRestaurantCard carries the documented card fields, rating defaults included', () => {
  const card = toRestaurantCard(baseRow());
  assertEquals(card.id, 'rest-1');
  assertEquals(card.cuisines, ['nigerian', 'grill']);
  assertEquals(card.ratingAverage, null);
  assertEquals(card.ratingCount, 0);
});

Deno.test('toRestaurantCard passes through a real ratingAverage/ratingCount from the row', () => {
  const card = toRestaurantCard(baseRow({ ratingAverage: 4.25, ratingCount: 12 }));
  assertEquals(card.ratingAverage, 4.25);
  assertEquals(card.ratingCount, 12);
});

Deno.test('toRestaurantDetail carries ratingAverage/ratingCount, defaulting to null/0', () => {
  const detail = toRestaurantDetail(baseRow(), DEFAULT_PRICING_CONFIG);
  assertEquals(detail.ratingAverage, null);
  assertEquals(detail.ratingCount, 0);

  const rated = toRestaurantDetail(baseRow({ ratingAverage: 3.6, ratingCount: 9 }), DEFAULT_PRICING_CONFIG);
  assertEquals(rated.ratingAverage, 3.6);
  assertEquals(rated.ratingCount, 9);
});

// Regression: a card with no isPublished field made
// apps/customer/src/utils/restaurantAvailability.ts's
// isRestaurantVisibleToCustomers reject every restaurant (isPublished !==
// true on `undefined`), emptying the home feed and — via
// getPlatformCoverage's zero-eligible-candidates fail-open path — silently
// reporting every location as covered. loadRestaurantRows only ever selects
// isPublished = true rows, so this must always be the literal `true`, never
// a passthrough of a possibly-absent row field.
Deno.test('toRestaurantCard always emits isPublished: true (every card comes from an isPublished=true row)', () => {
  const card = toRestaurantCard(baseRow());
  assertEquals(card.isPublished, true);
});

// --- hasAvailableMenuItem ---

Deno.test('hasAvailableMenuItem: true when at least one item is available', () => {
  assert(hasAvailableMenuItem(baseRow().menu));
});

Deno.test('hasAvailableMenuItem: false for an empty menu', () => {
  assertFalse(hasAvailableMenuItem([]));
});

Deno.test('hasAvailableMenuItem: false when every item is unavailable', () => {
  assertFalse(
    hasAvailableMenuItem([{ category: 'Mains', items: [{ id: 'i1', name: 'Jollof', isAvailable: false }] }])
  );
});

// Task 16 (F2): timed unavailability, and the drift guard against
// _shared/domains/orders.ts's item validation — see
// _shared/domains/placeCustomerOrderAvailability.test.ts's "drift guard" test
// for the cross-file half of this check (both call sites agreeing on the
// SAME real menu item, not just the pure predicate in isolation).

Deno.test('hasAvailableMenuItem: false when the only item is timed-unavailable in the FUTURE', () => {
  assertFalse(
    hasAvailableMenuItem(
      [{ category: 'Mains', items: [{ id: 'i1', name: 'Jollof', unavailableUntil: FUTURE_ISO }] }],
      FIXED_NOW
    )
  );
});

Deno.test('hasAvailableMenuItem: true when the only item\'s unavailableUntil is in the PAST (auto-resumed)', () => {
  assert(
    hasAvailableMenuItem(
      [{ category: 'Mains', items: [{ id: 'i1', name: 'Jollof', unavailableUntil: PAST_ISO }] }],
      FIXED_NOW
    )
  );
});

Deno.test('hasAvailableMenuItem: manual off is not undone by a past unavailableUntil', () => {
  assertFalse(
    hasAvailableMenuItem(
      [{ category: 'Mains', items: [{ id: 'i1', name: 'Jollof', isAvailable: false, unavailableUntil: PAST_ISO }] }],
      FIXED_NOW
    )
  );
});

// --- isRestaurantRowPaused / the list-feed pause filter ---

Deno.test('isRestaurantRowPaused: false with no pausedUntil', () => {
  assertFalse(isRestaurantRowPaused(baseRow(), FIXED_NOW));
});

Deno.test('isRestaurantRowPaused: true while pausedUntil is in the FUTURE', () => {
  assert(isRestaurantRowPaused(baseRow({ pausedUntil: FUTURE_ISO }), FIXED_NOW));
});

Deno.test('isRestaurantRowPaused: false once pausedUntil is in the PAST (auto-resumed)', () => {
  assertFalse(isRestaurantRowPaused(baseRow({ pausedUntil: PAST_ISO }), FIXED_NOW));
});

// Mirrors the exact filter public-catalog/index.ts's loadRestaurantRows
// applies (shared by BOTH customerGetRestaurantList and the deprecated
// customerGetPublishedRestaurants alias) — a paused row is dropped, a
// not-currently-paused row (including one whose pause already expired) is
// kept, proving "the catalog list excludes a paused store" at the row-filter
// level this module owns.
Deno.test('the list-feed pause filter drops a currently-paused row and keeps an unpaused/expired-pause row', () => {
  const rows = [
    baseRow({ id: 'live', pausedUntil: null }),
    baseRow({ id: 'paused-now', pausedUntil: FUTURE_ISO }),
    baseRow({ id: 'pause-expired', pausedUntil: PAST_ISO }),
  ];

  const kept = rows.filter((row) => !isRestaurantRowPaused(row, FIXED_NOW)).map((row) => row.id);
  assertEquals(kept, ['live', 'pause-expired']);
});

// --- radius filtering ---

Deno.test('radius filter: a restaurant inside its delivery radius is included and sorted nearest-first', () => {
  const near = { id: 'near', latitude: 6.46, longitude: 3.39, deliveryRadiusKm: 5 };
  const far = { id: 'far', latitude: 6.55, longitude: 3.5, deliveryRadiusKm: 50 };
  const coords = { latitude: 6.46, longitude: 3.39 };

  const result = sortRestaurantsByLocation([far, near], coords);
  assertEquals(result.map((r) => r.id), ['near', 'far']);
});

Deno.test('radius filter: a restaurant outside its delivery radius is excluded', () => {
  const outOfRange = { id: 'far', latitude: 9.0765, longitude: 7.3986, deliveryRadiusKm: 5 };
  const coords = { latitude: 6.46, longitude: 3.39 };

  const result = sortRestaurantsByLocation([outOfRange], coords);
  assertEquals(result, []);
});

Deno.test('radius filter: no customer coordinates passes the input through unfiltered', () => {
  const rows = [
    { id: 'a', latitude: null, longitude: null, deliveryRadiusKm: 5 },
    { id: 'b', latitude: 6.46, longitude: 3.39, deliveryRadiusKm: 5 },
  ];

  assertEquals(sortRestaurantsByLocation(rows, null), rows);
});

Deno.test('radius filter: a restaurant missing coordinates is excluded once customer coordinates are given', () => {
  const noCoords = { id: 'no-coords', latitude: null, longitude: null, deliveryRadiusKm: 5 };
  const coords = { latitude: 6.46, longitude: 3.39 };

  assertEquals(sortRestaurantsByLocation([noCoords], coords), []);
});

Deno.test('radius filter: a non-positive radius falls back to the 12km default rather than excluding', () => {
  // ~7km away: outside a literal 0km radius, inside the 12km fallback.
  const nearbyZeroRadius = { id: 'zero-radius', latitude: 6.517, longitude: 3.3841, deliveryRadiusKm: 0 };
  const coords = { latitude: 6.455, longitude: 3.3841 };

  const result = sortRestaurantsByLocation([nearbyZeroRadius], coords);
  assertEquals(result.map((r) => r.id), ['zero-radius']);
});

// --- rating tie-break (Task 12/E1): distance stays PRIMARY, rating only
// breaks a tie at equal distance ---

Deno.test('rating tie-break: at equal distance, the higher-rated restaurant sorts first', () => {
  const coords = { latitude: 6.46, longitude: 3.39 };
  // Same coordinates -> identical distanceKm from `coords`. Ids are chosen
  // so alphabetical order is the OPPOSITE of rating order — a mutation that
  // drops the rating comparator and falls back to id-only would otherwise
  // pass this test by coincidence.
  const lowRated = { id: 'a-low-rated', latitude: 6.46, longitude: 3.39, deliveryRadiusKm: 5, ratingAverage: 3.2 };
  const highRated = { id: 'z-high-rated', latitude: 6.46, longitude: 3.39, deliveryRadiusKm: 5, ratingAverage: 4.8 };

  const result = sortRestaurantsByLocation([lowRated, highRated], coords);
  assertEquals(result.map((r) => r.id), ['z-high-rated', 'a-low-rated']);
});

Deno.test('rating tie-break: distance strictly wins — a nearer low-rated restaurant beats a farther high-rated one', () => {
  const coords = { latitude: 6.46, longitude: 3.39 };
  const nearLowRated = { id: 'near-low', latitude: 6.46, longitude: 3.39, deliveryRadiusKm: 5, ratingAverage: 1.0 };
  const farHighRated = { id: 'far-high', latitude: 6.55, longitude: 3.5, deliveryRadiusKm: 50, ratingAverage: 5.0 };

  const result = sortRestaurantsByLocation([farHighRated, nearLowRated], coords);
  assertEquals(result.map((r) => r.id), ['near-low', 'far-high']);
});

Deno.test('rating tie-break: an unrated restaurant (ratingAverage null) sorts behind any actually-rated restaurant at equal distance', () => {
  const coords = { latitude: 6.46, longitude: 3.39 };
  // Ids again chosen opposite of rating order, for the same reason as above.
  const unrated = { id: 'a-unrated', latitude: 6.46, longitude: 3.39, deliveryRadiusKm: 5, ratingAverage: null };
  // Lowest possible real average (min score is 1) still outranks "no ratings".
  const barelyRated = { id: 'z-barely-rated', latitude: 6.46, longitude: 3.39, deliveryRadiusKm: 5, ratingAverage: 1.0 };

  const result = sortRestaurantsByLocation([unrated, barelyRated], coords);
  assertEquals(result.map((r) => r.id), ['z-barely-rated', 'a-unrated']);
});

Deno.test('rating tie-break: two equally-rated (or both unrated) restaurants at equal distance fall back to id, deterministically', () => {
  const coords = { latitude: 6.46, longitude: 3.39 };
  const b = { id: 'b-restaurant', latitude: 6.46, longitude: 3.39, deliveryRadiusKm: 5, ratingAverage: 4.0 };
  const a = { id: 'a-restaurant', latitude: 6.46, longitude: 3.39, deliveryRadiusKm: 5, ratingAverage: 4.0 };

  const result = sortRestaurantsByLocation([b, a], coords);
  assertEquals(result.map((r) => r.id), ['a-restaurant', 'b-restaurant']);
});

// --- cursor pagination ---

const buildRows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: `r${String(index).padStart(3, '0')}` }));

Deno.test('cursor pagination: first page returns pageSize items and a nextCursor when more remain', () => {
  const rows = buildRows(120);
  const page = paginateRestaurants(rows, null, 50);
  assertEquals(page.items.length, 50);
  assertEquals(page.items[0].id, 'r000');
  assertEquals(page.items[49].id, 'r049');
  assert(page.nextCursor !== null);
});

Deno.test('cursor pagination: the next page resumes right after the cursor', () => {
  const rows = buildRows(120);
  const first = paginateRestaurants(rows, null, 50);
  const second = paginateRestaurants(rows, first.nextCursor, 50);

  assertEquals(second.items.length, 50);
  assertEquals(second.items[0].id, 'r050');
  assertEquals(second.items[49].id, 'r099');
  assert(second.nextCursor !== null);
});

Deno.test('cursor pagination: the final page is exhausted with no nextCursor', () => {
  const rows = buildRows(120);
  const first = paginateRestaurants(rows, null, 50);
  const second = paginateRestaurants(rows, first.nextCursor, 50);
  const third = paginateRestaurants(rows, second.nextCursor, 50);

  assertEquals(third.items.length, 20);
  assertEquals(third.items[0].id, 'r100');
  assertEquals(third.nextCursor, null);

  // Calling again with the exhausted cursor returns an empty page, not a
  // restart from page 1.
  const fourth = paginateRestaurants(rows, third.items.length > 0 ? btoa(third.items[third.items.length - 1].id) : null, 50);
  assertEquals(fourth.items, []);
  assertEquals(fourth.nextCursor, null);
});

Deno.test('cursor pagination: an unrecognized cursor is treated as exhausted, not a restart', () => {
  const rows = buildRows(10);
  const page = paginateRestaurants(rows, btoa('does-not-exist'), 50);
  assertEquals(page.items, []);
  assertEquals(page.nextCursor, null);
});

Deno.test('cursor pagination: a page size larger than the data set returns everything with no nextCursor', () => {
  const rows = buildRows(5);
  const page = paginateRestaurants(rows, null, 50);
  assertEquals(page.items.length, 5);
  assertEquals(page.nextCursor, null);
});
