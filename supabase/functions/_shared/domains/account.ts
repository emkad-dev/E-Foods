// Account domain: policy acceptance, role administration, staff provisioning,
// account offboarding, and the anonymous promo-tracking beacon.

import {
  PRIVILEGED_APP_ROLES,
  deleteUserAccount,
  deleteUserRoleLinks,
  isAppRole,
  loadUserAccount,
  loadUserRoles,
  resolvePrimaryRole,
  syncUserRoleState,
  updateUserAccount,
  upsertUserAccount,
  type UserAccountRow,
} from '../accounts.ts';
import { createAuditEntry } from '../auditLog.ts';
import { serviceClient } from '../client.ts';
import {
  DEFAULT_DISPATCH_STATUS,
  DEFAULT_DISPATCH_VEHICLE,
  ensureDispatchRiderRecord,
} from '../dispatchRiders.ts';
import { buildNotificationData, notifyUsers } from '../notifications.ts';
import { TERMINAL_ORDER_STATUSES, normalizeOrderStatus } from '../orders.ts';
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  hasCurrentPolicyAcceptance,
  normalizePolicyApp,
  recordPolicyAcceptance,
  validatePolicyAcceptancePayload,
} from '../policyAcceptance.ts';
import { validatePromoTrack } from '../promoTrack.ts';
import { loadFeatureFlagMap } from '../featureFlags.ts';
import { broadcastRidersChanged } from '../realtime.ts';
import { loadManagedRestaurantForUser, loadRestaurantById } from '../restaurants.ts';
import {
  STAFF_INVITE_MAX_ATTEMPTS,
  hashStaffInviteCode,
  isStaffInviteExpired,
  resolveStaffJoinBranch,
  staffInviteCodeMatches,
} from '../staffInviteCodes.ts';
import { ACCOUNT_ACTIONS } from '../rpc/actions.ts';
import type { JsonObject } from '../rpc/coercion.ts';
import { nowIso, parseInteger, sanitizeOptionalText, sanitizeText } from '../rpc/coercion.ts';
import { ensureRole, type AuthenticatedRequestContext } from '../rpc/context.ts';
import { defineRpcDomain, type AnonymousRpcHandler, type RpcHandler } from '../rpc/registry.ts';
import { fail, json } from '../rpc/respond.ts';
import {
  createSupabaseAuthUser,
  deleteSupabaseAuthUser,
  findSupabaseAuthUserByEmail,
  loadSupabaseAuthIdentities,
  updateSupabaseAuthUser,
} from '../supabaseAdmin.ts';

type Handler = RpcHandler<AuthenticatedRequestContext>;

/**
 * Cap on the free-text `reason` recorded against an on-request account
 * deletion. Long enough for "emailed feastyfooders@gmail.com 2026-09-11,
 * identity confirmed against the order history", short enough that a paste of
 * the whole email thread cannot bloat the audit row.
 */
const DELETION_REASON_MAX_LENGTH = 500;

/**
 * Refuses self-service deletion for accounts that still own platform state.
 * Deleting them would orphan a restaurant or strand an in-flight delivery, so
 * they are pushed to the admin offboarding path where the state is untangled
 * first.
 */
const validateOffboardingEligibility = async (targetUid: string, role: string, account: UserAccountRow) => {
  if (role === 'restaurant') {
    const managedRestaurant = await loadManagedRestaurantForUser(targetUid, role);
    if (managedRestaurant.restaurant || sanitizeOptionalText(account.restaurantId)) {
      fail(
        412,
        'Partner accounts linked to a restaurant must be offboarded by admin so store ownership and order history stay traceable.'
      );
    }
  }

  if (role === 'dispatch') {
    const [{ data: rider, error: riderError }, { data: assignments, error: assignmentError }] = await Promise.all([
      serviceClient
        .from('DispatchRiderRecord')
        .select('id,activeLoad')
        .eq('id', targetUid)
        .maybeSingle<{ id: string; activeLoad?: number | null }>(),
      serviceClient.from('DeliveryAssignment').select('orderId,courierId').eq('courierId', targetUid),
    ]);

    if (riderError) {
      throw new Error(riderError.message);
    }
    if (assignmentError) {
      throw new Error(assignmentError.message);
    }

    const orderIds = (assignments ?? []).map((entry) => sanitizeText((entry as { orderId?: string }).orderId)).filter(Boolean);
    let hasOpenAssignments = false;
    if (orderIds.length > 0) {
      const { data: orders, error: orderError } = await serviceClient
        .from('CustomerOrder')
        .select('id,status')
        .in('id', orderIds);

      if (orderError) {
        throw new Error(orderError.message);
      }

      hasOpenAssignments = (orders ?? []).some(
        (order) => !TERMINAL_ORDER_STATUSES.has(normalizeOrderStatus((order as { status?: string }).status))
      );
    }

    if (parseInteger(rider?.activeLoad, 0) > 0 || hasOpenAssignments) {
      fail(
        412,
        'Dispatch accounts with active delivery work must be offboarded by admin after assignments are cleared.'
      );
    }
  }
};

/**
 * Deletes an account across auth and Postgres. The auth user is banned first so
 * the session dies immediately; if any Postgres cleanup fails the ban is lifted
 * and the whole thing is refused, because a half-deleted account that can no
 * longer sign in is worse than one that was never deleted.
 */
