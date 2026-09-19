// Partner domain: a restaurant's own workspace — profile, menu, kitchen queue,
// order transitions, and the onboarding application that gets it there.

import { loadUserAccount, loadUserPhoneNumber, loadUserPhoneNumbers, syncUserRoleState, updateUserAccount, upsertUserAccount, upsertUserRoleLink } from '../accounts.ts';
import {
  PARTNER_APPLICATION_STATUS,
  loadPartnerApplication,
} from '../applications.ts';
import { createAuditEntry } from '../auditLog.ts';
import { buildTransactionalEmailHtml, sendTransactionalEmail } from '../email.ts';
import {
  STAFF_INVITE_TTL_HOURS,
  generateStaffInviteCode,
  hashStaffInviteCode,
  isStaffInviteExpired,
} from '../staffInviteCodes.ts';
import { serviceClient } from '../client.ts';
import { releaseDispatchAssignmentLoad, runAutomaticDispatchAssignment } from '../dispatchSelection.ts';
import { buildNotificationData, notifyAdmins, notifyUsers } from '../notifications.ts';
import { logEdgeEvent } from '../observability.ts';
import {
  CUSTOMER_ORDER_COLUMNS,
  PAYMENT_PROVIDER_CASH,
  PAYMENT_STATUS,
  ORDER_STATUS,
  TERMINAL_ORDER_STATUSES,
  assertNonTerminalOrder,
  assertOrderPaymentReadyForOperations,
  insertDeliveryEvent,
  isOrderCleanForReporting,
  loadOrderBundle,
  loadOrderRelations,
  maybeExpireUnpaidOrder,
  normalizeOrderStatus,
  toOrderSnapshotResponse,
  updateOrderRecordIfStatus,
  type CustomerOrderRow,
} from '../orders.ts';
import { resolvePartnerSubmitOutcome } from '../partnerApplicationTransitions.ts';
import {
  buildPartnerVerificationUploadRequest,
  derivePartnerDocumentHash,
  derivePartnerDocumentLast4,
  normalizePartnerOnboardingDocumentType,
  validatePartnerOnboardingSubmission,
} from '../partnerOnboarding.ts';
import {
  canClaimRestaurantLink,
  dedupeRestaurantRowsById,
  resolvePartnerRestaurantScope,
} from '../partnerRestaurantScope.ts';
import { assertPaystackConfigured, resolvePaystackBankAccount } from '../paystack.ts';
import { validatePolicyAcceptancePayload, recordPolicyAcceptance } from '../policyAcceptance.ts';
import { loadDispatchWeights } from '../platformSettings.ts';
import { broadcastRestaurantsChanged } from '../realtime.ts';
import {
  DEFAULT_DELIVERY_TIME,
  RESTAURANT_APPROVAL_COLUMNS,
  RESTAURANT_COLUMNS,
  buildRestaurantResponse,
  loadManagedRestaurantForUser,
  loadRestaurantById,
  normalizeOperatingTime,
  type RestaurantApprovalRow,
  type RestaurantRecordRow,
} from '../restaurants.ts';
import { PARTNER_ACTIONS } from '../rpc/actions.ts';
import type { JsonObject } from '../rpc/coercion.ts';
import {
  buildNameKey,
  nowIso,
  parseInteger,
  parseNumber,
  roundCurrency,
  sanitizeOptionalText,
  sanitizeText,
  toSortableTimestamp,
} from '../rpc/coercion.ts';
import { ensureRole, type AuthenticatedRequestContext } from '../rpc/context.ts';
import { defineRpcDomain, type RpcHandler } from '../rpc/registry.ts';
import { fail, json } from '../rpc/respond.ts';

type Handler = RpcHandler<AuthenticatedRequestContext>;

const getPartnerKitchenPriority = (order: CustomerOrderRow) => {
  const status = normalizeOrderStatus(order.status);

  if (status === ORDER_STATUS.PLACED) {
    return 0;
  }

  if (status === ORDER_STATUS.ACCEPTED) {
    return 1;
  }

  if (status === ORDER_STATUS.PREPARING) {
    return 2;
  }

  if (status === ORDER_STATUS.READY_FOR_PICKUP) {
    return 3;
  }

  if (([ORDER_STATUS.PICKED_UP, ORDER_STATUS.ON_THE_WAY] as readonly string[]).includes(status)) {
    return 4;
  }

  return 5;
};

/** Terminal orders sink to the bottom; live orders sort by kitchen stage, then age. */
const sortPartnerKitchenQueue = (orders: CustomerOrderRow[]) =>
  [...orders].sort((left, right) => {
    const leftStatus = normalizeOrderStatus(left.status);
    const rightStatus = normalizeOrderStatus(right.status);
    const leftTerminal = TERMINAL_ORDER_STATUSES.has(leftStatus);
    const rightTerminal = TERMINAL_ORDER_STATUSES.has(rightStatus);

    if (leftTerminal !== rightTerminal) {
      return leftTerminal ? 1 : -1;
    }

    if (leftTerminal && rightTerminal) {
      return toSortableTimestamp(right.updatedAt ?? right.createdAt) - toSortableTimestamp(left.updatedAt ?? left.createdAt);
    }

    const priorityDelta = getPartnerKitchenPriority(left) - getPartnerKitchenPriority(right);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return toSortableTimestamp(left.createdAt) - toSortableTimestamp(right.createdAt);
  });

const buildPartnerStatusUpdate = (currentStatus: string, action: string) => {
  const currentTimelineAt = nowIso();

  switch (action) {
    case 'accept':
      if (currentStatus !== ORDER_STATUS.PLACED) {
        fail(412, 'Only newly placed orders can be accepted.');
      }

      return {
        status: ORDER_STATUS.ACCEPTED,
        timelinePatch: {
          acceptedAt: currentTimelineAt,
        },
      };
    case 'preparing':
      if (!([ORDER_STATUS.PLACED, ORDER_STATUS.ACCEPTED] as readonly string[]).includes(currentStatus)) {
        fail(412, 'Only accepted orders can move into preparation.');
      }

      return {
        status: ORDER_STATUS.PREPARING,
        timelinePatch: {
          ...(currentStatus === ORDER_STATUS.PLACED ? { acceptedAt: currentTimelineAt } : {}),
          preparingAt: currentTimelineAt,
        },
      };
    case 'ready':
      if (!([ORDER_STATUS.ACCEPTED, ORDER_STATUS.PREPARING] as readonly string[]).includes(currentStatus)) {
        fail(412, 'Only active kitchen orders can be marked ready.');
      }

      return {
        status: ORDER_STATUS.READY_FOR_PICKUP,
        timelinePatch: {
          ...(currentStatus === ORDER_STATUS.ACCEPTED ? { preparingAt: currentTimelineAt } : {}),
          readyAt: currentTimelineAt,
        },
      };
    case 'delivered':
      // Restaurants that self-provision delivery (and pickup handoffs) complete
      // their own orders — no platform rider is involved.
      if (!([ORDER_STATUS.PREPARING, ORDER_STATUS.READY_FOR_PICKUP] as readonly string[]).includes(currentStatus)) {
        fail(412, 'Only orders that are ready can be marked delivered.');
      }

      return {
        status: ORDER_STATUS.DELIVERED,
        timelinePatch: {
          ...(currentStatus === ORDER_STATUS.PREPARING ? { readyAt: currentTimelineAt } : {}),
          deliveredAt: currentTimelineAt,
        },
      };
    case 'reject':
      if (!([ORDER_STATUS.PLACED, ORDER_STATUS.ACCEPTED] as readonly string[]).includes(currentStatus)) {
        fail(412, 'Only active incoming orders can be rejected.');
      }

      return {
        status: ORDER_STATUS.REJECTED,
        timelinePatch: {
          cancelledAt: currentTimelineAt,
        },
      };
    default:
      fail(400, 'Unsupported partner order action.');
  }
};

