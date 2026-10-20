import { serviceClient } from './client.ts';
import { buildTransactionalEmailHtml, sendTransactionalEmail } from './email.ts';
import {
  checkExpoPushReceipts,
  deliverExpoPushMessages,
  summarizeFailures,
  type ExpoPushFailure,
  type ExpoPushMessage,
} from './expoPush.ts';
import { logEdgeEvent } from './observability.ts';
import { enqueuePushReceiptCheck } from './queue.ts';

type JsonObject = Record<string, unknown>;
type NotificationApp = 'customer' | 'partner' | 'dispatch' | 'admin';
type NotificationRouteKey =
  | 'customer_home'
  | 'customer_deals'
  | 'customer_profile'
  | 'customer_orders'
  | 'customer_order_detail'
  | 'customer_delivery_location'
  | 'customer_restaurant_detail'
  | 'customer_support'
  | 'customer_login'
  | 'partner_profile'
  | 'partner_orders'
  | 'partner_order_detail'
  | 'partner_login'
  | 'dispatch_profile'
  | 'dispatch_deliveries'
  | 'dispatch_delivery_detail'
  | 'dispatch_delivery_offer'
  | 'dispatch_fleet'
  | 'dispatch_login'
  | 'admin_access'
  | 'admin_approvals'
  | 'admin_order_detail'
  | 'admin_profile'
  | 'admin_login';

type UserPushRow = {
  expoPushToken?: string | null;
  uid: string;
};

const EXPO_PUSH_TOKEN_PATTERN = /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/;

const isExpoPushToken = (value: string | null | undefined): value is string =>
  Boolean(value && EXPO_PUSH_TOKEN_PATTERN.test(value));

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));
const sanitizeText = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const buildNotificationPath = (
  app: NotificationApp,
  routeKey: NotificationRouteKey,
  data: {
    orderId?: string | null;
    restaurantId?: string | null;
  }
) => {
  switch (routeKey) {
    case 'customer_home':
      return '/home';
    case 'customer_deals':
      return '/deals';
    case 'customer_profile':
      return '/profile';
    case 'customer_orders':
      return '/orders';
    case 'customer_order_detail':
      return data.orderId ? `/orders/${data.orderId}` : '/orders';
    case 'customer_delivery_location':
      return '/delivery-location';
    case 'customer_restaurant_detail':
      return data.restaurantId ? `/home/restaurant/${data.restaurantId}` : '/home';
    case 'customer_support':
      return '/support';
    case 'customer_login':
      return '/login';
    case 'partner_profile':
      return '/profile';
    case 'partner_orders':
      return '/orders';
    case 'partner_order_detail':
      return data.orderId ? `/order/${data.orderId}` : '/orders';
    case 'partner_login':
      return '/login';
    case 'dispatch_profile':
      return '/profile';
    case 'dispatch_deliveries':
      return '/deliveries';
    case 'dispatch_delivery_detail':
      return data.orderId ? `/delivery/${data.orderId}` : '/deliveries';
    case 'dispatch_delivery_offer':
      // Falls back to the deliveries list rather than a bare offer screen: an
      // offer push that arrives after the 45s window closed should land the
      // rider somewhere useful, not on a dead countdown.
      return data.orderId ? `/offer/${data.orderId}` : '/deliveries';
    case 'dispatch_fleet':
      return '/fleet';
    case 'dispatch_login':
      return '/login';
    case 'admin_access':
      return '/access';
    case 'admin_approvals':
      return '/approvals';
    case 'admin_order_detail':
      return data.orderId ? `/orders/${data.orderId}` : '/orders';
    case 'admin_profile':
      return '/profile';
    case 'admin_login':
      return '/login';
    default:
      return app === 'customer' ? '/home' : '/profile';
  }
};

/**
 * Customer-facing wording for an order status push. The generic
 * "Order ABC123 is now ready for pickup" read like a log line and, for a
 * rejection, did not tell the customer what happens next.
 */
export const customerOrderStatusCopy = (status: string, orderId: string) => {
  const code = orderId.slice(-6).toUpperCase();
  switch (status) {
    case 'accepted':
      return { title: 'Order accepted', body: `The restaurant accepted order ${code} and will start on it shortly.` };
    case 'preparing':
      return { title: 'Your food is being prepared', body: `The kitchen is preparing order ${code}.` };
    case 'ready_for_pickup':
      return { title: 'Order ready', body: `Order ${code} is ready and waiting to be picked up.` };
    case 'out_for_delivery':
    case 'picked_up':
      return { title: 'On the way', body: `Order ${code} is on its way to you.` };
    case 'delivered':
      return { title: 'Order delivered', body: `Order ${code} was delivered. Enjoy your meal!` };
    case 'rejected':
      return {
        title: 'Order not accepted',
        body: `The restaurant could not take order ${code}. Open the order to see your refund.`,
      };
    case 'cancelled':
      return { title: 'Order cancelled', body: `Order ${code} was cancelled. Open the order for refund details.` };
    default:
      return { title: 'Order update', body: `Order ${code} is now ${status.replace(/_/g, ' ')}.` };
  }
};