const offboardUserAccount = async (targetUid: string, actorUid: string, auditAction: string, details: JsonObject = {}) => {
  await createAuditEntry(actorUid, auditAction, 'user', targetUid, details);
  await updateSupabaseAuthUser(targetUid, {
    ban_duration: '876000h',
  }).catch(() => undefined);

  const cleanupOperations = await Promise.allSettled([
    (async () => {
      const { error } = await serviceClient.from('DispatchApplicationRecord').delete().eq('id', targetUid);
      if (error) {
        throw new Error(error.message);
      }
    })(),
    (async () => {
      const { error } = await serviceClient.from('PartnerApplicationRecord').delete().eq('id', targetUid);
      if (error) {
        throw new Error(error.message);
      }
    })(),
    (async () => {
      const { error } = await serviceClient.from('DispatchRiderRecord').delete().eq('id', targetUid);
      if (error) {
        throw new Error(error.message);
      }
      await broadcastRidersChanged();
    })(),
    deleteUserRoleLinks(targetUid),
    deleteUserAccount(targetUid),
  ]);

  const cleanupFailures = cleanupOperations.filter((result) => result.status === 'rejected');
  if (cleanupFailures.length > 0) {
    await updateSupabaseAuthUser(targetUid, {
      ban_duration: 'none',
    }).catch(() => undefined);
    fail(
      409,
      'Account deletion could not be completed cleanly. No records were removed from sign-in, so try again or contact support.'
    );
  }

  await deleteSupabaseAuthUser(targetUid);
};

// Anon-allowed: browsing customers are frequently not signed in. Fire-and-forget
// from the client, so failures here are still returned but never block the UI.
const promoTrack: AnonymousRpcHandler = async ({ data }) => {
  const parsed = validatePromoTrack(data);
  if (!parsed.ok) {
    fail(400, parsed.message);
  }
  const { error } = await serviceClient.from('PromoEvent').insert({
    promoId: parsed.value.promoId,
    type: parsed.value.type,
  });
  if (error) {
    throw new Error(error.message);
  }
  return json(200, { data: { ok: true } });
};

const getFeatureFlags: Handler = async () =>
  json(200, {
    data: {
      featureFlags: await loadFeatureFlagMap(),
    },
  });

const getPolicyAcceptance: Handler = async ({ context, data }) => {
  const app = normalizePolicyApp(data.app);
  if (!app) {
    fail(400, 'A valid app is required.');
  }

  return json(200, {
    data: await hasCurrentPolicyAcceptance(context.uid, app),
  });
};

const recordPolicyAcceptanceHandler: Handler = async ({ context, data }) => {
  const requestedApp = normalizePolicyApp(data.app);
  if (!requestedApp) {
    fail(400, 'A valid app is required.');
  }

  const acceptance = validatePolicyAcceptancePayload(
    {
      accepted: data.accepted,
      app: requestedApp,
      privacyVersion: data.privacyVersion,
      source: data.source,
      termsVersion: data.termsVersion,
    },
    requestedApp as 'customer' | 'partner' | 'dispatch',
    `${requestedApp}_policy_gate`
  );
  const acceptedAt = await recordPolicyAcceptance(context.uid, context.email, acceptance);

  return json(200, {
    data: {
      accepted: true,
      acceptedAt,
      privacyVersion: CURRENT_PRIVACY_VERSION,
      termsVersion: CURRENT_TERMS_VERSION,
    },
  });
};

/**
 * Shared validation for the two PRE-AUTH invite actions below.
 *
 * These are the only unauthenticated endpoints in this codebase besides
 * promoTrack and bootstrapFirstAdmin, so everything they do is deliberately
 * narrow: they resolve exactly one invite, for exactly one address, and they
 * refuse everything else.
 *
 * Returns the matched invite or throws the SAME rejection for every failure
 * mode -- unknown address, no invite, expired, wrong code, attempts exhausted.
 * An endpoint that distinguishes them tells an unauthenticated caller which
 * addresses have live invites, which is a list worth having if you are
 * guessing codes.
 */
const STAFF_INVITE_REJECTION =
  'That code is not valid. Check it with the restaurant, or ask them to send a new one.';

const resolvePendingStaffInvite = async (rawEmail: unknown, rawCode: unknown) => {
  const email = sanitizeText(rawEmail).trim().toLowerCase();
  const code = sanitizeText(rawCode).trim();

  if (!email || !code) {
    fail(400, 'Enter the email address the code was sent to, and the code.');
  }

  const { data: rows, error } = await serviceClient
    .from('StaffInvite')
    .select('id,restaurantId,codeHash,expiresAt,attempts')
    .eq('email', email)
    .eq('status', 'pending')
    .order('createdAt', { ascending: false })
    .limit(5);

  if (error) {
    throw new Error(error.message);
  }

  const now = new Date();
  const candidates = ((rows ?? []) as Array<{
    attempts?: number | null;
    codeHash: string;
    expiresAt: string;
    id: string;
    restaurantId: string;
  }>).filter((invite) => !isStaffInviteExpired(invite.expiresAt, now));

  for (const invite of candidates) {
    if ((invite.attempts ?? 0) >= STAFF_INVITE_MAX_ATTEMPTS) {
      continue;
    }

    if (staffInviteCodeMatches(invite.codeHash, await hashStaffInviteCode(invite.id, code))) {
      return { email, inviteId: invite.id, restaurantId: invite.restaurantId };
    }

    // Charged BEFORE the rejection returns. This counter is the entire
    // brute-force guard on a six-digit code, and it matters more here than on
    // the authenticated path: there is no session to rate-limit behind.
    const nextAttempts = (invite.attempts ?? 0) + 1;
    const { error: attemptError } = await serviceClient
      .from('StaffInvite')
      .update({
        attempts: nextAttempts,
        status: nextAttempts >= STAFF_INVITE_MAX_ATTEMPTS ? 'revoked' : 'pending',
        updatedAt: now.toISOString(),
      })
      .eq('id', invite.id);

    if (attemptError) {
      throw new Error(attemptError.message);
    }
  }

  fail(400, STAFF_INVITE_REJECTION);
};

