// User accounts, role links, and the claim/role synchronisation that keeps the
// `UserAccount` row, the `UserRole` rows, and the Supabase auth app_metadata in
// agreement. Anything that changes who a user *is* lives here.

import { serviceClient } from './client.ts';
import type { JsonObject } from './rpc/coercion.ts';
import { nowIso, sanitizeOptionalText, sanitizeText, unique } from './rpc/coercion.ts';
import { updateSupabaseAuthUser } from './supabaseAdmin.ts';

export type UserAccountRow = {
  accountDisabled?: boolean | null;
  activeSessionId?: string | null;
  activeSessionUpdatedAt?: string | null;
  createdAt?: string | null;
  disabledAt?: string | null;
  disabledByUid?: string | null;
  displayName?: string | null;
  email: string;
  emailVerified?: boolean | null;
  lastPrivilegedRole?: string | null;
  partnerApplicationRejectionReason?: string | null;
  partnerApplicationReviewedAt?: string | null;
  partnerApplicationStatus?: string | null;
  dispatchApplicationRejectionReason?: string | null;
  dispatchApplicationReviewedAt?: string | null;
  dispatchApplicationStatus?: string | null;
  phoneNumber?: string | null;
  restaurantId?: string | null;
  restaurantLinkedAt?: string | null;
  restaurantLinkSource?: string | null;
  restaurantName?: string | null;
  roleDisplay?: string | null;
  uid: string;
  updatedAt?: string | null;
};

export type UserRoleRow = {
  assignedByUid?: string | null;
  restaurantId?: string | null;
  role: string;
  userId: string;
};

export const USER_ACCOUNT_COLUMNS =
  'uid,email,displayName,phoneNumber,emailVerified,roleDisplay,partnerApplicationStatus,partnerApplicationReviewedAt,partnerApplicationRejectionReason,dispatchApplicationStatus,dispatchApplicationReviewedAt,dispatchApplicationRejectionReason,activeSessionId,activeSessionUpdatedAt,accountDisabled,disabledAt,disabledByUid,lastPrivilegedRole,restaurantId,restaurantName,restaurantLinkedAt,restaurantLinkSource,createdAt,updatedAt';

// Deliberately narrower than _shared/roles.ts APP_ROLES: 'support' is a support
// desk claim, not a role an admin can hand out through assignUserRole.
export const APP_ROLES = ['customer', 'restaurant', 'dispatch', 'admin'] as const;
export const PRIVILEGED_APP_ROLES = new Set(['restaurant', 'dispatch', 'admin']);

export const isAppRole = (role: string) => (APP_ROLES as readonly string[]).includes(role);

const getRolePriority = (role: string) => {
  switch (role) {
    case 'admin':
      return 1;
    case 'restaurant':
      return 2;
    case 'dispatch':
      return 3;
    default:
      return 4;
  }
};

export const resolvePrimaryRole = (account: UserAccountRow | null, roles: UserRoleRow[]) => {
  const nextRole = [...roles].sort((left, right) => getRolePriority(left.role) - getRolePriority(right.role))[0]?.role;
  return sanitizeText(nextRole, sanitizeText(account?.roleDisplay, 'customer'));
};

export const buildUserAccountResponse = (account: UserAccountRow, roles: UserRoleRow[]) => ({
  activeSessionId: sanitizeOptionalText(account.activeSessionId),
  activeSessionUpdatedAt: account.activeSessionUpdatedAt ?? null,
  accountDisabled: account.accountDisabled === true,
  createdAt: account.createdAt ?? null,
  displayName: sanitizeOptionalText(account.displayName),
  disabledAt: account.disabledAt ?? null,
  disabledByUid: sanitizeOptionalText(account.disabledByUid),
  email: sanitizeText(account.email),
  emailVerified: account.emailVerified === true,
  lastPrivilegedRole: sanitizeOptionalText(account.lastPrivilegedRole),
  restaurantId: sanitizeOptionalText(account.restaurantId),
  restaurantLinkedAt: account.restaurantLinkedAt ?? null,
  restaurantLinkSource: sanitizeOptionalText(account.restaurantLinkSource),
  restaurantName: sanitizeOptionalText(account.restaurantName),
  role: resolvePrimaryRole(account, roles),
  uid: account.uid,
  updatedAt: account.updatedAt ?? null,
});

export const loadUserAccount = async (uid: string) => {
  const { data, error } = await serviceClient
    .from('UserAccount')
    .select(USER_ACCOUNT_COLUMNS)
    .eq('uid', uid)
    .maybeSingle<UserAccountRow>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? null;
};

export const loadUserPhoneNumber = async (uid: string) => {
  const safeUid = sanitizeText(uid);
  if (!safeUid) {
    return null;
  }

  const { data, error } = await serviceClient
    .from('UserAccount')
    .select('phoneNumber')
    .eq('uid', safeUid)
    .maybeSingle<Pick<UserAccountRow, 'phoneNumber'>>();

  if (error) {
    throw new Error(error.message);
  }

  return sanitizeOptionalText(data?.phoneNumber);
};

