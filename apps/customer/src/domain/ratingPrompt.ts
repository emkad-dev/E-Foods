// Pure, Node-testable logic for the post-delivery rating prompt (Task 12/E1).
// Kept free of any RPC/Supabase import on purpose — apps/customer/src/services/
// customerRatings.ts is the thin, impure wiring layer that calls
// customerGetPendingRatings / customerSubmitOrderRating and cannot be
// imported under plain Node (it pulls in expo-constants / @supabase/supabase-js
// via backendRpc.ts, which need Expo/Metro's module resolution — the same
// constraint catalogCache.ts / publicRestaurantReadModel.ts document for the
// public-catalog read path). This module is what actually gets unit tested;
// the wiring layer is exercised only by hand/E2E, matching this codebase's
// established split (see supabase/functions/public-catalog/catalog.ts vs
// index.ts for the server-side equivalent of the same split).

export type PendingRating = {
  deliveredAt: string | null;
  hasCourier: boolean;
  orderId: string;
  restaurantId: string;
  restaurantName: string;
};

/**
 * Which pending order (if any) the prompt should show right now.
 *
 * `handledOrderIds` is LOCAL, session-only state — every orderId the prompt
 * has already resolved (submitted, or hit the already_rated outcome) since
 * the last successful `customerGetPendingRatings` fetch. It exists because
 * the server list can only reflect a rating that has actually committed:
 * between "submit succeeded" and "the next fetch confirms the order is gone
 * from the pending list", the order may still be sitting in `pending` from a
 * stale response. Without this set, a successful submit would flash the same
 * prompt again for a moment — the exact "does not re-appear for that order"
 * requirement in the brief. First-come, first-served: the earliest entry in
 * `pending` that hasn't been locally handled yet.
 */
export const selectNextPendingRating = (
  pending: readonly PendingRating[],
  handledOrderIds: ReadonlySet<string>
): PendingRating | null => pending.find((order) => !handledOrderIds.has(order.orderId)) ?? null;

// Must match the exact message customerSubmitOrderRating's `already_rated`
// branch throws (fail(409, ...) in supabase/functions/_shared/domains/orders.ts)
// — callBackendRpc (packages/auth/src/backendRpc.ts) only preserves the
// error MESSAGE across the RPC boundary, not the HTTP status code, so message
// text is the only signal available client-side to tell "the UNIQUE guard
// already caught this — nothing to do" apart from a real failure.
export const ALREADY_RATED_MESSAGE = 'This order has already been rated.';

/**
 * True only for the specific already-rated outcome — never for any other
 * server rejection (not_owner's 403, not_delivered's 412, a validation 400,
 * a genuine network/infra failure). The whole point of this predicate is
 * narrowness: something that matched everything would swallow real errors
 * silently instead of just the one expected race outcome.
 */
export const isAlreadyRatedError = (error: unknown): boolean =>
  error instanceof Error && error.message === ALREADY_RATED_MESSAGE;

export const RESTAURANT_SCORE_RANGE = { max: 5, min: 1 } as const;

/** Client-side UX guard only — the server independently enforces 1-5 via the OrderRating check constraint and customerSubmitOrderRating's own validation. */
export const isValidScore = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= RESTAURANT_SCORE_RANGE.min &&
  value <= RESTAURANT_SCORE_RANGE.max;