/**
 * PRE-AUTH. Which way does this person get in?
 *
 * The join screen cannot know whether to ask for a password, offer Google, or
 * invite them to choose a password, because it does not know whether the
 * address has an account -- and it must not be able to find out by asking.
 * So the code is validated FIRST and the server picks the branch. Without a
 * valid, unexpired, unexhausted invite for that exact address, this returns
 * nothing at all: it is not an account-existence oracle.
 *
 * Read-only apart from the attempt counter.
 */
const staffInviteResolve: AnonymousRpcHandler = async ({ data }) => {
  const invite = await resolvePendingStaffInvite(data.email, data.code);
  const authUser = await findSupabaseAuthUserByEmail(invite.email);

  // WHICH WAY IN, AND WHICH WAY TO BE WRONG.
  //
  // The first version read `identities` straight off the object the paged
  // admin listing returns. That listing does not reliably carry the field, so
  // the array was empty, "no password identity" looked true, and a real
  // password account was told on screen that it signs in with Google. It was
  // caught in production on the first live invite.
  //
  // Two changes. The identities come from the single-user admin endpoint,
  // which does carry them. And the UNKNOWN case now resolves to 'password'
  // rather than 'google', because the two mistakes are not symmetrical: a
  // Google user offered a password field types one, fails once, and can still
  // use Google from the sign-in screen, whereas a password user offered only
  // Google has nowhere to go. An account carrying BOTH identities also
  // resolves to 'password' -- it is the branch that works either way.
  const authUserId = sanitizeText(
    String((authUser as { id?: unknown } | null)?.id ?? '')
  );
  const identities = authUser ? await loadSupabaseAuthIdentities(authUserId) : [];
  const branch = resolveStaffJoinBranch(Boolean(authUser), identities);

  const restaurant = await loadRestaurantById(invite.restaurantId);

  return json(200, {
    data: {
      branch,
      email: invite.email,
      // Named so the person can tell they are joining the right place before
      // they type a password.
      restaurantName: sanitizeText(restaurant.restaurant?.name, 'this restaurant'),
    },
  });
};

/**
 * PRE-AUTH. Create an account for an invitee who has none, and attach it.
 *
 * WHY THIS IS ALLOWED TO CREATE AN ACCOUNT WITHOUT AN EMAIL OTP: the code was
 * delivered to that mailbox, so holding it already proves what the OTP would.
 * Asking for a second proof of the same fact is friction, not security.
 *
 * WHY THIS IS NOT provisionStaffAccount: the password is chosen by the person
 * signing up, never supplied by somebody else; the role is the literal
 * 'restaurant'; the restaurant comes from the invite; and an address that
 * ALREADY has an account is refused outright rather than updated. That refusal
 * is the whole difference -- an update branch here would recreate the
 * account-takeover primitive that kept provisionStaffAccount admin-only, and
 * hand it to an unauthenticated caller.
 */
const staffInviteCreateAccount: AnonymousRpcHandler = async ({ data }) => {
  const password = sanitizeText(data.password);
  const displayName = sanitizeOptionalText(data.displayName);

  if (password.length < 8) {
    fail(400, 'Choose a password of at least 8 characters.');
  }

  const invite = await resolvePendingStaffInvite(data.email, data.code);

  // NO UPDATE BRANCH. If the address already exists this stops here; it never
  // touches the existing account's password, role or ban state.
  if (await findSupabaseAuthUserByEmail(invite.email)) {
    fail(409, 'That address already has a FEASTY account. Sign in with it instead.');
  }

  const restaurant = await loadRestaurantById(invite.restaurantId);
  if (!restaurant.restaurant) {
    fail(404, 'The restaurant that invited you no longer exists.');
  }

  const now = new Date();

  // Claim the invite BEFORE creating the account, and only from `pending`. If
  // this loses the race it has created nothing; the other order can leave an
  // orphaned account attached to an invite somebody else redeemed.
  const { data: claimed, error: claimError } = await serviceClient
    .from('StaffInvite')
    .update({
      acceptedAt: now.toISOString(),
      status: 'accepted',
      updatedAt: now.toISOString(),
    })
    .eq('id', invite.inviteId)
    .eq('status', 'pending')
    .select('id');

  if (claimError) {
    throw new Error(claimError.message);
  }

  if (!claimed || claimed.length === 0) {
    fail(409, 'That invite has already been used.');
  }

  const authUser = await createSupabaseAuthUser({
    displayName,
    email: invite.email,
    // The code already proved this mailbox. Requiring a second confirmation
    // would lock the person out of the account they just made.
    emailConfirmed: true,
    password,
    role: 'restaurant',
  });

  const targetUid = sanitizeText(
    String((authUser as { id?: unknown; user?: { id?: unknown } }).id ?? (authUser as { user?: { id?: unknown } }).user?.id ?? '')
  );

  if (!targetUid) {
    throw new Error('The invited account was created but returned no uid.');
  }

  await serviceClient
    .from('StaffInvite')
    .update({ acceptedUid: targetUid, updatedAt: nowIso() })
    .eq('id', invite.inviteId);

  await syncUserRoleState(targetUid, 'restaurant', targetUid, {
    restaurantId: invite.restaurantId,
    restaurantLinkedAt: now.toISOString(),
    restaurantLinkSource: 'staff_invite',
    restaurantName: sanitizeText(restaurant.restaurant.name, 'Restaurant'),
  });

  await createAuditEntry(targetUid, 'staff_invite_account_created', 'user', targetUid, {
    inviteId: invite.inviteId,
    restaurantId: invite.restaurantId,
  });

  // No session is minted here. The caller signs in with the password they just
  // chose, through the ordinary sign-in path -- one fewer thing this pre-auth
  // endpoint is trusted to do.
  return json(200, {
    data: {
      email: invite.email,
      restaurantName: sanitizeText(restaurant.restaurant.name, 'Restaurant'),
    },
  });
};

