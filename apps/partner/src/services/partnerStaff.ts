import type { StaffInvite, StaffMember } from '../domain/staffInvites';
import { callAnonymousBackendRpc } from './anonymousBackendRpc';
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

/* -------------------------------------------------------------------------- *
 * THE TWO PRE-AUTH CALLS
 *
 * They live in this file, beside `redeemStaffInvite`, because they are the same
 * feature seen from the other end -- but they go through
 * `callAnonymousBackendRpc`, NOT `callPartnerBackendRpc`. The authenticated
 * helper resolves a session before it sends anything and throws "your session
 * expired" when there is none, which is the normal state of every caller here.
 * -------------------------------------------------------------------------- */

export type StaffInviteResolveResult = {
  /**
   * Which way this person gets in. Decided server-side off the auth user's
   * `identities`, because a Google account having no password to type is the
   * fact this whole flow was rebuilt around. Typed as `string` deliberately:
   * `resolveStaffJoinStep` in the domain module is what narrows it, and a
   * branch this build does not know must be recognisable as unknown rather
   * than silently typed into one of the three.
   */
  branch: string;
  /** The invite's address, normalised. The screen shows this, not what was typed. */
  email: string;
  restaurantName: string;
};

/**
 * Which route does this email + code take? Read-only apart from the attempt
 * counter.
 *
 * NOT AN ACCOUNT-EXISTENCE ORACLE, and callers must not undermine that. Every
 * failure -- unknown address, no invite, expired, wrong code, five attempts
 * spent -- comes back as one identical 400. Render `error.message` verbatim
 * and do not try to work out which case it was: a screen that distinguishes
 * them hands an unauthenticated caller a way to enumerate addresses with live
 * invites, and separately tells anyone holding a code whether their colleague
 * has an account.
 *
 * A WRONG code costs one of five attempts. A correct one costs nothing, so
 * re-resolving the same valid code (going back a step, say) is free.
 */
export const resolveStaffInvite = (email: string, code: string) =>
  callAnonymousBackendRpc<StaffInviteResolveResult>('staffInviteResolve', {
    // Lowercased server-side too; doing it here keeps the address the screen
    // echoes back identical to the one the server matched on.
    email: email.trim().toLowerCase(),
    code: code.trim(),
  });

export type StaffInviteCreateAccountResult = {
  email: string;
  restaurantName: string;
};

/**
 * Creates the account for an invitee who has none, and attaches it to the
 * restaurant that invited them. Only valid on the `create` branch.
 *
 * NO SESSION COMES BACK, by design -- the server mints nothing. The caller
 * signs in afterwards with the password the person just chose, through the
 * ordinary sign-in path, which is one fewer thing a pre-auth endpoint is
 * trusted to do.
 *
 * NO EMAIL OTP EITHER. The code was delivered to that mailbox, so holding it
 * already proves what a confirmation email would; the account is created
 * confirmed. The screen has to SAY this, or finishing with no confirmation
 * mail looks like a step that failed silently.
 *
 * 409 if the address already has an account -- refused, never updated. That
 * missing update branch is what keeps this from being an account-takeover
 * primitive handed to an unauthenticated caller, so a caller that "helpfully"
 * retried as a sign-in on 409 would be defeating the point; send them back to
 * step one and let the server pick the branch again.
 */
export const createStaffInviteAccount = (input: {
  code: string;
  displayName?: string;
  email: string;
  password: string;
}) =>
  callAnonymousBackendRpc<StaffInviteCreateAccountResult>('staffInviteCreateAccount', {
    code: input.code.trim(),
    // Omitted rather than sent empty when there is no name.
    ...(input.displayName ? { displayName: input.displayName } : null),
    email: input.email.trim().toLowerCase(),
    // NOT trimmed. A space at either end is a legitimate password character,
    // and trimming it here would create the account with a password that does
    // not match what the person typed into the sign-in call two lines later.
    password: input.password,
  });
