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
