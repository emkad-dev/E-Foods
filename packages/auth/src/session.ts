import type { SupabaseClient } from '@supabase/supabase-js';

export const SESSION_EXPIRED_ERROR_MESSAGE = 'Your session expired. Please sign in again.';

const STALE_SESSION_ERROR_PATTERNS = [
  /invalid refresh token/i,
  /refresh token not found/i,
  /refresh token expired/i,
  /token is expired/i,
  /invalid jwt/i,
];

const getErrorMessage = (error: unknown) => {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message?: unknown }).message ?? '').trim();
  }

  return typeof error === 'string' ? error.trim() : '';
};

export const isStaleSupabaseSessionError = (error: unknown) => {
  const message = getErrorMessage(error);
  return Boolean(message) && STALE_SESSION_ERROR_PATTERNS.some((pattern) => pattern.test(message));
};

export const clearSupabaseSession = async (supabase: SupabaseClient) => {
  await supabase.auth.signOut().catch(() => undefined);
};
