// roles.ts — mirrors packages/domain/src/roles.ts (Deno cannot import the monorepo package).
export const APP_ROLES = ['customer', 'restaurant', 'dispatch', 'admin', 'support'] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const isAppRole = (v: unknown): v is AppRole =>
  typeof v === 'string' && (APP_ROLES as readonly string[]).includes(v);

export const roleFromClaims = (claims: Record<string, unknown>): string | null => {
  const candidate = claims['user_role'] ?? claims['role'] ?? claims['app_role'];
  return isAppRole(candidate) ? candidate : null;
};

export const hasAllowedRole = (claims: Record<string, unknown>, allowed: readonly string[]): boolean => {
  const role = roleFromClaims(claims);
  return role !== null && allowed.includes(role);
};
