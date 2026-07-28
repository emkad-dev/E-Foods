import type { AppRole } from '../../domain/src/roles';

export type AuthRole = AppRole;

export interface SupabaseRuntimeEnv {
  anonKey?: string;
  projectRef?: string;
  url?: string;
}

export interface SupabaseAuthProfile {
  accountDisabled?: boolean;
  activeSessionId?: string | null;
  activeSessionUpdatedAt?: string | null;
  createdAt?: string;
  disabledAt?: string | null;
  disabledByUid?: string | null;
  dispatchApplicationRejectionReason?: string | null;
  dispatchApplicationReviewedAt?: string | null;
  dispatchApplicationStatus?: string | null;
  displayName?: string | null;
  email: string;
  emailVerified: boolean;
  expoPushToken?: string | null;
  lastPrivilegedRole?: AppRole | null;
  partnerApplicationRejectionReason?: string | null;
  partnerApplicationReviewedAt?: string | null;
  partnerApplicationStatus?: string | null;
  phoneNumber?: string | null;
  photoURL?: string | null;
  pushTokenUpdatedAt?: string | null;
  restaurantId?: string | null;
  restaurantLinkedAt?: string | null;
  restaurantLinkSource?: string | null;
  restaurantName?: string | null;
  role: AppRole;
  uid: string;
  updatedAt?: string | null;
}
