// Explicit `.ts` specifiers, the convention documented in
// `packages/design-system/src/tokens/index.ts`: `partnerQueue.test.ts` guards
// `getKitchenSignalColors` by loading this module under
// `node --test --experimental-strip-types`, and Node's ESM resolver will not
// infer an extension. Metro and tsc both resolve the explicit path unchanged.
import type { OrderDocument } from '../domain/entities.ts';
import {
  formatOrderItemOptions,
  isTerminalOrderStatus,
  normalizeOrderStatus,
  type OrderStatus,
} from '../domain/orders.ts';
import { partnerTheme } from '../theme/palette.ts';

type QueueTone = 'danger' | 'warning' | 'accent' | 'success' | 'muted';

export type KitchenSignal = {
  label: string;
  tone: QueueTone;
};

/**
 * Every place a live order can be rendered on the kitchen board. Four are
 * columns the kitchen works out of; two are strips that bracket them.
 *
 * `attention` and `handedOff` exist because the board used to map only
 * scheduled/placed/accepted/preparing/ready_for_pickup into columns while
 * `usePartnerOrders` fed it everything non-terminal — so `escalated`,
 * `picked_up` and `on_the_way` were handed to the board and rendered nowhere at
 * all. They were not hidden, they were GONE: no column, no count, no ticket.
 *
 * They do not want the same treatment, which is why they are two lanes and not
 * one. `picked_up`/`on_the_way` are out of the kitchen's hands — a rider has the
 * food — so they belong in a quiet lane below the working columns, present but
 * not competing for attention. `escalated` is the opposite: dispatch pulled the
 * order out of the flow (`_shared/domains/dispatch.ts` 'escalate'), every
 * partner action on it is disabled, and somebody has to look at it now — so it
 * goes in a loud strip ABOVE the columns.
 */
export const KITCHEN_LANES = ['attention', 'scheduled', 'new', 'preparing', 'ready', 'handedOff'] as const;
export type KitchenLane = (typeof KITCHEN_LANES)[number];

/**
 * THE GUARD, and the reason this is an exhaustive `Record` rather than a
 * `switch` with a `default`. A `switch` let three statuses fall through to
 * nothing and stay silent about it. Keyed by `OrderStatus`, adding a status to
 * `ORDER_STATUSES` in `packages/domain/src/orders.ts` is a TYPE ERROR here until
 * somebody decides where it renders — the vanish cannot be reintroduced by
 * forgetting.
 *
 * `null` means "not a live kitchen lane" and is reserved for terminal statuses,
 * which never reach the board (`usePartnerOrders` routes them to history).
 * `partnerQueue.test.ts` asserts that `null` lines up exactly with
 * `isTerminalOrderStatus`, so a non-terminal status can never be mapped to
 * nowhere.
 *
 * `draft` is deliberately `attention`, not `null`. It is non-terminal, and the
 * client's `normalizeOrderStatus` funnels EVERY unrecognised status string to
 * `draft` — so an order carrying a status written by a newer server than this
 * build surfaces loudly instead of disappearing.
 */
const KITCHEN_LANE_BY_STATUS: Record<OrderStatus, KitchenLane | null> = {
  draft: 'attention',
  scheduled: 'scheduled',
  placed: 'new',
  accepted: 'preparing',
  preparing: 'preparing',
  ready_for_pickup: 'ready',
  picked_up: 'handedOff',
  on_the_way: 'handedOff',
  delivered: null,
  cancelled: null,
  rejected: null,
  failed_delivery: null,
  escalated: 'attention',
};

/** The lane an order renders in, or `null` for a terminal status that belongs in history. */
export const getKitchenLane = (status: string | null | undefined): KitchenLane | null =>
  KITCHEN_LANE_BY_STATUS[normalizeOrderStatus(status)];

/**
 * True when a status is live work but has nowhere to render — the exact defect
 * class this module now forbids. Always false today; it exists so the board and
 * `partnerQueue.test.ts` can both assert on it rather than each re-deriving it.
 */
export const isUnrenderableLiveStatus = (status: string | null | undefined) =>
  !isTerminalOrderStatus(status) && getKitchenLane(status) === null;

export const formatPartnerMoney = (amount: number) => `₦${amount.toFixed(2)}`;

const toTimestamp = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
};

/**
 * `escalated` is FIRST, ahead of a brand-new ticket. It used to share the
 * catch-all `return 5` with unknown statuses, so the one order a human at
 * dispatch had already pulled out of the flow sorted below every routine one.
 * The server has the same defect in `getPartnerKitchenPriority`
 * (`supabase/functions/_shared/domains/partner.ts`) and the partner app consumed
 * the server's order verbatim, so nothing corrected it.
 *
 * `scheduled` moves the other way — below the handed-off orders, above the
 * unknowns. It is paid but not released; it is not work yet, and putting it
 * level with `draft` on the catch-all misrepresented that as "unclassified".
 *
 * An acceptance-deadline order needs no rule of its own: the sweep leaves it
 * `placed` and only flips `needsAttention`, and the age tiebreak below already
 * floats the oldest `placed` ticket — which is exactly the overdue one — to the
 * top of its group.
 */
