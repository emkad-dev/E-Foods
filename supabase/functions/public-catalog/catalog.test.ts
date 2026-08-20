import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';
import { DEFAULT_PRICING_CONFIG } from '../_shared/pricing.ts';
import {
  hasAvailableMenuItem,
  paginateRestaurants,
  sortRestaurantsByLocation,
  toRestaurantCard,
  toRestaurantDetail,
  type RestaurantRow,
} from './catalog.ts';

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