const normalizePartnerMenuInput = (menu: unknown) => {
  const allowedMenuCategories = new Map([
    ['rice', 'Rice'],
    ['swallow', 'Swallow'],
    ['soups', 'Soups'],
    ['proteins', 'Proteins'],
    ['snacks', 'Snacks'],
    ['drinks', 'Drinks'],
  ]);

  const inferMenuCategoryId = (value: string) => {
    const normalizedValue = value.trim().toLowerCase();

    if (/(rice|jollof|ofada|biryani)/.test(normalizedValue)) {
      return 'rice';
    }

    if (/(swallow|amala|eba|fufu|semo|pounded yam)/.test(normalizedValue)) {
      return 'swallow';
    }

    if (/(soup|egusi|efo|ogbono|banga|okra|oha|afang)/.test(normalizedValue)) {
      return 'soups';
    }

    if (/(chicken|beef|fish|turkey|goat|suya|protein|meat)/.test(normalizedValue)) {
      return 'proteins';
    }

    if (/(drink|juice|water|soda|zobo|smoothie|tea|coffee)/.test(normalizedValue)) {
      return 'drinks';
    }

    return 'snacks';
  };

  if (!Array.isArray(menu)) {
    fail(400, 'Menu payload must be an array of categories.');
  }

  return menu.map((category, categoryIndex) => {
    const categoryRecord = category as JsonObject;
    const categoryName = sanitizeText(categoryRecord.category);

    if (!categoryName) {
      fail(400, `Menu category ${categoryIndex + 1} needs a valid category name.`);
    }

    const items = Array.isArray(categoryRecord.items) ? categoryRecord.items : [];
    if (items.length === 0) {
      fail(400, `Menu category "${categoryName}" must include at least one item.`);
    }

    return {
      category: categoryName,
      items: items.map((item, itemIndex) => {
        const itemRecord = item as JsonObject;
        const itemId = sanitizeText(itemRecord.id);
        const itemName = sanitizeText(itemRecord.name);
        const itemDescription = sanitizeOptionalText(itemRecord.description) ?? '';
        const itemPrice = roundCurrency(parseNumber(itemRecord.price, Number.NaN));
        const rawCategoryId = sanitizeOptionalText(itemRecord.categoryId)?.toLowerCase();
        const fallbackCategoryId = inferMenuCategoryId(
          sanitizeOptionalText(itemRecord.categoryLabel) ?? rawCategoryId ?? categoryName
        );
        const categoryId = rawCategoryId && allowedMenuCategories.has(rawCategoryId) ? rawCategoryId : fallbackCategoryId;
        const categoryLabel = allowedMenuCategories.get(categoryId);

        if (!itemId || !itemName || !Number.isFinite(itemPrice) || itemPrice <= 0) {
          fail(
            400,
            `Menu item ${itemIndex + 1} in "${categoryName}" is missing a valid id, name, or price.`
          );
        }

        if (!categoryLabel) {
          fail(
            400,
            `Menu item ${itemIndex + 1} in "${categoryName}" has an unsupported customer category.`
          );
        }

        const itemIsAvailable = itemRecord.isAvailable !== false;

        return {
          categoryId,
          categoryLabel,
          description: itemDescription,
          id: itemId,
          image: sanitizeOptionalText(itemRecord.image),
          isAvailable: itemIsAvailable,
          name: itemName,
          price: itemPrice,
          // Preserved (not re-derived) so a full-menu save — editing one
          // item's price, or removing another item, both round-trip the
          // WHOLE menu through this normalizer — never silently clears a
          // DIFFERENT item's timed unavailability set via the lightweight
          // partnerSetMenuItemAvailability action. Forced to null whenever
          // isAvailable is true, matching that action's own invariant: an
          // available item never carries a stale unavailableUntil.
          unavailableUntil: itemIsAvailable ? null : sanitizeOptionalText(itemRecord.unavailableUntil),
        };
      }),
    };
  });
};

const buildPartnerRestaurantPayload = (
  input: Record<string, unknown>,
  uid: string,
  options: { allowPublish?: boolean; existingPublished?: boolean } = {}
) => {
  const name = sanitizeText(input.name);
  const allowPublish = options.allowPublish === true;
  const existingPublished = options.existingPublished === true;

  if (!name) {
    fail(400, 'A restaurant name is required.');
  }

  const supportsDelivery = input.supportsDelivery !== false;
  const supportsPickup = input.supportsPickup !== false;
  if (!supportsDelivery && !supportsPickup) {
    fail(400, 'Enable delivery, pickup, or both before saving.');
  }

  const latitude = input.latitude === null || input.latitude === undefined ? null : parseNumber(input.latitude, Number.NaN);
  const longitude = input.longitude === null || input.longitude === undefined ? null : parseNumber(input.longitude, Number.NaN);
  const hasLatitude = latitude !== null;
  const hasLongitude = longitude !== null;

  if (hasLatitude !== hasLongitude) {
    fail(400, 'Provide both latitude and longitude together.');
  }

  if (hasLatitude && (!Number.isFinite(latitude) || !Number.isFinite(longitude))) {
    fail(400, 'Use valid numeric coordinates for the restaurant.');
  }

  const address = sanitizeText(input.address);
  if (!address) {
    fail(400, 'A restaurant address is required.');
  }

  const openingTime = normalizeOperatingTime(input.openingTime, 'Opening time');
  const closingTime = normalizeOperatingTime(input.closingTime, 'Closing time');

  if (!openingTime || !closingTime) {
    fail(400, 'Add both opening and closing time before saving.');
  }

  return {
    address,
    closingTime,
    cuisine: sanitizeOptionalText(input.cuisine) ?? '',
    deliveryFee: roundCurrency(parseNumber(input.deliveryFee, 0)),
    deliveryRadiusKm:
      input.deliveryRadiusKm === null || input.deliveryRadiusKm === undefined
        ? null
        : roundCurrency(parseNumber(input.deliveryRadiusKm, 0)),
    deliveryTime: sanitizeText(input.deliveryTime, DEFAULT_DELIVERY_TIME),
    description: sanitizeOptionalText(input.description) ?? '',
    image: sanitizeOptionalText(input.image) ?? '',
    logoImage: sanitizeOptionalText(input.logoImage) ?? '',
    isOpen: input.isOpen !== false,
    isPublished:
      allowPublish && input.isPublished !== undefined ? input.isPublished === true : existingPublished,
    latitude,
    longitude,
    minOrder: roundCurrency(parseNumber(input.minOrder, 0)),
    name,
    nameKey: buildNameKey(name),
    openingTime,
    ownerId: uid,
    supportsDelivery,
    supportsPickup,
  };
};

const partnerGetRestaurantContext: Handler = async ({ context }) => {
  ensureRole(context.role, ['restaurant', 'admin']);
  const userAccount = await loadUserAccount(context.uid);
  const linkedRestaurantId = sanitizeText(userAccount?.restaurantId);
  const scope = resolvePartnerRestaurantScope({
    role: context.role,
    uid: context.uid,
    linkedRestaurantId,
  });

  const restaurantColumns = RESTAURANT_COLUMNS;

  const scopedQuery = serviceClient
    .from('RestaurantRecord')
    .select(restaurantColumns)
    .order('updatedAt', { ascending: false });

  const allRestaurants = await (scope.ownerFilterUid
    ? scopedQuery.eq('ownerId', scope.ownerFilterUid)
    : scopedQuery);

  if (allRestaurants.error) {
    throw new Error(allRestaurants.error.message);
  }

  const ownedRows = (allRestaurants.data ?? []) as RestaurantRecordRow[];
  let restaurantRows = ownedRows;

  if (scope.extraRestaurantId && !ownedRows.some((row) => row.id === scope.extraRestaurantId)) {
    const { data: linkedRow, error: linkedRowError } = await serviceClient
      .from('RestaurantRecord')
      .select(restaurantColumns)
      .eq('id', scope.extraRestaurantId)
      .maybeSingle<RestaurantRecordRow>();

    if (linkedRowError) {
      throw new Error(linkedRowError.message);
    }

    if (linkedRow) {
      restaurantRows = dedupeRestaurantRowsById([...ownedRows, linkedRow]);
    }
  }
  const managedRestaurant = await loadManagedRestaurantForUser(context.uid, context.role, userAccount);
  let approvalByRestaurantId = new Map<string, RestaurantApprovalRow>();

  if (restaurantRows.length > 0) {
    const { data: restaurantApprovals, error: restaurantApprovalError } = await serviceClient
      .from('RestaurantApproval')
      .select(RESTAURANT_APPROVAL_COLUMNS)
      .in(
        'restaurantId',
        restaurantRows.map((restaurant) => restaurant.id)
      );

    if (restaurantApprovalError) {
      throw new Error(restaurantApprovalError.message);
    }

    approvalByRestaurantId = new Map(
      ((restaurantApprovals ?? []) as RestaurantApprovalRow[]).map((approval) => [approval.restaurantId, approval])
    );
  }

  const allResponses = restaurantRows.map((restaurant) =>
    buildRestaurantResponse(restaurant, approvalByRestaurantId.get(restaurant.id) ?? null)
  );
  const restaurantResponse = managedRestaurant.restaurant
    ? buildRestaurantResponse(managedRestaurant.restaurant, managedRestaurant.approval)
    : null;
  const claimableRestaurants = allResponses.filter((restaurant) => {
    const candidate = restaurant as ReturnType<typeof buildRestaurantResponse>;
    return !candidate.ownerId || candidate.ownerId === context.uid || candidate.id === managedRestaurant.restaurant?.id;
  });

  return json(200, {
    data: {
      claimableRestaurants,
      requiresVerifiedLink: Boolean(
        restaurantResponse && linkedRestaurantId && linkedRestaurantId !== restaurantResponse.id
      ),
      restaurant: restaurantResponse,
      restaurants: allResponses,
    },
  });
};

