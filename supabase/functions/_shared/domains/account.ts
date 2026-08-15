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
import { broadcastRidersChanged } from '../realtime.ts';
import { loadManagedRestaurantForUser, loadRestaurantById } from '../restaurants.ts';
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
  updateSupabaseAuthUser,
} from '../supabaseAdmin.ts';

type Handler = RpcHandler<AuthenticatedRequestContext>;

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

  let authUser = await findSupabaseAuthUserByEmail(email);
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

export const accountDomain = defineRpcDomain<AuthenticatedRequestContext>({
  actions: ACCOUNT_ACTIONS,
  name: 'account',
  anonymousHandlers: {
    promoTrack,
  },
  handlers: {
    assignUserRole,
    deleteAdminAccess,
    deleteOwnAccount,
    disableUserAccess,
    enableUserAccess,
    getPolicyAcceptance,
    provisionStaffAccount,
    recordPolicyAcceptance: recordPolicyAcceptanceHandler,
    revokeUserRole,
    syncUserClaims,
    updateUserRestaurantLink,
  },
});
