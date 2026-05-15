import type { Session, User } from '@supabase/supabase-js';
import { APP_ROLES, type AppRole } from '../../domain/src/roles';

const isAppRole = (value: unknown): value is AppRole =>
  typeof value === 'string' && APP_ROLES.includes(value as AppRole);

const getRoleCandidate = (user: Pick<User, 'app_metadata'> | null | undefined) => {
  if (!user) {
    return null;
  }

  return (
    user.app_metadata?.user_role ??
    user.app_metadata?.role ??
    user.app_metadata?.app_role ??
    null
  );
};

export const getSupabaseUserRole = (user: Pick<User, 'app_metadata'> | null | undefined): AppRole | null => {
  const candidate = getRoleCandidate(user);
  return isAppRole(candidate) ? candidate : null;
};

export const getSupabaseSessionRole = (session: Session | null): AppRole | null =>
  getSupabaseUserRole(session?.user ?? null);
