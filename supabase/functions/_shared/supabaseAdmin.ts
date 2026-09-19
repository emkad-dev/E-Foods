/// <reference path="./edge-runtime.d.ts" />

// Wrappers around the Supabase Auth Admin REST API.
//
// These bypass the JS client on purpose: the admin endpoints are the only way
// to create/ban/delete auth users, and every call here runs with the service
// role key, so nothing in this module may ever be reachable without a prior
// role check by the caller.

import { sanitizeText } from './rpc/coercion.ts';
import { fail } from './rpc/respond.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')?.trim() ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')?.trim() ?? '';
const ADMIN_REQUEST_TIMEOUT_MS = 10_000;

const assertSupabaseAdminConfigured = () => {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    fail(500, 'Supabase admin credentials are not configured for this Edge function.');
  }
};

const toSupabaseAdminHeaders = () => {
  assertSupabaseAdminConfigured();
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
};

const adminAuthRequest = async <T = Record<string, unknown>>(
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  assertSupabaseAdminConfigured();
  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}${path}`, {
      ...init,
      headers: {
        ...toSupabaseAdminHeaders(),
        ...(init.headers ?? {}),
      },
      signal: init.signal ?? AbortSignal.timeout(ADMIN_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      fail(504, `Supabase admin request timed out after ${ADMIN_REQUEST_TIMEOUT_MS}ms.`);
    }
    throw error;
  }
  const payload = (await response.json().catch(() => null)) as T & { message?: string; msg?: string } | null;

  if (!response.ok) {
    fail(500, payload?.message ?? payload?.msg ?? 'Supabase admin request failed.');
  }

  return (payload ?? {}) as T;
};

export const listSupabaseAuthUsers = async () => {
  const users: Record<string, unknown>[] = [];
  let page = 1;

  while (true) {
    const payload = await adminAuthRequest<{ users?: Record<string, unknown>[] }>(
      `/auth/v1/admin/users?page=${page}&per_page=200`,
      { method: 'GET' }
    );
    const batch = Array.isArray(payload.users) ? payload.users : [];
    users.push(...batch);
    if (batch.length < 200) {
      break;
    }
    page += 1;
  }

  return users;
};

export const findSupabaseAuthUserByEmail = async (email: string) => {
  const normalizedEmail = sanitizeText(email).toLowerCase();
  if (!normalizedEmail) {
    return null;
  }

  const users = await listSupabaseAuthUsers();
  return (
    users.find(
      (user) =>
        typeof user.email === 'string' && sanitizeText(user.email).toLowerCase() === normalizedEmail
    ) ?? null
  );
};

/**
 * The auth providers linked to one account, straight from the admin API.
 *
 * WHY NOT READ `identities` OFF THE LIST RESPONSE: the paged
 * `/admin/users` listing does not reliably carry it, and a caller that
 * treats the missing array as "no password identity" concludes the exact
 * opposite of the truth. That happened in production: a password account was
 * told it signs in with Google, which left it with no way forward at all.
 *
 * Returns `null` when the answer cannot be established -- deliberately
 * distinct from `[]`, so a caller can tell "no identities" from "do not
 * know" and fail in the recoverable direction.
 */
export const loadSupabaseAuthIdentities = async (uid: string): Promise<string[] | null> => {
  const id = sanitizeText(uid);

  if (!id) {
    return null;
  }

  try {
    const payload = await adminAuthRequest<{ identities?: Array<{ provider?: unknown }> }>(
      `/auth/v1/admin/users/${encodeURIComponent(id)}`,
      { method: 'GET' }
    );

    if (!Array.isArray(payload.identities)) {
      return null;
    }

    return payload.identities
      .map((identity) => sanitizeText(identity?.provider))
      .filter((provider) => provider.length > 0);
  } catch {
    return null;
  }
};

export const createSupabaseAuthUser = async (input: {
  displayName?: string | null;
  email: string;
  emailConfirmed?: boolean;
  password: string;
  role: string;
}) =>
  adminAuthRequest<Record<string, unknown> & { user?: Record<string, unknown> }>('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      app_metadata: {
        app_role: input.role,
        role: input.role,
        user_role: input.role,
      },
      email: input.email,
      email_confirm: input.emailConfirmed === true,
      password: input.password,
      user_metadata: input.displayName
        ? {
            full_name: input.displayName,
          }
        : undefined,
    }),
  }).then((payload) => payload.user ?? payload);

export const updateSupabaseAuthUser = async (
  uid: string,
  updates: Record<string, unknown>
) =>
  adminAuthRequest<Record<string, unknown> & { user?: Record<string, unknown> }>(
    `/auth/v1/admin/users/${uid}`,
    {
      method: 'PUT',
      body: JSON.stringify(updates),
    }
  ).then((payload) => payload.user ?? payload);

export const deleteSupabaseAuthUser = async (uid: string) => {
  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/admin/users/${uid}`, {
      method: 'DELETE',
      headers: toSupabaseAdminHeaders(),
      signal: AbortSignal.timeout(ADMIN_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      fail(504, `Supabase admin request timed out after ${ADMIN_REQUEST_TIMEOUT_MS}ms.`);
    }
    throw error;
  }

  if (!response.ok && response.status !== 404) {
    const payload = (await response.json().catch(() => null)) as { message?: string; msg?: string } | null;
    fail(500, payload?.message ?? payload?.msg ?? 'Unable to delete the Supabase auth user.');
  }
};
