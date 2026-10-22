// Admin control for RestaurantRecord.deliveryProvider: whether a restaurant's
// delivery orders are delivered by FEASTY platform riders ('platform') or by the
// restaurant itself ('restaurant', the default).
//
// What it changes (see _shared/deliveryProvider.ts): from the NEXT checkout
// on, a 'platform' restaurant's delivery fee and tip stay with FEASTY to pay the
// rider, and its orders are offered to the global rider pool only. Orders
// already placed keep the provider they were paid under. Checkout honours
// 'platform' only while the platform_dispatch feature flag is on.

import { createAuditEntry } from './auditLog.ts';
import { serviceClient } from './client.ts';
import { normalizeDeliveryProvider, type DeliveryProvider } from './deliveryProvider.ts';
import { nowIso, sanitizeText } from './rpc/coercion.ts';
import { ensureRole, type AuthenticatedRequestContext } from './rpc/context.ts';
import type { RpcHandler } from './rpc/registry.ts';
import { fail, json } from './rpc/respond.ts';

type Handler = RpcHandler<AuthenticatedRequestContext>;

/** Strict: only the two exact values are accepted (normalize would map typos to 'restaurant'). */
export const parseDeliveryProviderInput = (value: unknown): DeliveryProvider | null =>
  value === 'platform' || value === 'restaurant' ? value : null;

export const adminSetRestaurantDeliveryProvider: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin']);
  const restaurantId = sanitizeText(data.restaurantId);
  if (!restaurantId) {
    fail(400, 'A restaurant id is required.');
  }
  const deliveryProvider = parseDeliveryProviderInput(data.deliveryProvider);
  if (!deliveryProvider) {
    fail(400, "deliveryProvider must be 'platform' or 'restaurant'.");
  }

  const { data: existing, error: readError } = await serviceClient
    .from('RestaurantRecord')
    .select('id,name,deliveryProvider')
    .eq('id', restaurantId)
    .maybeSingle<{ deliveryProvider: string | null; id: string; name: string }>();
  if (readError) {
    // Most likely the rider-pay migration has not been applied yet.
    throw new Error(readError.message);
  }
  if (!existing) {
    fail(404, 'The selected restaurant could not be found.');
  }
  const previous = normalizeDeliveryProvider(existing?.deliveryProvider);

  const { error } = await serviceClient
    .from('RestaurantRecord')
    .update({ deliveryProvider, updatedAt: nowIso() })
    .eq('id', restaurantId);
  if (error) {
    throw new Error(error.message);
  }

  if (previous !== deliveryProvider) {
    await createAuditEntry(context.uid, 'restaurant_delivery_provider_set', 'restaurant', restaurantId, {
      deliveryProvider,
      previous,
    });
  }

  return json(200, {
    data: { deliveryProvider, id: restaurantId, name: existing?.name ?? null, previous },
  });
};
