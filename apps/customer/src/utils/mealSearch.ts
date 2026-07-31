import type { AddressRecord } from '../domain/entities';
import {
  type DiscoveryRestaurant,
  type RestaurantAvailability,
  getRestaurantAvailability,
  isRestaurantVisibleToCustomers,
  normalizeRestaurantQuery,
} from './restaurantAvailability';

// The catalog menu item carries a couple of fields (image, description) that the
// leaner DiscoveryRestaurant.menu type omits. A menu item without them is still
// assignable to this wider shape, so we can iterate the catalog directly.
type MealMenuItem = {
  categoryId?: string;
  categoryLabel?: string;
  description?: string;
  id: string;
  image?: string;
  isAvailable?: boolean;
  name: string;
  price: number;
};

export type MealSearchResult = {
  /** Stable list key — a single meal name can appear once per restaurant. */
  key: string;
  itemId: string;
  itemName: string;
  itemImage?: string;
  itemDescription?: string;
  price: number;
  categoryLabel: string;
  restaurant: DiscoveryRestaurant;
  availability: RestaurantAvailability;
};

const buildHaystack = (item: MealMenuItem, categoryName: string) =>
  [item.name, item.categoryLabel ?? '', item.categoryId ?? '', categoryName].join(' ').toLowerCase();

/**
 * Flattens every visible restaurant's menu into a meal-first result list.
 *
 * Each result is a (meal, restaurant) pair, so the same dish served by two
 * kitchens produces two distinct rows — that is what disambiguates "Jollof Rice
 * — Neeta's" from "Jollof Rice — Gojo mojo" and lets a tap open the right store.
 *
 * Results are ordered "near you" first: orderable meals ahead of unavailable
 * ones, then by delivery distance (unknown distance sinks to the bottom of its
 * group), then alphabetically for a stable tie-break. Distance is only known
 * once the customer has pinned a delivery location AND the restaurant has
 * coordinates; otherwise the row still shows, just without a distance sort key.
 */
export const buildMealSearchResults = (
  restaurants: DiscoveryRestaurant[],
  query: string,
  deliveryLocation: AddressRecord | null
): MealSearchResult[] => {
  const normalizedQuery = normalizeRestaurantQuery(query);

  if (!normalizedQuery) {
    return [];
  }

  const results: MealSearchResult[] = [];

  restaurants.forEach((restaurant) => {
    if (!isRestaurantVisibleToCustomers(restaurant)) {
      return;
    }

    const availability = getRestaurantAvailability(restaurant, deliveryLocation);

    (restaurant.menu ?? []).forEach((category) => {
      const categoryName = category.category ?? '';
      const items: MealMenuItem[] = category.items ?? [];

      items.forEach((item) => {
        if (item.isAvailable === false) {
          return;
        }

        if (!buildHaystack(item, categoryName).includes(normalizedQuery)) {
          return;
        }

        results.push({
          key: `${restaurant.id}:${item.id}`,
          itemId: item.id,
          itemName: item.name,
          itemImage: item.image,
          itemDescription: item.description,
          price: item.price,
          categoryLabel: item.categoryLabel ?? categoryName,
          restaurant,
          availability,
        });
      });
    });
  });

  return results.sort((left, right) => {
    if (left.availability.isAvailable !== right.availability.isAvailable) {
      return left.availability.isAvailable ? -1 : 1;
    }

    const leftDistance = left.availability.distanceKm ?? Number.MAX_SAFE_INTEGER;
    const rightDistance = right.availability.distanceKm ?? Number.MAX_SAFE_INTEGER;
    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }

    const nameComparison = left.itemName.localeCompare(right.itemName);
    if (nameComparison !== 0) {
      return nameComparison;
    }

    return (left.restaurant.name ?? '').localeCompare(right.restaurant.name ?? '');
  });
};

/**
 * Most common available meal categories across the visible catalog, used to seed
 * the empty search state with tappable quick-filters ("Rice", "Soups", …).
 */
export const getPopularMealCategories = (restaurants: DiscoveryRestaurant[], limit = 8): string[] => {
  const counts = new Map<string, number>();

  restaurants.forEach((restaurant) => {
    if (!isRestaurantVisibleToCustomers(restaurant)) {
      return;
    }

    (restaurant.menu ?? []).forEach((category) => {
      const items: MealMenuItem[] = category.items ?? [];
      const hasAvailableItem = items.some((item) => item.isAvailable !== false);
      if (!hasAvailableItem) {
        return;
      }

      const label = (category.category ?? '').trim();
      if (!label) {
        return;
      }

      counts.set(label, (counts.get(label) ?? 0) + 1);
    });
  });

  return Array.from(counts.entries())
    .sort((left, right) => {
      if (left[1] !== right[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })
    .slice(0, limit)
    .map(([label]) => label);
};
