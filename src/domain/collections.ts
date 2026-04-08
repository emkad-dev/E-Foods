export const COLLECTIONS = {
  addresses: 'addresses',
  categories: 'categories',
  dispatchProfiles: 'dispatchProfiles',
  orderAssignments: 'orderAssignments',
  orders: 'orders',
  promotions: 'promotions',
  restaurants: 'restaurants',
  users: 'users',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
