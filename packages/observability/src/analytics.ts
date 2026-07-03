import Constants from 'expo-constants';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type AnalyticsProperties = Record<string, JsonValue>;

type AnalyticsEnvelope = {
  app: string;
  environment: string;
  event: string;
  properties: AnalyticsProperties;
  timestamp: string;
  userId: string | null;
};

const readTrimmedEnv = (name: string) => {
  const inlineValue = process.env[name];
  if (typeof inlineValue === 'string' && inlineValue.trim()) {
    return inlineValue.trim();
  }

  const extraValue = Constants.expoConfig?.extra?.[name];
  return typeof extraValue === 'string' && extraValue.trim() ? extraValue.trim() : '';
};

let appName = 'unknown';
let environment = 'production';
let analyticsEndpoint = '';
let userId: string | null = null;
let isInitialized = false;

const normalizeProperties = (properties: AnalyticsProperties = {}): AnalyticsProperties => {
  const normalized: AnalyticsProperties = {};

  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined) {
      continue;
    }

    normalized[key] = value;
  }

  return normalized;
};

const dispatchAnalyticsEvent = (payload: AnalyticsEnvelope) => {
  const message = JSON.stringify({
    level: 'info',
    message: 'analytics event',
    ...payload,
  });

  if (!analyticsEndpoint) {
    console.info(message);
    return;
  }

  void fetch(analyticsEndpoint, {
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  }).catch((error) => {
    console.warn(`Failed to send analytics event ${payload.event}:`, error);
    console.info(message);
  });
};

export const initializeAnalytics = (nextAppName: string) => {
  appName = nextAppName.trim() || 'unknown';
  environment = readTrimmedEnv('EXPO_PUBLIC_APP_ENV') || (__DEV__ ? 'development' : 'production');
  analyticsEndpoint = readTrimmedEnv('EXPO_PUBLIC_ANALYTICS_ENDPOINT');
  isInitialized = true;
  return Boolean(analyticsEndpoint);
};

export const identifyAnalyticsUser = (nextUserId: string | null | undefined) => {
  userId = typeof nextUserId === 'string' && nextUserId.trim() ? nextUserId.trim() : null;
};

export const clearAnalyticsUser = () => {
  userId = null;
};

export const trackAnalyticsEvent = (event: string, properties: AnalyticsProperties = {}) => {
  const trimmedEvent = event.trim();
  if (!trimmedEvent) {
    return;
  }

  if (!isInitialized) {
    initializeAnalytics(appName);
  }

  dispatchAnalyticsEvent({
    app: appName,
    environment,
    event: trimmedEvent,
    properties: normalizeProperties(properties),
    timestamp: new Date().toISOString(),
    userId,
  });
};
