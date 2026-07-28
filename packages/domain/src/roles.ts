export const APP_ROLES = ['customer', 'restaurant', 'dispatch', 'admin', 'support'] as const;

export type AppRole = (typeof APP_ROLES)[number];
