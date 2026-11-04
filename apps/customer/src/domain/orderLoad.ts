// Pure decision for the order detail hook (hooks/useCustomerOrder.ts): what a
// FAILED load should do to an order the screen already holds.

/**
 * True when a failed load must leave the held order on screen.
 *
 * A reload that fails (flaky connection right after confirm/report, a missed
 * poll) says nothing about the order itself, so wiping a good order into a bare
 * "Order not found" is wrong - and it unmounts whatever UI triggered the reload.
 * Only an order for the SAME id and the SAME customer is kept: after switching
 * orders, or accounts while the screen stays mounted, the previous one must
 * never stand in for the new one. With nothing held (first load) the failure is
 * the answer and the error shows.
 *
 * A genuine "not yours" answer is not a failed load; the hook handles it on its
 * success path and still clears.
 */
export const shouldKeepOrderOnLoadFailure = (
  heldOrder: { customerId?: string | null; id?: string | null } | null | undefined,
  requestedOrderId: string,
  customerId: string | null
): boolean =>
  Boolean(
    heldOrder &&
      requestedOrderId &&
      customerId &&
      heldOrder.id === requestedOrderId &&
      heldOrder.customerId === customerId
  );
