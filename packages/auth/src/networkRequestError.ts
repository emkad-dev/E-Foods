// Split out of supabaseAuth.ts so transientNetworkFailure.ts (which the sign-in
// helper in supabaseAuth.ts now uses for its one retry) and supabaseAuth.ts do
// not import each other. supabaseAuth.ts re-exports it, so existing imports of
// `isNetworkRequestError` from there keep working.
const NETWORK_ERROR_PATTERNS = [
  'failed to fetch',
  'fetch failed',
  'network request failed',
  'networkerror',
  'load failed',
  'request failed',
];

export const isNetworkRequestError = (error: unknown) => {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as any).message ?? '').toLowerCase()
      : '';

  if (!message) {
    return false;
  }

  return NETWORK_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
};