const partnerGetRestaurantOrders: Handler = async ({ context }) => {
  ensureRole(context.role, ['restaurant', 'admin']);
  const managedRestaurant = await loadManagedRestaurantForUser(context.uid, context.role);
  if (!managedRestaurant.restaurant) {
    return json(200, {
      data: {
        orders: [],
        restaurant: null,
      },
    });
  }

  const { data: orders, error } = await serviceClient
    .from('CustomerOrder')
    .select(CUSTOMER_ORDER_COLUMNS)
    .eq('restaurantId', managedRestaurant.restaurant.id)
    .order('createdAt', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const orderList = sortPartnerKitchenQueue(
    (await Promise.all(((orders ?? []) as CustomerOrderRow[]).map((order) => maybeExpireUnpaidOrder(order))))
      .filter(isOrderCleanForReporting)
  );
  const { assignmentsByOrderId, itemsByOrderId } = await loadOrderRelations(orderList.map((order) => order.id));
  const customerPhoneByUid = await loadUserPhoneNumbers(orderList.map((order) => order.customerId));

  return json(200, {
    data: {
      orders: orderList.map((order) =>
        toOrderSnapshotResponse(
          order,
          itemsByOrderId.get(order.id) ?? [],
          assignmentsByOrderId.get(order.id) ?? null,
          [],
          { customerPhone: customerPhoneByUid.get(order.customerId) ?? null }
        )
      ),
      restaurant: buildRestaurantResponse(managedRestaurant.restaurant, managedRestaurant.approval),
    },
  });
};

/** One page of feedback. Capped for the same reason every other list here is. */
const RESTAURANT_RATINGS_MAX_LIMIT = 50;

/**
 * What customers actually said about this restaurant.
 *
 * WHY IT EXISTS: OrderRating has been collecting scores and comments, and
 * RestaurantRecord.ratingAverage has been moving, with no way for the
 * restaurant to see either. Being rated without being told is not feedback.
 *
 * WHAT IS DELIBERATELY WITHHELD: `customerId`. The restaurant learns WHAT was
 * said, never WHO said it. A one-star review attached to a name -- on a
 * platform where that name also carries a delivery address the restaurant can
 * read off the order -- is a retaliation surface, and no part of this feature
 * needs it. `orderId` is withheld for the same reason: it is one join away
 * from the customer, and the restaurant already has its own order list.
 *
 * `courierScore` is withheld because it is not theirs. It rates the rider.
 */
const partnerGetRestaurantRatings: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['restaurant', 'admin']);
  const managedRestaurant = await loadManagedRestaurantForUser(context.uid, context.role);

  if (!managedRestaurant.restaurant) {
    return json(200, { data: { ratingAverage: null, ratingCount: 0, ratings: [], hasMore: false } });
  }

  const limit = Math.min(Math.max(parseInteger(data.limit, 20), 1), RESTAURANT_RATINGS_MAX_LIMIT);
  const offset = Math.max(parseInteger(data.offset, 0), 0);

  const { data: rows, error } = await serviceClient
    .from('OrderRating')
    .select('id,restaurantScore,comment,createdAt')
    .eq('restaurantId', managedRestaurant.restaurant.id)
    .order('createdAt', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(error.message);
  }

  const ratings = (rows ?? []) as Array<{
    comment?: string | null;
    createdAt: string;
    id: string;
    restaurantScore: number;
  }>;

  return json(200, {
    data: {
      // The stored aggregate, not a recomputation over this page -- the page is
      // twenty rows and the average is over all of them.
      ratingAverage: managedRestaurant.restaurant.ratingAverage ?? null,
      ratingCount: managedRestaurant.restaurant.ratingCount ?? 0,
      ratings: ratings.map((rating) => ({
        comment: sanitizeOptionalText(rating.comment),
        createdAt: rating.createdAt,
        id: rating.id,
        restaurantScore: rating.restaurantScore,
      })),
      hasMore: ratings.length === limit,
    },
  });
};

/**
 * Invite a staff member to this restaurant.
 *
 * Everything that decides authority comes from the CALLER, never the request:
 * the restaurant from loadManagedRestaurantForUser, the role as the literal
 * 'restaurant'. The body supplies an email address and nothing else that
 * matters. That is the whole difference between this and
 * provisionStaffAccount, which reads both from the body and must stay
 * admin-only.
 *
 * The invite creates no account and grants nothing by itself. It is a pointer
 * an already-signed-in user can redeem for themselves.
 */
const partnerInviteStaff: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['restaurant']);
  const managedRestaurant = await loadManagedRestaurantForUser(context.uid, context.role);

  if (!managedRestaurant.restaurant) {
    fail(412, 'Finish setting up your store before inviting staff.');
  }

  const email = sanitizeText(data.email).trim().toLowerCase();

  if (!email || !email.includes('@') || email.length > 254) {
    fail(400, 'Enter the email address of the person you are inviting.');
  }

  // Inviting yourself is a no-op that would read as a broken feature when the
  // code never unlocks anything.
  const ownerAccount = await loadUserAccount(context.uid);
  if (sanitizeText(ownerAccount?.email).toLowerCase() === email) {
    fail(400, 'That is your own address - you already have access.');
  }

  const restaurantId = managedRestaurant.restaurant.id;
  const now = new Date();
  const inviteId = crypto.randomUUID();
  const code = generateStaffInviteCode();
  const codeHash = await hashStaffInviteCode(inviteId, code);
  const expiresAt = new Date(now.getTime() + STAFF_INVITE_TTL_HOURS * 60 * 60 * 1000).toISOString();

  // Supersede any live invite for this address first. The partial unique index
  // allows exactly one pending row per (restaurant, email), and re-inviting
  // somebody -- after a typo, or because the first code expired -- has to work.
  const { error: supersedeError } = await serviceClient
    .from('StaffInvite')
    .update({ status: 'revoked', updatedAt: now.toISOString() })
    .eq('restaurantId', restaurantId)
    .eq('email', email)
    .eq('status', 'pending');

  if (supersedeError) {
    throw new Error(supersedeError.message);
  }

  const { error: insertError } = await serviceClient.from('StaffInvite').insert({
    id: inviteId,
    restaurantId,
    email,
    codeHash,
    role: 'restaurant',
    invitedByUid: context.uid,
    status: 'pending',
    expiresAt,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });

  if (insertError) {
    throw new Error(insertError.message);
  }

  const restaurantName = sanitizeText(managedRestaurant.restaurant.name, 'a FEASTY restaurant');

  // Sent AFTER the row exists. The other order loses the code entirely if the
  // insert fails, leaving somebody holding a number nothing will accept.
  await sendTransactionalEmail({
    to: email,
    subject: 'Your code to join ' + restaurantName + ' on FEASTY',
    html: buildTransactionalEmailHtml({
      heading: 'Join ' + restaurantName + ' on FEASTY',
      lines: [
        restaurantName + ' has invited you to help manage their store on FEASTY.',
        'Your invite code is ' + code + '. It expires in ' + STAFF_INVITE_TTL_HOURS + ' hours.',
        'Create your own FEASTY partner account with this email address, then enter the code to get access. You choose your own password, and nobody at the restaurant can see it.',
        'If you were not expecting this, ignore this email. The code grants nothing until someone signs in with this address and enters it.',
      ],
    }),
  });

  await createAuditEntry(context.uid, 'staff_invited', 'restaurant', restaurantId, {
    // The address is the subject of the record. The CODE is never logged.
    email,
    inviteId,
  });

  return json(200, { data: { email, expiresAt, inviteId } });
};

