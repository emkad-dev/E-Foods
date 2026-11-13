export const NOTIFICATION_APPS = ['customer', 'partner', 'dispatch', 'admin'] as const;

export type NotificationApp = (typeof NOTIFICATION_APPS)[number];

export const NOTIFICATION_ROUTE_KEYS = [
  'customer_home',
  'customer_deals',
  'customer_profile',
  'customer_orders',
  'customer_order_detail',
  'customer_delivery_location',
  'customer_restaurant_detail',
  'customer_support',
  'customer_login',
  'partner_profile',
  'partner_orders',
  'partner_order_detail',
  'partner_login',
  'dispatch_profile',
  'dispatch_deliveries',
  'dispatch_delivery_detail',
  'dispatch_delivery_offer',
  'dispatch_fleet',
  'dispatch_login',
  'admin_access',
  'admin_approvals',
  'admin_order_detail',
  'admin_profile',
  'admin_login',
] as const;

export type NotificationRouteKey = (typeof NOTIFICATION_ROUTE_KEYS)[number];

export type AppNotificationPayload = {
  app?: NotificationApp | null;
  applicationId?: string | null;
  orderId?: string | null;
  path?: string | null;
  restaurantId?: string | null;
  role?: string | null;
  routeKey?: NotificationRouteKey | null;
  status?: string | null;
  type?: string | null;
  version?: number | null;
};

const sanitizeText = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const isNotificationApp = (value: unknown): value is NotificationApp =>
  typeof value === 'string' && NOTIFICATION_APPS.includes(value as NotificationApp);

const isNotificationRouteKey = (value: unknown): value is NotificationRouteKey =>
  typeof value === 'string' && NOTIFICATION_ROUTE_KEYS.includes(value as NotificationRouteKey);

const resolveLegacyPath = (app: NotificationApp, path: string) => {
  if (path.startsWith('/(')) {
    return path
      .replace('/(customer)/', '/')
      .replace('/(partner)/', '/')
      .replace('/(dispatch)/', '/')
      .replace('/(admin)/', '/')
      .replace('/(auth)/', '/');
  }

  if (app === 'customer') {
    if (/^\/orders\/[^/]+$/.test(path)) {
      return path;
    }
    if (/^\/home\/restaurant\/[^/]+$/.test(path)) {
      return path;
    }
    if (path === '/orders' || path === '/profile' || path === '/deals' || path === '/delivery-location' || path === '/cart' || path === '/support') {
      return path;
    }
    if (path === '/home') {
      return '/home';
    }
    if (path === '/login') {
      return '/login';
    }
  }

  if (app === 'partner') {
    if (/^\/order\/[^/]+$/.test(path)) {
      return path;
    }
    if (path === '/orders' || path === '/profile') {
      return path;
    }
    if (path === '/login') {
      return '/login';
    }
  }

  if (app === 'dispatch') {
    if (/^\/delivery\/[^/]+$/.test(path) || /^\/offer\/[^/]+$/.test(path)) {
      return path;
    }
    if (path === '/deliveries' || path === '/profile' || path === '/fleet') {
      return path;
    }
    if (path === '/login') {
      return '/login';
    }
  }

  if (app === 'admin') {
    if (path === '/access' || path === '/approvals' || path === '/profile') {
      return path;
    }
    if (path === '/login') {
      return '/login';
    }
  }

  return null;
};

const resolveRouteKeyPath = (routeKey: NotificationRouteKey, data: AppNotificationPayload) => {
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
      return data.orderId ? `/orders/${data.orderId}` : null;
    case 'customer_delivery_location':
      return '/delivery-location';
    case 'customer_restaurant_detail':
      return data.restaurantId ? `/home/restaurant/${data.restaurantId}` : null;
    case 'customer_support':
      return '/support';
    case 'customer_login':
      return '/login';
    case 'partner_profile':
      return '/profile';
    case 'partner_orders':
      return '/orders';
    case 'partner_order_detail':
      return data.orderId ? `/order/${data.orderId}` : null;
    case 'partner_login':
      return '/login';
    case 'dispatch_profile':
      return '/profile';
    case 'dispatch_deliveries':
      return '/deliveries';
    case 'dispatch_delivery_detail':
      return data.orderId ? `/delivery/${data.orderId}` : null;
    case 'dispatch_delivery_offer':
      return data.orderId ? `/offer/${data.orderId}` : null;
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
      return null;
  }
};

