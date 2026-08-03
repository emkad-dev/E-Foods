// Restaurant records and their approval state.
//
// `buildRestaurantResponse` is the single place a restaurant crosses the wire,
// which is what keeps CDN rewriting and the approved/published distinction
// consistent for customer, partner, and admin readers alike.

import { loadUserAccount, type UserAccountRow } from './accounts.ts';
import { serviceClient } from './client.ts';
import { toCdnImageUrl } from './media.ts';
import { sanitizeOptionalText, sanitizeText } from './rpc/coercion.ts';
import { fail } from './rpc/respond.ts';

export type RestaurantApprovalRow = {
  approvedAt?: string | null;
  approvedByUid?: string | null;
  restaurantId: string;
  status: string;
};

export type RestaurantRecordRow = {
  address?: string | null;
  closingTime?: string | null;
  createdAt?: string | null;
  cuisine?: string | null;
  deliveryFee?: number | null;
  deliveryRadiusKm?: number | null;
  deliveryTime?: string | null;
  description?: string | null;
  id: string;
  image?: string | null;
  logoImage?: string | null;
  isOpen?: boolean | null;
  isPublished?: boolean | null;
  latitude?: number | null;
  longitude?: number | null;
  menu?: unknown[] | null;
  minOrder?: number | null;
  name: string;
  nameKey?: string | null;
  openingTime?: string | null;
  ownerId?: string | null;
  paystackSubaccountCode?: string | null;
  supportsDelivery?: boolean | null;
  supportsPickup?: boolean | null;
  updatedAt?: string | null;
};

export const RESTAURANT_COLUMNS =
  'id,ownerId,name,nameKey,cuisine,address,description,image,logoImage,menu,deliveryFee,deliveryRadiusKm,deliveryTime,openingTime,closingTime,latitude,longitude,minOrder,paystackSubaccountCode,supportsDelivery,supportsPickup,isOpen,isPublished,createdAt,updatedAt';

export const RESTAURANT_APPROVAL_COLUMNS = 'restaurantId,status,approvedByUid,approvedAt';

export const DEFAULT_DELIVERY_TIME = '25-35 min';

export const normalizeOperatingTime = (value: unknown, fieldLabel: string) => {
  const nextValue = sanitizeOptionalText(value);
  if (!nextValue) {
    return null;
  }

  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(nextValue)) {
    fail(400, `${fieldLabel} must use 24-hour HH:mm format.`);
  }

  return nextValue;
};

export const buildRestaurantResponse = (
  restaurant: RestaurantRecordRow,
  approval: RestaurantApprovalRow | null = null
) => ({
  address: sanitizeOptionalText(restaurant.address),
  approvalStatus: approval?.status ?? (restaurant.isPublished ? 'approved' : 'pending'),
  approvedAt: approval?.approvedAt ?? null,
  approvedByUid: sanitizeOptionalText(approval?.approvedByUid),
  cuisine: sanitizeOptionalText(restaurant.cuisine),
  deliveryFee: restaurant.deliveryFee ?? 0,
  deliveryRadiusKm: restaurant.deliveryRadiusKm ?? null,
  deliveryTime: sanitizeOptionalText(restaurant.deliveryTime),
  closingTime: sanitizeOptionalText(restaurant.closingTime),
  description: sanitizeOptionalText(restaurant.description),
  id: restaurant.id,
  image: toCdnImageUrl(sanitizeOptionalText(restaurant.image)),
  logoImage: toCdnImageUrl(sanitizeOptionalText(restaurant.logoImage)),
  isOpen: restaurant.isOpen !== false,
  isPublished: restaurant.isPublished === true,
  latitude: restaurant.latitude ?? null,
  longitude: restaurant.longitude ?? null,
  menu: Array.isArray(restaurant.menu) ? restaurant.menu : [],
  minOrder: restaurant.minOrder ?? 0,
  name: sanitizeText(restaurant.name, 'Restaurant'),
  openingTime: sanitizeOptionalText(restaurant.openingTime),
  ownerId: sanitizeOptionalText(restaurant.ownerId),
  paystackSubaccountCode: sanitizeOptionalText(restaurant.paystackSubaccountCode),
  supportsDelivery: restaurant.supportsDelivery !== false,
  supportsPickup: restaurant.supportsPickup !== false,
  updatedAt: restaurant.updatedAt ?? null,
});

export const loadRestaurantById = async (restaurantId: string) => {
  const [{ data: restaurant, error: restaurantError }, { data: approval, error: approvalError }] = await Promise.all([
    serviceClient
      .from('RestaurantRecord')
      .select(RESTAURANT_COLUMNS)
      .eq('id', restaurantId)
      .maybeSingle<RestaurantRecordRow>(),
    serviceClient
      .from('RestaurantApproval')
      .select(RESTAURANT_APPROVAL_COLUMNS)
      .eq('restaurantId', restaurantId)
      .maybeSingle<RestaurantApprovalRow>(),
  ]);

  if (restaurantError) {
    throw new Error(restaurantError.message);
  }

  if (approvalError) {
    throw new Error(approvalError.message);
  }

  return {
    approval: approval ?? null,
    restaurant: restaurant ?? null,
  };
};

/**
 * Resolves the restaurant a partner (or admin) is acting for. The account's
 * explicit link wins; falling back to ownership keeps a partner who has not
 * been linked yet from seeing an empty workspace. An admin with no link falls
 * back to the most recently updated restaurant of all.
 */
export const loadManagedRestaurantForUser = async (
  uid: string,
  role: string,
  userAccount: UserAccountRow | null = null
) => {
  const account = userAccount ?? (await loadUserAccount(uid));
  const linkedRestaurantId = sanitizeText(account?.restaurantId);

  if (linkedRestaurantId) {
    const linkedRestaurant = await loadRestaurantById(linkedRestaurantId);
    if (linkedRestaurant.restaurant) {
      return linkedRestaurant;
    }
  }

  const query = serviceClient
    .from('RestaurantRecord')
    .select(RESTAURANT_COLUMNS)
    .order('updatedAt', { ascending: false })
    .limit(1);

  const filteredQuery = role === 'admin' ? query : query.eq('ownerId', uid);
  const { data: restaurants, error } = await filteredQuery;

  if (error) {
    throw new Error(error.message);
  }

  const restaurant = ((restaurants ?? []) as RestaurantRecordRow[])[0] ?? null;
  if (!restaurant) {
    return {
      approval: null,
      restaurant: null,
    };
  }

  const { data: approval, error: approvalError } = await serviceClient
    .from('RestaurantApproval')
    .select(RESTAURANT_APPROVAL_COLUMNS)
    .eq('restaurantId', restaurant.id)
    .maybeSingle<RestaurantApprovalRow>();

  if (approvalError) {
    throw new Error(approvalError.message);
  }

  return {
    approval: approval ?? null,
    restaurant,
  };
};