/** Who can act for this restaurant, and who has been asked to. */
const partnerListStaff: Handler = async ({ context }) => {
  ensureRole(context.role, ['restaurant']);
  const managedRestaurant = await loadManagedRestaurantForUser(context.uid, context.role);

  if (!managedRestaurant.restaurant) {
    return json(200, { data: { invites: [], staff: [] } });
  }

  const restaurantId = managedRestaurant.restaurant.id;

  const [{ data: inviteRows, error: inviteError }, { data: staffRows, error: staffError }] = await Promise.all([
    serviceClient
      .from('StaffInvite')
      .select('id,email,status,expiresAt,createdAt,acceptedAt')
      .eq('restaurantId', restaurantId)
      .order('createdAt', { ascending: false })
      .limit(50),
    serviceClient
      .from('UserAccount')
      .select('uid,email,displayName,accountDisabled')
      .eq('restaurantId', restaurantId),
  ]);

  if (inviteError) {
    throw new Error(inviteError.message);
  }
  if (staffError) {
    throw new Error(staffError.message);
  }

  const now = new Date();

  return json(200, {
    data: {
      invites: ((inviteRows ?? []) as Array<Record<string, string | null>>).map((invite) => ({
        acceptedAt: invite.acceptedAt ?? null,
        createdAt: invite.createdAt,
        email: invite.email,
        expiresAt: invite.expiresAt,
        id: invite.id,
        // Derived, not stored. A pending row whose window has closed is
        // expired whatever the column says, and no sweep runs on this table --
        // so without this a dead invite would keep looking live forever.
        status:
          invite.status === 'pending' && isStaffInviteExpired(invite.expiresAt, now)
            ? 'expired'
            : invite.status,
      })),
      staff: ((staffRows ?? []) as Array<Record<string, unknown>>)
        .filter((account) => sanitizeText(String(account.uid)) !== context.uid)
        .map((account) => ({
          disabled: account.accountDisabled === true,
          displayName: sanitizeOptionalText(account.displayName),
          email: sanitizeOptionalText(account.email),
          uid: sanitizeText(String(account.uid)),
        })),
    },
  });
};

/** Cancel an invite that has not been redeemed. */
const partnerRevokeStaffInvite: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['restaurant']);
  const managedRestaurant = await loadManagedRestaurantForUser(context.uid, context.role);

  if (!managedRestaurant.restaurant) {
    fail(404, 'No restaurant is linked to this account.');
  }

  const inviteId = sanitizeText(data.inviteId);
  if (!inviteId) {
    fail(400, 'An invite id is required.');
  }

  // Scoped by restaurantId inside the WHERE clause rather than checked after
  // the read: a partner must not be able to revoke another restaurant's invite
  // by guessing an id, and the query is the place to guarantee that.
  const { data: updated, error } = await serviceClient
    .from('StaffInvite')
    .update({ status: 'revoked', updatedAt: nowIso() })
    .eq('id', inviteId)
    .eq('restaurantId', managedRestaurant.restaurant.id)
    .eq('status', 'pending')
    .select('id');

  if (error) {
    throw new Error(error.message);
  }

  if (!updated || updated.length === 0) {
    fail(404, 'That invite is no longer pending.');
  }

  await createAuditEntry(context.uid, 'staff_invite_revoked', 'restaurant', managedRestaurant.restaurant.id, {
    inviteId,
  });

  return json(200, { data: { inviteId, status: 'revoked' } });
};

/**
 * Remove a staff member's access to this restaurant.
 *
 * The counterpart to inviting, and the reason the feature is worth having: an
 * owner who can add staff but never remove them is worse off than one shared
 * password, because the set of people who can act for the restaurant only ever
 * grows.
 *
 * This unlinks and drops the role. It deliberately does NOT delete the account
 * or touch the password -- their FEASTY login is theirs, and the restaurant's
 * authority over it stops at its own door.
 */
const partnerRevokeStaffAccess: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['restaurant']);
  const managedRestaurant = await loadManagedRestaurantForUser(context.uid, context.role);

  if (!managedRestaurant.restaurant) {
    fail(404, 'No restaurant is linked to this account.');
  }

  const targetUid = sanitizeText(data.targetUid);
  if (!targetUid) {
    fail(400, 'A staff member is required.');
  }

  if (targetUid === context.uid) {
    // Removing yourself would strand the restaurant with nobody able to reach
    // its own console.
    fail(400, 'You cannot remove your own access.');
  }

  const account = await loadUserAccount(targetUid);
  if (!account || sanitizeText(account.restaurantId) !== managedRestaurant.restaurant.id) {
    // One message for "no such user" and "not your staff". Splitting them
    // turns this endpoint into an oracle for which uids exist.
    fail(404, 'That person does not have access to this restaurant.');
  }

  await syncUserRoleState(targetUid, 'customer', context.uid, {
    restaurantId: null,
    restaurantLinkedAt: null,
    restaurantLinkSource: null,
    restaurantName: null,
  });

  await createAuditEntry(context.uid, 'staff_access_revoked', 'user', targetUid, {
    restaurantId: managedRestaurant.restaurant.id,
  });

  return json(200, { data: { targetUid } });
};

const partnerGetRestaurantOrder: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['restaurant', 'admin']);
  const orderId = sanitizeText(data.orderId);
  if (!orderId) {
    fail(400, 'An order id is required.');
  }

  const managedRestaurant = await loadManagedRestaurantForUser(context.uid, context.role);
  const bundle = await loadOrderBundle(orderId);
  if (!bundle) {
    fail(404, 'The selected order could not be found.');
  }

  if (!managedRestaurant.restaurant || managedRestaurant.restaurant.id !== bundle.order.restaurantId) {
    fail(403, 'This order does not belong to your restaurant profile.');
  }

  assertOrderPaymentReadyForOperations(bundle.order);

  const customerPhone = await loadUserPhoneNumber(bundle.order.customerId);

  return json(200, {
    data: {
      order: toOrderSnapshotResponse(bundle.order, bundle.items, bundle.assignment, [], { customerPhone }),
    },
  });
};

const upsertPartnerRestaurantProfile: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['restaurant', 'admin']);
  const requestedRestaurantId = sanitizeText(data.restaurantId);
  const userAccount = await loadUserAccount(context.uid);
  const linkedRestaurantId = sanitizeText(userAccount?.restaurantId);
  const isAdmin = context.role === 'admin';

  let currentRestaurant: RestaurantRecordRow | null = null;
  let restaurantId = requestedRestaurantId || linkedRestaurantId || crypto.randomUUID();

  if (requestedRestaurantId || linkedRestaurantId) {
    const existingRestaurant = await loadRestaurantById(restaurantId);
    currentRestaurant = existingRestaurant.restaurant;
    if (!currentRestaurant) {
      fail(404, 'The selected restaurant could not be found.');
    }

    const existingOwnerId = sanitizeText(currentRestaurant.ownerId);
    if (
      !canClaimRestaurantLink({
        role: context.role,
        uid: context.uid,
        linkedRestaurantId,
        restaurantId,
        restaurantOwnerId: existingOwnerId,
      })
    ) {
      fail(403, 'This restaurant is not available to link to this partner account.');
    }
  }

  const profile = buildPartnerRestaurantPayload(data, context.uid, {
    allowPublish: true,
    existingPublished: currentRestaurant?.isPublished === true,
  });

  const savedAt = nowIso();
  const { error } = await serviceClient.from('RestaurantRecord').upsert(
    {
      id: restaurantId,
      ownerId: context.uid,
      name: profile.name,
      nameKey: profile.nameKey,
      cuisine: profile.cuisine,
      address: profile.address,
      description: profile.description,
      image: profile.image,
      logoImage: profile.logoImage,
      deliveryFee: profile.deliveryFee,
      deliveryRadiusKm: profile.deliveryRadiusKm,
      deliveryTime: profile.deliveryTime,
      openingTime: profile.openingTime,
      closingTime: profile.closingTime,
      latitude: profile.latitude,
      longitude: profile.longitude,
      minOrder: profile.minOrder,
      supportsDelivery: profile.supportsDelivery,
      supportsPickup: profile.supportsPickup,
      isOpen: profile.isOpen,
      isPublished: profile.isPublished,
      createdAt: currentRestaurant?.createdAt ?? savedAt,
      updatedAt: savedAt,
    },
    { onConflict: 'id' }
  );

  if (error) {
    throw new Error(error.message);
  }

  await broadcastRestaurantsChanged({ restaurantId });

  await updateUserAccount(context.uid, {
    restaurantId,
    restaurantLinkedAt: savedAt,
    restaurantLinkSource: currentRestaurant ? 'partner_update' : 'partner_create',
    restaurantName: profile.name,
    updatedAt: savedAt,
  });

  await upsertUserRoleLink(context.uid, context.role, restaurantId, isAdmin ? context.uid : null);
  await createAuditEntry(
    context.uid,
    currentRestaurant ? 'restaurant_profile_updated' : 'restaurant_profile_created',
    'restaurant',
    restaurantId,
    { isAdmin }
  );

  return json(200, {
    data: {
      id: restaurantId,
      name: profile.name,
    },
  });
};

