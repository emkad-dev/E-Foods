/**
 * Client-side mirror of the `deleteAdminAccess` RPC guards so the console only
 * offers the button when the server can actually honour it.
 *
 * The server (supabase/functions/_shared/domains/account.ts) refuses with:
 *   400 when `targetUid` is missing/blank
 *   412 when `targetUid === context.uid` (an admin cannot delete themselves here)
 *   412 when the target's resolved primary role is not `admin`
 *
 * The access overview rows carry the same resolved primary role
 * (`resolvePrimaryRole` via `buildUserAccountResponse`), so the role check here
 * reads the same value the server will. Roles can still change between the read
 * and the call, so the server remains the authority and its refusal text is
 * surfaced verbatim when that happens.
 */

export type AdminDeleteRefusalReason = 'missing-target' | 'self' | 'not-admin';

export type AdminDeleteEligibility =
  | { deletable: true }
  | { deletable: false; reason: AdminDeleteRefusalReason };

export type AdminDeleteEligibilityInput = {
  role: string | null | undefined;
  signedInUid: string | null | undefined;
  targetUid: string | null | undefined;
};

export const resolveAdminDeleteEligibility = ({
  role,
  signedInUid,
  targetUid,
}: AdminDeleteEligibilityInput): AdminDeleteEligibility => {
  const uid = typeof targetUid === 'string' ? targetUid.trim() : '';
  if (!uid) {
    return { deletable: false, reason: 'missing-target' };
  }

  const signedIn = typeof signedInUid === 'string' ? signedInUid.trim() : '';
  if (signedIn && uid === signedIn) {
    return { deletable: false, reason: 'self' };
  }

  if (typeof role !== 'string' || role.trim() !== 'admin') {
    return { deletable: false, reason: 'not-admin' };
  }

  return { deletable: true };
};

export const canDeleteAdminAccess = (input: AdminDeleteEligibilityInput) =>
  resolveAdminDeleteEligibility(input).deletable;

/**
 * Client-side mirror of the `deleteUserAccountOnRequest` RPC guards — the
 * action that honours a deletion request emailed by someone who cannot reach
 * the in-app flow (published at https://feasty.com.ng/account-deletion).
 *
 * It is the mirror image of `deleteAdminAccess` above: that one is offered ONLY
 * on admin rows, this one on every row that is NOT an admin, so exactly one of
 * the two controls appears on any given row and an operator is never choosing
 * between them.
 *
 * The server (supabase/functions/_shared/domains/account.ts) refuses with:
 *   400 when `targetUid` is missing/blank
 *   412 when `targetUid === context.uid` (delete your own account in-app)
 *   412 when the target's resolved primary role IS `admin`
 *
 * The server ALSO enforces `validateOffboardingEligibility` for `restaurant`
 * and `dispatch` targets (still linked to a restaurant / still holding live
 * delivery work). Those are NOT mirrored here on purpose: they depend on server
 * state the access overview does not carry, so the button stays available and
 * the server's 412 text — which names exactly what the admin must clear first —
 * is surfaced verbatim instead of being guessed at client-side.
 */
export type RequestedDeleteRefusalReason = 'missing-target' | 'self' | 'is-admin';

export type RequestedDeleteEligibility =
  | { deletable: true }
  | { deletable: false; reason: RequestedDeleteRefusalReason };

export const resolveRequestedDeleteEligibility = ({
  role,
  signedInUid,
  targetUid,
}: AdminDeleteEligibilityInput): RequestedDeleteEligibility => {
  const uid = typeof targetUid === 'string' ? targetUid.trim() : '';
  if (!uid) {
    return { deletable: false, reason: 'missing-target' };
  }

  const signedIn = typeof signedInUid === 'string' ? signedInUid.trim() : '';
  if (signedIn && uid === signedIn) {
    return { deletable: false, reason: 'self' };
  }

  if (typeof role === 'string' && role.trim() === 'admin') {
    return { deletable: false, reason: 'is-admin' };
  }

  return { deletable: true };
};

export const canDeleteUserAccountOnRequest = (input: AdminDeleteEligibilityInput) =>
  resolveRequestedDeleteEligibility(input).deletable;
