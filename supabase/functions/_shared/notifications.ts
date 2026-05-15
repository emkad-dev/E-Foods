import { serviceClient } from './client.ts';

type JsonObject = Record<string, unknown>;

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