const claimPartnerRestaurantLink: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['restaurant', 'admin']);
  const restaurantId = sanitizeText(data.restaurantId);
  if (!restaurantId) {
    fail(400, 'A restaurant id is required.');
  }

  const existingRestaurant = await loadRestaurantById(restaurantId);
  if (!existingRestaurant.restaurant) {
    fail(404, 'The selected restaurant could not be found.');
  }

  const existingOwnerId = sanitizeText(existingRestaurant.restaurant.ownerId);
  const claimantAccount = await loadUserAccount(context.uid);
  const claimantLinkedRestaurantId = sanitizeText(claimantAccount?.restaurantId);

  if (
    !canClaimRestaurantLink({
      role: context.role,
      uid: context.uid,
      linkedRestaurantId: claimantLinkedRestaurantId,
      restaurantId,
      restaurantOwnerId: existingOwnerId,
    })
  ) {
    fail(403, 'This restaurant is not available to link to this partner account.');
  }

  const linkedAt = nowIso();
  const { error: restaurantError } = await serviceClient
    .from('RestaurantRecord')
    .update({
      ownerId: context.uid,
      updatedAt: linkedAt,
    })
    .eq('id', restaurantId);

  if (restaurantError) {
    throw new Error(restaurantError.message);
  }

  await broadcastRestaurantsChanged({ restaurantId });

  await updateUserAccount(context.uid, {
    restaurantId,
    restaurantLinkedAt: linkedAt,
    restaurantLinkSource: 'partner_claim',
    restaurantName: sanitizeText(existingRestaurant.restaurant.name, 'Restaurant'),
    updatedAt: linkedAt,
  });

  await upsertUserRoleLink(
    context.uid,
    context.role,
    restaurantId,
    context.role === 'admin' ? context.uid : null
  );
  await createAuditEntry(context.uid, 'restaurant_link_claimed', 'restaurant', restaurantId, {
    isAdmin: context.role === 'admin',
  });

  return json(200, {
    data: {
      id: restaurantId,
      name: sanitizeText(existingRestaurant.restaurant.name, 'Restaurant'),
    },
  });
};

const upsertPartnerRestaurantMenu: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['restaurant', 'admin']);
  const restaurantId = sanitizeText(data.restaurantId);
  if (!restaurantId) {
    fail(400, 'A restaurant id is required.');
  }

  const menu = normalizePartnerMenuInput(data.menu);
  const existingRestaurant = await loadRestaurantById(restaurantId);
  if (!existingRestaurant.restaurant) {
    fail(404, 'The selected restaurant could not be found.');
  }

  if (
    context.role !== 'admin' &&
    sanitizeText(existingRestaurant.restaurant.ownerId) !== context.uid
  ) {
    fail(403, 'You are not allowed to update this restaurant\'s menu.');
  }

  const { error } = await serviceClient
    .from('RestaurantRecord')
    .update({
      menu,
      updatedAt: nowIso(),
    })
    .eq('id', restaurantId);

  if (error) {
    throw new Error(error.message);
  }

  await broadcastRestaurantsChanged({ restaurantId });

  await createAuditEntry(context.uid, 'partner_menu_upserted', 'restaurant', restaurantId, {
    categories: menu.length,
    items: menu.reduce((sum, category) => sum + category.items.length, 0),
  });

  return json(200, {
    data: {
      categories: menu.length,
      items: menu.reduce((sum, category) => sum + category.items.length, 0),
      restaurantId,
    },
  });
};

/**
 * Task 16 (F2): marks a single menu item available/unavailable, indefinitely
 * (isAvailable=false, no unavailableUntil) or for a bounded window
 * (unavailableUntil in the future — auto-resumes at read time, see
 * ../availability.ts). Deliberately a targeted JSONB patch of one item
 * inside the existing menu, NOT a re-run through upsertPartnerRestaurantMenu
 * / normalizePartnerMenuInput's full-menu validation — the brief calls for
 * "two taps", and re-validating (and potentially re-inferring the category
 * of) every other item on every toggle would be needless blast radius for a
 * single-field flip.
 */
const partnerSetMenuItemAvailability: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['restaurant', 'admin']);
  const restaurantId = sanitizeText(data.restaurantId);
  const itemId = sanitizeText(data.itemId);

  if (!restaurantId) {
    fail(400, 'A restaurant id is required.');
  }
  if (!itemId) {
    fail(400, 'A menu item id is required.');
  }
  if (typeof data.isAvailable !== 'boolean') {
    fail(400, 'An isAvailable flag is required.');
  }

  const isAvailable = data.isAvailable === true;
  // The manual, indefinite form clears any stale unavailableUntil so a
  // previously-timed window can never resurrect itself after a partner
  // explicitly turns an item back on; the timed form requires a real,
  // future, parseable timestamp.
  let unavailableUntil: string | null = null;
  if (!isAvailable) {
    const rawUntil = sanitizeOptionalText(data.unavailableUntil);
    if (rawUntil) {
      const parsedMs = Date.parse(rawUntil);
      if (Number.isNaN(parsedMs)) {
        fail(400, 'unavailableUntil must be a valid date/time.');
      }
      if (parsedMs <= Date.now()) {
        fail(400, 'unavailableUntil must be in the future.');
      }
      unavailableUntil = rawUntil;
    }
  }

  const existingRestaurant = await loadRestaurantById(restaurantId);
  if (!existingRestaurant.restaurant) {
    fail(404, 'The selected restaurant could not be found.');
  }

  if (
    context.role !== 'admin' &&
    sanitizeText(existingRestaurant.restaurant.ownerId) !== context.uid
  ) {
    fail(403, 'You are not allowed to update this restaurant\'s menu.');
  }

  const menu = Array.isArray(existingRestaurant.restaurant.menu) ? existingRestaurant.restaurant.menu : [];
  let itemName = '';
  let found = false;

  const nextMenu = menu.map((category) => {
    const categoryRecord = category as JsonObject;
    const items = Array.isArray(categoryRecord.items) ? categoryRecord.items : [];

    return {
      ...categoryRecord,
      items: items.map((item) => {
        const itemRecord = item as JsonObject;
        if (sanitizeText(itemRecord.id) !== itemId) {
          return item;
        }

        found = true;
        itemName = sanitizeText(itemRecord.name, 'This item');
        return {
          ...itemRecord,
          isAvailable,
          unavailableUntil,
        };
      }),
    };
  });

  if (!found) {
    fail(404, 'The selected menu item could not be found.');
  }

  const { error } = await serviceClient
    .from('RestaurantRecord')
    .update({
      menu: nextMenu,
      updatedAt: nowIso(),
    })
    .eq('id', restaurantId);

  if (error) {
    throw new Error(error.message);
  }

  // Task 5's realtime — an open customer catalog/detail screen updates
  // without a poll the instant a kitchen marks an item out of stock.
  await broadcastRestaurantsChanged({ restaurantId });

  await createAuditEntry(
    context.uid,
    isAvailable ? 'partner_menu_item_available' : 'partner_menu_item_unavailable',
    'restaurant',
    restaurantId,
    { itemId, itemName, unavailableUntil }
  );

  return json(200, {
    data: {
      isAvailable,
      itemId,
      itemName,
      restaurantId,
      unavailableUntil,
    },
  });
};

