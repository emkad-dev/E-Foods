// Shared prep-time read model.
//
// The pure estimation math lives in packages/domain/src/prepTime.ts so both
// the edge functions and the customer app can rely on the same median /
// fallback rules. This module adds the DB reads that assemble the samples
// from recent restaurant orders and the restaurant's own timing context.

import { serviceClient } from './client.ts';
import { logEdgeEvent } from './observability.ts';
import { sanitizeText } from './rpc/coercion.ts';
import {
  buildRestaurantPrepTimeEstimate,
  type PrepTimeEstimate,
  type PrepTimeSample,
} from '../../../packages/domain/src/prepTime.ts';

type CoordinatePair = {
  latitude: number | null;
  longitude: number | null;
};

export type RestaurantTimingContext = CoordinatePair & {
  deliveryTime: string | null;
};

const readCoordinatePair = (value: { latitude?: number | null; longitude?: number | null } | null | undefined) => {
  if (!value) {
    return null;
  }

  const { latitude, longitude } = value;
  if (
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude)
  ) {
    return { latitude, longitude };
  }

  return null;
};

const readPrepSample = (timeline: unknown): PrepTimeSample | null => {
  if (!timeline || typeof timeline !== 'object') {
    return null;
  }

  const record = timeline as Record<string, unknown>;
  const acceptedAtIso = sanitizeText(record.acceptedAt);
  const readyAtIso = sanitizeText(record.readyAt);
  if (!acceptedAtIso || !readyAtIso) {
    return null;
  }

  return { acceptedAtIso, readyAtIso };
};

/**
 * Restaurant coordinates and the restaurant's published delivery-time string.
 * Missing rows are treated as null so ETA and dispatch timing can continue
 * with best-effort defaults rather than failing the order flow.
 */
export const loadRestaurantTimingContext = async (
  restaurantId: string | null | undefined
): Promise<RestaurantTimingContext | null> => {
  const safeRestaurantId = sanitizeText(restaurantId);
  if (!safeRestaurantId) {
    return null;
  }

  try {
    const { data, error } = await serviceClient
      .from('RestaurantRecord')
      .select('latitude,longitude,deliveryTime')
      .eq('id', safeRestaurantId)
      .maybeSingle<{ deliveryTime?: string | null; latitude?: number | null; longitude?: number | null }>();

    if (error) {
      throw new Error(error.message);
    }

    const coordinates = readCoordinatePair(data ?? null);
    return {
      deliveryTime: sanitizeText(data?.deliveryTime) || null,
      latitude: coordinates?.latitude ?? null,
      longitude: coordinates?.longitude ?? null,
    };
  } catch (error) {
    logEdgeEvent('warn', 'Failed to load restaurant timing context', {
      error: error instanceof Error ? error.message : String(error),
      restaurantId: safeRestaurantId,
    });
    return null;
  }
};

/**
 * Rolling prep estimate for a restaurant.
 *
 * The query intentionally reads a wider slice than the final 20 samples so the
 * caller can still get the first matching 20 in bucket order even when the
 * most recent orders are in a different hour bucket.
 */
export const loadRestaurantPrepTimeEstimate = async ({
  acceptedAtIso,
  fallbackDeliveryTime,
  restaurantId,
}: {
  acceptedAtIso: string;
  fallbackDeliveryTime: unknown;
  restaurantId: string | null | undefined;
}): Promise<PrepTimeEstimate> => {
  const safeRestaurantId = sanitizeText(restaurantId);
  if (!safeRestaurantId) {
    return buildRestaurantPrepTimeEstimate({
      acceptedAtIso,
      fallbackDeliveryTime,
      samples: [],
    });
  }

  try {
    const query = serviceClient
      .from('CustomerOrder')
      .select('timeline,createdAt')
      .eq('restaurantId', safeRestaurantId)
      .order('createdAt', { ascending: false })
      .limit(200);

    const { data, error } = await query;

    if (error) {
      throw new Error(error.message);
    }

    const samples = ((data ?? []) as Array<{ timeline?: unknown }>).flatMap((row) => {
      const sample = readPrepSample(row.timeline);
      return sample ? [sample] : [];
    });

    return buildRestaurantPrepTimeEstimate({
      acceptedAtIso,
      fallbackDeliveryTime,
      samples,
    });
  } catch (error) {
    logEdgeEvent('warn', 'Failed to load restaurant prep samples', {
      error: error instanceof Error ? error.message : String(error),
      restaurantId: safeRestaurantId,
    });

    return buildRestaurantPrepTimeEstimate({
      acceptedAtIso,
      fallbackDeliveryTime,
      samples: [],
    });
  }
};
