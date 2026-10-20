// Who delivers an order, decided ONCE, at checkout, and stamped onto the order.
//
// WHY AT CHECKOUT. The Paystack split (subaccount + transaction_charge) is fixed
// when the payment is initialised, long before any rider is chosen. If the
// delivery fee goes to the restaurant's subaccount at payment time, it cannot
// later be clawed back to pay a FEASTY rider, and vice versa. So the decision
// cannot wait for dispatch: it is made here from a restaurant-level setting,
// written into CustomerOrder.pricing.deliveryProvider, and every later step
// reads the stamp rather than re-deciding:
//
//   * pricing.ts           - 'platform' keeps the delivery fee (and the tip) in
//                            the platform balance; 'restaurant' is unchanged.
//   * dispatchSelection.ts - 'platform' orders are offered ONLY to the global
//                            FEASTY pool; 'restaurant' orders ONLY to the
//                            restaurant's own riders (no global fallback), so a
//                            FEASTY rider is never sent on an order whose fee
//                            the restaurant already received.
//   * RiderEarning trigger - only a 'platform' order delivered by a global-pool
//                            rider with a verified handoff code earns rider pay.
//
// 'platform' requires BOTH the restaurant opting in
// (RestaurantRecord.deliveryProvider = 'platform', admin-set) AND the
// platform_dispatch feature flag being on - with the flag off there is no rider
// pool, so taking the fee off the restaurant would leave nobody to deliver.
//
// Every failure resolves to 'restaurant', which is today's behaviour exactly.
// That makes the code safe to deploy BEFORE the migration that adds the column:
// a missing column reads as 'restaurant', and because dispatch follows the same
// stamp the fallback is self-consistent (the restaurant keeps the fee AND
// delivers).

import { serviceClient } from './client.ts';
import { isFeatureEnabled, loadFeatureFlagMap } from './featureFlags.ts';
import { logEdgeEvent } from './observability.ts';

export type DeliveryProvider = 'restaurant' | 'platform';

export const PLATFORM_DISPATCH_FLAG = 'platform_dispatch';

/** Anything other than the exact string 'platform' is the restaurant (today's default). */
export const normalizeDeliveryProvider = (value: unknown): DeliveryProvider =>
  typeof value === 'string' && value.trim() === 'platform' ? 'platform' : 'restaurant';

/** Reads the stamp an order was paid under. Unstamped (legacy) orders are restaurant-delivered. */
export const readOrderDeliveryProvider = (pricing: unknown): DeliveryProvider => {
  if (!pricing || typeof pricing !== 'object' || Array.isArray(pricing)) {
    return 'restaurant';
  }
  return normalizeDeliveryProvider((pricing as Record<string, unknown>).deliveryProvider);
};

/** The pure checkout decision. Pickup never has a delivery provider. */
export const resolveCheckoutDeliveryProvider = (input: {
  fulfillmentType: string;
  platformDispatchEnabled: boolean;
  restaurantSetting: unknown;
}): DeliveryProvider => {
  if (input.fulfillmentType !== 'delivery') {
    return 'restaurant';
  }
  if (!input.platformDispatchEnabled) {
    return 'restaurant';
  }
  return normalizeDeliveryProvider(input.restaurantSetting);
};

type ProviderClient = Pick<typeof serviceClient, 'from'>;

/**
 * Loads the restaurant setting for each id. Tolerant by design (see the module
 * header): a query error - including the column not existing yet - yields
 * 'restaurant' for every id and is logged, never thrown.
 */
export const loadRestaurantDeliveryProviders = async (
  restaurantIds: string[],
  client: ProviderClient = serviceClient
): Promise<Map<string, DeliveryProvider>> => {
  const result = new Map<string, DeliveryProvider>(restaurantIds.map((id) => [id, 'restaurant' as DeliveryProvider]));
  if (restaurantIds.length === 0) {
    return result;
  }

  try {
    const { data, error } = await client
      .from('RestaurantRecord')
      .select('id,deliveryProvider')
      .in('id', restaurantIds);
    if (error) {
      logEdgeEvent('warn', 'Restaurant delivery provider unreadable; defaulting to restaurant delivery', {
        error: { message: error.message },
      });
      return result;
    }
    for (const row of (data ?? []) as Array<{ deliveryProvider?: unknown; id?: unknown }>) {
      if (typeof row.id === 'string' && result.has(row.id)) {
        result.set(row.id, normalizeDeliveryProvider(row.deliveryProvider));
      }
    }
  } catch (error) {
    logEdgeEvent('warn', 'Restaurant delivery provider lookup threw; defaulting to restaurant delivery', {
      error: error instanceof Error ? { message: error.message } : String(error),
    });
  }

  return result;
};

/** Tolerant flag read: an unreadable FeatureFlag table means platform dispatch is off. */
export const loadPlatformDispatchEnabled = async (
  loadFlags: typeof loadFeatureFlagMap = loadFeatureFlagMap
): Promise<boolean> => {
  try {
    return isFeatureEnabled(await loadFlags(), PLATFORM_DISPATCH_FLAG);
  } catch (error) {
    logEdgeEvent('warn', 'Feature flags unreadable at checkout; treating platform dispatch as off', {
      error: error instanceof Error ? { message: error.message } : String(error),
    });
    return false;
  }
};

/**
 * Checkout entry point: one provider per restaurant in the cart, every one of
 * them 'restaurant' unless the flag is on AND that restaurant opted in.
 */
export const resolveCheckoutDeliveryProviders = async (input: {
  fulfillmentType: string;
  restaurantIds: string[];
}): Promise<Map<string, DeliveryProvider>> => {
  const fallback = new Map<string, DeliveryProvider>(
    input.restaurantIds.map((id) => [id, 'restaurant' as DeliveryProvider])
  );
  if (input.fulfillmentType !== 'delivery') {
    return fallback;
  }
  const platformDispatchEnabled = await loadPlatformDispatchEnabled();
  if (!platformDispatchEnabled) {
    return fallback;
  }
  const settings = await loadRestaurantDeliveryProviders(input.restaurantIds);
  return new Map(
    input.restaurantIds.map((id) => [
      id,
      resolveCheckoutDeliveryProvider({
        fulfillmentType: input.fulfillmentType,
        platformDispatchEnabled,
        restaurantSetting: settings.get(id),
      }),
    ])
  );
};
