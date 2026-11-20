/**
 * Who gets an order to the customer, in words.
 *
 * Order detail used to show "Courier" and "Courier uid" straight from the
 * dispatch assignment, which is empty for every pickup and for every
 * restaurant that delivers its own orders -- so the field sat blank and read
 * like missing data. The order says enough to be exact: pricing.deliveryProvider
 * is 'platform' when a FEASTY rider delivers, and a rider assignment means the
 * same; otherwise a delivery order is the restaurant's own.
 *
 * Pure: no imports, so it runs under plain `node --test`.
 */

export type DeliveryLike = {
  fulfillmentType?: string | null;
  pricing?: { deliveryProvider?: string | null } | null;
  assignment?: { courierName?: string | null; courierId?: string | null } | null;
};

export type DeliveryDescription = {
  mode: 'pickup' | 'platform' | 'restaurant';
  /** Who delivers, in words. */
  deliveredBy: string;
  /** The FEASTY rider's name or short id, when one is assigned. */
  courier: string | null;
};

export const describeDelivery = (order: DeliveryLike): DeliveryDescription => {
  if ((order.fulfillmentType ?? '').toLowerCase() === 'pickup') {
    return { mode: 'pickup', deliveredBy: 'Customer pickup, no courier', courier: null };
  }

  const courierName = order.assignment?.courierName?.trim() || null;
  const courierId = order.assignment?.courierId?.trim() || null;
  const courier = courierName ?? (courierId ? courierId.slice(-6).toUpperCase() : null);

  if ((order.pricing?.deliveryProvider ?? '') === 'platform' || courierId) {
    return {
      mode: 'platform',
      deliveredBy: courier ? 'FEASTY rider' : 'FEASTY rider, not assigned yet',
      courier,
    };
  }

  return { mode: 'restaurant', deliveredBy: "The restaurant's own delivery", courier: null };
};
