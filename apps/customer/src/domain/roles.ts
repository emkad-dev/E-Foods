export const APP_ROLES = ['customer', 'restaurant', 'dispatch'] as const;

export type AppRole = (typeof APP_ROLES)[number];

export const DEFAULT_APP_ROLE: AppRole = 'customer';

export const isAppRole = (value: unknown): value is AppRole =>
  typeof value === 'string' && APP_ROLES.includes(value as AppRole);