/**
 * Task 16 (F2): pauses/unpauses the whole store. Pausing always requires a
 * future `pausedUntil` — there is no indefinite store-level pause, unlike the
 * item-level manual-off form, because an entire store silently staying
 * closed forever with no reminder is a worse failure mode than a kitchen
 * having to tap "pause" again after their estimate runs out. Unpausing
 * (paused=false) always clears `pausedUntil` outright, regardless of what a
 * client sends for it.
 */
const partnerSetStorePause: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['restaurant', 'admin']);
  const restaurantId = sanitizeText(data.restaurantId);

  if (!restaurantId) {
    fail(400, 'A restaurant id is required.');
  }
  if (typeof data.paused !== 'boolean') {
    fail(400, 'A paused flag is required.');
  }

  const paused = data.paused === true;
  let pausedUntil: string | null = null;

  if (paused) {
    const rawUntil = sanitizeOptionalText(data.pausedUntil);
    if (!rawUntil) {
      fail(400, 'A pausedUntil time is required to pause the store.');
    }
    const parsedMs = Date.parse(rawUntil);
    if (Number.isNaN(parsedMs)) {
      fail(400, 'pausedUntil must be a valid date/time.');
    }
    if (parsedMs <= Date.now()) {
      fail(400, 'pausedUntil must be in the future.');
    }
    pausedUntil = rawUntil;
  }

  const existingRestaurant = await loadRestaurantById(restaurantId);
  if (!existingRestaurant.restaurant) {
    fail(404, 'The selected restaurant could not be found.');
  }

  if (
    context.role !== 'admin' &&
    sanitizeText(existingRestaurant.restaurant.ownerId) !== context.uid
  ) {
    fail(403, 'You are not allowed to update this restaurant.');
  }

  const { error } = await serviceClient
    .from('RestaurantRecord')
    .update({
      pausedUntil,
      updatedAt: nowIso(),
    })
    .eq('id', restaurantId);

  if (error) {
    throw new Error(error.message);
  }

  await broadcastRestaurantsChanged({ restaurantId });

  await createAuditEntry(
    context.uid,
    paused ? 'partner_store_paused' : 'partner_store_unpaused',
    'restaurant',
    restaurantId,
    { pausedUntil }
  );

  return json(200, {
    data: {
      paused,
      pausedUntil,
      restaurantId,
    },
  });
};

const partnerUpdateOrderStatus: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['restaurant', 'admin']);
  const orderId = sanitizeText(data.orderId);
  const nextAction = sanitizeText(data.action);
  if (!orderId) {
    fail(400, 'An order id is required.');
  }

  const managedRestaurant = await loadManagedRestaurantForUser(context.uid, context.role);
  const bundle = await loadOrderBundle(orderId);
  if (!bundle) {
    fail(404, 'The selected order could not be found.');
  }

  if (!managedRestaurant.restaurant || managedRestaurant.restaurant.id !== bundle.order.restaurantId) {
    fail(403, 'This order does not belong to your restaurant profile.');
  }

  assertNonTerminalOrder(bundle.order);
  assertOrderPaymentReadyForOperations(bundle.order);

  // The RAW stored status (the compare-and-swap key for the write below) and
  // the normalized one (what the transition is validated against) both derive
  // from a single deref of bundle.order.status.
  const observedStatus = sanitizeText(bundle.order.status);
  const currentStatus = normalizeOrderStatus(observedStatus);
  const nextState = buildPartnerStatusUpdate(currentStatus, nextAction);
  const timeline = {
    ...(bundle.order.timeline ?? {}),
    ...nextState.timelinePatch,
  };

  const payment = { ...(bundle.order.payment ?? {}) } as JsonObject;

  // Restaurant self-provisions delivery: when it completes the order, a cash
  // order is collected on handoff.
  if (nextState.status === ORDER_STATUS.DELIVERED && sanitizeText(payment.method, 'cash') === 'cash') {
    payment.capturedAmount = roundCurrency(parseNumber((bundle.order.pricing ?? {}).total, 0));
    payment.lastEvent = 'cash_collected_on_delivery';
    payment.paidAt = nowIso();
    payment.processor = PAYMENT_PROVIDER_CASH;
    payment.reference = sanitizeText(payment.reference, `CASH-${orderId.slice(-6).toUpperCase()}`);
    payment.status = PAYMENT_STATUS.PAID;
  }

  // Compare-and-swap on the status this transition was computed from. bundle is
  // a stale snapshot (loadOrderBundle does a plain read, no FOR UPDATE), and the
  // write below is the money-critical one: `accept` overwrites payment + status,
  // and the acceptance-deadline sweep (Task 14 / E3) can cancel + refund a
  // `placed` order concurrently. Without this guard, T0 read `placed` -> T1
  // sweep commits `cancelled` + refund -> T2 this unconditional write resurrects
  // the order to `accepted` with the stale paid payment, erasing the refund.
  // Guarding here covers every partner transition (accept/reject/preparing/
  // ready/delivered), which all share this one write and the same stale read.
  const applied = await updateOrderRecordIfStatus(orderId, observedStatus, {
    payment,
    status: nextState.status,
    timeline,
    updatedAt: nowIso(),
  });

  if (!applied) {
    fail(409, 'This order changed while you were updating it. Reload the order and try again.');
  }

  await insertDeliveryEvent({
    orderId,
    eventType: `partner_${nextAction}`,
    actorUid: context.uid,
    details: {
      nextStatus: nextState.status,
    },
  });
  await notifyUsers([bundle.order.customerId], {
    title: 'Order update',
    body: `Order ${orderId.slice(-6).toUpperCase()} is now ${nextState.status.replace(/_/g, ' ')}.`,
    data: buildNotificationData({
      app: 'customer',
      orderId,
      routeKey: 'customer_order_detail',
      status: nextState.status,
      type: 'order_update',
    }),
  });

  // Automatic dispatch assignment: this is the call site (Task 9 / D1) - the
  // moment a delivery order becomes actionable for a rider is exactly when
  // the restaurant commits an accepted/preparing/ready_for_pickup
  // transition, which only ever happens here. Calling it after every
  // transition (not just 'accept') doubles as the retry the brief asks for:
  // an order that hit an empty pool on accept gets another automatic attempt
  // for free on preparing/ready, with no separate poller needed.
  //
  // Deliberately non-fatal: the restaurant's status transition has already
  // been committed above. A selection failure must never unwind that - the
  // order stays accepted and a human can assign a courier manually via
  // dispatchAssignOrderCourier.
  // `bundle`/`nextState` are already validated non-null above (the `!bundle`
  // and switch-exhaustive `fail()` guards) - the `!` assertions here match
  // the pre-existing pattern throughout this file, where deno check cannot
  // prove that a `fail()` (typed `never`) narrows away a `const` across the
  // subsequent `await`s (tracked as baseline debt, not something this task
  // takes on for the whole file).
  try {
    const statusTimelinePatch = nextState!.timelinePatch as {
      acceptedAt?: unknown;
      preparingAt?: unknown;
      readyAt?: unknown;
    };
    const statusChangedAtIso = sanitizeText(
      statusTimelinePatch.acceptedAt ?? statusTimelinePatch.preparingAt ?? statusTimelinePatch.readyAt
    );

    await runAutomaticDispatchAssignment(
      bundle!.order,
      bundle!.assignment,
      context.uid,
      nextState!.status,
      loadDispatchWeights,
      statusChangedAtIso || null
    );
  } catch (error) {
    logEdgeEvent('error', 'automatic dispatch assignment failed', {
      error: error instanceof Error ? error.message : String(error),
      orderId,
      status: nextState!.status,
    });
  }

  // Release the assigned rider's load on the two terminal transitions this
  // handler can produce. This is the platform's default flow for a
  // self-delivering restaurant: accept -> auto-assign increments a rider's
  // activeLoad -> the restaurant marks the order delivered from the partner
  // app, never touching the dispatch app at all. Nothing else releases that
  // load on this path (dispatchUpdateOrderStatus's own decrement only fires
  // when a *dispatcher* marks delivered/failed), so without this the load
  // climbs without bound on every order a self-delivering restaurant
  // completes, and the scorer - which weights activeLoad at 1.0 against
  // distance's 0.15 - ends up steering every future order away from a rider
  // who has actually gone idle. Same for a reject that happens after an
  // accept already triggered auto-assignment.
  //
  // Called with the order id alone, and no longer gated on this handler's
  // snapshot showing a courier (review round 4). Two reasons, both about
  // that snapshot being stale by the time this line runs: the rider to
  // decrement is whoever the assignment row names when the release commits
  // (a manual reassignment may have moved the claim), and an order that had
  // no courier when `bundle` was read may have been claimed since - by the
  // automatic assignment a concurrent transition on this very order
  // triggered - in which case skipping the release strands that claim on a
  // now-terminal order forever. With no live claim the SQL matches no rows
  // and does nothing, so the reject-from-PLACED case the old guard existed
  // for costs one no-op round trip instead of a correctness hole.
  // Non-fatal for the same reason the assignment call above is - the status
  // transition has already committed.
  const isReleaseEligibleStatus: readonly string[] = [ORDER_STATUS.DELIVERED, ORDER_STATUS.REJECTED];
  if (isReleaseEligibleStatus.includes(nextState!.status)) {
    try {
      await releaseDispatchAssignmentLoad(orderId);
    } catch (error) {
      logEdgeEvent('error', 'dispatch load release failed', {
        error: error instanceof Error ? error.message : String(error),
        orderId,
        status: nextState!.status,
      });
    }
  }

  return json(200, {
    data: {
      orderId,
      status: nextState.status,
    },
  });
};

