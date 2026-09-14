/**
 * Where the customer app's route guards send a signed-in visitor.
 *
 * Extracted from `app/(auth)/_layout.tsx` so the part that is easy to get wrong
 * -- which paths the onboarding gates are allowed to swallow -- is unit-testable
 * without Metro, and so the root layout can honour the same exemption list
 * instead of keeping its own hand-written copy of it.
 */

/**
 * Terms and Privacy sit inside the `(auth)` group for layout reasons only: the
 * content is public, static, and identical signed in or out. The group's
 * signed-in redirect treated them as sign-in screens anyway and bounced a
 * signed-in customer to `/home`, which left the app with no reachable copy of
 * either document -- including from `/accept-policy`, where `!policyAccepted`
 * makes the gate's own target `/accept-policy`, so "Open full Terms page"
 * bounced the reader straight back to the page they tapped from. Both documents
 * are an app-store review requirement, so the gates let exactly these two paths
 * through and nothing else.
 */
export const PUBLIC_CONTENT_ROUTES: ReadonlySet<string> = new Set(['/terms', '/privacy']);

export const isPublicContentRoute = (pathname: string | null | undefined): boolean =>
  typeof pathname === 'string' && PUBLIC_CONTENT_ROUTES.has(pathname);

export type AuthRouteViewer = {
  emailVerified: boolean;
  hasPhoneNumber: boolean;
  role: string;
};

export type AuthRouteRequest = {
  /**
   * `usePathname()` output. expo-router omits route GROUPS from the URL, so a
   * screen in `app/(auth)/` reports `/privacy`, never `/(auth)/privacy` -- the
   * comparisons below are written against that shape.
   */
  currentPath: string;
  policyAccepted: boolean;
  /** Already normalised by the layout; `null` when there is nothing to honour. */
  redirectTo?: string | null;
  /** `null` for a signed-out visitor, who is never redirected by this guard. */
  viewer: AuthRouteViewer | null;
};

/**
 * The path the `(auth)` group should redirect to, or `null` to render the
 * screen that was asked for.
 *
 * Returning `null` rather than a target for the "stay put" case keeps the
 * signed-out path (which has no target at all) and the already-on-target case
 * from needing two different shapes at the call site.
 */
export const resolveAuthRouteRedirect = ({
  currentPath,
  policyAccepted,
  redirectTo,
  viewer,
}: AuthRouteRequest): string | null => {
  if (!viewer) {
    return null;
  }

  if (isPublicContentRoute(currentPath)) {
    return null;
  }

  let target = '/home';

  if (!viewer.emailVerified) {
    target = '/verify-email';
  } else if (viewer.role === 'customer' && !viewer.hasPhoneNumber) {
    target = '/complete-profile';
  } else if (!policyAccepted) {
    target = '/accept-policy';
  } else if (redirectTo) {
    target = redirectTo;
  }

  return currentPath === target ? null : target;
};
