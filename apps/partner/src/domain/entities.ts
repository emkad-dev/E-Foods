export type AppRole = 'customer' | 'restaurant' | 'dispatch';

export interface UserDocument {
  uid: string;
  email: string;
  role: AppRole;
  emailVerified: boolean;
  displayName?: string;
  photoURL?: string;
  restaurantId?: string;
  restaurantName?: string;
  activeSessionId?: string | null;
  activeSessionUpdatedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
}
