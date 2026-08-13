/**
 * Pure, testable logic for the public-catalog function: row -> card/detail
 * projection, geo filtering/sorting, and cursor pagination. Kept free of
 * Deno.serve/service-client wiring so it can be unit tested directly (see
 * catalog.test.ts) — the same pattern as payment-verification/invariants.ts.
 */
import { toCdnImageUrl } from '../_shared/media.ts';
import { calculateDistanceKm, resolveDeliveryRadiusKm } from '../_shared/deliveryCoverage.ts';
import { toDisplayPrice, type PricingConfig } from '../_shared/pricing.ts';

export type RestaurantRow = {
  address?: string | null;
  closingTime?: string | null;
  createdAt?: string | null;
  cuisine?: string | null;
  cuisines?: string[] | null;
  deliveryFee?: number | null;
  deliveryRadiusKm?: number | null;
  deliveryTime?: string | number | null;
  description?: string | null;
  id: string;
  image?: string | null;
  logoImage?: string | null;
  isOpen?: boolean | null;
  isPublished?: boolean | null;
  latitude?: number | null;
  longitude?: number | null;
  menu?: unknown[] | null;
  minOrder?: number | null;
  name: string;
  openingTime?: string | null;
  supportsDelivery?: boolean | null;
  supportsPickup?: boolean | null;
  updatedAt?: string | null;
};

/** Card projection returned by customerGetRestaurantList. Deliberately has no `menu` key. */
export type RestaurantCard = {
  id: string;
  name: string;
  cuisine: string | null;
  cuisines: string[];
  image: string | null;
  logoImage: string | null;
  deliveryFee: number;
  deliveryTime: string | number | null;
  minOrder: number;
  latitude: number | null;
  longitude: number | null;
  deliveryRadiusKm: number | null;
  supportsDelivery: boolean;
  supportsPickup: boolean;
  isOpen: boolean;
  updatedAt: string | null;
  // RestaurantRecord has no rating columns yet (Task 12/E1 adds ratingAverage/
  // ratingCount). Emitting the field now, always null/0, means the shape
  // never has to change again once that column lands — only these two lines do.
  ratingAverage: number | null;
  ratingCount: number;
};

export const DEFAULT_PAGE_SIZE = 50;

const sanitizeText = (value: unknown, fallback = '') =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const sanitizeOptionalText = (value: unknown) => {
  const nextValue = sanitizeText(value);
  return nextValue || null;
};

/**
 * True when the row's menu has at least one category with at least one
 * available (isAvailable !== false) item. Mirrors
 * apps/customer/src/utils/restaurantAvailability.ts's
 * getPublishedMenuItemCount(...) > 0 — the two MUST agree, or a restaurant
 * hidden from the card list would still show up via the deprecated full-menu
 * alias, or vice versa.
 */
export const hasAvailableMenuItem = (menu: unknown): boolean => {
  if (!Array.isArray(menu)) {
    return false;
  }

  return menu.some((category) => {
    if (!category || typeof category !== 'object') {
      return false;
    }

    const items = (category as Record<string, unknown>).items;
    if (!Array.isArray(items)) {
      return false;
    }

    return items.some((item) => {
      if (!item || typeof item !== 'object') {
        return false;
      }

      return (item as Record<string, unknown>).isAvailable !== false;
    });
  });
};

export const toRestaurantCard = (restaurant: RestaurantRow): RestaurantCard => ({
  id: restaurant.id,
  name: sanitizeText(restaurant.name, 'Restaurant'),
  cuisine: sanitizeOptionalText(restaurant.cuisine),
  cuisines: Array.isArray(restaurant.cuisines) ? restaurant.cuisines.filter((entry) => typeof entry === 'string') : [],
  image: toCdnImageUrl(sanitizeOptionalText(restaurant.image)),
  logoImage: toCdnImageUrl(sanitizeOptionalText(restaurant.logoImage)),
  deliveryFee: restaurant.deliveryFee ?? 0,
  deliveryTime: restaurant.deliveryTime ?? null,
  minOrder: restaurant.minOrder ?? 0,
  latitude: restaurant.latitude ?? null,
  longitude: restaurant.longitude ?? null,
  deliveryRadiusKm: restaurant.deliveryRadiusKm ?? null,
  supportsDelivery: restaurant.supportsDelivery !== false,
  supportsPickup: restaurant.supportsPickup !== false,
  isOpen: restaurant.isOpen !== false,
  updatedAt: restaurant.updatedAt ?? null,
  ratingAverage: null,
  ratingCount: 0,
});

// Customers only ever see final prices; the restaurant's own price never
// leaves the server. Malformed categories/items pass through untouched.
const withDisplayMenuPrices = (menu: unknown[], config: PricingConfig) =>
  menu.map((category) => {
    if (!category || typeof category !== 'object') {
      return category;
    }

    const categoryRecord = category as Record<string, unknown>;
    if (!Array.isArray(categoryRecord.items)) {
      return category;
    }

    return {
      ...categoryRecord,
      items: categoryRecord.items.map((item) => {
        if (!item || typeof item !== 'object') {
          return item;
        }

        const itemRecord = item as Record<string, unknown>;
        if (typeof itemRecord.price !== 'number' || !Number.isFinite(itemRecord.price)) {
          return item;
        }

        return { ...itemRecord, price: toDisplayPrice(itemRecord.price, config) };
      }),
    };
  });