const getKitchenPriority = (order: OrderDocument) => {
  const status = normalizeOrderStatus(order.status);

  if (status === 'escalated') {
    return 0;
  }

  if (status === 'placed') {
    return 1;
  }

  if (status === 'accepted') {
    return 2;
  }

  if (status === 'preparing') {
    return 3;
  }

  if (status === 'ready_for_pickup') {
    return 4;
  }

  if (['picked_up', 'on_the_way'].includes(status)) {
    return 5;
  }

  if (status === 'scheduled') {
    return 6;
  }

  return 7;
};

/**
 * Safe to apply on top of the server's own ordering rather than instead of it:
 * it is a pure, total, deterministic reordering of the same array — it adds
 * nothing, drops nothing, and does not depend on where the list came from. The
 * server's sort and this one already agree on every status except `escalated`
 * and `scheduled`, so running it client-side corrects those two without
 * contradicting the server on anything else, and without waiting on an edge
 * function deploy.
 */
export const sortLiveKitchenOrders = (orders: OrderDocument[]) =>
  [...orders].sort((left, right) => {
    const priorityDelta = getKitchenPriority(left) - getKitchenPriority(right);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return toTimestamp(left.createdAt) - toTimestamp(right.createdAt);
  });

export const sortKitchenHistoryOrders = (orders: OrderDocument[]) =>
  [...orders].sort((left, right) => toTimestamp(right.updatedAt ?? right.createdAt) - toTimestamp(left.updatedAt ?? left.createdAt));

export const getKitchenHistoryBucket = (order: OrderDocument) => {
  const status = normalizeOrderStatus(order.status);

  if (status === 'delivered') {
    return 'delivered' as const;
  }

  if (status === 'failed_delivery') {
    return 'failed' as const;
  }

  return 'cancelled' as const;
};

export const getKitchenSignal = (order: OrderDocument): KitchenSignal => {
  const status = normalizeOrderStatus(order.status);

  // Ahead of every other branch, matching its rank in getKitchenPriority. It
  // used to fall through to the muted 'Monitoring' catch-all, so on the phone
  // list an order dispatch had pulled out of the flow wore the same grey chip as
  // an unrecognised status.
  if (status === 'escalated') {
    return { label: 'Escalated', tone: 'danger' };
  }

  if (status === 'placed') {
    return { label: 'New', tone: 'danger' };
  }

  if (status === 'accepted') {
    return { label: 'Waiting start', tone: 'warning' };
  }

  if (status === 'preparing') {
    return { label: 'Cooking', tone: 'accent' };
  }

  if (status === 'ready_for_pickup') {
    return { label: 'Pickup waiting', tone: 'warning' };
  }

  if (['picked_up', 'on_the_way'].includes(status)) {
    return { label: 'Handed off', tone: 'success' };
  }

  if (status === 'delivered') {
    return { label: 'Delivered', tone: 'success' };
  }

  if (status === 'failed_delivery') {
    return { label: 'Failed', tone: 'danger' };
  }

  if (['cancelled', 'rejected'].includes(status)) {
    return { label: 'Cancelled', tone: 'muted' };
  }

  return { label: 'Monitoring', tone: 'muted' };
};

export const getKitchenSignalColors = (tone: QueueTone) => {
  switch (tone) {
    case 'danger':
      // `dangerText`, matching the `warningText` line below: the chip's text sits
      // on `dangerSoft`, where the fill red is 3.74:1.
      return { backgroundColor: partnerTheme.dangerSoft, textColor: partnerTheme.dangerText };
    case 'warning':
      return { backgroundColor: partnerTheme.warningSoft, textColor: partnerTheme.warningText };
    case 'accent':
      return { backgroundColor: partnerTheme.heroSoft, textColor: partnerTheme.accentStrong };
    case 'success':
      // The brand green is a fill too: #2e7d32 on `successSoft` (#c8e6c9) is
      // 3.81:1, the same defect the orange and red branches above already had.
      // There is no `successText` counterpart and none is needed — `Badge`'s own
      // `success` tone is `successSoft` + `text.primary`, so this branch takes
      // the pairing the design system had already settled.
      return { backgroundColor: partnerTheme.successSoft, textColor: partnerTheme.text };
    default:
      return { backgroundColor: partnerTheme.surfaceMuted, textColor: partnerTheme.textMuted };
  }
};

export const getKitchenElapsedLabel = (value: unknown) => {
  const timestamp = toTimestamp(value);
  if (!timestamp) {
    return 'Time unavailable';
  }

  const deltaMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));

  if (deltaMinutes < 60) {
    return `${deltaMinutes} min open`;
  }

  const hours = Math.floor(deltaMinutes / 60);
  const minutes = deltaMinutes % 60;
  return minutes === 0 ? `${hours} hr open` : `${hours} hr ${minutes} min open`;
};

// ONE definition, now in packages/domain/src/orders.ts -- this file and
// apps/customer each carried an identical copy. Re-exported because the order
// screen imports it from here, and imported at the top because
// countItemsWithOptions below calls it.
export { formatOrderItemOptions };

/** How many lines of an order carry modifiers, for the board ticket's one-line hint. */
export const countModifiedOrderItems = (order: OrderDocument) =>
  (order.items ?? []).filter((item) => formatOrderItemOptions(item) !== null).length;
