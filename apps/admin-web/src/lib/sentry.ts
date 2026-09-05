import { createSentryInitializer } from '../../../../packages/observability/src/sentry';
import { appEnv } from '../config/env';

const initializeSharedSentry = createSentryInitializer({
  getDsn: () => appEnv.sentryDsn || '',
  getEnvironment: () => import.meta.env.VITE_APP_ENV || import.meta.env.MODE || 'production',
  getPlatform: () => 'web',
  loadWebSdk: () => import('@sentry/browser'),
});

export const initializeSentry = (appName: string) => initializeSharedSentry(appName);
