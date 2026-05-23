import { serviceClient } from './client.ts';

type JsonObject = Record<string, unknown>;
type NotificationApp = 'customer' | 'partner' | 'dispatch' | 'admin';
type NotificationRouteKey =
  | 'customer_home'
  | 'customer_promotions'
  | 'customer_profile'
  | 'customer_orders'
  | 'customer_order_detail'
  | 'customer_delivery_location'
  | 'customer_restaurant_detail'
  | 'customer_login'
  | 'partner_profile'
  | 'partner_orders'
  | 'partner_order_detail'
  | 'partner_login'
  | 'dispatch_profile'
  | 'dispatch_deliveries'
  | 'dispatch_delivery_detail'
  | 'dispatch_fleet'
  | 'dispatch_login'
  | 'admin_access'
  | 'admin_approvals'
  | 'admin_profile'
  | 'admin_login';

type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data?: JsonObject;
  sound?: 'default' | null;
  channelId?: string;
};

type UserPushRow = {
  expoPushToken?: string | null;
  uid: string;
};

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const EXPO_PUSH_TOKEN_PATTERN = /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/;
const EXPO_BATCH_SIZE = 100;

const isExpoPushToken = (value: string | null | undefined): value is string =>
  Boolean(value && EXPO_PUSH_TOKEN_PATTERN.test(value));

const chunkArray = <T>(values: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

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
    case 'customer_promotions':
      return '/promotions';
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
    case 'dispatch_fleet':
      return '/fleet';
    case 'dispatch_login':
      return '/login';
    case 'admin_access':
      return '/access';
    case 'admin_approvals':
      return '/approvals';
    case 'admin_profile':
      return '/profile';
    case 'admin_login':
      return '/login';
    default:
      return app === 'customer' ? '/home' : '/profile';
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
    version: 1,
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

export const sendExpoPushMessages = async (messages: ExpoPushMessage[]) => {
  if (messages.length === 0) {
    return {
      sent: 0,
    };
  }

  let sent = 0;

  for (const batch of chunkArray(messages, EXPO_BATCH_SIZE)) {
    const response = await fetch(EXPO_PUSH_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batch),
    });

    if (!response.ok) {
      const payload = await response.text();
      throw new Error(`Expo push delivery failed: ${response.status} ${payload}`);
    }

    sent += batch.length;
  }

  return { sent };
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
