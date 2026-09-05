// Terms/Privacy acceptance. The version strings are the contract: a client that
// posts anything other than the current pair is refused with 412, which is what
// forces the in-app policy gate to re-prompt after a policy update.

import { serviceClient } from './client.ts';
import type { JsonObject } from './rpc/coercion.ts';
import { nowIso, sanitizeText } from './rpc/coercion.ts';
import { fail } from './rpc/respond.ts';

export const CURRENT_TERMS_VERSION = '2026-05-31-v1';
export const CURRENT_PRIVACY_VERSION = '2026-05-31-v1';

const POLICY_APPS = new Set(['customer', 'partner', 'dispatch']);
const POLICY_SOURCES = new Set([
  'customer_signup',
  'customer_policy_gate',
  'customer_google_gate',
  'partner_signup',
  'dispatch_signup',
]);

export const normalizePolicyApp = (value: unknown) => {
  const app = sanitizeText(value).toLowerCase();
  return POLICY_APPS.has(app) ? app : '';
};

const normalizePolicySource = (value: unknown, fallback: string) => {
  const source = sanitizeText(value, fallback);
  return POLICY_SOURCES.has(source) ? source : fallback;
};

export const validatePolicyAcceptancePayload = (
  value: unknown,
  expectedApp: 'customer' | 'partner' | 'dispatch',
  fallbackSource: string
) => {
  const payload = typeof value === 'object' && value !== null ? (value as JsonObject) : {};
  const app = normalizePolicyApp(payload.app);
  const termsVersion = sanitizeText(payload.termsVersion);
  const privacyVersion = sanitizeText(payload.privacyVersion);

  if (payload.accepted !== true || app !== expectedApp) {
    fail(412, 'Accept the current Terms and Privacy Policy before continuing.');
  }

  if (termsVersion !== CURRENT_TERMS_VERSION || privacyVersion !== CURRENT_PRIVACY_VERSION) {
    fail(412, 'Accept the latest Terms and Privacy Policy before continuing.');
  }

  return {
    app,
    privacyVersion,
    source: normalizePolicySource(payload.source, fallbackSource),
    termsVersion,
  };
};

export const recordPolicyAcceptance = async (
  uid: string,
  email: string,
  acceptance: {
    app: string;
    privacyVersion: string;
    source: string;
    termsVersion: string;
  }
) => {
  const acceptedAt = nowIso();
  const { error } = await serviceClient.from('UserPolicyAcceptance').upsert(
    {
      id: crypto.randomUUID(),
      userId: uid,
      email,
      app: acceptance.app,
      termsVersion: acceptance.termsVersion,
      privacyVersion: acceptance.privacyVersion,
      source: acceptance.source,
      acceptedAt,
      createdAt: acceptedAt,
      updatedAt: acceptedAt,
    },
    {
      onConflict: 'userId,app,termsVersion,privacyVersion',
    }
  );

  if (error) {
    throw new Error(error.message);
  }

  return acceptedAt;
};

export const hasCurrentPolicyAcceptance = async (uid: string, app: string) => {
  const { data, error } = await serviceClient
    .from('UserPolicyAcceptance')
    .select('id,acceptedAt')
    .eq('userId', uid)
    .eq('app', app)
    .eq('termsVersion', CURRENT_TERMS_VERSION)
    .eq('privacyVersion', CURRENT_PRIVACY_VERSION)
    .maybeSingle<{ acceptedAt?: string | null; id: string }>();

  if (error) {
    throw new Error(error.message);
  }

  return {
    accepted: Boolean(data?.id),
    acceptedAt: data?.acceptedAt ?? null,
    privacyVersion: CURRENT_PRIVACY_VERSION,
    termsVersion: CURRENT_TERMS_VERSION,
  };
};
