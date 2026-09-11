import type { AppRole } from '../../../../packages/domain/src';
import { callAdminRpc } from '../lib/rpc';

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

type DeleteAdminAccessResult = {
  deleted: boolean;
  role: AppRole;
  targetUid: string;
};

export const assignUserRole = (targetUid: string, role: AppRole, restaurantId?: string | null) =>
  callAdminRpc<RoleMutationResult>('assignUserRole', {
    restaurantId: restaurantId?.trim() ? restaurantId.trim() : null,
    role,
    targetUid,
  });

export const revokeUserRole = (targetUid: string) => callAdminRpc<RoleMutationResult>('revokeUserRole', { targetUid });

export const provisionStaffAccount = (input: {
  displayName?: string;
  email: string;
  password: string;
  role: Extract<AppRole, 'restaurant' | 'dispatch' | 'admin'>;
  restaurantId?: string | null;
}) => callAdminRpc<ProvisionStaffResult>('provisionStaffAccount', input);

export const updateUserRestaurantLink = (targetUid: string, restaurantId?: string | null) =>
  callAdminRpc<{ restaurantId: string | null; targetUid: string; tokenRefreshRequired: boolean }>(
    'updateUserRestaurantLink',
    {
      restaurantId: restaurantId?.trim() ? restaurantId.trim() : null,
      targetUid,
    }
  );

export const disableUserAccess = (targetUid: string) =>
  callAdminRpc<DisableAccessResult>('disableUserAccess', { targetUid });

export const enableUserAccess = (targetUid: string) =>
  callAdminRpc<EnableAccessResult>('enableUserAccess', { targetUid });

export const deleteAdminAccess = (targetUid: string) =>
  callAdminRpc<DeleteAdminAccessResult>('deleteAdminAccess', { targetUid });

/**
 * Honours a deletion request from a NON-admin account holder who cannot reach
 * the in-app flow (see https://feasty.com.ng/account-deletion). `reason` is
 * recorded in the audit entry and is the compliance evidence that the request
 * existed, so it is sent whenever the operator supplied one.
 */
export const deleteUserAccountOnRequest = (targetUid: string, reason?: string | null) =>
  callAdminRpc<DeleteAdminAccessResult>('deleteUserAccountOnRequest', {
    reason: reason?.trim() ? reason.trim() : null,
    targetUid,
  });
