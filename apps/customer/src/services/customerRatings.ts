// Thin RPC wiring for the post-delivery rating prompt (Task 12/E1). All the
// actually-testable logic (which order to prompt next, recognizing the
// already_rated outcome, client-side score validation) lives in the pure
// ../domain/ratingPrompt.ts module. This file cannot be imported under plain
// Node — callCustomerBackendRpc pulls in expo-constants / @supabase/supabase-js
// via backendRpc.ts — so it is intentionally left untested directly, matching
// this codebase's established split between pure logic and RPC wiring (see
// catalogCache.ts vs publicRestaurantReadModel.ts).

import { isAlreadyRatedError, type PendingRating } from '../domain/ratingPrompt';
import { callCustomerBackendRpc } from './backendRpc';
import { clearCustomerReadCache } from './customerReadModel';

export const getPendingOrderRatings = async (): Promise<PendingRating[]> => {
  const result = await callCustomerBackendRpc<{ orders: PendingRating[] }>('customerGetPendingRatings');
  return result.orders ?? [];
};

export type SubmitOrderRatingInput = {
  comment?: string | null;
  courierScore?: number | null;
  orderId: string;
  restaurantScore: number;
};

export type SubmitOrderRatingResult =
  | { outcome: 'already_rated' }
  | { outcome: 'submitted'; ratingId: string | null; restaurantId: string | null };

/**
 * Never throws for the already_rated outcome — the UNIQUE constraint on
 * OrderRating.orderId is the real guard (see 20260820_order_ratings.sql), and
 * a second submission racing it (a double-tap, or a stale prompt still on
 * screen) is an ordinary, expected outcome here, not a failure to surface as
 * an error banner. Any OTHER rejection (ownership, status, validation, a
 * genuine network failure) rethrows unchanged.
 */
export const submitOrderRating = async (input: SubmitOrderRatingInput): Promise<SubmitOrderRatingResult> => {
  try {
    const result = await callCustomerBackendRpc<{
      orderId: string;
      ratingId: string | null;
      restaurantId: string | null;
    }>('customerSubmitOrderRating', {
      orderId: input.orderId,
      restaurantScore: input.restaurantScore,
      ...(input.courierScore != null ? { courierScore: input.courierScore } : {}),
      ...(input.comment?.trim() ? { comment: input.comment.trim() } : {}),
    });

    clearCustomerReadCache();
    return { outcome: 'submitted', ratingId: result.ratingId, restaurantId: result.restaurantId };
  } catch (error) {
    if (isAlreadyRatedError(error)) {
      return { outcome: 'already_rated' };
    }

    throw error;
  }
};