/**
 * Redeem a staff invite for the account that is already signed in.
 *
 * WHAT BINDS THE INVITE TO A PERSON is not the code. It is the email on the
 * signed-in account: the lookup is by `account.email`, so holding a code for
 * someone else's address achieves nothing. The code only proves the holder of
 * that mailbox meant to accept.
 *
 * Deliberately an AUTHENTICATED action, which is what keeps this feature small.
 * The invitee signs up through the ordinary partner signup -- their own
 * password, the existing email OTP -- and arrives here with an account already.
 * So nothing in this path creates an auth user, sets a password or lifts a ban,
 * ANONYMOUS_ACTIONS stays at two, and the pre-auth surface does not grow to
 * carry a feature that does not need it.
 */
const redeemStaffInvite: Handler = async ({ context, data }) => {
  const code = sanitizeText(data.code).trim();

  if (!code) {
    fail(400, 'Enter the invite code you were sent.');
  }

  const account = await loadUserAccount(context.uid);
  if (!account) {
    fail(404, 'Your account could not be loaded.');
  }

  const email = sanitizeText(account.email).toLowerCase();
  if (!email) {
    fail(412, 'Add an email address to your account before redeeming an invite.');
  }

  // A VERIFIED address, not merely a claimed one. Without this, signing up with
  // somebody else's address and never confirming it would be enough to take
  // the invite meant for them -- the code is emailed to the mailbox, so the
  // mailbox has to be proven to belong to this account.
  if (account.emailVerified !== true) {
    fail(412, 'Confirm your email address before redeeming an invite.');
  }

  // An admin redeeming a staff invite would silently demote themselves out of
  // the console. A person who already works for another restaurant has to be
  // released by that restaurant first, rather than being moved by a code.
  if (context.role === 'admin') {
    fail(400, 'Administrator accounts cannot be added as restaurant staff.');
  }

  const existingRestaurantId = sanitizeText(account.restaurantId);

  const { data: inviteRows, error: lookupError } = await serviceClient
    .from('StaffInvite')
    .select('id,restaurantId,codeHash,status,expiresAt,attempts')
    .eq('email', email)
    .eq('status', 'pending')
    .order('createdAt', { ascending: false })
    .limit(5);

  if (lookupError) {
    throw new Error(lookupError.message);
  }

  const now = new Date();
  const candidates = ((inviteRows ?? []) as Array<{
    attempts?: number | null;
    codeHash: string;
    expiresAt: string;
    id: string;
    restaurantId: string;
  }>).filter((invite) => !isStaffInviteExpired(invite.expiresAt, now));

  // One message for "no invite", "expired", "wrong code" and "out of attempts".
  // Distinguishing them tells an attacker which addresses have live invites.
  const REJECTION = 'That code is not valid. Check it with the restaurant, or ask them to send a new one.';

  if (candidates.length === 0) {
    fail(400, REJECTION);
  }

  let matched: { id: string; restaurantId: string } | null = null;

  for (const invite of candidates) {
    if ((invite.attempts ?? 0) >= STAFF_INVITE_MAX_ATTEMPTS) {
      continue;
    }

    const candidateHash = await hashStaffInviteCode(invite.id, code);

    if (staffInviteCodeMatches(invite.codeHash, candidateHash)) {
      matched = { id: invite.id, restaurantId: invite.restaurantId };
      break;
    }

    // Count the miss BEFORE returning. Six digits is a million combinations,
    // and this counter is the only thing standing between that number and a
    // script; a failed attempt that costs nothing is not a guard.
    const nextAttempts = (invite.attempts ?? 0) + 1;
    const { error: attemptError } = await serviceClient
      .from('StaffInvite')
      .update({
        attempts: nextAttempts,
        // Burn the invite outright once the budget is gone, rather than
        // leaving a row that quietly accepts nothing.
        status: nextAttempts >= STAFF_INVITE_MAX_ATTEMPTS ? 'revoked' : 'pending',
        updatedAt: now.toISOString(),
      })
      .eq('id', invite.id);

    if (attemptError) {
      throw new Error(attemptError.message);
    }
  }

  if (!matched) {
    fail(400, REJECTION);
  }

  if (existingRestaurantId && existingRestaurantId !== matched.restaurantId) {
    fail(409, 'This account already works for another restaurant. Ask them to remove your access first.');
  }

  const restaurant = await loadRestaurantById(matched.restaurantId);
  if (!restaurant.restaurant) {
    fail(404, 'The restaurant that invited you no longer exists.');
  }

  // Claim the row FIRST, and only from `pending`. Two tabs redeeming the same
  // code race here; the status predicate means exactly one of them gets a row
  // back and therefore exactly one grants access.
  const { data: claimed, error: claimError } = await serviceClient
    .from('StaffInvite')
    .update({
      acceptedAt: now.toISOString(),
      acceptedUid: context.uid,
      status: 'accepted',
      updatedAt: now.toISOString(),
    })
    .eq('id', matched.id)
    .eq('status', 'pending')
    .select('id');

  if (claimError) {
    throw new Error(claimError.message);
  }

  if (!claimed || claimed.length === 0) {
    fail(409, 'That invite has already been used.');
  }

  await syncUserRoleState(context.uid, 'restaurant', context.uid, {
    restaurantId: matched.restaurantId,
    restaurantLinkedAt: now.toISOString(),
    restaurantLinkSource: 'staff_invite',
    restaurantName: sanitizeText(restaurant.restaurant.name, 'Restaurant'),
  });

  await createAuditEntry(context.uid, 'staff_invite_redeemed', 'user', context.uid, {
    inviteId: matched.id,
    restaurantId: matched.restaurantId,
  });

  return json(200, {
    data: {
      restaurantId: matched.restaurantId,
      restaurantName: sanitizeText(restaurant.restaurant.name, 'Restaurant'),
    },
  });
};

