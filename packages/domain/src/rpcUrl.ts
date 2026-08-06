/**
 * Rewrites the last path segment of a backend RPC base URL (which today
 * points at one Edge Function, e.g. `.../app-rpc`) to point at a different
 * Edge Function name instead — e.g. `.../feasty-orders`.
 *
 * Pure and side-effect free so both packages/auth/src/backendRpc.ts's
 * direct-URL transport and apps/customer/src/services/promoTracking.ts's
 * anonymous promoTrack fetch (which bypasses callBackendRpc entirely) can
 * derive the correct per-domain function URL from the single
 * EXPO_PUBLIC_BACKEND_RPC_URL / VITE_BACKEND_RPC_URL env var without
 * duplicating URL-parsing logic.
 *
 * Throws if `baseUrl` isn't a parseable absolute URL. Callers should treat
 * that as a transport-level failure (fall back, or let it propagate) rather
 * than catch it here and silently reuse the un-rewritten URL, which would
 * point at the wrong function.
 */
export const deriveRpcFunctionUrl = (baseUrl: string, functionName: string): string => {
  const url = new URL(baseUrl);
  const segments = url.pathname.split('/').filter(Boolean);

  if (segments.length > 0) {
    segments[segments.length - 1] = functionName;
  } else {
    segments.push(functionName);
  }

  url.pathname = `/${segments.join('/')}`;
  return url.toString();
};