const submitPartnerApplication: Handler = async ({ context, data }) => {
  const contactName = sanitizeText(data.contactName);
  const phoneNumber = sanitizeText(data.phoneNumber);
  const restaurantName = sanitizeText(data.restaurantName);
  const cuisine = sanitizeText(data.cuisine);
  const address = sanitizeText(data.address);
  const description = sanitizeOptionalText(data.description);
  const logoImage = sanitizeOptionalText(data.logoImage);
  const deliveryTime = sanitizeOptionalText(data.deliveryTime) ?? DEFAULT_DELIVERY_TIME;
  const policyAcceptance = validatePolicyAcceptancePayload(
    data.policyAcceptance,
    'partner',
    'partner_signup'
  );
  const latitude =
    data.latitude === null || data.latitude === undefined ? null : parseNumber(data.latitude, Number.NaN);
  const longitude =
    data.longitude === null || data.longitude === undefined ? null : parseNumber(data.longitude, Number.NaN);

  if (!contactName) {
    fail(400, 'A contact name is required.');
  }
  if (!phoneNumber) {
    fail(400, 'A phone number is required.');
  }
  if (!restaurantName) {
    fail(400, 'A restaurant name is required.');
  }
  if (!cuisine) {
    fail(400, 'A cuisine is required.');
  }
  if (!address) {
    fail(400, 'A restaurant address is required.');
  }

  const hasLatitude = latitude !== null;
  const hasLongitude = longitude !== null;
  if (hasLatitude !== hasLongitude) {
    fail(400, 'Provide both latitude and longitude together.');
  }
  if (hasLatitude && (!Number.isFinite(latitude) || !Number.isFinite(longitude))) {
    fail(400, 'Use valid numeric coordinates for the restaurant location.');
  }

  const existingApplication = await loadPartnerApplication(context.uid);
  const submitOutcome = resolvePartnerSubmitOutcome(existingApplication?.status);
  if (!submitOutcome.allowed) {
    fail(submitOutcome.httpStatus, submitOutcome.message);
  }

  const submittedAt = existingApplication?.submittedAt ?? nowIso();
  const updatedAt = nowIso();
  const restaurantId = existingApplication?.restaurantId ?? crypto.randomUUID();

  const { error: applicationError } = await serviceClient.from('PartnerApplicationRecord').upsert(
    {
      id: context.uid,
      uid: context.uid,
      email: context.email,
      contactName,
      phoneNumber,
      restaurantName,
      cuisine,
      address,
      description,
      logoImage,
      latitude: hasLatitude ? latitude : null,
      longitude: hasLongitude ? longitude : null,
      deliveryTime,
      status: PARTNER_APPLICATION_STATUS.PENDING,
      restaurantId,
      submittedAt,
      // An admin has not looked at this yet. Clearing the review fields also
      // wipes a previous rejection reason when a rejected partner resubmits.
      reviewedAt: null,
      approvedByUid: null,
      rejectionReason: null,
      updatedAt,
    },
    { onConflict: 'id' }
  );

  if (applicationError) {
    throw new Error(applicationError.message);
  }

  // Submitting creates no restaurant and grants no role. The RestaurantRecord
  // and RestaurantApproval rows are written by adminReviewPartnerApplication
  // when an admin approves; it reuses the restaurantId allocated above.
  const currentAccount = await loadUserAccount(context.uid);

  await upsertUserAccount({
    uid: context.uid,
    email: context.email,
    displayName: contactName,
    phoneNumber,
    emailVerified: true,
    // Role stays 'customer' until an admin approves. The restaurant link is
    // written by adminReviewPartnerApplication, not here.
    roleDisplay: 'customer',
    partnerApplicationStatus: PARTNER_APPLICATION_STATUS.PENDING,
    partnerApplicationReviewedAt: null,
    partnerApplicationRejectionReason: null,
    createdAt: currentAccount?.createdAt ?? updatedAt,
    updatedAt,
  });
  await recordPolicyAcceptance(context.uid, context.email, policyAcceptance);
  await createAuditEntry(context.uid, 'partner_application_submitted', 'partner_application', context.uid, {
    cuisine,
    restaurantName,
    logoImage: logoImage ?? null,
  });
  await notifyAdmins({
    title: 'New restaurant application',
    body: `${restaurantName} has applied and is waiting for review.`,
    data: buildNotificationData({
      app: 'admin',
      extra: {
        applicationId: context.uid,
      },
      routeKey: 'admin_approvals',
      type: 'application_submitted',
    }),
  });

  return json(200, {
    data: {
      status: PARTNER_APPLICATION_STATUS.PENDING,
      submittedAt,
      restaurantId,
      targetUid: context.uid,
    },
  });
};

const resolvePartnerBankAccount: Handler = async ({ data }) => {
  const bankCode = sanitizeText(data.bankCode);
  const accountNumber = sanitizeText(data.accountNumber).replace(/\s+/g, '');
  if (!bankCode) {
    fail(400, 'A bank code is required.');
  }
  if (accountNumber.length < 6) {
    fail(400, 'A valid account number is required.');
  }
  assertPaystackConfigured();

  let resolved: { accountName: string; accountNumber: string };
  try {
    resolved = await resolvePaystackBankAccount({ accountNumber, bankCode });
  } catch (_error) {
    fail(422, 'We could not verify that bank account. Check the number and bank, then try again.');
  }
  if (!resolved.accountName) {
    fail(422, 'That bank account could not be verified. Check the details and try again.');
  }

  return json(200, {
    data: { accountName: resolved.accountName, accountNumber: resolved.accountNumber },
  });
};

const requestPartnerVerificationUploadUrl: Handler = async ({ context, data }) => {
  const kind = sanitizeText(data.kind);
  const extension = sanitizeText(data.extension, 'jpg');
  const contentType = sanitizeText(data.contentType, 'application/octet-stream');
  if (!kind) {
    fail(400, 'A verification document kind is required.');
  }

  // The restaurant row does not exist until approval, so uploads are foldered
  // under the application's allocated restaurantId when present, else the uid.
  const existingApplication = await loadPartnerApplication(context.uid);
  const restaurantId = sanitizeText(existingApplication?.restaurantId) || context.uid;

  const uploadRequest = buildPartnerVerificationUploadRequest({
    uid: context.uid,
    restaurantId,
    kind,
    extension,
    contentType,
  });
  // buildPartnerVerificationDocPath prefixes the bucket; storage.from(bucket)
  // wants the object path relative to the bucket.
  const objectPath = uploadRequest.path.startsWith(`${uploadRequest.bucket}/`)
    ? uploadRequest.path.slice(uploadRequest.bucket.length + 1)
    : uploadRequest.path;

  const { data: signed, error: signError } = await serviceClient.storage
    .from(uploadRequest.bucket)
    .createSignedUploadUrl(objectPath, { upsert: true });

  if (signError || !signed) {
    throw new Error(signError?.message ?? 'Could not create a verification upload URL.');
  }

  return json(200, {
    data: {
      bucket: uploadRequest.bucket,
      contentType: uploadRequest.contentType,
      path: uploadRequest.path,
      signedUrl: signed.signedUrl,
      token: signed.token,
    },
  });
};

