export type CachedUserProfile = {
  uid?: string | null;
  role?: string | null;
};

type ShouldHydrateCachedUserProfileArgs = {
  sessionUserId: string | null | undefined;
  cachedUser: CachedUserProfile | null;
  expectedRole: string;
};

export const shouldHydrateCachedUserProfile = ({
  sessionUserId,
  cachedUser,
  expectedRole,
}: ShouldHydrateCachedUserProfileArgs): boolean => {
  if (!sessionUserId || !cachedUser) {
    return false;
  }

  return cachedUser.uid === sessionUserId && cachedUser.role === expectedRole;
};
