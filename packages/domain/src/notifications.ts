export const NOTIFICATION_APPS = ['customer', 'partner', 'dispatch', 'admin'] as const;

export type NotificationApp = (typeof NOTIFICATION_APPS)[number];

export const NOTIFICATION_ROUTE_KEYS = [
  'customer_home',
  'customer_promotions',
  'customer_profile',
  'customer_orders',
  'customer_order_detail',
  'customer_delivery_location',
  'customer_restaurant_detail',
  'customer_login',
  'partner_profile',
  'partner_orders',
  'partner_order_detail',
  'partner_login',
  'dispatch_profile',
  'dispatch_deliveries',
  'dispatch_delivery_detail',
  'dispatch_fleet',
  'dispatch_login',
  'admin_access',
  'admin_approvals',
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
    return path;
  }

  if (app === 'customer') {
    if (/^\/orders\/[^/]+$/.test(path)) {
      return `/(customer)${path}`;
    }
    if (/^\/home\/restaurant\/[^/]+$/.test(path)) {
      return `/(customer)${path}`;
    }
    if (path === '/orders' || path === '/profile' || path === '/promotions' || path === '/delivery-location' || path === '/cart') {
      return `/(customer)${path}`;
    }
    if (path === '/home') {
      return '/(customer)/home';
    }
    if (path === '/login') {
      return '/(auth)/login';
    }
  }

  if (app === 'partner') {
    if (/^\/order\/[^/]+$/.test(path)) {
      return `/(partner)${path}`;
    }
    if (path === '/orders' || path === '/profile') {
      return `/(partner)${path}`;
    }
    if (path === '/login') {
      return '/(auth)/login';
    }
  }

  if (app === 'dispatch') {
    if (/^\/delivery\/[^/]+$/.test(path)) {
      return `/(dispatch)${path}`;
    }
    if (path === '/deliveries' || path === '/profile' || path === '/fleet') {
      return `/(dispatch)${path}`;
    }
    if (path === '/login') {
      return '/(auth)/login';
    }
  }

  if (app === 'admin') {
    if (path === '/access' || path === '/approvals' || path === '/profile') {
      return `/(admin)${path}`;
    }
    if (path === '/login') {
      return '/(auth)/login';
    }
  }

  return null;
};

const resolveRouteKeyPath = (routeKey: NotificationRouteKey, data: AppNotificationPayload) => {
  switch (routeKey) {
    case 'customer_home':
      return '/(customer)/home';
    case 'customer_promotions':
      return '/(customer)/promotions';
    case 'customer_profile':
      return '/(customer)/profile';
    case 'customer_orders':
      return '/(customer)/orders';
    case 'customer_order_detail':
      return data.orderId ? `/(customer)/orders/${data.orderId}` : null;
    case 'customer_delivery_location':
      return '/(customer)/delivery-location';
    case 'customer_restaurant_detail':
      return data.restaurantId ? `/(customer)/home/restaurant/${data.restaurantId}` : null;
    case 'customer_login':
      return '/(auth)/login';
    case 'partner_profile':
      return '/(partner)/profile';
    case 'partner_orders':
      return '/(partner)/orders';
    case 'partner_order_detail':
      return data.orderId ? `/(partner)/order/${data.orderId}` : null;
    case 'partner_login':
      return '/(auth)/login';
    case 'dispatch_profile':
      return '/(dispatch)/profile';
    case 'dispatch_deliveries':
      return '/(dispatch)/deliveries';
    case 'dispatch_delivery_detail':
      return data.orderId ? `/(dispatch)/delivery/${data.orderId}` : null;
    case 'dispatch_fleet':
      return '/(dispatch)/fleet';
    case 'dispatch_login':
      return '/(auth)/login';
    case 'admin_access':
      return '/(admin)/access';
    case 'admin_approvals':
      return '/(admin)/approvals';
    case 'admin_profile':
      return '/(admin)/profile';
    case 'admin_login':
      return '/(auth)/login';
    default:
      return null;
  }
};

const resolveFallbackPath = (app: NotificationApp, data: AppNotificationPayload) => {
  if (data.orderId) {
    if (app === 'customer') {
      return `/(customer)/orders/${data.orderId}`;
    }
    if (app === 'partner') {
      return `/(partner)/order/${data.orderId}`;
    }
    if (app === 'dispatch') {
      return `/(dispatch)/delivery/${data.orderId}`;
    }
  }

  if (app === 'admin' && data.applicationId) {
    return '/(admin)/approvals';
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