export const loadUserPhoneNumbers = async (uids: string[]) => {
  const phoneByUid = new Map<string, string | null>();
  const safeUids = unique(uids.map((uid) => sanitizeText(uid)).filter(Boolean));
  if (safeUids.length === 0) {
    return phoneByUid;
  }

  const { data, error } = await serviceClient
    .from('UserAccount')
    .select('uid,phoneNumber')
    .in('uid', safeUids);

  if (error) {
    throw new Error(error.message);
  }

  for (const row of (data ?? []) as Pick<UserAccountRow, 'uid' | 'phoneNumber'>[]) {
    phoneByUid.set(row.uid, sanitizeOptionalText(row.phoneNumber));
  }

  return phoneByUid;
};

export const loadUserRoles = async (userIds: string[]) => {
  if (userIds.length === 0) {
    return new Map<string, UserRoleRow[]>();
  }

  const { data, error } = await serviceClient
    .from('UserRole')
    .select('userId,role,restaurantId,assignedByUid')
    .in('userId', userIds);

  if (error) {
    throw new Error(error.message);
  }

  const rolesByUserId = new Map<string, UserRoleRow[]>();
  for (const role of (data ?? []) as UserRoleRow[]) {
    const bucket = rolesByUserId.get(role.userId) ?? [];
    bucket.push(role);
    rolesByUserId.set(role.userId, bucket);
  }

  return rolesByUserId;
};

export const upsertUserRoleLink = async (
  userId: string,
  role: string,
  restaurantId: string | null,
  assignedByUid: string | null = null
) => {
  const { error: deleteError } = await serviceClient
    .from('UserRole')
    .delete()
    .eq('userId', userId)
    .neq('role', role);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  const { error } = await serviceClient.from('UserRole').upsert(
    {
      userId,
      role,
      restaurantId,
      assignedByUid,
      updatedAt: nowIso(),
    },
    { onConflict: 'userId,role' }
  );

  if (error) {
    throw new Error(error.message);
  }
};

export const deleteUserRoleLinks = async (userId: string) => {
  const { error } = await serviceClient.from('UserRole').delete().eq('userId', userId);
  if (error) {
    throw new Error(error.message);
  }
};

export const updateUserAccount = async (uid: string, updates: JsonObject) => {
  const nextUpdates = {
    ...updates,
    updatedAt: nowIso(),
  };

  const { error } = await serviceClient.from('UserAccount').update(nextUpdates).eq('uid', uid);
  if (error) {
    throw new Error(error.message);
  }
};

export const upsertUserAccount = async (record: JsonObject) => {
  const nextRecord = {
    ...record,
    updatedAt: nowIso(),
  };

  const { error } = await serviceClient.from('UserAccount').upsert(nextRecord, { onConflict: 'uid' });
  if (error) {
    throw new Error(error.message);
  }
};

export const deleteUserAccount = async (uid: string) => {
  const { error } = await serviceClient.from('UserAccount').delete().eq('uid', uid);
  if (error) {
    throw new Error(error.message);
  }
};

/**
 * Single write path for "this user now has this role": role link, auth
 * app_metadata (so the next JWT carries the claim), and the denormalised
 * account fields. The auth update is deliberately swallowed — a role change
 * that lands in Postgres but not in auth is recoverable via syncUserClaims,
 * whereas a half-applied change is not.
 */
export const syncUserRoleState = async (
  targetUid: string,
  role: string,
  assignedByUid: string | null,
  options: {
    accountDisabled?: boolean;
    disabledAt?: string | null;
    disabledByUid?: string | null;
    lastPrivilegedRole?: string | null;
    restaurantId?: string | null;
    restaurantLinkedAt?: string | null;
    restaurantLinkSource?: string | null;
    restaurantName?: string | null;
  } = {}
) => {
  await upsertUserRoleLink(targetUid, role, options.restaurantId ?? null, assignedByUid);
  await updateSupabaseAuthUser(targetUid, {
    app_metadata: {
      app_role: role,
      role,
      user_role: role,
    },
    ...(options.accountDisabled === true ? { ban_duration: '876000h' } : { ban_duration: 'none' }),
  }).catch(() => undefined);
  await updateUserAccount(targetUid, {
    accountDisabled: options.accountDisabled === true,
    disabledAt: options.disabledAt ?? null,
    disabledByUid: options.disabledByUid ?? null,
    lastPrivilegedRole:
      options.lastPrivilegedRole !== undefined
        ? options.lastPrivilegedRole
        : PRIVILEGED_APP_ROLES.has(role)
          ? role
          : null,
    ...(options.restaurantId !== undefined ? { restaurantId: options.restaurantId } : null),
    ...(options.restaurantLinkedAt !== undefined ? { restaurantLinkedAt: options.restaurantLinkedAt } : null),
    ...(options.restaurantLinkSource !== undefined ? { restaurantLinkSource: options.restaurantLinkSource } : null),
    ...(options.restaurantName !== undefined ? { restaurantName: options.restaurantName } : null),
    roleDisplay: role,
    updatedAt: nowIso(),
  });
};