const provisionStaffAccount: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin']);
  const email = sanitizeText(data.email).toLowerCase();
  const password = sanitizeText(data.password);
  const displayName = sanitizeOptionalText(data.displayName);
  const requestedRestaurantId = sanitizeText(data.restaurantId);
  const role = sanitizeText(data.role);

  if (!email) {
    fail(400, 'A staff email is required.');
  }

  if (!password || password.length < 6) {
    fail(400, 'Use a password with at least 6 characters.');
  }

  if (!['restaurant', 'dispatch', 'admin'].includes(role)) {
    fail(400, 'Only admin, restaurant, and dispatch staff can be provisioned here.');
  }

  let restaurantId = ['restaurant', 'dispatch'].includes(role) ? requestedRestaurantId : null;
  let restaurantName: string | null = null;

  // The admin auth API returns a bare JSON object, so every field arrives as
  // `unknown` through the index signature. Naming the two nested bags this
  // handler actually reaches into (`user` on a create/update response,
  // `user_metadata` on a lookup) is what lets those reads type-check; the
  // sanitizers below already accept `unknown` and validate at runtime.
  type ProvisionedAuthUser = Record<string, unknown> & {
    user?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
  };

  let authUser: ProvisionedAuthUser | null = await findSupabaseAuthUserByEmail(email);
  let created = false;

  if (!authUser) {
    authUser = await createSupabaseAuthUser({
      displayName,
      email,
      emailConfirmed: true,
      password,
      role,
    });
    created = true;
  } else {
    authUser = await updateSupabaseAuthUser(sanitizeText(String(authUser.id ?? authUser.user?.id ?? authUser.uid)), {
      app_metadata: {
        app_role: role,
        role,
        user_role: role,
      },
      ban_duration: 'none',
      email_confirm: true,
      password,
      user_metadata: displayName
        ? {
            full_name: displayName,
          }
        : undefined,
    });
  }

  const targetUid = sanitizeText(String(authUser.id ?? authUser.user?.id ?? authUser.uid));
  if (!targetUid) {
    fail(500, 'The provisioned auth account is missing a uid.');
  }

  const existingAccount = await loadUserAccount(targetUid);
  const now = nowIso();
  if (['restaurant', 'dispatch'].includes(role) && !restaurantId) {
    restaurantId = sanitizeText(existingAccount?.restaurantId);
  }

  if (restaurantId) {
    const linkedRestaurant = await loadRestaurantById(restaurantId);
    if (!linkedRestaurant.restaurant) {
      fail(404, 'The selected restaurant could not be found.');
    }

    restaurantName = sanitizeText(linkedRestaurant.restaurant.name, sanitizeText(existingAccount?.restaurantName, 'Restaurant'));
  }

  await upsertUserAccount({
    uid: targetUid,
    email,
    displayName:
      displayName ?? sanitizeOptionalText(authUser.user_metadata?.full_name) ?? existingAccount?.displayName ?? email.split('@')[0],
    emailVerified: Boolean(authUser.email_confirmed_at ?? true),
    phoneNumber: existingAccount?.phoneNumber ?? null,
    createdAt: existingAccount?.createdAt ?? now,
    updatedAt: now,
    restaurantId,
    restaurantName,
    roleDisplay: role,
    accountDisabled: false,
    disabledAt: null,
    disabledByUid: null,
    lastPrivilegedRole: role,
  });
  await syncUserRoleState(targetUid, role, context.uid, {
    accountDisabled: false,
    disabledAt: null,
    disabledByUid: null,
    lastPrivilegedRole: role,
    restaurantId,
    restaurantLinkedAt: restaurantId ? now : null,
    restaurantLinkSource: restaurantId ? 'staff_account_provisioned' : null,
    restaurantName,
  });
  if (role === 'dispatch') {
    await ensureDispatchRiderRecord(targetUid, {
      completedTrips: 0,
      displayName:
        displayName ?? sanitizeOptionalText(authUser.user_metadata?.full_name) ?? existingAccount?.displayName ?? email.split('@')[0],
      phoneNumber: existingAccount?.phoneNumber ?? null,
      status: DEFAULT_DISPATCH_STATUS,
      vehicleType: DEFAULT_DISPATCH_VEHICLE,
      zone: sanitizeText(existingAccount?.restaurantName, 'Unassigned coverage area'),
    });
  }
  await createAuditEntry(context.uid, 'staff_account_provisioned', 'user', targetUid, {
    created,
    email,
    role,
  });
  await notifyUsers([targetUid], {
    title: 'Staff access provisioned',
    body: `Your ${role} account is ready. Sign in to continue.`,
    data: buildNotificationData({
      app: role === 'admin' ? 'admin' : role === 'dispatch' ? 'dispatch' : 'partner',
      role,
      routeKey: role === 'admin' ? 'admin_profile' : role === 'dispatch' ? 'dispatch_profile' : 'partner_profile',
      type: 'staff_access',
    }),
  });

  return json(200, {
    data: {
      created,
      email,
      role,
      targetUid,
      tokenRefreshRequired: true,
    },
  });
};

