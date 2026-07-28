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