export const buildNotificationData = (input: {
  app: NotificationApp;
  extra?: JsonObject;
  orderId?: string | null;
  path?: string | null;
  restaurantId?: string | null;
  role?: string | null;
  routeKey: NotificationRouteKey;
  status?: string | null;
  type: string;
}) => {
  const orderId = sanitizeText(input.orderId);
  const restaurantId = sanitizeText(input.restaurantId);
  const role = sanitizeText(input.role);
  const status = sanitizeText(input.status);
  const path = sanitizeText(input.path) ?? buildNotificationPath(input.app, input.routeKey, { orderId, restaurantId });

  return {
    ...(input.extra ?? {}),
    app: input.app,
    ...(orderId ? { orderId } : null),
    path,
    ...(restaurantId ? { restaurantId } : null),
    ...(role ? { role } : null),
    routeKey: input.routeKey,
    ...(status ? { status } : null),
    type: input.type,
    // String, not numeric: push data payloads (enqueueNotification's
    // `Record<string, string>` contract, and FCM/APNs data payloads
    // generally) require string values. No consumer reads this field today
    // (grepped both apps' push-notification handlers) so widening its
    // representation is safe.
    version: '1',
  } satisfies JsonObject;
};

const loadPushRowsByUserIds = async (userIds: string[]) => {
  const nextUserIds = unique(userIds);
  if (nextUserIds.length === 0) {
    return [] as UserPushRow[];
  }

  const { data, error } = await serviceClient
    .from('UserAccount')
    .select('uid,expoPushToken')
    .in('uid', nextUserIds);

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as UserPushRow[]).filter((row) => isExpoPushToken(row.expoPushToken));
};

const loadUserIdsByRoles = async (roles: string[]) => {
  const nextRoles = unique(roles);
  if (nextRoles.length === 0) {
    return [] as string[];
  }

  const { data, error } = await serviceClient.from('UserRole').select('userId,role').in('role', nextRoles);

  if (error) {
    throw new Error(error.message);
  }

  return unique(
    ((data ?? []) as Array<{ role: string; userId: string }>).map((row) => row.userId)
  );
};

export const loadRestaurantRecipientUserIds = async (restaurantId: string) => {
  const { data: roleRows, error: roleError } = await serviceClient
    .from('UserRole')
    .select('userId')
    .eq('role', 'restaurant')
    .eq('restaurantId', restaurantId);

  if (roleError) {
    throw new Error(roleError.message);
  }

  const linkedUserIds = unique(
    ((roleRows ?? []) as Array<{ userId: string }>).map((row) => row.userId)
  );

  if (linkedUserIds.length > 0) {
    return linkedUserIds;
  }

  const { data: restaurant, error: restaurantError } = await serviceClient
    .from('RestaurantRecord')
    .select('ownerId')
    .eq('id', restaurantId)
    .maybeSingle<{ ownerId?: string | null }>();

  if (restaurantError) {
    throw new Error(restaurantError.message);
  }

  return unique([restaurant?.ownerId ?? '']);
};

/**
 * Deletes tokens Expo has declared permanently dead (the app was uninstalled
 * or the token was rotated). Matching on the token rather than a uid also
 * clears it from any OTHER account that last registered from the same device.
 */
export const clearDeadPushTokens = async (tokens: string[]) => {
  const deadTokens = unique(tokens);
  if (deadTokens.length === 0) {
    return;
  }

  const { error } = await serviceClient
    .from('UserAccount')
    .update({ expoPushToken: null, pushTokenUpdatedAt: new Date().toISOString() })
    .in('expoPushToken', deadTokens);

  if (error) {
    logEdgeEvent('error', 'push dead-token cleanup failed', { count: deadTokens.length, error: error.message });
    return;
  }

  logEdgeEvent('info', 'push dead tokens cleared', { count: deadTokens.length });
};

const reportPushFailures = (stage: 'ticket' | 'receipt', failures: ExpoPushFailure[]) => {
  if (failures.length === 0) {
    return;
  }

  const { counts, hints } = summarizeFailures(failures);
  // Tokens are not logged: they are device identifiers, and the counts plus
  // the error codes are what an operator needs to act.
  logEdgeEvent(hints.length > 0 ? 'error' : 'warn', `expo push ${stage} errors`, {
    counts,
    ...(hints.length > 0 ? { action: hints } : null),
  });
};