const assignUserRole: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin']);
  const targetUid = sanitizeText(data.targetUid);
  const nextRole = sanitizeText(data.role);
  const requestedRestaurantId = sanitizeText(data.restaurantId);
  if (!targetUid) {
    fail(400, 'A target uid is required.');
  }
  if (!isAppRole(nextRole)) {
    fail(400, 'Use a valid app role when assigning access.');
  }

  const account = await loadUserAccount(targetUid);
  if (!account) {
    fail(404, 'The selected user could not be found.');
  }

  const existingRestaurantId = sanitizeText(account.restaurantId);
  const restaurantId =
    ['restaurant', 'dispatch'].includes(nextRole) ? requestedRestaurantId ?? existingRestaurantId : null;
  let restaurantName: string | null = null;
  let restaurantLinkedAt: string | null | undefined;
  let restaurantLinkSource: string | null | undefined;

  if (restaurantId) {
    const linkedRestaurant = await loadRestaurantById(restaurantId);
    if (!linkedRestaurant.restaurant) {
      fail(404, 'The selected restaurant could not be found.');
    }

    restaurantName = sanitizeText(linkedRestaurant.restaurant.name, sanitizeText(account.restaurantName, 'Restaurant'));
    restaurantLinkedAt = sanitizeText(account.restaurantLinkedAt) ?? nowIso();
    restaurantLinkSource = 'admin_role_assignment';
  } else if (!['restaurant', 'dispatch'].includes(nextRole)) {
    restaurantName = null;
    restaurantLinkedAt = null;
    restaurantLinkSource = null;
  }

  await syncUserRoleState(targetUid, nextRole, context.uid, {
    accountDisabled: false,
    disabledAt: null,
    disabledByUid: null,
    lastPrivilegedRole: PRIVILEGED_APP_ROLES.has(nextRole) ? nextRole : null,
    restaurantId,
    restaurantLinkedAt,
    restaurantLinkSource,
    restaurantName,
  });
  if (nextRole === 'dispatch') {
    await ensureDispatchRiderRecord(targetUid, {
      completedTrips: 0,
      displayName: sanitizeText(account.displayName, account.email.split('@')[0]),
      phoneNumber: sanitizeOptionalText(account.phoneNumber),
      status: DEFAULT_DISPATCH_STATUS,
      vehicleType: DEFAULT_DISPATCH_VEHICLE,
      zone: sanitizeText(account.restaurantName, 'Unassigned coverage area'),
    });
  }
  await createAuditEntry(context.uid, 'role_assigned', 'user_role', targetUid, {
    role: nextRole,
    restaurantId,
  });
  await notifyUsers([targetUid], {
    title: 'Access role updated',
    body: `Your access role is now ${nextRole}. Refresh your session if the app prompts for it.`,
    data: buildNotificationData({
      app: nextRole === 'admin' ? 'admin' : nextRole === 'dispatch' ? 'dispatch' : nextRole === 'restaurant' ? 'partner' : 'customer',
      role: nextRole,
      routeKey:
        nextRole === 'admin'
          ? 'admin_access'
          : nextRole === 'dispatch'
            ? 'dispatch_profile'
            : nextRole === 'restaurant'
              ? 'partner_profile'
              : 'customer_profile',
      type: 'staff_access',
    }),
  });

  return json(200, {
    data: {
      assignedBy: context.uid,
      role: nextRole,
      targetUid,
      tokenRefreshRequired: true,
    },
  });
};

const updateUserRestaurantLink: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin']);
  const targetUid = sanitizeText(data.targetUid);
  const requestedRestaurantId = sanitizeText(data.restaurantId);
  if (!targetUid) {
    fail(400, 'A target uid is required.');
  }

  const account = await loadUserAccount(targetUid);
  if (!account) {
    fail(404, 'The selected user could not be found.');
  }

  const roles = Array.from((await loadUserRoles([targetUid])).get(targetUid) ?? []);
  const role = resolvePrimaryRole(account, roles);
  if (!['restaurant', 'dispatch'].includes(role)) {
    fail(412, 'Only partner and dispatch accounts can be linked to a restaurant.');
  }

  let restaurantId: string | null = null;
  let restaurantName: string | null = null;
  let restaurantLinkedAt: string | null = null;
  let restaurantLinkSource: string | null = null;

  if (requestedRestaurantId) {
    const linkedRestaurant = await loadRestaurantById(requestedRestaurantId);
    if (!linkedRestaurant.restaurant) {
      fail(404, 'The selected restaurant could not be found.');
    }

    restaurantId = requestedRestaurantId;
    restaurantName = sanitizeText(linkedRestaurant.restaurant.name, sanitizeText(account.restaurantName, 'Restaurant'));
    restaurantLinkedAt = nowIso();
    restaurantLinkSource = 'admin_access_console';
  }

  await syncUserRoleState(targetUid, role, context.uid, {
    accountDisabled: false,
    disabledAt: null,
    disabledByUid: null,
    lastPrivilegedRole: PRIVILEGED_APP_ROLES.has(role) ? role : null,
    restaurantId,
    restaurantLinkedAt,
    restaurantLinkSource,
    restaurantName,
  });
  await createAuditEntry(context.uid, 'restaurant_link_updated', 'user_role', targetUid, {
    restaurantId,
    role,
  });

  return json(200, {
    data: {
      restaurantId,
      targetUid,
      tokenRefreshRequired: true,
    },
  });
};

const revokeUserRole: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin']);
  const targetUid = sanitizeText(data.targetUid);
  if (!targetUid) {
    fail(400, 'A target uid is required.');
  }

  const account = await loadUserAccount(targetUid);
  if (!account) {
    fail(404, 'The selected user could not be found.');
  }

  await syncUserRoleState(targetUid, 'customer', context.uid, {
    accountDisabled: false,
    disabledAt: null,
    disabledByUid: null,
  });
  await createAuditEntry(context.uid, 'role_revoked', 'user_role', targetUid, {
    role: 'customer',
  });
  await notifyUsers([targetUid], {
    title: 'Privileged access removed',
    body: 'This account has been returned to standard customer access.',
    data: buildNotificationData({
      app: 'customer',
      role: 'customer',
      routeKey: 'customer_profile',
      type: 'staff_access',
    }),
  });

  return json(200, {
    data: {
      revokedBy: context.uid,
      role: 'customer',
      targetUid,
      tokenRefreshRequired: true,
    },
  });
};

