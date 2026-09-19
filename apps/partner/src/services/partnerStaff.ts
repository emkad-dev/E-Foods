import type { StaffInvite, StaffMember } from '../domain/staffInvites';
import { callPartnerBackendRpc } from './backendRpc';

/**
 * The staff-invite wire calls.
 *
 * WHAT IS NOT IN THIS FILE, and must never be added: any way for the owner's
 * side of the app to learn an invite code. `partnerInviteStaff` returns
 * `{ inviteId, email, expiresAt }` and deliberately no code -- the code is
 * emailed to the invitee and stored only as an HMAC. The response type below
 * mirrors that omission so nothing here is tempted to read a field the server
 * would have to start sending. An owner who can see the code can accept the
 * invite themselves, which destroys the only thing this feature buys: that an
 * action logged against a staff member could not have been the owner's.
 *
 * `redeemStaffInvite` lives here too even though it routes to `feasty-account`
 * rather than `feasty-partner` (see packages/domain/src/rpcRoutes.ts).
 * `callPartnerBackendRpc` resolves the function from the action name, so the
 * split is invisible at this layer, and keeping both ends of one feature in
 * one file is worth more than mirroring the server's function boundaries.
 */

/** Deliberately no `code`. See the note above. */
export type PartnerStaffInviteResult = {
  inviteId: string;
  email: string;
  expiresAt: string;
};

export type PartnerStaffList = {
  staff: StaffMember[];
  invites: StaffInvite[];
};

export type RedeemStaffInviteResult = {
  restaurantId: string;
  restaurantName: string;
};

/**
 * Sends a 6-digit code to `email`. Creates no account and grants nothing --
 * the invitee signs up themselves and redeems it.
 *
 * 412 when the store is not set up, 400 for a bad or self-addressed email.
 * Both arrive as readable sentences from the server, so callers render
 * `error.message` rather than mapping status codes.
 */
export const inviteStaffMember = (email: string) =>
  callPartnerBackendRpc<PartnerStaffInviteResult>('partnerInviteStaff', {
    // Trimmed and lowercased server-side as well; doing it here keeps the
    // optimistic row the screen renders identical to the one the next list
    // fetch returns, so the address does not visibly change case after send.
    email: email.trim().toLowerCase(),
  });

/**
 * Everyone who can act for this restaurant, plus every invite.
 *
 * `staff` excludes the caller (the server filters on `uid`), so the list is
 * literally "other people", and `invites` arrives newest-first with `expired`
 * already derived from `expiresAt` -- do not recompute that against the
 * device clock.
 */
export const getPartnerStaff = () => callPartnerBackendRpc<PartnerStaffList>('partnerListStaff', {});

/** Cancels an unredeemed invite. 404 once it is no longer pending. */
export const revokeStaffInvite = (inviteId: string) =>
  callPartnerBackendRpc<{ inviteId: string; status: string }>('partnerRevokeStaffInvite', { inviteId });

/**
 * Unlinks a staff member from this restaurant and drops their role.
 *
 * Does NOT delete their account or touch their password: their FEASTY login
 * is theirs, and the restaurant's authority over it stops at its own door.
 * 400 when targeting yourself, 404 when they are not your staff.
 */
export const revokeStaffAccess = (targetUid: string) =>
  callPartnerBackendRpc<{ targetUid: string }>('partnerRevokeStaffAccess', { targetUid });

/**
 * Attaches the SIGNED-IN account to the restaurant that issued this code.
 *
 * What binds the invite to a person is the email on the signed-in account,
 * not the code -- so this is an authenticated call and holding somebody
 * else's code achieves nothing.
 *
 * The 400 is deliberately one message covering wrong, expired and
 * out-of-attempts, so that the screen cannot become an oracle for which
 * addresses have live invites. Callers must render it verbatim and must not
 * try to guess which case it was.
 */
export const redeemStaffInvite = (code: string) =>
  callPartnerBackendRpc<RedeemStaffInviteResult>('redeemStaffInvite', { code: code.trim() });