/** Full restaurant projection (incl. priced menu) for customerGetRestaurantDetail. */
export const toRestaurantDetail = (restaurant: RestaurantRow, pricingConfig: PricingConfig) => ({
  address: sanitizeOptionalText(restaurant.address),
  approvalStatus: restaurant.isPublished ? 'approved' : 'pending',
  approvedAt: null,
  cuisine: sanitizeOptionalText(restaurant.cuisine),
  deliveryFee: restaurant.deliveryFee ?? 0,
  deliveryRadiusKm: restaurant.deliveryRadiusKm ?? null,
  deliveryTime: restaurant.deliveryTime ?? null,
  description: sanitizeOptionalText(restaurant.description),
  closingTime: sanitizeOptionalText(restaurant.closingTime),
  id: restaurant.id,
  image: toCdnImageUrl(sanitizeOptionalText(restaurant.image)),
  logoImage: toCdnImageUrl(sanitizeOptionalText(restaurant.logoImage)),
  isOpen: restaurant.isOpen !== false,
  isPublished: restaurant.isPublished === true,
  latitude: restaurant.latitude ?? null,
  longitude: restaurant.longitude ?? null,
  menu: Array.isArray(restaurant.menu) ? withDisplayMenuPrices(restaurant.menu, pricingConfig) : [],
  minOrder: restaurant.minOrder ?? 0,
  name: sanitizeText(restaurant.name, 'Restaurant'),
  openingTime: sanitizeOptionalText(restaurant.openingTime),
  supportsDelivery: restaurant.supportsDelivery !== false,
  supportsPickup: restaurant.supportsPickup !== false,
  updatedAt: restaurant.updatedAt ?? null,
});

export type GeoCoords = { latitude: number; longitude: number };

type Locatable = {
  id: string;
  latitude?: number | null;
  longitude?: number | null;
  deliveryRadiusKm?: number | null;
};

/**
 * Without coords: returns `rows` unchanged (caller already has them in the
 * desired order, e.g. updatedAt DESC from the DB query).
 * With coords: keeps only rows with coordinates AND whose deliveryRadiusKm
 * (resolveDeliveryRadiusKm's 12km fallback for a non-positive radius — same
 * default order-time enforcement uses, see deliveryCoverage.ts) covers the
 * point, sorted nearest-first (id as a stable tie-break).
 */
export const sortRestaurantsByLocation = <T extends Locatable>(rows: T[], coords: GeoCoords | null): T[] => {
  if (!coords) {
    return rows;
  }

  return rows
    .filter((row): row is T => typeof row.latitude === 'number' && typeof row.longitude === 'number')
    .map((row) => ({
      row,
      distanceKm: calculateDistanceKm(coords, {
        latitude: row.latitude as number,
        longitude: row.longitude as number,
      }),
    }))
    .filter(({ row, distanceKm }) => distanceKm <= resolveDeliveryRadiusKm(row.deliveryRadiusKm))
    .sort((a, b) => a.distanceKm - b.distanceKm || a.row.id.localeCompare(b.row.id))
    .map(({ row }) => row);
};

const encodeCursor = (id: string): string => btoa(id);

const decodeCursorId = (cursor: string): string | null => {
  try {
    const decoded = atob(cursor);
    return decoded || null;
  } catch {
    return null;
  }
};

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};

/**
 * Opaque-cursor pagination over an already-sorted array. The cursor encodes
 * the id of the last item on the previous page; the next page resumes right
 * after it, so the same helper paginates both the geo-sorted and the
 * updatedAt-DESC order without knowing which one it is.
 *
 * An unrecognized cursor (row deleted between calls, or a tampered value) is
 * treated as exhausted (empty page, no nextCursor) rather than silently
 * restarting from page 1 — re-serving already-seen rows is worse than an
 * empty page.
 */
export const paginateRestaurants = <T extends { id: string }>(
  sorted: T[],
  cursor: string | null | undefined,
  pageSize: number = DEFAULT_PAGE_SIZE
): Page<T> => {
  let startIndex = 0;

  if (cursor) {
    const cursorId = decodeCursorId(cursor);
    const foundIndex = cursorId ? sorted.findIndex((entry) => entry.id === cursorId) : -1;
    startIndex = foundIndex === -1 ? sorted.length : foundIndex + 1;
  }

  const items = sorted.slice(startIndex, startIndex + pageSize);
  const nextIndex = startIndex + items.length;
  const nextCursor = items.length > 0 && nextIndex < sorted.length ? encodeCursor(items[items.length - 1].id) : null;

  return { items, nextCursor };
};