const disableUserAccess: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin']);
  const targetUid = sanitizeText(data.targetUid);
  if (!targetUid) {
    fail(400, 'A target uid is required.');
  }
  if (targetUid === context.uid) {
    fail(412, 'Use a separate trusted admin before disabling the signed-in operator.');
  }

  const account = await loadUserAccount(targetUid);
  if (!account) {
    fail(404, 'The selected user could not be found.');
  }

  const roles = Array.from((await loadUserRoles([targetUid])).get(targetUid) ?? []);
  const previousRole = resolvePrimaryRole(account, roles);
  const previousPrivilegedRole = PRIVILEGED_APP_ROLES.has(previousRole) ? previousRole : null;

  await syncUserRoleState(targetUid, 'customer', context.uid, {
    accountDisabled: true,
    disabledAt: nowIso(),
    disabledByUid: context.uid,
    lastPrivilegedRole: previousPrivilegedRole,
  });
  // Poisoning the active session id is what forces existing clients to
  // re-authenticate rather than keep using a live token.
  await updateUserAccount(targetUid, {
    activeSessionId: `disabled:${Date.now()}`,
    activeSessionUpdatedAt: nowIso(),
    updatedAt: nowIso(),
  });
  await createAuditEntry(context.uid, 'user_access_disabled', 'user', targetUid, {
    previousPrivilegedRole,
    role: 'customer',
  });
  await notifyUsers([targetUid], {
    title: 'Account access disabled',
    body: 'An admin disabled this account. Contact your platform administrator for restore access.',
    data: buildNotificationData({
      app: 'customer',
      routeKey: 'customer_login',
      type: 'staff_access',
    }),
  });

  return json(200, {
    data: {
      disabled: true,
      role: 'customer',
      targetUid,
    },
  });
};

const enableUserAccess: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin']);
  const targetUid = sanitizeText(data.targetUid);
  if (!targetUid) {
    fail(400, 'A target uid is required.');
  }

  const account = await loadUserAccount(targetUid);
  if (!account) {
    fail(404, 'The selected user could not be found.');
  }

  const restoreRole = sanitizeText(account.lastPrivilegedRole);
  if (!PRIVILEGED_APP_ROLES.has(restoreRole)) {
    fail(412, 'No previous privileged role is recorded for this account. Re-provision or assign a role first.');
  }

  await syncUserRoleState(targetUid, restoreRole, context.uid, {
    accountDisabled: false,
    disabledAt: null,
    disabledByUid: null,
    lastPrivilegedRole: restoreRole,
  });
  if (restoreRole === 'dispatch') {
    await ensureDispatchRiderRecord(targetUid, {
      completedTrips: 0,
      displayName: sanitizeText(account.displayName, account.email.split('@')[0]),
      phoneNumber: sanitizeOptionalText(account.phoneNumber),
      status: DEFAULT_DISPATCH_STATUS,
      vehicleType: DEFAULT_DISPATCH_VEHICLE,
      zone: sanitizeText(account.restaurantName, 'Unassigned coverage area'),
    });
  }
  await updateUserAccount(targetUid, {
    activeSessionId: null,
    activeSessionUpdatedAt: nowIso(),
    updatedAt: nowIso(),
  });
  await createAuditEntry(context.uid, 'user_access_enabled', 'user', targetUid, {
    role: restoreRole,
  });
  await notifyUsers([targetUid], {
    title: 'Account access restored',
    body: `Your ${restoreRole} access has been restored.`,
    data: buildNotificationData({
      app: restoreRole === 'admin' ? 'admin' : restoreRole === 'dispatch' ? 'dispatch' : 'partner',
      role: restoreRole,
      routeKey: restoreRole === 'admin' ? 'admin_access' : restoreRole === 'dispatch' ? 'dispatch_profile' : 'partner_profile',
      type: 'staff_access',
    }),
  });

  return json(200, {
    data: {
      enabled: true,
      role: restoreRole,
      targetUid,
      tokenRefreshRequired: true,
    },
  });
};

const syncUserClaims: Handler = async ({ context, data }) => {
  const targetUid = sanitizeText(data.targetUid, context.uid);
  if (targetUid !== context.uid) {
    ensureRole(context.role, ['admin']);
  }

  const account = await loadUserAccount(targetUid);
  if (!account) {
    fail(404, 'The selected user could not be found.');
  }

  const roles = Array.from((await loadUserRoles([targetUid])).get(targetUid) ?? []);
  const resolvedRole = resolvePrimaryRole(account, roles);

  // Self-service claim sync may only re-assert a role the caller already holds:
  // otherwise a customer whose profile row said "admin" could mint an admin JWT.
  if (targetUid === context.uid && context.role !== 'admin' && PRIVILEGED_APP_ROLES.has(resolvedRole) && resolvedRole !== context.role) {
    fail(403, 'Only admins can provision privileged role claims. Ask an admin to finish setting up this account.');
  }

  if (targetUid === context.uid && context.role !== 'admin' && resolvedRole !== context.role) {
    fail(403, 'Your profile role does not match your authenticated access claim.');
  }

  await updateSupabaseAuthUser(targetUid, {
    app_metadata: {
      app_role: resolvedRole,
      role: resolvedRole,
      user_role: resolvedRole,
    },
  }).catch(() => undefined);

  return json(200, {
    data: {
      role: resolvedRole,
      targetUid,
      tokenRefreshRequired: true,
    },
  });
};