export const sendExpoPushMessages = async (messages: ExpoPushMessage[]) => {
  if (messages.length === 0) {
    return {
      sent: 0,
    };
  }

  const outcome = await deliverExpoPushMessages(messages);

  reportPushFailures('ticket', outcome.failures);
  await clearDeadPushTokens(outcome.deadTokens);

  // Receipts carry the FCM/APNs verdict (most DeviceNotRegistered and every
  // InvalidCredentials for a missing FCM V1 key arrive only here). Scheduling
  // is best-effort: failing to schedule must not turn a delivered push into
  // an error for the caller.
  if (outcome.receiptTickets.length > 0) {
    try {
      await enqueuePushReceiptCheck(serviceClient, outcome.receiptTickets);
    } catch (error) {
      logEdgeEvent('warn', 'push receipt check could not be scheduled', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { sent: outcome.accepted };
};

/** Queue-drainer entry point for a deferred receipt check. */
export const processPushReceiptCheck = async (tickets: Array<{ id: string; token: string }>) => {
  const result = await checkExpoPushReceipts(tickets);
  reportPushFailures('receipt', result.failures);
  await clearDeadPushTokens(result.deadTokens);
  return {
    checked: result.checked,
    deadTokens: result.deadTokens.length,
    failed: result.failures.length,
    pending: result.pending,
  };
};

export const sendPushNotificationsToUsers = async (
  userIds: string[],
  payload: {
    body: string;
    channelId?: string;
    data?: JsonObject;
    sound?: 'default' | null;
    title: string;
  }
) => {
  const pushRows = await loadPushRowsByUserIds(userIds);
  const messages = pushRows.map((row) => ({
    body: payload.body,
    channelId: payload.channelId,
    data: payload.data,
    sound: payload.sound ?? 'default',
    title: payload.title,
    to: row.expoPushToken as string,
  }));

  return sendExpoPushMessages(messages);
};

export const sendPushNotificationsToRoles = async (
  roles: string[],
  payload: {
    body: string;
    channelId?: string;
    data?: JsonObject;
    sound?: 'default' | null;
    title: string;
  }
) => {
  const userIds = await loadUserIdsByRoles(roles);
  return sendPushNotificationsToUsers(userIds, payload);
};

// ---------------------------------------------------------------------------
// Fire-and-forget wrappers used by the RPC domains.
//
// A push failure must never fail the mutation that triggered it: the order has
// already been written, so the caller gets its success response and the
// delivery failure is logged instead of thrown.
// ---------------------------------------------------------------------------

const notifySafely = async (work: () => Promise<void>) => {
  try {
    await work();
  } catch (error) {
    console.error('Notification dispatch failed.', error);
  }
};

export const notifyUsers = async (
  userIds: string[],
  payload: {
    body: string;
    channelId?: string;
    data?: JsonObject;
    title: string;
  }
) => {
  await notifySafely(async () => {
    await sendPushNotificationsToUsers(userIds, {
      body: payload.body,
      channelId: payload.channelId,
      data: payload.data ?? {},
      title: payload.title,
    });
  });
};

export const notifyAdmins = async (
  payload: {
    body: string;
    data?: JsonObject;
    title: string;
  }
) => {
  const adminUserIds = await loadUserIdsByRoles(['admin']).catch((error) => {
    console.error('Unable to load admin recipients.', error);
    return [] as string[];
  });

  await notifySafely(async () => {
    await sendPushNotificationsToUsers(adminUserIds, {
      body: payload.body,
      data: payload.data ?? {},
      title: payload.title,
    });
  });

  // Admins work from the web console (apps/admin-web), which cannot receive
  // Expo pushes, and no admin account holds a push token. Push alone meant a
  // rider SOS, an empty dispatch pool or a restaurant ignoring a paid order
  // reached nobody. Email is the channel admins actually have.
  await notifySafely(async () => {
    await emailUsers(adminUserIds, {
      heading: payload.title,
      lines: [payload.body, 'Open the FEASTY admin console to act on this alert.'],
      subject: `[FEASTY admin] ${payload.title}`,
    });
  });
};

const emailUsers = async (
  userIds: string[],
  message: { heading: string; lines: string[]; subject: string }
) => {
  const ids = unique(userIds);
  if (ids.length === 0) {
    return;
  }

  const { data, error } = await serviceClient
    .from('UserAccount')
    .select('uid,email,displayName,accountDisabled')
    .in('uid', ids);

  if (error) {
    throw new Error(error.message);
  }

  for (const row of (data ?? []) as Array<{
    accountDisabled?: boolean | null;
    displayName?: string | null;
    email?: string | null;
  }>) {
    const email = sanitizeText(row.email);
    if (!email || row.accountDisabled === true) continue;
    await sendTransactionalEmail({
      html: buildTransactionalEmailHtml({
        heading: message.heading,
        lines: message.lines,
        recipientName: row.displayName ?? null,
      }),
      subject: message.subject,
      to: email,
    });
  }
};

export const notifyRestaurantUsers = async (
  restaurantId: string,
  payload: {
    body: string;
    data?: JsonObject;
    title: string;
  }
) => {
  await notifySafely(async () => {
    const userIds = await loadRestaurantRecipientUserIds(restaurantId);
    await sendPushNotificationsToUsers(userIds, {
      body: payload.body,
      data: payload.data ?? {},
      title: payload.title,
    });
  });
};

export { notifySafely };