const resolveFallbackPath = (app: NotificationApp, data: AppNotificationPayload) => {
  if (data.orderId) {
    if (app === 'customer') {
      return `/orders/${data.orderId}`;
    }
    if (app === 'partner') {
      return `/order/${data.orderId}`;
    }
    if (app === 'dispatch') {
      return `/delivery/${data.orderId}`;
    }
  }

  if (app === 'admin' && data.applicationId) {
    return '/approvals';
  }

  return null;
};

/**
 * Android notification channel ids. Android fixes a channel's sound the first
 * time the app creates it, so a channel can never gain a custom sound later:
 * the sounded channels are new ids, and changing one of their sounds means
 * another new id.
 *
 * A push naming a channel the device does not have is not lost: the installed
 * expo-notifications (0.32) shows it on its own fallback channel
 * (IMPORTANCE_HIGH, default sound). That is what a build from before these
 * channels shows for a new-channel push, so the legacy ids below stay
 * registered by every app only so a push queued for an old id still lands on
 * the channel the user already knows.
 */
export const ANDROID_NOTIFICATION_CHANNELS = {
  /** Legacy (no custom sound). The server no longer targets it. */
  default: 'default',
  /** Legacy dispatch offer channel (no custom sound). The server no longer targets it. */
  dispatchOffers: 'offers',
  /** Customer order progress and payment; partner and dispatch everyday updates. Chime. */
  orderUpdates: 'order_updates',
  /** Customer promos, broadcasts and support messages. Marimba. */
  offersAndNews: 'offers_news',
  /** Partner: a new order to accept, and the acceptance reminder. Urgent. */
  newOrders: 'new_orders',
  /** Dispatch: a delivery offer with a short window to accept. Urgent. */
  deliveryOffers: 'delivery_offers',
} as const;

export type AndroidNotificationChannelId =
  (typeof ANDROID_NOTIFICATION_CHANNELS)[keyof typeof ANDROID_NOTIFICATION_CHANNELS];

/**
 * Sound files bundled with the apps (assets/sounds, listed in the
 * expo-notifications plugin `sounds`, and copied into android res/raw).
 * Android resource names allow only lowercase letters, digits and
 * underscores. iOS plays the file the push names; Android plays the channel's.
 */
export const NOTIFICATION_SOUNDS = {
  chime: 'feasty_chime.wav',
  marimba: 'feasty_marimba.wav',
  urgent: 'feasty_urgent.wav',
} as const;

export type NotificationSoundFile = (typeof NOTIFICATION_SOUNDS)[keyof typeof NOTIFICATION_SOUNDS];

/** Push type of the restaurant's half-deadline acceptance reminder. */
export const ACCEPTANCE_REMINDER_NOTIFICATION_TYPE = 'acceptance_reminder';

/** The rider's delivery offer (45 s to accept). */
export const DISPATCH_OFFER_NOTIFICATION_TYPE = 'dispatch_offer';

/** A broadcast from the admin console (it carries no data payload of its own). */
export const BROADCAST_NOTIFICATION_TYPE = 'broadcast';

// Partner pushes that need the kitchen's attention now. A paid order
// ('payment_confirmed' to the partner) and the reminder are the orders the
// restaurant must accept before the deadline; an 'order_update' at status
// 'placed' is a new order reaching the queue (order placement, a scheduled
// order released).
const PARTNER_URGENT_TYPES = new Set<string>(['payment_confirmed', ACCEPTANCE_REMINDER_NOTIFICATION_TYPE]);
const DISPATCH_URGENT_TYPES = new Set<string>([DISPATCH_OFFER_NOTIFICATION_TYPE]);
// Customer pushes that are not about an order in progress.
const CUSTOMER_NEWS_TYPES = new Set<string>([BROADCAST_NOTIFICATION_TYPE, 'promo', 'support_reply']);

export type PushChannelChoice = {
  /** Undefined lets Expo use its "Default" channel (the app's legacy `default`). */
  channelId: AndroidNotificationChannelId | undefined;
  sound: NotificationSoundFile | 'default';
};