const deleteOwnAccount: Handler = async ({ context }) => {
  if (context.role === 'admin') {
    fail(403, 'Admin accounts must be offboarded from the admin access console so audit history stays intact.');
  }

  const account = await loadUserAccount(context.uid);
  if (!account) {
    fail(404, 'The signed-in account could not be found.');
  }

  if (context.role === 'restaurant' || context.role === 'dispatch') {
    await validateOffboardingEligibility(context.uid, context.role, account);
  }

  await offboardUserAccount(context.uid, context.uid, 'self_account_deleted', {
    role: context.role,
  });

  return json(200, {
    data: {
      deleted: true,
      targetUid: context.uid,
    },
  });
};

const deleteAdminAccess: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin']);
  const targetUid = sanitizeText(data.targetUid);
  if (!targetUid) {
    fail(400, 'A target uid is required.');
  }
  if (targetUid === context.uid) {
    fail(412, 'Use the signed-in admin offboarding flow for your own account.');
  }

  const account = await loadUserAccount(targetUid);
  if (!account) {
    fail(404, 'The selected user could not be found.');
  }

  const roles = Array.from((await loadUserRoles([targetUid])).get(targetUid) ?? []);
  const resolvedRole = resolvePrimaryRole(account, roles);
  if (resolvedRole !== 'admin') {
    fail(412, 'This action only deletes admin access. Use role revoke or disable access for other accounts.');
  }

  await offboardUserAccount(targetUid, context.uid, 'admin_account_deleted', {
    email: account.email,
    role: resolvedRole,
  });

  return json(200, {
    data: {
      deleted: true,
      role: resolvedRole,
      targetUid,
    },
  });
};

/**
 * Deletes a NON-admin account on the account holder's behalf, for the person
 * who cannot reach the in-app flow: they uninstalled, they are locked out, or
 * they wrote to the address published on https://feasty.com.ng/account-deletion
 * (the Play Store "Data deletion" URL, which promises a response in 30 days).
 * Before this action existed the only delete paths were `deleteOwnAccount`
 * (self-service only, and 403 for admins) and `deleteAdminAccess` (admin
 * targets only), so honouring an emailed request meant raw SQL against
 * production.
 *
 * This is the exact mirror of `deleteAdminAccess`: that one refuses every
 * non-admin target, this one refuses every admin target. Between them every
 * role is covered exactly once, with no overlap and no gap.
 *
 * The `validateOffboardingEligibility` gates are kept deliberately, and there
 * is NO force/override flag by design. A partner still linked to a restaurant
 * would silently orphan the store (`RestaurantRecord.ownerId` is ON DELETE SET
 * NULL) and a rider with live work would strand a delivery — an override switch
 * would just make that one click away. The 412 text names what is blocking, and
 * the admin resolves it first (`updateUserRestaurantLink` to unlink the
 * restaurant, clearing the assignment for the rider) and then deletes.
 *
 * `reason` is free text and optional, but a deletion performed on someone
 * else's say-so needs a record of why: that audit detail is the compliance
 * evidence that the request existed.
 */
const deleteUserAccountOnRequest: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin']);
  const targetUid = sanitizeText(data.targetUid);
  if (!targetUid) {
    fail(400, 'A target uid is required.');
  }
  if (targetUid === context.uid) {
    fail(412, 'Delete your own account from the signed-in account settings, not from this console.');
  }

  const account = await loadUserAccount(targetUid);
  if (!account) {
    fail(404, 'The selected user could not be found.');
  }

  const roles = Array.from((await loadUserRoles([targetUid])).get(targetUid) ?? []);
  const resolvedRole = resolvePrimaryRole(account, roles);
  if (resolvedRole === 'admin') {
    fail(412, 'Admin accounts are removed with delete admin access, not with the on-request deletion flow.');
  }

  if (resolvedRole === 'restaurant' || resolvedRole === 'dispatch') {
    await validateOffboardingEligibility(targetUid, resolvedRole, account);
  }

  const reason = sanitizeOptionalText(data.reason)?.slice(0, DELETION_REASON_MAX_LENGTH) ?? null;

  // A third, distinct audit action so `self_account_deleted` (the user did it),
  // `admin_account_deleted` (an admin account was removed) and this one (an
  // admin did it for a non-admin user) stay separable in AdminAuditLog. Not
  // named "requested_*": `UserAccount.deletionRequestedAt` is the dormant
  // 30-day grace-period flag (see PENDING_DELETION_EXEMPT_ACTIONS in
  // rpc/actions.ts) and this path has nothing to do with it — it deletes now.
  await offboardUserAccount(targetUid, context.uid, 'assisted_account_deleted', {
    email: account.email,
    reason,
    role: resolvedRole,
  });

  return json(200, {
    data: {
      deleted: true,
      role: resolvedRole,
      targetUid,
    },
  });
};

export const accountDomain = defineRpcDomain<AuthenticatedRequestContext>({
  actions: ACCOUNT_ACTIONS,
  name: 'account',
  anonymousHandlers: {
    promoTrack,
    staffInviteCreateAccount,
    staffInviteResolve,
  },
  handlers: {
    assignUserRole,
    deleteAdminAccess,
    deleteOwnAccount,
    deleteUserAccountOnRequest,
    disableUserAccess,
    enableUserAccess,
    getFeatureFlags,
    getPolicyAcceptance,
    provisionStaffAccount,
    redeemStaffInvite,
    recordPolicyAcceptance: recordPolicyAcceptanceHandler,
    revokeUserRole,
    syncUserClaims,
    updateUserRestaurantLink,
  },
});
