import type { UserDocument } from '../../domain/entities';
import { supabase } from './config';

const USER_PROFILE_COLUMNS =
  'uid,email,displayName,phoneNumber,photoURL,emailVerified,role,partnerApplicationStatus,partnerApplicationReviewedAt,partnerApplicationRejectionReason,dispatchApplicationStatus,dispatchApplicationReviewedAt,dispatchApplicationRejectionReason,expoPushToken,pushTokenUpdatedAt,activeSessionId,activeSessionUpdatedAt,accountDisabled,disabledAt,disabledByUid,lastPrivilegedRole,restaurantId,restaurantName,restaurantLinkedAt,restaurantLinkSource,createdAt,updatedAt';

const mapProfile = (record: Record<string, any>): UserDocument => ({
  uid: record.uid,
  email: record.email,
  role: record.role,
  emailVerified: record.emailVerified === true,
  displayName: record.displayName ?? undefined,
  phoneNumber: record.phoneNumber ?? undefined,
  partnerApplicationStatus: record.partnerApplicationStatus ?? undefined,
  partnerApplicationReviewedAt: record.partnerApplicationReviewedAt ?? null,
  partnerApplicationRejectionReason: record.partnerApplicationRejectionReason ?? null,
  dispatchApplicationStatus: record.dispatchApplicationStatus ?? undefined,
  dispatchApplicationReviewedAt: record.dispatchApplicationReviewedAt ?? null,
  dispatchApplicationRejectionReason: record.dispatchApplicationRejectionReason ?? null,
  photoURL: record.photoURL ?? undefined,
  restaurantId: record.restaurantId ?? undefined,
  restaurantName: record.restaurantName ?? undefined,
  restaurantLinkedAt: record.restaurantLinkedAt ?? undefined,
  restaurantLinkSource: record.restaurantLinkSource ?? undefined,
  expoPushToken: record.expoPushToken ?? undefined,
  pushTokenUpdatedAt: record.pushTokenUpdatedAt ?? undefined,
  activeSessionId: record.activeSessionId ?? null,
  activeSessionUpdatedAt: record.activeSessionUpdatedAt ?? null,
  accountDisabled: record.accountDisabled === true,
  disabledAt: record.disabledAt ?? null,
  disabledByUid: record.disabledByUid ?? null,
  lastPrivilegedRole: record.lastPrivilegedRole ?? null,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt ?? undefined,
});

export const getUserDocument = async (userId: string): Promise<UserDocument | null> => {
  const { data, error } = await supabase.from('user_profiles').select(USER_PROFILE_COLUMNS).eq('uid', userId).maybeSingle();

  if (error) {
    throw error;
  }

  return data ? mapProfile(data) : null;
};

export const createUserDocument = async (
  userId: string,
  userData: Partial<UserDocument>
): Promise<UserDocument> => {
  const baseRecord = {
    uid: userId,
    email: userData.email ?? '',
    displayName: userData.displayName ?? null,
    photoURL: userData.photoURL ?? null,
    phoneNumber: userData.phoneNumber ?? null,
    emailVerified: userData.emailVerified === true,
    roleDisplay: userData.role ?? 'customer',
    createdAt: userData.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const { error: profileError } = await supabase.from('UserAccount').upsert(baseRecord, {
    onConflict: 'uid',
  });

  if (profileError) {
    throw profileError;
  }

  const { error: roleError } = await supabase.from('UserRole').upsert(
    {
      userId,
      role: userData.role ?? 'customer',
    },
    {
      onConflict: 'userId,role',
    }
  );

  if (roleError) {
    throw roleError;
  }

  const nextUser = await getUserDocument(userId);

  if (!nextUser) {
    throw new Error('Customer profile was created but could not be reloaded from Supabase.');
  }

  return nextUser;
};

export const updateUserDocument = async (
  userId: string,
  updates: Partial<UserDocument>
): Promise<void> => {
  const nextUpdates = {
    ...(updates.displayName !== undefined ? { displayName: updates.displayName ?? null } : null),
    ...(updates.photoURL !== undefined ? { photoURL: updates.photoURL ?? null } : null),
    ...(updates.phoneNumber !== undefined ? { phoneNumber: updates.phoneNumber ?? null } : null),
    ...(updates.expoPushToken !== undefined ? { expoPushToken: updates.expoPushToken ?? null } : null),
    ...(updates.pushTokenUpdatedAt !== undefined
      ? { pushTokenUpdatedAt: updates.pushTokenUpdatedAt ?? null }
      : null),
    ...(updates.activeSessionId !== undefined ? { activeSessionId: updates.activeSessionId } : null),
    ...(updates.activeSessionUpdatedAt !== undefined
      ? { activeSessionUpdatedAt: updates.activeSessionUpdatedAt ?? null }
      : null),
    updatedAt: new Date().toISOString(),
  };

  const { error } = await supabase.from('UserAccount').update(nextUpdates).eq('uid', userId);

  if (error) {
    throw error;
  }
};
