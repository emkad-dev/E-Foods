import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase/config';
import type { AppRole } from '../domain/entities';

type RoleMutationResult = {
  role: AppRole;
  targetUid: string;
  tokenRefreshRequired: boolean;
};

type ProvisionStaffResult = {
  created: boolean;
  email: string;
  role: AppRole;
  targetUid: string;
  tokenRefreshRequired: boolean;
};

type DisableAccessResult = {
  disabled: boolean;
  role: AppRole;
  targetUid: string;
};

type EnableAccessResult = {
  enabled: boolean;
  role: AppRole;
  targetUid: string;
  tokenRefreshRequired: boolean;
};

const assignUserRoleCallable = httpsCallable<
  {
    targetUid: string;
    role: AppRole;
  },
  RoleMutationResult
>(functions, 'assignUserRole');

const revokeUserRoleCallable = httpsCallable<
  {
    targetUid: string;
  },
  RoleMutationResult
>(functions, 'revokeUserRole');

const syncUserClaimsCallable = httpsCallable<
  {
    targetUid?: string;
  },
  RoleMutationResult
>(functions, 'syncUserClaims');

const provisionStaffAccountCallable = httpsCallable<
  {
    displayName?: string;
    email: string;
    password: string;
    role: Extract<AppRole, 'restaurant' | 'dispatch' | 'admin'>;
  },
  ProvisionStaffResult
>(functions, 'provisionStaffAccount');

const disableUserAccessCallable = httpsCallable<
  {
    targetUid: string;
  },
  DisableAccessResult
>(functions, 'disableUserAccess');

const enableUserAccessCallable = httpsCallable<
  {
    targetUid: string;
  },
  EnableAccessResult
>(functions, 'enableUserAccess');

export const assignUserRole = async (targetUid: string, role: AppRole) => {
  const result = await assignUserRoleCallable({ role, targetUid });
  return result.data;
};

export const revokeUserRole = async (targetUid: string) => {
  const result = await revokeUserRoleCallable({ targetUid });
  return result.data;
};

export const syncUserClaims = async (targetUid?: string) => {
  const result = await syncUserClaimsCallable(targetUid ? { targetUid } : {});
  return result.data;
};

export const provisionStaffAccount = async (input: {
  displayName?: string;
  email: string;
  password: string;
  role: Extract<AppRole, 'restaurant' | 'dispatch' | 'admin'>;
}) => {
  const result = await provisionStaffAccountCallable(input);
  return result.data;
};

export const disableUserAccess = async (targetUid: string) => {
  const result = await disableUserAccessCallable({ targetUid });
  return result.data;
};

export const enableUserAccess = async (targetUid: string) => {
  const result = await enableUserAccessCallable({ targetUid });
  return result.data;
};
