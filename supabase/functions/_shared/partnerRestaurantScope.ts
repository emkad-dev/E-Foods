export type PartnerRestaurantScopeInput = {
  role: string;
  uid: string;
  linkedRestaurantId: string;
};

export type PartnerRestaurantScope = {
  /** When set, restrict the RestaurantRecord query to this ownerId. Null means no filter. */
  ownerFilterUid: string | null;
  /** A restaurant the caller is linked to but may not own; fetched separately and merged in. */
  extraRestaurantId: string | null;
};

export const resolvePartnerRestaurantScope = ({
  role,
  uid,
  linkedRestaurantId,
}: PartnerRestaurantScopeInput): PartnerRestaurantScope => {
  if (role === 'admin') {
    return { ownerFilterUid: null, extraRestaurantId: null };
  }

  return {
    ownerFilterUid: uid,
    extraRestaurantId: linkedRestaurantId || null,
  };
};

export type ClaimRestaurantLinkInput = {
  role: string;
  uid: string;
  linkedRestaurantId: string;
  restaurantId: string;
  restaurantOwnerId: string;
};

export const canClaimRestaurantLink = ({
  role,
  uid,
  linkedRestaurantId,
  restaurantId,
  restaurantOwnerId,
}: ClaimRestaurantLinkInput): boolean => {
  if (role === 'admin') {
    return true;
  }

  if (restaurantOwnerId) {
    return restaurantOwnerId === uid;
  }

  // Unowned rows are only claimable by the partner the application flow already assigned.
  return Boolean(linkedRestaurantId) && linkedRestaurantId === restaurantId;
};

export const dedupeRestaurantRowsById = <T extends { id: string }>(rows: T[]): T[] => {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const row of rows) {
    if (seen.has(row.id)) {
      continue;
    }

    seen.add(row.id);
    deduped.push(row);
  }

  return deduped;
};
