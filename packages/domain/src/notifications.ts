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
 * Android notification channel ids the server targets. A push whose channelId
 * does not exist on the device is DROPPED by Android, so every id here must be
 * created by the app before its first push can arrive.
 */
export const ANDROID_NOTIFICATION_CHANNELS = {
  default: 'default',
  dispatchOffers: 'offers',
} as const;

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
