export type AppRole = 'customer' | 'restaurant' | 'dispatch';

export interface UserDocument {
  uid: string;
  email: string;
  role: AppRole;
  emailVerified: boolean;
  displayName?: string;
  photoURL?: string;
  activeSessionId?: string | null;
  activeSessionUpdatedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
}
