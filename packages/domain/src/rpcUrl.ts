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
 * `knownTargets` is an explicit parameter rather than an import from
 * './rpcRoutes' on purpose: this file has no relative imports, which sides
 * steps a real Node ESM resolution problem — a bare specifier like
 * `'./rpcRoutes'` (no extension) fails to resolve when this file is loaded
 * directly by `node --experimental-strip-types` (as it is via
 * rpcUrl.test.ts), while an explicit `'./rpcRoutes.ts'` specifier would
 * satisfy Node but fails `tsc` in apps/partner and apps/dispatch, whose
 * tsconfigs don't set `allowImportingTsExtensions`. Callers already import
 * KNOWN_RPC_TARGETS from './rpcRoutes' anyway (to resolve the routing
 * target itself), so passing it through costs one extra argument and keeps
 * this module dependency-free and trivially unit-testable.
 *
 * When the base URL already has a path, the segment about to be replaced is
 * validated against `knownTargets` (the five domain functions plus app-rpc,
 * i.e. RPC_ROUTES.ts's KNOWN_RPC_TARGETS) before being overwritten. Without
 * this, a base URL configured to something like `.../functions/v1` (missing
 * the function-name segment entirely) would silently clobber "v1" instead —
 * every direct-URL call would then 404, always falling through to the
 * relay, working but paying for an extra round-trip on every single RPC.
 * Guessing which segment is "the function name" is worse than failing
 * loudly, so this throws instead. (When the base URL has no path at all,
 * there is nothing to guess wrong — the function name is simply appended.)
 *
 * Also throws if `baseUrl` isn't a parseable absolute URL. Callers should
 * treat either failure as transport/config-level (fall back, or let it
 * propagate) rather than catch it here and silently reuse the
 * un-rewritten URL, which would point at the wrong function.
 */
export const deriveRpcFunctionUrl = (
  baseUrl: string,
  functionName: string,
  knownTargets: Iterable<string>
): string => {
  const knownTargetSet = knownTargets instanceof Set ? knownTargets : new Set(knownTargets);
  const url = new URL(baseUrl);
  const segments = url.pathname.split('/').filter(Boolean);

  if (segments.length > 0) {
    const currentLastSegment = segments[segments.length - 1];

    if (!knownTargetSet.has(currentLastSegment)) {
      throw new Error(
        `deriveRpcFunctionUrl: refusing to rewrite "${baseUrl}" — its last path segment ("${currentLastSegment}") ` +
          'is not "app-rpc" or a known Edge Function name, so replacing it would be a guess, not a routing ' +
          'decision. Configure the base RPC URL so it ends in the current function name (e.g. ".../app-rpc").'
      );
    }

    segments[segments.length - 1] = functionName;
  } else {
    segments.push(functionName);
  }

  url.pathname = `/${segments.join('/')}`;
  return url.toString();
};