const choice = (channelId: AndroidNotificationChannelId, sound: NotificationSoundFile): PushChannelChoice => ({
  channelId,
  sound,
});

/**
 * The one place a push's Android channel and sound are chosen, from the app it
 * is addressed to and its type (and status, for order updates). Pushes for an
 * app with no FEASTY channels (admin, or no app named) keep the platform
 * default sound and channel.
 */
export const resolvePushChannel = (input: {
  app?: unknown;
  status?: unknown;
  type?: unknown;
}): PushChannelChoice => {
  const app = sanitizeText(input.app);
  const type = sanitizeText(input.type) ?? '';
  const status = sanitizeText(input.status);

  if (app === 'customer') {
    return CUSTOMER_NEWS_TYPES.has(type)
      ? choice(ANDROID_NOTIFICATION_CHANNELS.offersAndNews, NOTIFICATION_SOUNDS.marimba)
      : choice(ANDROID_NOTIFICATION_CHANNELS.orderUpdates, NOTIFICATION_SOUNDS.chime);
  }

  if (app === 'partner') {
    const urgent = PARTNER_URGENT_TYPES.has(type) || (type === 'order_update' && status === 'placed');
    return urgent
      ? choice(ANDROID_NOTIFICATION_CHANNELS.newOrders, NOTIFICATION_SOUNDS.urgent)
      : choice(ANDROID_NOTIFICATION_CHANNELS.orderUpdates, NOTIFICATION_SOUNDS.chime);
  }

  if (app === 'dispatch') {
    return DISPATCH_URGENT_TYPES.has(type)
      ? choice(ANDROID_NOTIFICATION_CHANNELS.deliveryOffers, NOTIFICATION_SOUNDS.urgent)
      : choice(ANDROID_NOTIFICATION_CHANNELS.orderUpdates, NOTIFICATION_SOUNDS.chime);
  }

  return { channelId: undefined, sound: 'default' };
};

/**
 * Which app a broadcast is addressed to. Broadcasts go to the legacy per-user
 * token, which can belong to any app, so only an audience made purely of
 * customers can safely name the customer channel; a mixed or staff audience
 * keeps the platform default rather than landing on a channel their app lacks.
 */
export const resolveBroadcastPushApp = (segment: {
  activity?: unknown;
  restaurantId?: unknown;
  roles?: readonly string[] | null;
}): NotificationApp | null => {
  const roles = Array.isArray(segment.roles) ? segment.roles : [];
  if (roles.length === 0) {
    // Mirrors resolveBroadcastAudience: customer filters alone mean customers.
    return segment.activity || segment.restaurantId ? 'customer' : null;
  }
  return roles.every((role) => role === 'customer') ? 'customer' : null;
};

const EAS_PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Picks the EAS project id to request an Expo push token for: the first
 * candidate shaped like an EAS project UUID.
 *
 * Push registration used to read EXPO_PUBLIC_PROJECT_ID, which holds a legacy
 * Google Analytics id ("G-...") in the customer and dispatch configs and is
 * unset for partner, so getExpoPushTokenAsync either threw or was skipped and
 * no device ever stored a token. The UUID check rejects that class of value
 * instead of handing it to Expo.
 */
export const resolveEasProjectId = (...candidates: unknown[]) => {
  for (const candidate of candidates) {
    const value = sanitizeText(candidate);
    if (value && EAS_PROJECT_ID_PATTERN.test(value)) {
      return value;
    }
  }
  return null;
};

export const resolveNotificationHref = (app: NotificationApp, rawData: unknown) => {
  const data = (rawData ?? {}) as AppNotificationPayload;
  const payloadApp = sanitizeText(data.app);

  if (payloadApp && isNotificationApp(payloadApp) && payloadApp !== app) {
    return null;
  }

  const routeKey = sanitizeText(data.routeKey);
  if (routeKey && isNotificationRouteKey(routeKey)) {
    return resolveRouteKeyPath(routeKey, data);
  }

  const path = sanitizeText(data.path);
  if (path) {
    return resolveLegacyPath(app, path);
  }

  return resolveFallbackPath(app, data);
};
