export const COLLECTIONS = {
  addresses: 'addresses',
  categories: 'categories',
  dispatchProfiles: 'dispatchProfiles',
  deals: 'deals',
  orderAssignments: 'orderAssignments',
  orders: 'orders',
  restaurants: 'restaurants',
  users: 'users',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
