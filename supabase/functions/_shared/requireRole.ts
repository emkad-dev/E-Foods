import { verifySupabaseJwt } from './auth.ts';
import { ClientSafeError } from './observability.ts';
import { hasAllowedRole, roleFromClaims } from './roles.ts';

export { APP_ROLES, hasAllowedRole, roleFromClaims } from './roles.ts';

export const requireRole = async (request: Request, allowed: readonly string[]) => {
  const { claims, token } = await verifySupabaseJwt(request); // throws ClientSafeError(401) itself
  if (!hasAllowedRole(claims, allowed)) {
    throw new ClientSafeError(403, 'You do not have permission to perform this action.');
  }
  return { claims, token, role: roleFromClaims(claims) as string };
};
