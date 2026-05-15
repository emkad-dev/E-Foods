import type { AppRole } from '../domain/entities';
import { callAdminBackendRpc } from './backendRpc';

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

export const assignUserRole = async (targetUid: string, role: AppRole) =>
  callAdminBackendRpc<RoleMutationResult>('assignUserRole', { role, targetUid });

export const revokeUserRole = async (targetUid: string) =>
  callAdminBackendRpc<RoleMutationResult>('revokeUserRole', { targetUid });

export const syncUserClaims = async (targetUid?: string) =>
  callAdminBackendRpc<RoleMutationResult>('syncUserClaims', targetUid ? { targetUid } : undefined);

export const provisionStaffAccount = async (input: {
  displayName?: string;
  email: string;
  password: string;
  role: Extract<AppRole, 'restaurant' | 'dispatch' | 'admin'>;
}) => callAdminBackendRpc<ProvisionStaffResult>('provisionStaffAccount', input);

export const disableUserAccess = async (targetUid: string) =>
  callAdminBackendRpc<DisableAccessResult>('disableUserAccess', { targetUid });

export const enableUserAccess = async (targetUid: string) =>
  callAdminBackendRpc<EnableAccessResult>('enableUserAccess', { targetUid });