const submitPartnerOnboarding: Handler = async ({ context, data }) => {
  let submission: ReturnType<typeof validatePartnerOnboardingSubmission>;
  try {
    submission = validatePartnerOnboardingSubmission({
      accountNumber: sanitizeText(data.accountNumber),
      address: sanitizeText(data.address),
      bankCode: sanitizeText(data.bankCode),
      bankName: sanitizeText(data.bankName),
      contactName: sanitizeText(data.contactName),
      cuisine: sanitizeText(data.cuisine),
      deliveryRadiusKm:
        data.deliveryRadiusKm === null || data.deliveryRadiusKm === undefined
          ? null
          : parseNumber(data.deliveryRadiusKm, Number.NaN),
      deliveryTime: sanitizeText(data.deliveryTime),
      description: sanitizeText(data.description),
      documentBackPath: sanitizeText(data.documentBackPath),
      documentFrontPath: sanitizeText(data.documentFrontPath),
      documentType: sanitizeText(data.documentType),
      email: sanitizeText(data.email, context.email),
      latitude:
        data.latitude === null || data.latitude === undefined
          ? null
          : parseNumber(data.latitude, Number.NaN),
      legalName: sanitizeText(data.legalName),
      longitude:
        data.longitude === null || data.longitude === undefined
          ? null
          : parseNumber(data.longitude, Number.NaN),
      phoneNumber: sanitizeText(data.phoneNumber),
      restaurantName: sanitizeText(data.restaurantName),
    });
  } catch (validationError) {
    fail(400, validationError instanceof Error ? validationError.message : 'Invalid onboarding submission.');
  }

  // The raw document number is never stored — only its hash and last four, so a
  // leak of the row cannot reconstruct the NIN. Derived server-side.
  const documentNumber = sanitizeText(data.documentNumber ?? data.ninNumber);
  if (!documentNumber) {
    fail(400, 'A verification document number is required.');
  }
  const ninHash = await derivePartnerDocumentHash(documentNumber);
  const ninLast4 = derivePartnerDocumentLast4(documentNumber);
  if (!ninHash || !ninLast4) {
    fail(400, 'A valid verification document number is required.');
  }

  const policyAcceptance = data.policyAcceptance
    ? validatePolicyAcceptancePayload(data.policyAcceptance, 'partner', 'partner_signup')
    : null;

  const existingApplication = await loadPartnerApplication(context.uid);
  const submitOutcome = resolvePartnerSubmitOutcome(existingApplication?.status);
  if (!submitOutcome.allowed) {
    fail(submitOutcome.httpStatus, submitOutcome.message);
  }

  assertPaystackConfigured();
  let resolvedAccountName: string;
  try {
    const resolved = await resolvePaystackBankAccount({
      accountNumber: submission.accountNumber,
      bankCode: submission.bankCode,
    });
    resolvedAccountName = resolved.accountName;
  } catch (_error) {
    fail(422, 'We could not verify that bank account. Check the number and bank, then try again.');
  }
  if (!resolvedAccountName) {
    fail(422, 'That bank account could not be verified. Check the details and try again.');
  }

  const submittedAt = existingApplication?.submittedAt ?? nowIso();
  const updatedAt = nowIso();
  const restaurantId = existingApplication?.restaurantId ?? crypto.randomUUID();
  const documentType = normalizePartnerOnboardingDocumentType(submission.documentType);

  const { error: applicationError } = await serviceClient.from('PartnerApplicationRecord').upsert(
    {
      id: context.uid,
      uid: context.uid,
      email: context.email,
      contactName: submission.contactName,
      phoneNumber: submission.phoneNumber,
      restaurantName: submission.restaurantName,
      cuisine: submission.cuisine,
      address: submission.address,
      description: submission.description || null,
      latitude: submission.latitude,
      longitude: submission.longitude,
      deliveryTime: submission.deliveryTime,
      // Kept at PENDING so the existing admin review -> approve path is unchanged;
      // KYC/payout readiness lives in the dedicated rows written below.
      status: PARTNER_APPLICATION_STATUS.PENDING,
      restaurantId,
      submittedAt,
      reviewedAt: null,
      approvedByUid: null,
      rejectionReason: null,
      updatedAt,
    },
    { onConflict: 'id' }
  );
  if (applicationError) {
    throw new Error(applicationError.message);
  }

  const { error: kycError } = await serviceClient.from('RestaurantKyc').upsert(
    {
      id: `kyc_${context.uid}`,
      uid: context.uid,
      restaurantId,
      legalName: submission.legalName,
      ninNumber: null,
      ninLast4,
      ninHash,
      ninFrontPath: submission.documentFrontPath,
      ninBackPath: submission.documentBackPath || '',
      verification: 'manual',
      verifiedByUid: null,
      verifiedAt: null,
      reviewNotes: documentType === 'tax_id' ? 'Document type: tax_id' : null,
      updatedAt,
    },
    { onConflict: 'uid' }
  );
  if (kycError) {
    throw new Error(kycError.message);
  }

  const { error: payoutError } = await serviceClient.from('RestaurantPayout').upsert(
    {
      id: `payout_${context.uid}`,
      uid: context.uid,
      restaurantId,
      bankCode: submission.bankCode,
      bankName: submission.bankName,
      accountNumber: submission.accountNumber,
      accountLast4: submission.accountNumber.slice(-4),
      resolvedAccountName,
      // Subaccount is created at approval, not now. Resolved but not yet active.
      paystackSubaccountCode: null,
      status: 'resolved',
      lastError: null,
      updatedAt,
    },
    { onConflict: 'uid' }
  );
  if (payoutError) {
    throw new Error(payoutError.message);
  }

  const currentAccount = await loadUserAccount(context.uid);
  await upsertUserAccount({
    uid: context.uid,
    email: context.email,
    displayName: submission.contactName,
    phoneNumber: submission.phoneNumber,
    emailVerified: true,
    roleDisplay: 'customer',
    partnerApplicationStatus: PARTNER_APPLICATION_STATUS.PENDING,
    partnerApplicationReviewedAt: null,
    partnerApplicationRejectionReason: null,
    createdAt: currentAccount?.createdAt ?? updatedAt,
    updatedAt,
  });

  if (policyAcceptance) {
    await recordPolicyAcceptance(context.uid, context.email, policyAcceptance);
  }

  await createAuditEntry(context.uid, 'partner_onboarding_submitted', 'partner_application', context.uid, {
    restaurantName: submission.restaurantName,
    bankName: submission.bankName,
    documentType,
  });
  await notifyAdmins({
    title: 'New restaurant application',
    body: `${submission.restaurantName} submitted onboarding and is waiting for review.`,
    data: buildNotificationData({
      app: 'admin',
      extra: { applicationId: context.uid },
      routeKey: 'admin_approvals',
      type: 'application_submitted',
    }),
  });

  return json(200, {
    data: {
      status: PARTNER_APPLICATION_STATUS.PENDING,
      submittedAt,
      restaurantId,
      payoutStatus: 'resolved',
      resolvedAccountName,
      targetUid: context.uid,
    },
  });
};

export const partnerDomain = defineRpcDomain<AuthenticatedRequestContext>({
  actions: PARTNER_ACTIONS,
  name: 'partner',
  handlers: {
    claimPartnerRestaurantLink,
    partnerGetRestaurantContext,
    partnerGetRestaurantOrder,
    partnerGetRestaurantOrders,
    partnerGetRestaurantRatings,
    partnerInviteStaff,
    partnerListStaff,
    partnerRevokeStaffAccess,
    partnerRevokeStaffInvite,
    partnerSetMenuItemAvailability,
    partnerSetStorePause,
    partnerUpdateOrderStatus,
    requestPartnerVerificationUploadUrl,
    resolvePartnerBankAccount,
    submitPartnerApplication,
    submitPartnerOnboarding,
    upsertPartnerRestaurantMenu,
    upsertPartnerRestaurantProfile,
  },
});
