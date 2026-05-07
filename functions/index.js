const admin = require("firebase-admin");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const {
  auditSqlAction,
  createSqlOrder,
  deleteSqlDispatchRider,
  deleteSqlRestaurant,
  deleteSqlUserAccount,
  deleteSqlUserRoles,
  getSqlIdempotencyRecord,
  recordSqlDeliveryEvent,
  requireSql,
  storeSqlIdempotencyRecord,
  syncSqlDeliveryAssignment,
  syncSqlRestaurant,
  syncSqlRestaurantApproval,
  syncSqlUserAccount,
  syncSqlUserRole,
  upsertSqlDispatchRider,
  updateSqlOrder,
} = require("./sql");

admin.initializeApp();

const db = admin.firestore();
const serverTimestamp = admin.firestore.FieldValue.serverTimestamp;

const ORDER_STATUS = {
  ACCEPTED: "accepted",
  CANCELLED: "cancelled",
  DELIVERED: "delivered",
  ESCALATED: "escalated",
  FAILED_DELIVERY: "failed_delivery",
  ON_THE_WAY: "on_the_way",
  PICKED_UP: "picked_up",
  PLACED: "placed",
  PREPARING: "preparing",
  READY_FOR_PICKUP: "ready_for_pickup",
  REJECTED: "rejected",
};

const PAYMENT_METHOD = {
  CARD: "card",
  CASH: "cash",
  WALLET: "wallet",
};

const PAYMENT_STATUS = {
  PAID: "paid",
  PENDING: "pending",
  REFUNDED: "refunded",
};

const DISPATCH_APPLICATION_STATUS = {
  APPROVED: "approved",
  PENDING: "pending",
  REJECTED: "rejected",
};

const PARTNER_APPLICATION_STATUS = {
  APPROVED: "approved",
  PENDING: "pending",
  REJECTED: "rejected",
};

const APP_ROLES = ["customer", "restaurant", "dispatch", "admin"];
const PRIVILEGED_APP_ROLES = new Set(["restaurant", "dispatch", "admin"]);

const PREPAID_CHECKOUT_DISABLED_MESSAGE =
  "Card and wallet payments are coming soon. Use cash for now while payment service is still being set up.";

const TERMINAL_STATUSES = new Set(["cancelled", "delivered", "failed_delivery", "rejected"]);
const LEGACY_STATUS_MAP = {
  delivered: ORDER_STATUS.DELIVERED,
  pending: ORDER_STATUS.PLACED,
  preparing: ORDER_STATUS.PREPARING,
  ready: ORDER_STATUS.READY_FOR_PICKUP,
};

const sanitizeText = (value, fallback = "") => {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
};

const buildNameKey = (value) =>
  sanitizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const sanitizeOptionalText = (value) => {
  const trimmed = sanitizeText(value);
  return trimmed || null;
};

const toDateValue = (value) => {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value?.toDate === "function") {
    return value.toDate();
  }

  if (typeof value === "string") {
    const parsedDate = new Date(value);
    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
  }

  return null;
};

const parseNumber = (value, fallback = 0) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsedValue = Number.parseFloat(value);
    if (Number.isFinite(parsedValue)) {
      return parsedValue;
    }
  }

  return fallback;
};

const roundCurrency = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const parseInteger = (value, fallback = 0) => {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsedValue = Number.parseInt(value, 10);
    if (Number.isInteger(parsedValue)) {
      return parsedValue;
    }
  }

  return fallback;
};

const toIsoString = (value) => {
  const dateValue = toDateValue(value);
  return dateValue ? dateValue.toISOString() : null;
};

const logStructured = (level, event, details = {}) => {
  const payload = {
    event,
    level,
    timestamp: new Date().toISOString(),
    ...details,
  };

  const serializedPayload = JSON.stringify(payload);

  if (level === "error") {
    console.error(serializedPayload);
    return;
  }

  if (level === "warn") {
    console.warn(serializedPayload);
    return;
  }

  console.log(serializedPayload);
};

const normalizeOrderStatus = (status) => {
  if (typeof status !== "string" || !status.trim()) {
    return "draft";
  }

  if (status in LEGACY_STATUS_MAP) {
    return LEGACY_STATUS_MAP[status];
  }

  return status;
};

const isPrepaidMethod = (paymentMethod) => [PAYMENT_METHOD.CARD, PAYMENT_METHOD.WALLET].includes(paymentMethod);

const calculateServiceFee = (subtotal) => {
  if (subtotal <= 0) {
    return 0;
  }

  return roundCurrency(Math.min(Math.max(subtotal * 0.05, 0.49), 12));
};

const calculatePricing = ({ deliveryFee, subtotal, tip }) => {
  const safeSubtotal = roundCurrency(subtotal);
  const safeDeliveryFee = roundCurrency(deliveryFee);
  const safeTip = roundCurrency(tip);
  const serviceFee = calculateServiceFee(safeSubtotal);
  const total = roundCurrency(safeSubtotal + safeDeliveryFee + serviceFee + safeTip);

  return {
    currency: "USD",
    deliveryFee: safeDeliveryFee,
    discount: 0,
    serviceFee,
    subtotal: safeSubtotal,
    tip: safeTip,
    total,
  };
};

const generatePaymentReference = (paymentMethod) => {
  const prefix = paymentMethod === PAYMENT_METHOD.WALLET ? "WAL" : "CRD";
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)
    .toString()
    .padStart(5, "0")}`;
};

const buildInitialPaymentSummary = ({ paymentMethod, total }) => {
  if (!isPrepaidMethod(paymentMethod)) {
    return {
      capturedAmount: 0,
      lastEvent: "awaiting_cash_collection",
      method: paymentMethod,
      processor: "cash_on_delivery",
      reference: null,
      refundAmount: 0,
      refundedAt: null,
      paidAt: null,
      status: PAYMENT_STATUS.PENDING,
    };
  }

  return {
    capturedAmount: 0,
    lastEvent: "awaiting_payment_service_setup",
    method: paymentMethod,
    paidAt: null,
    processor: "payment_service_pending",
    reference: generatePaymentReference(paymentMethod),
    refundAmount: 0,
    refundedAt: null,
    status: PAYMENT_STATUS.PENDING,
  };
};

const buildRefundUpdate = ({ order, refundRate, reason }) => {
  const paymentMethod = sanitizeText(order.payment?.method, PAYMENT_METHOD.CASH);
  const capturedAmount = roundCurrency(parseNumber(order.payment?.capturedAmount, parseNumber(order.pricing?.total, 0)));

  if (!isPrepaidMethod(paymentMethod) || capturedAmount <= 0) {
    return {
      "payment.lastEvent": reason,
    };
  }

  const refundAmount = roundCurrency(capturedAmount * refundRate);

  return {
    "payment.lastEvent": reason,
    "payment.refundAmount": refundAmount,
    "payment.refundedAt": serverTimestamp(),
    "payment.status": PAYMENT_STATUS.REFUNDED,
  };
};

const getCustomerCancellationRefundRate = (currentStatus) => {
  if ([ORDER_STATUS.PLACED, ORDER_STATUS.ACCEPTED].includes(currentStatus)) {
    return 1;
  }

  if ([ORDER_STATUS.PREPARING, ORDER_STATUS.READY_FOR_PICKUP].includes(currentStatus)) {
    return 0.5;
  }

  return 0;
};

const isAppRole = (value) => APP_ROLES.includes(value);

const getProfileRole = (user) => {
  const role = sanitizeText(user?.role);
  return isAppRole(role) ? role : null;
};

const getRoleClaim = (request) => {
  const role = sanitizeText(request.auth?.token?.role);
  return isAppRole(role) ? role : null;
};

const assertPartnerRestaurantRole = (authRole) => {
  requireRole(authRole, ["restaurant", "admin"]);
};

const assertRestaurantOwnershipAssignable = ({ existingOwnerId, isAdmin, uid }) => {
  if (!existingOwnerId || existingOwnerId === uid || isAdmin) {
    return;
  }

  throw new HttpsError(
    "permission-denied",
    "This restaurant is already managed by another partner account."
  );
};

const buildPartnerRestaurantPayload = (input, uid, options = {}) => {
  const name = sanitizeText(input?.name);
  const { allowPublish = false, existingPublished = false } = options;

  if (!name) {
    throw new HttpsError("invalid-argument", "A restaurant name is required.");
  }

  const supportsDelivery = input?.supportsDelivery !== false;
  const supportsPickup = input?.supportsPickup !== false;

  if (!supportsDelivery && !supportsPickup) {
    throw new HttpsError("invalid-argument", "Enable delivery, pickup, or both before saving.");
  }

  const latitude = input?.latitude === null || input?.latitude === undefined ? null : parseNumber(input.latitude, Number.NaN);
  const longitude = input?.longitude === null || input?.longitude === undefined ? null : parseNumber(input.longitude, Number.NaN);
  const hasLatitude = latitude !== null;
  const hasLongitude = longitude !== null;

  if (hasLatitude !== hasLongitude) {
    throw new HttpsError("invalid-argument", "Provide both latitude and longitude together.");
  }

  if (hasLatitude && (!Number.isFinite(latitude) || !Number.isFinite(longitude))) {
    throw new HttpsError("invalid-argument", "Use valid numeric coordinates for the restaurant.");
  }

  const address = sanitizeText(input?.address);
  if (!address) {
    throw new HttpsError("invalid-argument", "A restaurant address is required.");
  }

  return {
    address,
    cuisine: sanitizeOptionalText(input?.cuisine) ?? "",
    deliveryFee: roundCurrency(parseNumber(input?.deliveryFee, 0)),
    deliveryRadiusKm:
      input?.deliveryRadiusKm === null || input?.deliveryRadiusKm === undefined
        ? null
        : roundCurrency(parseNumber(input.deliveryRadiusKm, 0)),
    deliveryTime: sanitizeText(input?.deliveryTime, "25-35 min"),
    description: sanitizeOptionalText(input?.description) ?? "",
    image: sanitizeOptionalText(input?.image) ?? "",
    isOpen: input?.isOpen !== false,
    isPublished: allowPublish ? input?.isPublished === true : existingPublished === true,
    latitude,
    location:
      hasLatitude && hasLongitude
        ? {
            latitude,
            longitude,
          }
        : null,
    longitude,
    minOrder: roundCurrency(parseNumber(input?.minOrder, 0)),
    name,
    nameKey: buildNameKey(name),
    ownerId: uid,
    ownerLinkedAt: serverTimestamp(),
    supportsDelivery,
    supportsPickup,
    updatedAt: serverTimestamp(),
  };
};

const assertCustomerCanCancelOrder = (order, uid, userRole) => {
  if (userRole !== "admin" && order.customerId !== uid) {
    throw new HttpsError("permission-denied", "You can only cancel your own orders.");
  }

  const currentStatus = normalizeOrderStatus(order.status);
  if (![ORDER_STATUS.PLACED, ORDER_STATUS.ACCEPTED, ORDER_STATUS.PREPARING, ORDER_STATUS.READY_FOR_PICKUP].includes(currentStatus)) {
    throw new HttpsError("failed-precondition", "This order can no longer be cancelled.");
  }

  return currentStatus;
};

const assertAuthenticated = (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to perform this action.");
  }

  return request.auth.uid;
};

const getUserDocument = async (uid) => {
  const userSnapshot = await db.collection("users").doc(uid).get();

  if (!userSnapshot.exists) {
    throw new HttpsError("permission-denied", "Your account profile could not be verified.");
  }

  const user = {
    id: userSnapshot.id,
    ...userSnapshot.data(),
  };

  await syncSqlUserAccount({
    uid,
    email: sanitizeText(user.email),
    displayName: sanitizeOptionalText(user.displayName),
    emailVerified: user.emailVerified === true,
    roleDisplay: getProfileRole(user),
    activeSessionId: sanitizeOptionalText(user.activeSessionId),
    activeSessionUpdatedAt: user.activeSessionUpdatedAt,
    restaurantId: sanitizeOptionalText(user.restaurantId),
    restaurantName: sanitizeOptionalText(user.restaurantName),
    restaurantLinkedAt: user.restaurantLinkedAt,
    restaurantLinkSource: sanitizeOptionalText(user.restaurantLinkSource),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  });

  return user;
};

const getAuthenticatedUserContext = async (request) => {
  const uid = assertAuthenticated(request);
  const authRole = getRoleClaim(request);
  const user = await getUserDocument(uid);

  return {
    authRole,
    uid,
    user,
  };
};

const requireRole = (authRole, allowedRoles) => {
  if (!authRole || !allowedRoles.includes(authRole)) {
    throw new HttpsError("permission-denied", "You do not have permission to perform this action.");
  }
};

const assertRateLimit = async ({ scope, uid, windowMs, maxRequests }) => {
  const bucketStart = Math.floor(Date.now() / windowMs) * windowMs;
  const rateLimitRef = db.collection("_functionRateLimits").doc(`${scope}:${uid}:${bucketStart}`);

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(rateLimitRef);
    const currentCount = snapshot.exists ? parseInteger(snapshot.data()?.count, 0) : 0;

    if (currentCount >= maxRequests) {
      throw new HttpsError(
        "resource-exhausted",
        "Too many requests in a short time. Pause for a moment and try again."
      );
    }

    transaction.set(
      rateLimitRef,
      {
        count: currentCount + 1,
        createdAt: snapshot.exists ? snapshot.data()?.createdAt ?? serverTimestamp() : serverTimestamp(),
        expiresAt: new Date(bucketStart + windowMs * 2).toISOString(),
        scope,
        uid,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  });
};

const getBootstrapAdminEmails = () =>
  sanitizeText(process.env.BOOTSTRAP_ADMIN_EMAILS)
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

const buildOrderSnapshotResponse = (order, extras = {}) => ({
  assignment: order.assignment ?? null,
  cancellation: order.cancellation ?? null,
  createdAt: toIsoString(order.createdAt),
  customerId: order.customerId,
  deliveryAddress: sanitizeOptionalText(order.deliveryAddress),
  deliveryLocation: order.deliveryLocation ?? null,
  events: extras.events ?? [],
  fulfillmentType: sanitizeText(order.fulfillmentType, "delivery"),
  id: order.id,
  items: Array.isArray(order.items)
    ? order.items.map((item) => ({
        id: item.itemId ?? item.id,
        name: item.name,
        price: parseNumber(item.price, 0),
        quantity: parseInteger(item.quantity, 0),
        restaurantId: item.restaurantId,
        restaurantName: item.restaurantName,
      }))
    : [],
  payment: order.payment ?? null,
  pricing: order.pricing ?? null,
  restaurantId: order.restaurantId,
  restaurantName: order.restaurantName,
  status: sanitizeText(order.status, ORDER_STATUS.PLACED),
  timeline: order.timeline ?? null,
  total: parseNumber(order.pricing?.total, 0),
  updatedAt: toIsoString(order.updatedAt),
});

const buildRestaurantResponse = (restaurant, approval = null) => ({
  address: sanitizeOptionalText(restaurant.address),
  approvalStatus: approval?.status ?? buildRestaurantApprovalStatus(restaurant.isPublished === true),
  approvedAt: toIsoString(approval?.approvedAt),
  approvedByUid: sanitizeOptionalText(approval?.approvedByUid),
  cuisine: sanitizeOptionalText(restaurant.cuisine),
  deliveryFee: restaurant.deliveryFee,
  deliveryRadiusKm: restaurant.deliveryRadiusKm,
  deliveryTime: sanitizeOptionalText(restaurant.deliveryTime),
  id: restaurant.id,
  image: sanitizeOptionalText(restaurant.image),
  isOpen: restaurant.isOpen !== false,
  isPublished: restaurant.isPublished === true,
  latitude: restaurant.latitude,
  longitude: restaurant.longitude,
  menu: restaurant.menu ?? [],
  minOrder: restaurant.minOrder,
  name: sanitizeText(restaurant.name, "Restaurant"),
  ownerId: sanitizeOptionalText(restaurant.ownerId),
  supportsDelivery: restaurant.supportsDelivery !== false,
  supportsPickup: restaurant.supportsPickup !== false,
  updatedAt: toIsoString(restaurant.updatedAt),
});

const buildUserAccountResponse = (account, profile = null) => ({
  activeSessionId: sanitizeOptionalText(account.activeSessionId),
  activeSessionUpdatedAt: toIsoString(account.activeSessionUpdatedAt),
  accountDisabled: profile?.accountDisabled === true,
  createdAt: toIsoString(account.createdAt),
  displayName: sanitizeOptionalText(account.displayName),
  disabledAt: profile?.disabledAt ?? null,
  disabledByUid: sanitizeOptionalText(profile?.disabledByUid),
  email: sanitizeText(account.email),
  emailVerified: account.emailVerified === true,
  lastPrivilegedRole: sanitizeOptionalText(profile?.lastPrivilegedRole),
  restaurantId: sanitizeOptionalText(account.restaurantId),
  restaurantLinkedAt: toIsoString(account.restaurantLinkedAt),
  restaurantLinkSource: sanitizeOptionalText(account.restaurantLinkSource),
  restaurantName: sanitizeOptionalText(account.restaurantName),
  role:
    sanitizeText(account.roles?.[0]?.role) ||
    sanitizeText(account.roleDisplay) ||
    "customer",
  uid: account.uid,
  updatedAt: toIsoString(account.updatedAt),
});

const buildDispatchRiderResponse = (rider) => ({
  acceptanceRate: rider.acceptanceRate,
  activeLoad: rider.activeLoad,
  completedTrips: rider.completedTrips,
  currentAddress: sanitizeOptionalText(rider.currentAddress),
  displayName: rider.displayName,
  id: rider.id,
  latitude: rider.latitude,
  longitude: rider.longitude,
  phoneNumber: sanitizeOptionalText(rider.phoneNumber),
  region: sanitizeOptionalText(rider.region ?? rider.zone),
  status: rider.status,
  updatedAt: toIsoString(rider.updatedAt),
  vehicleType: rider.vehicleType,
  zone: rider.zone,
});

const buildDispatchApplicationResponse = (application) => ({
  approvedByUid: sanitizeOptionalText(application.approvedByUid),
  currentAddress: sanitizeOptionalText(application.currentAddress),
  displayName: sanitizeText(application.displayName, "Dispatch applicant"),
  email: sanitizeText(application.email),
  id: application.id,
  latitude: parseNumber(application.latitude, 0),
  longitude: parseNumber(application.longitude, 0),
  phoneNumber: sanitizeText(application.phoneNumber),
  region: sanitizeText(application.region),
  rejectionReason: sanitizeOptionalText(application.rejectionReason),
  reviewedAt: toIsoString(application.reviewedAt),
  status: sanitizeText(application.status, DISPATCH_APPLICATION_STATUS.PENDING),
  submittedAt: toIsoString(application.submittedAt) ?? new Date().toISOString(),
  uid: sanitizeText(application.uid, application.id),
  vehicleType: sanitizeText(application.vehicleType, "Bike"),
});

const buildPartnerApplicationResponse = (application) => ({
  address: sanitizeText(application.address),
  approvedByUid: sanitizeOptionalText(application.approvedByUid),
  contactName: sanitizeText(application.contactName, "Partner applicant"),
  cuisine: sanitizeText(application.cuisine, "Cuisine pending"),
  deliveryTime: sanitizeOptionalText(application.deliveryTime),
  description: sanitizeOptionalText(application.description),
  email: sanitizeText(application.email),
  id: application.id,
  latitude:
    application.latitude === null || application.latitude === undefined
      ? null
      : parseNumber(application.latitude, 0),
  longitude:
    application.longitude === null || application.longitude === undefined
      ? null
      : parseNumber(application.longitude, 0),
  phoneNumber: sanitizeText(application.phoneNumber),
  rejectionReason: sanitizeOptionalText(application.rejectionReason),
  restaurantName: sanitizeText(application.restaurantName, "Restaurant"),
  reviewedAt: toIsoString(application.reviewedAt),
  status: sanitizeText(application.status, PARTNER_APPLICATION_STATUS.PENDING),
  submittedAt: toIsoString(application.submittedAt) ?? new Date().toISOString(),
  uid: sanitizeText(application.uid, application.id),
});

const getManagedRestaurantForUser = async (uid, user, authRole) => {
  const sql = requireSql();
  const linkedRestaurantId = sanitizeText(user.restaurantId);
  const ownerFilter = authRole === "admin" ? undefined : uid;

  let restaurant = null;

  if (linkedRestaurantId) {
    restaurant = await sql.restaurantRecord.findUnique({
      where: { id: linkedRestaurantId },
      include: { approval: true },
    });
  }

  if (!restaurant) {
    restaurant = await sql.restaurantRecord.findFirst({
      where: ownerFilter ? { ownerId: ownerFilter } : undefined,
      include: { approval: true },
      orderBy: { updatedAt: "desc" },
    });
  }

  return restaurant;
};

const setRoleClaim = async (uid, role) => {
  const userRecord = await admin.auth().getUser(uid);
  const existingClaims = userRecord.customClaims ?? {};

  await admin.auth().setCustomUserClaims(uid, {
    ...existingClaims,
    role,
  });
};

const mirrorRoleToUserProfile = async (uid, role) => {
  await db.collection("users").doc(uid).set(
    {
      role,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
};

const syncRoleClaimFromUserProfile = async (uid) => {
  const user = await getUserDocument(uid);
  const profileRole = getProfileRole(user);

  if (!profileRole) {
    throw new HttpsError("failed-precondition", "The account profile does not contain a valid app role.");
  }

  await setRoleClaim(uid, profileRole);

  return {
    role: profileRole,
    user,
  };
};

const buildRestaurantApprovalStatus = (isPublished) =>
  isPublished === true ? "approved" : "pending";

const syncSqlRestaurantFromProfile = async ({
  approvalStatus = null,
  approvedByUid = null,
  approvedAt = null,
  profile,
  restaurantId,
}) => {
  const parsedLatitude =
    profile.latitude === null || profile.latitude === undefined ? null : parseNumber(profile.latitude, Number.NaN);
  const parsedLongitude =
    profile.longitude === null || profile.longitude === undefined ? null : parseNumber(profile.longitude, Number.NaN);

  await syncSqlRestaurant({
    restaurantId,
    ownerId: sanitizeOptionalText(profile.ownerId),
    name: sanitizeText(profile.name, "Restaurant"),
    nameKey: sanitizeOptionalText(profile.nameKey),
    cuisine: sanitizeOptionalText(profile.cuisine),
    address: sanitizeOptionalText(profile.address),
    description: sanitizeOptionalText(profile.description),
    image: sanitizeOptionalText(profile.image),
    deliveryFee: parseNumber(profile.deliveryFee, 0),
    deliveryRadiusKm:
      profile.deliveryRadiusKm === null || profile.deliveryRadiusKm === undefined
        ? null
        : parseNumber(profile.deliveryRadiusKm, 0),
    deliveryTime: sanitizeOptionalText(profile.deliveryTime),
    latitude: Number.isFinite(parsedLatitude) ? parsedLatitude : null,
    longitude: Number.isFinite(parsedLongitude) ? parsedLongitude : null,
    minOrder: parseNumber(profile.minOrder, 0),
    supportsDelivery: profile.supportsDelivery !== false,
    supportsPickup: profile.supportsPickup !== false,
    isOpen: profile.isOpen !== false,
    isPublished: profile.isPublished === true,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  });

  await syncSqlRestaurantApproval({
    restaurantId,
    status: approvalStatus ?? buildRestaurantApprovalStatus(profile.isPublished === true),
    approvedByUid,
    approvedAt,
  });
};

const syncSqlOrderFromState = async ({
  assignment,
  cancellation,
  deliveryAddress,
  deliveryLocation,
  orderId,
  payment,
  pricing,
  status,
  timeline,
}) => {
  await updateSqlOrder({
    orderId,
    status,
    pricing,
    payment,
    cancellation,
    timeline,
    deliveryAddress,
    deliveryLocation,
  });

  if (assignment !== undefined) {
    await syncSqlDeliveryAssignment({
      orderId,
      dispatchId: sanitizeOptionalText(assignment?.dispatchId),
      courierId: sanitizeOptionalText(assignment?.courierId),
      courierName: sanitizeOptionalText(assignment?.courierName),
      assignedAt: assignment?.assignedAt ?? new Date(),
    });
  }
};

const normalizeDeliveryLocation = (deliveryLocation) => {
  if (!deliveryLocation || typeof deliveryLocation !== "object") {
    return null;
  }

  const address = sanitizeText(deliveryLocation.address);
  const latitude = parseNumber(deliveryLocation.latitude, Number.NaN);
  const longitude = parseNumber(deliveryLocation.longitude, Number.NaN);

  if (!address || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new HttpsError("invalid-argument", "A valid delivery location is required.");
  }

  return {
    address,
    isDefault: deliveryLocation.isDefault === true,
    label: sanitizeOptionalText(deliveryLocation.label),
    latitude,
    longitude,
    note: sanitizeOptionalText(deliveryLocation.note),
    shortAddress: sanitizeOptionalText(deliveryLocation.shortAddress),
  };
};

const flattenRestaurantMenu = (restaurant) => {
  const categories = Array.isArray(restaurant.menu) ? restaurant.menu : [];

  return categories.flatMap((category) => {
    const items = Array.isArray(category?.items) ? category.items : [];

    return items
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        id: sanitizeText(item.id),
        isAvailable: item.isAvailable !== false,
        name: sanitizeText(item.name),
        price: parseNumber(item.price, Number.NaN),
      }))
      .filter((item) => item.id && item.name && Number.isFinite(item.price));
  });
};

const buildOrderItems = (requestedItems, restaurantId, restaurant) => {
  if (!Array.isArray(requestedItems) || requestedItems.length === 0) {
    throw new HttpsError("invalid-argument", "Add at least one item before placing an order.");
  }

  const menuItems = flattenRestaurantMenu(restaurant);
  const menuLookup = new Map(menuItems.map((item) => [item.id, item]));
  const normalizedItems = requestedItems.map((item) => {
    const itemId = sanitizeText(item?.id);
    const quantity = Number.parseInt(String(item?.quantity ?? ""), 10);

    if (!itemId || !Number.isInteger(quantity) || quantity <= 0) {
      throw new HttpsError("invalid-argument", "Each order item must include a valid id and quantity.");
    }

    const menuItem = menuLookup.get(itemId);
    if (!menuItem || menuItem.isAvailable === false) {
      throw new HttpsError("failed-precondition", "One or more selected menu items are unavailable.");
    }

    return {
      id: menuItem.id,
      name: menuItem.name,
      price: menuItem.price,
      quantity,
      restaurantId,
      restaurantName: sanitizeText(restaurant.name, "Restaurant"),
    };
  });

  return normalizedItems;
};

const normalizePartnerMenuInput = (menu) => {
  if (!Array.isArray(menu)) {
    throw new HttpsError("invalid-argument", "Menu payload must be an array of categories.");
  }

  return menu.map((category, categoryIndex) => {
    const categoryName = sanitizeText(category?.category);
    if (!categoryName) {
      throw new HttpsError(
        "invalid-argument",
        `Menu category ${categoryIndex + 1} needs a valid category name.`
      );
    }

    const items = Array.isArray(category?.items) ? category.items : [];
    if (items.length === 0) {
      throw new HttpsError(
        "invalid-argument",
        `Menu category "${categoryName}" must include at least one item.`
      );
    }

    return {
      category: categoryName,
      items: items.map((item, itemIndex) => {
        const itemId = sanitizeText(item?.id);
        const itemName = sanitizeText(item?.name);
        const itemDescription = sanitizeOptionalText(item?.description) ?? "";
        const itemPrice = roundCurrency(parseNumber(item?.price, Number.NaN));

        if (!itemId || !itemName || !Number.isFinite(itemPrice) || itemPrice <= 0) {
          throw new HttpsError(
            "invalid-argument",
            `Menu item ${itemIndex + 1} in "${categoryName}" is missing a valid id, name, or price.`
          );
        }

        return {
          description: itemDescription,
          id: itemId,
          image: sanitizeOptionalText(item?.image),
          isAvailable: item?.isAvailable !== false,
          name: itemName,
          price: itemPrice,
        };
      }),
    };
  });
};

const normalizeDispatchRiderDraft = (input) => {
  const displayName = sanitizeText(input?.name || input?.displayName);
  const zone = sanitizeText(input?.zone);
  const status = sanitizeText(input?.status, "Available");
  const vehicleType = sanitizeText(input?.vehicleType, "Bike");
  const activeLoad = parseInteger(input?.activeLoad, 0);
  const completedTrips = parseInteger(input?.completedTrips, 0);
  const acceptanceRateRaw = parseNumber(input?.acceptanceRate, Number.NaN);
  const latitude = input?.latitude === null || input?.latitude === undefined ? null : parseNumber(input.latitude, Number.NaN);
  const longitude =
    input?.longitude === null || input?.longitude === undefined ? null : parseNumber(input.longitude, Number.NaN);

  if (!displayName) {
    throw new HttpsError("invalid-argument", "Rider name is required.");
  }

  if (!zone) {
    throw new HttpsError("invalid-argument", "Rider zone is required.");
  }

  if (activeLoad < 0 || completedTrips < 0) {
    throw new HttpsError("invalid-argument", "Rider load and trip counters cannot be negative.");
  }

  const hasLatitude = latitude !== null;
  const hasLongitude = longitude !== null;

  if (hasLatitude !== hasLongitude) {
    throw new HttpsError("invalid-argument", "Provide both rider latitude and longitude together.");
  }

  if (hasLatitude && (!Number.isFinite(latitude) || !Number.isFinite(longitude))) {
    throw new HttpsError("invalid-argument", "Use valid numeric coordinates for the rider.");
  }

  return {
    acceptanceRate: Number.isFinite(acceptanceRateRaw) ? acceptanceRateRaw : 85,
    activeLoad,
    completedTrips,
    displayName,
    latitude: hasLatitude ? latitude : null,
    longitude: hasLongitude ? longitude : null,
    status,
    vehicleType,
    zone,
  };
};

const resolveRestaurantReferenceForOrder = async (transaction, order) => {
  if (typeof order.restaurantId === "string" && order.restaurantId.trim()) {
    const restaurantRef = db.collection("restaurants").doc(order.restaurantId);
    const restaurantSnapshot = await transaction.get(restaurantRef);

    if (!restaurantSnapshot.exists) {
      throw new HttpsError("failed-precondition", "The restaurant linked to this order no longer exists.");
    }

    return {
      id: restaurantSnapshot.id,
      ref: restaurantRef,
      ...restaurantSnapshot.data(),
    };
  }

  const restaurantName = sanitizeText(order.restaurantName);
  if (!restaurantName) {
    throw new HttpsError("failed-precondition", "This order is missing restaurant metadata.");
  }

  const restaurantQuery = db.collection("restaurants").where("name", "==", restaurantName).limit(1);
  const restaurantQuerySnapshot = await transaction.get(restaurantQuery);

  if (restaurantQuerySnapshot.empty) {
    throw new HttpsError("failed-precondition", "The restaurant linked to this order could not be found.");
  }

  const restaurantSnapshot = restaurantQuerySnapshot.docs[0];
  return {
    id: restaurantSnapshot.id,
    ref: restaurantSnapshot.ref,
    ...restaurantSnapshot.data(),
  };
};

const canManageRestaurant = (restaurant, user, uid) => {
  const linkedRestaurantId = sanitizeText(user.restaurantId);

  return (
    sanitizeText(restaurant.ownerId) === uid ||
    linkedRestaurantId === restaurant.id
  );
};

const assertPartnerCanManageOrder = async (transaction, order, user, uid) => {
  const restaurant = await resolveRestaurantReferenceForOrder(transaction, order);

  if (!canManageRestaurant(restaurant, user, uid)) {
    throw new HttpsError("permission-denied", "You are not allowed to manage this restaurant's orders.");
  }

  return restaurant;
};

const assertNonTerminalOrder = (order) => {
  if (TERMINAL_STATUSES.has(normalizeOrderStatus(order.status))) {
    throw new HttpsError("failed-precondition", "This order can no longer be updated.");
  }
};

const hasAssignedCourier = (order) => Boolean(sanitizeText(order.assignment?.courierId));

const assertDispatchCanAssignCourier = (currentStatus) => {
  if (![ORDER_STATUS.ACCEPTED, ORDER_STATUS.PREPARING, ORDER_STATUS.READY_FOR_PICKUP].includes(currentStatus)) {
    throw new HttpsError(
      "failed-precondition",
      "Wait for the restaurant to accept the order before assigning a rider."
    );
  }
};

const assertDispatchCanConfirmPickup = (currentStatus, order) => {
  if (currentStatus !== ORDER_STATUS.READY_FOR_PICKUP) {
    throw new HttpsError(
      "failed-precondition",
      "Pickup can only be confirmed after the restaurant marks the order ready."
    );
  }

  if (!hasAssignedCourier(order)) {
    throw new HttpsError(
      "failed-precondition",
      "Assign a rider before confirming pickup."
    );
  }
};

const assertDispatchCanCompleteDelivery = (currentStatus, order) => {
  if (![ORDER_STATUS.PICKED_UP, "on_the_way"].includes(currentStatus)) {
    throw new HttpsError(
      "failed-precondition",
      "Only picked-up delivery orders can be marked delivered."
    );
  }

  if (!hasAssignedCourier(order)) {
    throw new HttpsError(
      "failed-precondition",
      "Assign a rider before completing delivery."
    );
  }
};

const buildPartnerUpdate = (currentStatus, action) => {
  switch (action) {
    case "accept":
      if (currentStatus !== ORDER_STATUS.PLACED) {
        throw new HttpsError("failed-precondition", "Only newly placed orders can be accepted.");
      }

      return {
        status: ORDER_STATUS.ACCEPTED,
        update: {
          status: ORDER_STATUS.ACCEPTED,
          "timeline.acceptedAt": serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      };

    case "preparing":
      if (![ORDER_STATUS.PLACED, ORDER_STATUS.ACCEPTED].includes(currentStatus)) {
        throw new HttpsError("failed-precondition", "Only accepted orders can move into preparation.");
      }

      return {
        status: ORDER_STATUS.PREPARING,
        update: {
          status: ORDER_STATUS.PREPARING,
          ...(currentStatus === ORDER_STATUS.PLACED ? { "timeline.acceptedAt": serverTimestamp() } : {}),
          "timeline.preparingAt": serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      };

    case "ready":
      if (![ORDER_STATUS.ACCEPTED, ORDER_STATUS.PREPARING].includes(currentStatus)) {
        throw new HttpsError("failed-precondition", "Only active kitchen orders can be marked ready.");
      }

      return {
        status: ORDER_STATUS.READY_FOR_PICKUP,
        update: {
          status: ORDER_STATUS.READY_FOR_PICKUP,
          ...(currentStatus === ORDER_STATUS.ACCEPTED ? { "timeline.preparingAt": serverTimestamp() } : {}),
          "timeline.readyAt": serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      };

    case "reject":
      if (![ORDER_STATUS.PLACED, ORDER_STATUS.ACCEPTED].includes(currentStatus)) {
        throw new HttpsError("failed-precondition", "Only active incoming orders can be rejected.");
      }

      return {
        status: ORDER_STATUS.REJECTED,
        update: {
          status: ORDER_STATUS.REJECTED,
          "timeline.cancelledAt": serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      };

    default:
      throw new HttpsError("invalid-argument", "Unsupported partner order action.");
  }
};

const buildDispatchStatusUpdate = (order, action) => {
  const currentStatus = normalizeOrderStatus(order.status);

  switch (action) {
    case "on_the_way":
      if (currentStatus !== ORDER_STATUS.PICKED_UP) {
        throw new HttpsError(
          "failed-precondition",
          "Only picked-up orders can move to the on-the-way stage."
        );
      }

      if (!hasAssignedCourier(order)) {
        throw new HttpsError(
          "failed-precondition",
          "Assign a rider before marking the order on the way."
        );
      }

      return {
        status: ORDER_STATUS.ON_THE_WAY,
        update: {
          status: ORDER_STATUS.ON_THE_WAY,
          "timeline.onTheWayAt": serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      };

    case "picked_up":
      assertDispatchCanConfirmPickup(currentStatus, order);

      return {
        status: ORDER_STATUS.PICKED_UP,
        update: {
          status: ORDER_STATUS.PICKED_UP,
          "timeline.pickedUpAt": serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      };

    case "delivered":
      assertDispatchCanCompleteDelivery(currentStatus, order);

      return {
        status: ORDER_STATUS.DELIVERED,
        update: {
          status: ORDER_STATUS.DELIVERED,
          "timeline.deliveredAt": serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      };

    case "failed_delivery":
      if (![ORDER_STATUS.PICKED_UP, ORDER_STATUS.ON_THE_WAY].includes(currentStatus)) {
        throw new HttpsError(
          "failed-precondition",
          "Only rider-active delivery orders can be marked as failed."
        );
      }

      if (!hasAssignedCourier(order)) {
        throw new HttpsError(
          "failed-precondition",
          "Assign a rider before marking delivery as failed."
        );
      }

      return {
        status: ORDER_STATUS.FAILED_DELIVERY,
        update: {
          status: ORDER_STATUS.FAILED_DELIVERY,
          "timeline.failedDeliveryAt": serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      };

    case "escalate":
      if (TERMINAL_STATUSES.has(currentStatus)) {
        throw new HttpsError(
          "failed-precondition",
          "Completed or cancelled orders cannot be escalated."
        );
      }

      return {
        status: ORDER_STATUS.ESCALATED,
        update: {
          status: ORDER_STATUS.ESCALATED,
          "timeline.escalatedAt": serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      };

    default:
      throw new HttpsError("invalid-argument", "Unsupported dispatch order action.");
  }
};

exports.bootstrapFirstAdmin = onCall(async (request) => {
  const uid = assertAuthenticated(request);
  const requesterEmail = sanitizeText(request.auth?.token?.email).toLowerCase();
  const allowedEmails = getBootstrapAdminEmails();

  if (!requesterEmail || !allowedEmails.includes(requesterEmail)) {
    throw new HttpsError(
      "permission-denied",
      "This account is not allowed to run the first-admin bootstrap flow."
    );
  }

  await assertRateLimit({
    scope: "bootstrap_first_admin",
    uid,
    windowMs: 5 * 60 * 1000,
    maxRequests: 3,
  });

  const sql = requireSql();
  const existingAdminCount = await sql.userRole.count({
    where: {
      role: "admin",
    },
  });

  if (existingAdminCount > 0) {
    throw new HttpsError(
      "failed-precondition",
      "An admin account already exists. Use the admin access tools for further role changes."
    );
  }

  await getUserDocument(uid);
  await setRoleClaim(uid, "admin");
  await mirrorRoleToUserProfile(uid, "admin");
  await syncSqlUserRole({
    uid,
    role: "admin",
    assignedByUid: uid,
  });
  await auditSqlAction({
    actorUid: uid,
    action: "first_admin_bootstrapped",
    targetType: "user_role",
    targetId: uid,
    details: {
      email: requesterEmail,
    },
  });
  logStructured("warn", "first_admin_bootstrapped", {
    actorUid: uid,
    email: requesterEmail,
  });

  return {
    role: "admin",
    targetUid: uid,
    tokenRefreshRequired: true,
  };
});

exports.provisionStaffAccount = onCall(async (request) => {
  const { authRole, uid } = await getAuthenticatedUserContext(request);
  requireRole(authRole, ["admin"]);

  await assertRateLimit({
    scope: "provision_staff_account",
    uid,
    windowMs: 60 * 1000,
    maxRequests: 10,
  });

  const email = sanitizeText(request.data?.email).toLowerCase();
  const password = sanitizeText(request.data?.password);
  const displayName = sanitizeOptionalText(request.data?.displayName);
  const role = sanitizeText(request.data?.role);

  if (!email) {
    throw new HttpsError("invalid-argument", "A staff email is required.");
  }

  if (!password || password.length < 6) {
    throw new HttpsError("invalid-argument", "Use a password with at least 6 characters.");
  }

  if (!["restaurant", "dispatch", "admin"].includes(role)) {
    throw new HttpsError("invalid-argument", "Only admin, restaurant, and dispatch staff can be provisioned here.");
  }

  let userRecord;
  let created = false;

  try {
    userRecord = await admin.auth().getUserByEmail(email);
  } catch (error) {
    if (error?.code !== "auth/user-not-found") {
      throw error;
    }

    userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: displayName ?? undefined,
    });
    created = true;
  }

  if (!created) {
    await admin.auth().updateUser(userRecord.uid, {
      disabled: false,
      displayName: displayName ?? userRecord.displayName ?? undefined,
      password,
    });
  }

  await setRoleClaim(userRecord.uid, role);
  await db.collection("users").doc(userRecord.uid).set(
    {
      accountDisabled: false,
      createdAt: new Date().toISOString(),
      disabledAt: null,
      disabledByUid: null,
      displayName: displayName ?? userRecord.displayName ?? email.split("@")[0],
      email,
      emailVerified: userRecord.emailVerified === true,
      lastPrivilegedRole: role,
      role,
      updatedAt: new Date().toISOString(),
      uid: userRecord.uid,
    },
    { merge: true }
  );

  await getUserDocument(userRecord.uid);
  await syncSqlUserRole({
    uid: userRecord.uid,
    role,
    assignedByUid: uid,
  });
  await auditSqlAction({
    actorUid: uid,
    action: "staff_account_provisioned",
    targetType: "user",
    targetId: userRecord.uid,
    details: {
      created,
      email,
      role,
    },
  });
  logStructured("warn", "staff_account_provisioned", {
    actorUid: uid,
    created,
    role,
    targetUid: userRecord.uid,
  });

  return {
    created,
    email,
    role,
    targetUid: userRecord.uid,
    tokenRefreshRequired: true,
  };
});

exports.assignUserRole = onCall(async (request) => {
  const { authRole, uid } = await getAuthenticatedUserContext(request);
  requireRole(authRole, ["admin"]);

  await assertRateLimit({
    scope: "assign_user_role",
    uid,
    windowMs: 60 * 1000,
    maxRequests: 12,
  });

  const targetUid = sanitizeText(request.data?.targetUid);
  const nextRole = sanitizeText(request.data?.role);

  if (!targetUid) {
    throw new HttpsError("invalid-argument", "A target uid is required.");
  }

  if (!isAppRole(nextRole)) {
    throw new HttpsError("invalid-argument", "Use a valid app role when assigning access.");
  }

  await getUserDocument(targetUid);
  await admin.auth().updateUser(targetUid, { disabled: false });
  await setRoleClaim(targetUid, nextRole);
  await mirrorRoleToUserProfile(targetUid, nextRole);
  await db.collection("users").doc(targetUid).set(
    {
      accountDisabled: false,
      disabledAt: null,
      disabledByUid: null,
      lastPrivilegedRole: PRIVILEGED_APP_ROLES.has(nextRole) ? nextRole : null,
      role: nextRole,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
  await syncSqlUserRole({
    uid: targetUid,
    role: nextRole,
    assignedByUid: uid,
  });
  await auditSqlAction({
    actorUid: uid,
    action: "role_assigned",
    targetType: "user_role",
    targetId: targetUid,
    details: {
      role: nextRole,
    },
  });

  return {
    assignedBy: uid,
    role: nextRole,
    targetUid,
    tokenRefreshRequired: true,
  };
});

exports.revokeUserRole = onCall(async (request) => {
  const { authRole, uid } = await getAuthenticatedUserContext(request);
  requireRole(authRole, ["admin"]);

  await assertRateLimit({
    scope: "revoke_user_role",
    uid,
    windowMs: 60 * 1000,
    maxRequests: 12,
  });

  const targetUid = sanitizeText(request.data?.targetUid);
  if (!targetUid) {
    throw new HttpsError("invalid-argument", "A target uid is required.");
  }

  const fallbackRole = "customer";
  await getUserDocument(targetUid);
  await setRoleClaim(targetUid, fallbackRole);
  await mirrorRoleToUserProfile(targetUid, fallbackRole);
  await syncSqlUserRole({
    uid: targetUid,
    role: fallbackRole,
    assignedByUid: uid,
  });
  await auditSqlAction({
    actorUid: uid,
    action: "role_revoked",
    targetType: "user_role",
    targetId: targetUid,
    details: {
      role: fallbackRole,
    },
  });

  return {
    revokedBy: uid,
    role: fallbackRole,
    targetUid,
    tokenRefreshRequired: true,
  };
});

exports.disableUserAccess = onCall(async (request) => {
  const { authRole, uid } = await getAuthenticatedUserContext(request);
  requireRole(authRole, ["admin"]);

  await assertRateLimit({
    scope: "disable_user_access",
    uid,
    windowMs: 60 * 1000,
    maxRequests: 12,
  });

  const targetUid = sanitizeText(request.data?.targetUid);
  if (!targetUid) {
    throw new HttpsError("invalid-argument", "A target uid is required.");
  }

  if (targetUid === uid) {
    throw new HttpsError(
      "failed-precondition",
      "Use a separate trusted admin before disabling the signed-in operator."
    );
  }

  const targetUser = await getUserDocument(targetUid);
  const previousRole = getProfileRole(targetUser);
  const previousPrivilegedRole = PRIVILEGED_APP_ROLES.has(previousRole) ? previousRole : null;
  const invalidatedSessionId = `disabled:${Date.now()}`;
  await admin.auth().updateUser(targetUid, { disabled: true });
  await admin.auth().revokeRefreshTokens(targetUid);

  const fallbackRole = "customer";
  await setRoleClaim(targetUid, fallbackRole);
  await mirrorRoleToUserProfile(targetUid, fallbackRole);
  await db.collection("users").doc(targetUid).set(
    {
      activeSessionId: invalidatedSessionId,
      activeSessionUpdatedAt: new Date().toISOString(),
      accountDisabled: true,
      disabledAt: new Date().toISOString(),
      disabledByUid: uid,
      lastPrivilegedRole: previousPrivilegedRole,
      role: fallbackRole,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
  await syncSqlUserRole({
    uid: targetUid,
    role: fallbackRole,
    assignedByUid: uid,
  });
  await auditSqlAction({
    actorUid: uid,
    action: "user_access_disabled",
    targetType: "user",
    targetId: targetUid,
    details: {
      previousPrivilegedRole,
      role: fallbackRole,
    },
  });
  logStructured("warn", "user_access_disabled", {
    actorUid: uid,
    previousPrivilegedRole,
    targetUid,
  });

  return {
    disabled: true,
    role: fallbackRole,
    targetUid,
  };
});

exports.enableUserAccess = onCall(async (request) => {
  const { authRole, uid } = await getAuthenticatedUserContext(request);
  requireRole(authRole, ["admin"]);

  await assertRateLimit({
    scope: "enable_user_access",
    uid,
    windowMs: 60 * 1000,
    maxRequests: 12,
  });

  const targetUid = sanitizeText(request.data?.targetUid);
  if (!targetUid) {
    throw new HttpsError("invalid-argument", "A target uid is required.");
  }

  const targetUser = await getUserDocument(targetUid);
  const restoreRole = sanitizeText(targetUser.lastPrivilegedRole);

  if (!PRIVILEGED_APP_ROLES.has(restoreRole)) {
    throw new HttpsError(
      "failed-precondition",
      "No previous privileged role is recorded for this account. Re-provision or assign a role first."
    );
  }

  await admin.auth().updateUser(targetUid, { disabled: false });
  await setRoleClaim(targetUid, restoreRole);
  await mirrorRoleToUserProfile(targetUid, restoreRole);
  await db.collection("users").doc(targetUid).set(
    {
      accountDisabled: false,
      activeSessionId: null,
      activeSessionUpdatedAt: new Date().toISOString(),
      disabledAt: null,
      disabledByUid: null,
      role: restoreRole,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
  await syncSqlUserRole({
    uid: targetUid,
    role: restoreRole,
    assignedByUid: uid,
  });
  await auditSqlAction({
    actorUid: uid,
    action: "user_access_enabled",
    targetType: "user",
    targetId: targetUid,
    details: {
      role: restoreRole,
    },
  });

  return {
    enabled: true,
    role: restoreRole,
    targetUid,
    tokenRefreshRequired: true,
  };
});

exports.deleteOwnAccount = onCall(async (request) => {
  const { authRole, uid, user } = await getAuthenticatedUserContext(request);

  if (authRole === "admin") {
    throw new HttpsError(
      "permission-denied",
      "Admin accounts must be offboarded from the admin access console so audit history stays intact."
    );
  }

  await assertRateLimit({
    scope: "delete_own_account",
    uid,
    windowMs: 10 * 60 * 1000,
    maxRequests: 3,
  });

  if (authRole === "restaurant") {
    const managedRestaurantSnapshot = await db
      .collection("restaurants")
      .where("ownerId", "==", uid)
      .limit(1)
      .get();

    if (!managedRestaurantSnapshot.empty || sanitizeOptionalText(user.restaurantId)) {
      throw new HttpsError(
        "failed-precondition",
        "Partner accounts linked to a restaurant must be offboarded by admin so store ownership and order history stay traceable."
      );
    }
  }

  if (authRole === "dispatch") {
    const [riderSnapshot, assignedOrdersSnapshot] = await Promise.all([
      db.collection("dispatchProfiles").doc(uid).get(),
      db.collection("orders").where("assignment.courierId", "==", uid).get(),
    ]);

    const riderData = riderSnapshot.data() ?? {};
    const activeLoad = parseInteger(
      riderData.activeLoad,
      parseInteger(riderData.activeLoadCount, 0)
    );
    const hasOpenAssignments = assignedOrdersSnapshot.docs.some((orderSnapshot) => {
      const currentStatus = normalizeOrderStatus(orderSnapshot.data()?.status);
      return !TERMINAL_STATUSES.has(currentStatus);
    });

    if (activeLoad > 0 || hasOpenAssignments) {
      throw new HttpsError(
        "failed-precondition",
        "Dispatch accounts with active delivery work must be offboarded by admin after assignments are cleared."
      );
    }
  }

  await auditSqlAction({
    actorUid: uid,
    action: "self_account_deleted",
    targetType: "user",
    targetId: uid,
    details: {
      role: authRole ?? getProfileRole(user),
    },
  });

  await admin.auth().updateUser(uid, { disabled: true });
  await admin.auth().revokeRefreshTokens(uid);

  const cleanupResults = await Promise.allSettled([
    db.collection("dispatchApplications").doc(uid).delete(),
    db.collection("partnerApplications").doc(uid).delete(),
    db.collection("dispatchProfiles").doc(uid).delete(),
    deleteSqlDispatchRider({ riderId: uid }),
    deleteSqlUserRoles({ uid }),
    deleteSqlUserAccount({ uid }),
  ]);

  const cleanupFailures = cleanupResults.filter((result) => result.status === "rejected");
  if (cleanupFailures.length > 0) {
    await admin.auth().updateUser(uid, { disabled: false }).catch((restoreError) => {
      logStructured("error", "self_account_delete_restore_failed", {
        error: restoreError instanceof Error ? restoreError.message : String(restoreError),
        targetUid: uid,
      });
    });
    logStructured("error", "self_account_cleanup_partial_failure", {
      cleanupFailures: cleanupFailures.map((result) => result.reason?.message ?? String(result.reason)),
      targetUid: uid,
    });
    throw new HttpsError(
      "aborted",
      "Account deletion could not be completed cleanly. No records were removed from sign-in, so try again or contact support."
    );
  }

  await admin.auth().deleteUser(uid);
  await db.collection("users").doc(uid).delete();

  return {
    deleted: true,
    targetUid: uid,
  };
});

exports.syncUserClaims = onCall(async (request) => {
  const uid = assertAuthenticated(request);
  const authRole = getRoleClaim(request);
  const requestedTargetUid = sanitizeText(request.data?.targetUid);
  const targetUid = requestedTargetUid || uid;

  if (targetUid !== uid) {
    requireRole(authRole, ["admin"]);
  }

  if (targetUid === uid && !authRole) {
    const { role } = await syncRoleClaimFromUserProfile(uid);

    await syncSqlUserRole({
      uid,
      role,
      assignedByUid: null,
    });

    if (role !== "customer") {
      throw new HttpsError(
        "permission-denied",
        "Only admins can provision privileged role claims. Ask an admin to finish setting up this account."
      );
    }

    return {
      role,
      targetUid: uid,
      tokenRefreshRequired: true,
    };
  }

  if (targetUid === uid && authRole && !PRIVILEGED_APP_ROLES.has(authRole)) {
    const { role } = await syncRoleClaimFromUserProfile(uid);
    await syncSqlUserRole({
      uid,
      role,
      assignedByUid: null,
    });

    if (role !== authRole) {
      throw new HttpsError("permission-denied", "Your profile role does not match your authenticated access claim.");
    }

    return {
      role,
      targetUid: uid,
      tokenRefreshRequired: true,
    };
  }

  const { role } = await syncRoleClaimFromUserProfile(targetUid);
  await syncSqlUserRole({
    uid: targetUid,
    role,
    assignedByUid: uid === targetUid ? null : uid,
  });

  return {
    role,
    targetUid,
    tokenRefreshRequired: true,
  };
});

exports.submitDispatchApplication = onCall(async (request) => {
  const uid = assertAuthenticated(request);

  await assertRateLimit({
    scope: "submit_dispatch_application",
    uid,
    windowMs: 60 * 1000,
    maxRequests: 6,
  });

  const displayName = sanitizeText(request.data?.displayName);
  const phoneNumber = sanitizeText(request.data?.phoneNumber);
  const region = sanitizeText(request.data?.region);
  const vehicleType = sanitizeText(request.data?.vehicleType);
  const currentAddress = sanitizeOptionalText(request.data?.currentAddress);
  const latitude = parseNumber(request.data?.latitude, Number.NaN);
  const longitude = parseNumber(request.data?.longitude, Number.NaN);

  if (!displayName) {
    throw new HttpsError("invalid-argument", "A rider name is required.");
  }

  if (!phoneNumber) {
    throw new HttpsError("invalid-argument", "A phone number is required.");
  }

  if (!region) {
    throw new HttpsError("invalid-argument", "Select a dispatch region before submitting.");
  }

  if (!vehicleType) {
    throw new HttpsError("invalid-argument", "Select a delivery vehicle before submitting.");
  }

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new HttpsError("invalid-argument", "Provide a valid rider latitude and longitude.");
  }

  const authRecord = await admin.auth().getUser(uid);
  const email = sanitizeText(authRecord.email).toLowerCase();

  if (!email) {
    throw new HttpsError("failed-precondition", "This account must have a valid email address before applying.");
  }

  const applicationRef = db.collection("dispatchApplications").doc(uid);
  const userRef = db.collection("users").doc(uid);
  const nowIso = new Date().toISOString();

  await db.runTransaction(async (transaction) => {
    const existingApplication = await transaction.get(applicationRef);
    const currentStatus = sanitizeText(existingApplication.data()?.status, DISPATCH_APPLICATION_STATUS.PENDING);

    if (existingApplication.exists && currentStatus === DISPATCH_APPLICATION_STATUS.APPROVED) {
      throw new HttpsError(
        "failed-precondition",
        "This dispatch application has already been approved. Sign in from the dispatch login screen."
      );
    }

    transaction.set(
      applicationRef,
      {
        approvedByUid: null,
        currentAddress,
        displayName,
        email,
        latitude,
        longitude,
        phoneNumber,
        region,
        rejectionReason: null,
        reviewedAt: null,
        status: DISPATCH_APPLICATION_STATUS.PENDING,
        submittedAt: existingApplication.exists ? existingApplication.data()?.submittedAt ?? nowIso : nowIso,
        uid,
        updatedAt: nowIso,
        vehicleType,
      },
      { merge: true }
    );

    transaction.set(
      userRef,
      {
        ...(existingApplication.exists ? {} : { createdAt: nowIso }),
        dispatchApplicationRejectionReason: null,
        dispatchApplicationReviewedAt: null,
        dispatchApplicationStatus: DISPATCH_APPLICATION_STATUS.PENDING,
        displayName,
        email,
        emailVerified: authRecord.emailVerified === true,
        phoneNumber,
        role: "customer",
        uid,
        updatedAt: nowIso,
      },
      { merge: true }
    );
  });

  try {
    await auditSqlAction({
      actorUid: uid,
      action: "dispatch_application_submitted",
      targetType: "dispatch_application",
      targetId: uid,
      details: {
        region,
        vehicleType,
      },
    });
  } catch (auditError) {
    logStructured("warn", "dispatch_application_submission_audit_failed", {
      actorUid: uid,
      error: auditError instanceof Error ? auditError.message : String(auditError),
    });
  }
  logStructured("info", "dispatch_application_submitted", {
    actorUid: uid,
    region,
    vehicleType,
  });

  return {
    status: DISPATCH_APPLICATION_STATUS.PENDING,
    submittedAt: nowIso,
    targetUid: uid,
  };
});

exports.submitPartnerApplication = onCall(async (request) => {
  const uid = assertAuthenticated(request);

  await assertRateLimit({
    scope: "submit_partner_application",
    uid,
    windowMs: 60 * 1000,
    maxRequests: 6,
  });

  const contactName = sanitizeText(request.data?.contactName);
  const phoneNumber = sanitizeText(request.data?.phoneNumber);
  const restaurantName = sanitizeText(request.data?.restaurantName);
  const cuisine = sanitizeText(request.data?.cuisine);
  const address = sanitizeText(request.data?.address);
  const description = sanitizeOptionalText(request.data?.description);
  const deliveryTime = sanitizeOptionalText(request.data?.deliveryTime) ?? "25-35 min";
  const latitude =
    request.data?.latitude === null || request.data?.latitude === undefined
      ? null
      : parseNumber(request.data?.latitude, Number.NaN);
  const longitude =
    request.data?.longitude === null || request.data?.longitude === undefined
      ? null
      : parseNumber(request.data?.longitude, Number.NaN);

  if (!contactName) {
    throw new HttpsError("invalid-argument", "A contact name is required.");
  }

  if (!phoneNumber) {
    throw new HttpsError("invalid-argument", "A phone number is required.");
  }

  if (!restaurantName) {
    throw new HttpsError("invalid-argument", "A restaurant name is required.");
  }

  if (!cuisine) {
    throw new HttpsError("invalid-argument", "A cuisine is required.");
  }

  if (!address) {
    throw new HttpsError("invalid-argument", "A restaurant address is required.");
  }

  const hasLatitude = latitude !== null;
  const hasLongitude = longitude !== null;

  if (hasLatitude !== hasLongitude) {
    throw new HttpsError("invalid-argument", "Provide both latitude and longitude together.");
  }

  if (hasLatitude && (!Number.isFinite(latitude) || !Number.isFinite(longitude))) {
    throw new HttpsError("invalid-argument", "Use valid numeric coordinates for the restaurant location.");
  }

  const authRecord = await admin.auth().getUser(uid);
  const email = sanitizeText(authRecord.email).toLowerCase();

  if (!email) {
    throw new HttpsError("failed-precondition", "This account must have a valid email address before applying.");
  }

  const applicationRef = db.collection("partnerApplications").doc(uid);
  const userRef = db.collection("users").doc(uid);
  const nowIso = new Date().toISOString();

  await db.runTransaction(async (transaction) => {
    const existingApplication = await transaction.get(applicationRef);
    const currentStatus = sanitizeText(existingApplication.data()?.status, PARTNER_APPLICATION_STATUS.PENDING);

    if (existingApplication.exists && currentStatus === PARTNER_APPLICATION_STATUS.APPROVED) {
      throw new HttpsError(
        "failed-precondition",
        "This partner application has already been approved. Sign in from the partner login screen."
      );
    }

    transaction.set(
      applicationRef,
      {
        address,
        approvedByUid: null,
        contactName,
        cuisine,
        deliveryTime,
        description,
        email,
        latitude: hasLatitude ? latitude : null,
        longitude: hasLongitude ? longitude : null,
        phoneNumber,
        rejectionReason: null,
        restaurantName,
        reviewedAt: null,
        status: PARTNER_APPLICATION_STATUS.PENDING,
        submittedAt: existingApplication.exists ? existingApplication.data()?.submittedAt ?? nowIso : nowIso,
        uid,
        updatedAt: nowIso,
      },
      { merge: true }
    );

    transaction.set(
      userRef,
      {
        ...(existingApplication.exists ? {} : { createdAt: nowIso }),
        displayName: contactName,
        email,
        emailVerified: authRecord.emailVerified === true,
        partnerApplicationRejectionReason: null,
        partnerApplicationReviewedAt: null,
        partnerApplicationStatus: PARTNER_APPLICATION_STATUS.PENDING,
        phoneNumber,
        role: "customer",
        uid,
        updatedAt: nowIso,
      },
      { merge: true }
    );
  });

  try {
    await auditSqlAction({
      actorUid: uid,
      action: "partner_application_submitted",
      targetType: "partner_application",
      targetId: uid,
      details: {
        cuisine,
        restaurantName,
      },
    });
  } catch (auditError) {
    logStructured("warn", "partner_application_submission_audit_failed", {
      actorUid: uid,
      error: auditError instanceof Error ? auditError.message : String(auditError),
    });
  }
  logStructured("info", "partner_application_submitted", {
    actorUid: uid,
    cuisine,
    restaurantName,
  });

  return {
    status: PARTNER_APPLICATION_STATUS.PENDING,
    submittedAt: nowIso,
    targetUid: uid,
  };
});

exports.adminGetDashboardSnapshot = onCall(async (request) => {
  const { authRole, uid } = await getAuthenticatedUserContext(request);
  requireRole(authRole, ["admin"]);

  const sql = requireSql();
  const [users, restaurants, orders, riders] = await Promise.all([
    sql.userAccount.findMany({
      include: { roles: true },
      orderBy: { createdAt: "desc" },
    }),
    sql.restaurantRecord.findMany({
      include: { approval: true },
      orderBy: { updatedAt: "desc" },
    }),
    sql.customerOrder.findMany({
      include: {
        assignment: true,
        items: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    sql.dispatchRiderRecord.findMany({
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  const userProfileSnapshots = users.length
    ? await db.getAll(...users.map((account) => db.collection("users").doc(account.uid)))
    : [];
  const userProfilesByUid = new Map(
    userProfileSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, snapshot.data()])
  );

  logStructured("info", "admin_dashboard_snapshot_loaded", {
    actorUid: uid,
    orders: orders.length,
    restaurants: restaurants.length,
    riders: riders.length,
    users: users.length,
  });

  return {
    dispatchProfiles: riders.map((rider) => buildDispatchRiderResponse(rider)),
    orders: orders.map((order) => buildOrderSnapshotResponse(order)),
    restaurants: restaurants.map((restaurant) => buildRestaurantResponse(restaurant, restaurant.approval)),
    users: users.map((account) => buildUserAccountResponse(account, userProfilesByUid.get(account.uid))),
  };
});

exports.adminGetAccessOverview = onCall(async (request) => {
  const { authRole } = await getAuthenticatedUserContext(request);
  requireRole(authRole, ["admin"]);

  const sql = requireSql();
  const users = await sql.userAccount.findMany({
    include: { roles: true },
    orderBy: { createdAt: "desc" },
  });
  const userProfileSnapshots = users.length
    ? await db.getAll(...users.map((account) => db.collection("users").doc(account.uid)))
    : [];
  const userProfilesByUid = new Map(
    userProfileSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, snapshot.data()])
  );

  return {
    users: users.map((account) => buildUserAccountResponse(account, userProfilesByUid.get(account.uid))),
  };
});

exports.adminGetApprovalQueue = onCall(async (request) => {
  const { authRole } = await getAuthenticatedUserContext(request);
  requireRole(authRole, ["admin"]);

  const sql = requireSql();
  const [restaurants, dispatchApplicationsSnapshot, partnerApplicationsSnapshot] = await Promise.all([
    sql.restaurantRecord.findMany({
      include: { approval: true },
      orderBy: [{ isPublished: "asc" }, { updatedAt: "desc" }],
    }),
    db.collection("dispatchApplications").orderBy("submittedAt", "desc").get(),
    db.collection("partnerApplications").orderBy("submittedAt", "desc").get(),
  ]);

  return {
    dispatchApplications: dispatchApplicationsSnapshot.docs.map((snapshot) =>
      buildDispatchApplicationResponse({
        id: snapshot.id,
        ...snapshot.data(),
      })
    ),
    partnerApplications: partnerApplicationsSnapshot.docs.map((snapshot) =>
      buildPartnerApplicationResponse({
        id: snapshot.id,
        ...snapshot.data(),
      })
    ),
    restaurants: restaurants.map((restaurant) => buildRestaurantResponse(restaurant, restaurant.approval)),
  };
});

exports.adminReviewDispatchApplication = onCall(async (request) => {
  const { authRole, uid } = await getAuthenticatedUserContext(request);
  requireRole(authRole, ["admin"]);

  await assertRateLimit({
    scope: "admin_review_dispatch_application",
    uid,
    windowMs: 60 * 1000,
    maxRequests: 20,
  });

  const applicationId = sanitizeText(request.data?.applicationId);
  const decision = sanitizeText(request.data?.decision);
  const rejectionReason = sanitizeOptionalText(request.data?.rejectionReason);

  if (!applicationId) {
    throw new HttpsError("invalid-argument", "A dispatch application id is required.");
  }

  if (!["approve", "reject"].includes(decision)) {
    throw new HttpsError("invalid-argument", "Use approve or reject when reviewing a dispatch application.");
  }

  const applicationRef = db.collection("dispatchApplications").doc(applicationId);
  const riderRef = db.collection("dispatchProfiles").doc(applicationId);
  const userRef = db.collection("users").doc(applicationId);
  const nowIso = new Date().toISOString();

  const applicationSnapshot = await applicationRef.get();

  if (!applicationSnapshot.exists) {
    throw new HttpsError("not-found", "The selected dispatch application could not be found.");
  }

  const application = {
    id: applicationSnapshot.id,
    ...applicationSnapshot.data(),
  };

  const currentStatus = sanitizeText(application.status, DISPATCH_APPLICATION_STATUS.PENDING);

  if (decision === "approve" && currentStatus === DISPATCH_APPLICATION_STATUS.APPROVED) {
    return {
      approvedByUid: sanitizeOptionalText(application.approvedByUid),
      applicationId,
      decision,
      role: "dispatch",
      tokenRefreshRequired: true,
    };
  }

  if (decision === "reject" && currentStatus === DISPATCH_APPLICATION_STATUS.REJECTED) {
    return {
      approvedByUid: sanitizeOptionalText(application.approvedByUid),
      applicationId,
      decision,
      role: "customer",
      tokenRefreshRequired: false,
    };
  }

  if (currentStatus !== DISPATCH_APPLICATION_STATUS.PENDING) {
    throw new HttpsError(
      "failed-precondition",
      `This dispatch application has already been reviewed as ${currentStatus}.`
    );
  }

  let result = {
    application,
    decision,
  };

  if (decision === "approve") {
    let claimUpdated = false;
    let sqlRoleSynced = false;
    let sqlRiderSynced = false;

    try {
      await setRoleClaim(applicationId, "dispatch");
      claimUpdated = true;

      await syncSqlUserRole({
        uid: applicationId,
        role: "dispatch",
        assignedByUid: uid,
      });
      sqlRoleSynced = true;

      await upsertSqlDispatchRider({
        riderId: applicationId,
        acceptanceRate: 100,
        activeLoad: 0,
        completedTrips: 0,
        displayName: sanitizeText(application.displayName, "Dispatch rider"),
        latitude: parseNumber(application.latitude, 0),
        longitude: parseNumber(application.longitude, 0),
        status: "Available",
        vehicleType: sanitizeText(application.vehicleType, "Bike"),
        zone: sanitizeText(application.region),
      });
      sqlRiderSynced = true;

      await db.runTransaction(async (transaction) => {
        const latestApplicationSnapshot = await transaction.get(applicationRef);

        if (!latestApplicationSnapshot.exists) {
          throw new HttpsError("not-found", "The selected dispatch application could not be found.");
        }

        const latestApplication = {
          id: latestApplicationSnapshot.id,
          ...latestApplicationSnapshot.data(),
        };

        const latestStatus = sanitizeText(latestApplication.status, DISPATCH_APPLICATION_STATUS.PENDING);

        if (latestStatus !== DISPATCH_APPLICATION_STATUS.PENDING) {
          throw new HttpsError(
            "failed-precondition",
            `This dispatch application has already been reviewed as ${latestStatus}.`
          );
        }

        transaction.set(
          applicationRef,
          {
            approvedByUid: uid,
            rejectionReason: null,
            reviewedAt: nowIso,
            status: DISPATCH_APPLICATION_STATUS.APPROVED,
            updatedAt: nowIso,
          },
          { merge: true }
        );

        transaction.set(
          userRef,
          {
            dispatchApplicationRejectionReason: null,
            dispatchApplicationReviewedAt: nowIso,
            dispatchApplicationStatus: DISPATCH_APPLICATION_STATUS.APPROVED,
            displayName: sanitizeText(latestApplication.displayName, latestApplication.email.split("@")[0]),
            email: sanitizeText(latestApplication.email),
            emailVerified: false,
            phoneNumber: sanitizeText(latestApplication.phoneNumber),
            role: "dispatch",
            uid: latestApplication.id,
            updatedAt: nowIso,
          },
          { merge: true }
        );

        transaction.set(
          riderRef,
          {
            activeLoad: 0,
            acceptanceRate: 100,
            completedTrips: 0,
            currentAddress: sanitizeOptionalText(latestApplication.currentAddress),
            displayName: sanitizeText(latestApplication.displayName, "Dispatch rider"),
            latitude: parseNumber(latestApplication.latitude, 0),
            longitude: parseNumber(latestApplication.longitude, 0),
            phoneNumber: sanitizeText(latestApplication.phoneNumber),
            region: sanitizeText(latestApplication.region),
            status: "Available",
            updatedAt: nowIso,
            vehicleType: sanitizeText(latestApplication.vehicleType, "Bike"),
            zone: sanitizeText(latestApplication.region),
          },
          { merge: true }
        );
      });

      result = {
        application,
        decision,
      };
    } catch (approvalError) {
      logStructured("error", "dispatch_application_approval_failed", {
        actorUid: uid,
        applicationId,
        claimUpdated,
        sqlRoleSynced,
        sqlRiderSynced,
        error: approvalError instanceof Error ? approvalError.message : String(approvalError),
      });

      const rollbackErrors = [];

      if (claimUpdated) {
        try {
          await setRoleClaim(applicationId, "customer");
        } catch (rollbackError) {
          rollbackErrors.push(`claim:${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
        }
      }

      if (sqlRoleSynced) {
        try {
          await syncSqlUserRole({
            uid: applicationId,
            role: "customer",
            assignedByUid: uid,
          });
        } catch (rollbackError) {
          rollbackErrors.push(`sql_role:${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
        }
      }

      if (sqlRiderSynced) {
        try {
          await deleteSqlDispatchRider({
            riderId: applicationId,
          });
        } catch (rollbackError) {
          rollbackErrors.push(`sql_rider:${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
        }
      }

      if (rollbackErrors.length) {
        logStructured("error", "dispatch_application_approval_rollback_failed", {
          actorUid: uid,
          applicationId,
          rollbackErrors,
        });
      }

      throw approvalError;
    }
  } else {
    result = await db.runTransaction(async (transaction) => {
      const latestApplicationSnapshot = await transaction.get(applicationRef);

      if (!latestApplicationSnapshot.exists) {
        throw new HttpsError("not-found", "The selected dispatch application could not be found.");
      }

      const latestApplication = {
        id: latestApplicationSnapshot.id,
        ...latestApplicationSnapshot.data(),
      };

      const latestStatus = sanitizeText(latestApplication.status, DISPATCH_APPLICATION_STATUS.PENDING);
      if (latestStatus !== DISPATCH_APPLICATION_STATUS.PENDING) {
        throw new HttpsError(
          "failed-precondition",
          `This dispatch application has already been reviewed as ${latestStatus}.`
        );
      }

      transaction.set(
        applicationRef,
        {
          approvedByUid: uid,
          rejectionReason: rejectionReason ?? "Application rejected by admin review.",
          reviewedAt: nowIso,
          status: DISPATCH_APPLICATION_STATUS.REJECTED,
          updatedAt: nowIso,
        },
        { merge: true }
      );

      transaction.set(
        userRef,
        {
          dispatchApplicationRejectionReason: rejectionReason ?? "Application rejected by admin review.",
          dispatchApplicationReviewedAt: nowIso,
          dispatchApplicationStatus: DISPATCH_APPLICATION_STATUS.REJECTED,
          updatedAt: nowIso,
        },
        { merge: true }
      );

      return {
        application: latestApplication,
        decision,
      };
    });
  }

  await auditSqlAction({
    actorUid: uid,
    action: decision === "approve" ? "dispatch_application_approved" : "dispatch_application_rejected",
    targetType: "dispatch_application",
    targetId: applicationId,
    details: {
      rejectionReason: rejectionReason ?? null,
      vehicleType: sanitizeText(result.application.vehicleType),
    },
  });
  logStructured("warn", "dispatch_application_reviewed", {
    actorUid: uid,
    applicationId,
    decision,
  });

  return {
    approvedByUid: decision === "approve" ? uid : null,
    applicationId,
    decision,
    role: decision === "approve" ? "dispatch" : "customer",
    tokenRefreshRequired: decision === "approve",
  };
});

exports.adminReviewPartnerApplication = onCall(async (request) => {
  const { authRole, uid } = await getAuthenticatedUserContext(request);
  requireRole(authRole, ["admin"]);

  await assertRateLimit({
    scope: "admin_review_partner_application",
    uid,
    windowMs: 60 * 1000,
    maxRequests: 20,
  });

  const applicationId = sanitizeText(request.data?.applicationId);
  const decision = sanitizeText(request.data?.decision);
  const rejectionReason = sanitizeOptionalText(request.data?.rejectionReason);

  if (!applicationId) {
    throw new HttpsError("invalid-argument", "A partner application id is required.");
  }

  if (!["approve", "reject"].includes(decision)) {
    throw new HttpsError("invalid-argument", "Use approve or reject when reviewing a partner application.");
  }

  const applicationRef = db.collection("partnerApplications").doc(applicationId);
  const userRef = db.collection("users").doc(applicationId);
  const nowIso = new Date().toISOString();
  const applicationSnapshot = await applicationRef.get();

  if (!applicationSnapshot.exists) {
    throw new HttpsError("not-found", "The selected partner application could not be found.");
  }

  const application = {
    id: applicationSnapshot.id,
    ...applicationSnapshot.data(),
  };

  const currentStatus = sanitizeText(application.status, PARTNER_APPLICATION_STATUS.PENDING);

  if (decision === "approve" && currentStatus === PARTNER_APPLICATION_STATUS.APPROVED) {
    return {
      applicationId,
      approvedByUid: sanitizeOptionalText(application.approvedByUid),
      decision,
      restaurantId: sanitizeOptionalText(application.restaurantId),
      role: "restaurant",
      tokenRefreshRequired: true,
    };
  }

  if (decision === "reject" && currentStatus === PARTNER_APPLICATION_STATUS.REJECTED) {
    return {
      applicationId,
      approvedByUid: sanitizeOptionalText(application.approvedByUid),
      decision,
      restaurantId: sanitizeOptionalText(application.restaurantId),
      role: "customer",
      tokenRefreshRequired: false,
    };
  }

  if (currentStatus !== PARTNER_APPLICATION_STATUS.PENDING) {
    throw new HttpsError(
      "failed-precondition",
      `This partner application has already been reviewed as ${currentStatus}.`
    );
  }

  let result = {
    application,
    decision,
    restaurantId: null,
  };

  if (decision === "approve") {
    const restaurantId = sanitizeText(application.restaurantId) || db.collection("restaurants").doc().id;
    const restaurantRef = db.collection("restaurants").doc(restaurantId);
    let claimUpdated = false;
    let sqlRoleSynced = false;
    let sqlRestaurantSynced = false;

    try {
      await setRoleClaim(applicationId, "restaurant");
      claimUpdated = true;

      await syncSqlUserRole({
        uid: applicationId,
        role: "restaurant",
        assignedByUid: uid,
        restaurantId,
      });
      sqlRoleSynced = true;

      await syncSqlRestaurant({
        restaurantId,
        ownerId: application.id,
        name: sanitizeText(application.restaurantName, "Restaurant"),
        nameKey: buildNameKey(sanitizeText(application.restaurantName, "Restaurant")),
        cuisine: sanitizeOptionalText(application.cuisine),
        address: sanitizeOptionalText(application.address),
        description: sanitizeOptionalText(application.description) ?? "",
        image: "",
        deliveryFee: 0,
        deliveryRadiusKm: 12,
        deliveryTime: sanitizeOptionalText(application.deliveryTime) ?? "25-35 min",
        latitude:
          application.latitude === null || application.latitude === undefined
            ? null
            : parseNumber(application.latitude, 0),
        longitude:
          application.longitude === null || application.longitude === undefined
            ? null
            : parseNumber(application.longitude, 0),
        minOrder: 0,
        supportsDelivery: true,
        supportsPickup: true,
        isOpen: true,
        isPublished: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      sqlRestaurantSynced = true;

      await syncSqlRestaurantApproval({
        restaurantId,
        status: "pending",
        approvedByUid: null,
        approvedAt: null,
      });

      result = await db.runTransaction(async (transaction) => {
        const latestApplicationSnapshot = await transaction.get(applicationRef);

        if (!latestApplicationSnapshot.exists) {
          throw new HttpsError("not-found", "The selected partner application could not be found.");
        }

        const latestApplication = {
          id: latestApplicationSnapshot.id,
          ...latestApplicationSnapshot.data(),
        };
        const latestStatus = sanitizeText(latestApplication.status, PARTNER_APPLICATION_STATUS.PENDING);

        if (latestStatus !== PARTNER_APPLICATION_STATUS.PENDING) {
          throw new HttpsError(
            "failed-precondition",
            `This partner application has already been reviewed as ${latestStatus}.`
          );
        }

        transaction.set(
          applicationRef,
          {
            approvedByUid: uid,
            rejectionReason: null,
            reviewedAt: nowIso,
            status: PARTNER_APPLICATION_STATUS.APPROVED,
            restaurantId,
            updatedAt: nowIso,
          },
          { merge: true }
        );

        transaction.set(
          userRef,
          {
            displayName: sanitizeText(latestApplication.contactName, latestApplication.email.split("@")[0]),
            email: sanitizeText(latestApplication.email),
            emailVerified: false,
            phoneNumber: sanitizeText(latestApplication.phoneNumber),
            partnerApplicationRejectionReason: null,
            partnerApplicationReviewedAt: nowIso,
            partnerApplicationStatus: PARTNER_APPLICATION_STATUS.APPROVED,
            restaurantId,
            restaurantLinkedAt: nowIso,
            restaurantLinkSource: "partner_application_approved",
            restaurantName: sanitizeText(latestApplication.restaurantName, "Restaurant"),
            role: "restaurant",
            uid: latestApplication.id,
            updatedAt: nowIso,
          },
          { merge: true }
        );

        transaction.set(
          restaurantRef,
          {
            address: sanitizeText(latestApplication.address),
            approvalStatus: "pending",
            cuisine: sanitizeText(latestApplication.cuisine),
            createdAt: serverTimestamp(),
            deliveryFee: 0,
            deliveryRadiusKm: 12,
            deliveryTime: sanitizeOptionalText(latestApplication.deliveryTime) ?? "25-35 min",
            description: sanitizeOptionalText(latestApplication.description) ?? "",
            image: "",
            isOpen: true,
            isPublished: false,
            latitude:
              latestApplication.latitude === null || latestApplication.latitude === undefined
                ? null
                : parseNumber(latestApplication.latitude, 0),
            longitude:
              latestApplication.longitude === null || latestApplication.longitude === undefined
                ? null
                : parseNumber(latestApplication.longitude, 0),
            menu: [],
            minOrder: 0,
            name: sanitizeText(latestApplication.restaurantName, "Restaurant"),
            nameKey: buildNameKey(sanitizeText(latestApplication.restaurantName, "Restaurant")),
            ownerId: latestApplication.id,
            ownerLinkedAt: serverTimestamp(),
            supportsDelivery: true,
            supportsPickup: true,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        return {
          application: latestApplication,
          decision,
          restaurantId,
        };
      });
    } catch (approvalError) {
      logStructured("error", "partner_application_approval_failed", {
        actorUid: uid,
        applicationId,
        restaurantId,
        claimUpdated,
        sqlRoleSynced,
        sqlRestaurantSynced,
        error: approvalError instanceof Error ? approvalError.message : String(approvalError),
      });

      const rollbackErrors = [];

      if (claimUpdated) {
        try {
          await setRoleClaim(applicationId, "customer");
        } catch (rollbackError) {
          rollbackErrors.push(`claim:${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
        }
      }

      if (sqlRoleSynced) {
        try {
          await syncSqlUserRole({
            uid: applicationId,
            role: "customer",
            assignedByUid: uid,
          });
        } catch (rollbackError) {
          rollbackErrors.push(`sql_role:${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
        }
      }

      if (sqlRestaurantSynced) {
        try {
          await deleteSqlRestaurant({
            restaurantId,
          });
        } catch (rollbackError) {
          rollbackErrors.push(`sql_restaurant:${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
        }
      }

      if (rollbackErrors.length) {
        logStructured("error", "partner_application_approval_rollback_failed", {
          actorUid: uid,
          applicationId,
          restaurantId,
          rollbackErrors,
        });
      }

      throw approvalError;
    }
  } else {
    result = await db.runTransaction(async (transaction) => {
      const latestApplicationSnapshot = await transaction.get(applicationRef);

      if (!latestApplicationSnapshot.exists) {
        throw new HttpsError("not-found", "The selected partner application could not be found.");
      }

      const latestApplication = {
        id: latestApplicationSnapshot.id,
        ...latestApplicationSnapshot.data(),
      };
      const latestStatus = sanitizeText(latestApplication.status, PARTNER_APPLICATION_STATUS.PENDING);

      if (latestStatus !== PARTNER_APPLICATION_STATUS.PENDING) {
        throw new HttpsError(
          "failed-precondition",
          `This partner application has already been reviewed as ${latestStatus}.`
        );
      }

      transaction.set(
        applicationRef,
        {
          approvedByUid: uid,
          rejectionReason: rejectionReason ?? "Partner application rejected by admin review.",
          reviewedAt: nowIso,
          status: PARTNER_APPLICATION_STATUS.REJECTED,
          updatedAt: nowIso,
        },
        { merge: true }
      );

      transaction.set(
        userRef,
        {
          partnerApplicationRejectionReason: rejectionReason ?? "Partner application rejected by admin review.",
          partnerApplicationReviewedAt: nowIso,
          partnerApplicationStatus: PARTNER_APPLICATION_STATUS.REJECTED,
          updatedAt: nowIso,
        },
        { merge: true }
      );

      return {
        application: latestApplication,
        decision,
        restaurantId: null,
      };
    });
  }

  await auditSqlAction({
    actorUid: uid,
    action: decision === "approve" ? "partner_application_approved" : "partner_application_rejected",
    targetType: "partner_application",
    targetId: applicationId,
    details: {
      rejectionReason: rejectionReason ?? null,
      restaurantId: result.restaurantId,
    },
  });
  logStructured("warn", "partner_application_reviewed", {
    actorUid: uid,
    applicationId,
    decision,
    restaurantId: result.restaurantId,
  });

  return {
    applicationId,
    approvedByUid: decision === "approve" ? uid : null,
    decision,
    restaurantId: result.restaurantId,
    role: decision === "approve" ? "restaurant" : "customer",
    tokenRefreshRequired: decision === "approve",
  };
});

exports.partnerGetRestaurantContext = onCall(async (request) => {
  const { authRole, uid, user } = await getAuthenticatedUserContext(request);
  assertPartnerRestaurantRole(authRole);

  const sql = requireSql();
  const [restaurant, restaurants] = await Promise.all([
    getManagedRestaurantForUser(uid, user, authRole),
    sql.restaurantRecord.findMany({
      include: { approval: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const restaurantResponse = restaurant ? buildRestaurantResponse(restaurant, restaurant.approval) : null;
  const restaurantList = restaurants.map((entry) => buildRestaurantResponse(entry, entry.approval));
  const claimableRestaurants = restaurantList.filter((candidate) => {
    return !candidate.ownerId || candidate.ownerId === uid || candidate.id === user.restaurantId;
  });

  return {
    claimableRestaurants,
    requiresVerifiedLink: Boolean(restaurantResponse && user.restaurantId !== restaurantResponse.id),
    restaurant: restaurantResponse,
    restaurants: restaurantList,
  };
});

exports.partnerGetRestaurantOrders = onCall(async (request) => {
  const { authRole, uid, user } = await getAuthenticatedUserContext(request);
  assertPartnerRestaurantRole(authRole);

  const restaurant = await getManagedRestaurantForUser(uid, user, authRole);
  if (!restaurant) {
    return {
      orders: [],
      restaurant: null,
    };
  }

  const sql = requireSql();
  const orders = await sql.customerOrder.findMany({
    where: { restaurantId: restaurant.id },
    include: {
      assignment: true,
      items: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return {
    orders: orders.map((order) => buildOrderSnapshotResponse(order)),
    restaurant: buildRestaurantResponse(restaurant, restaurant.approval),
  };
});

exports.partnerGetRestaurantOrder = onCall(async (request) => {
  const { authRole, uid, user } = await getAuthenticatedUserContext(request);
  assertPartnerRestaurantRole(authRole);

  const orderId = sanitizeText(request.data?.orderId);
  if (!orderId) {
    throw new HttpsError("invalid-argument", "An order id is required.");
  }

  const sql = requireSql();
  const order = await sql.customerOrder.findUnique({
    where: { id: orderId },
    include: {
      assignment: true,
      items: true,
    },
  });

  if (!order) {
    throw new HttpsError("not-found", "The selected order could not be found.");
  }

  const restaurant = await getManagedRestaurantForUser(uid, user, authRole);
  if (!restaurant || restaurant.id !== order.restaurantId) {
    throw new HttpsError("permission-denied", "This order does not belong to your restaurant profile.");
  }

  return {
    order: buildOrderSnapshotResponse(order),
  };
});

exports.dispatchGetDeliveryQueue = onCall(async (request) => {
  const { authRole } = await getAuthenticatedUserContext(request);
  requireRole(authRole, ["dispatch", "admin"]);

  const sql = requireSql();
  const orders = await sql.customerOrder.findMany({
    where: { fulfillmentType: "delivery" },
    include: {
      assignment: true,
      items: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return {
    orders: orders.map((order) => buildOrderSnapshotResponse(order)),
  };
});

exports.dispatchGetRiders = onCall(async (request) => {
  const { authRole } = await getAuthenticatedUserContext(request);
  requireRole(authRole, ["dispatch", "admin"]);

  const sql = requireSql();
  const riders = await sql.dispatchRiderRecord.findMany({
    orderBy: { updatedAt: "desc" },
  });

  return {
    riders: riders.map((rider) => buildDispatchRiderResponse(rider)),
  };
});

exports.dispatchGetOrderDetail = onCall(async (request) => {
  const { authRole } = await getAuthenticatedUserContext(request);
  requireRole(authRole, ["dispatch", "admin"]);

  const orderId = sanitizeText(request.data?.orderId);
  if (!orderId) {
    throw new HttpsError("invalid-argument", "An order id is required.");
  }

  const sql = requireSql();
  const order = await sql.customerOrder.findUnique({
    where: { id: orderId },
    include: {
      assignment: true,
      deliveryEvents: {
        orderBy: { createdAt: "asc" },
      },
      items: true,
    },
  });

  if (!order) {
    throw new HttpsError("not-found", "The selected order could not be found.");
  }

  return {
    order: buildOrderSnapshotResponse(order, {
      events: order.deliveryEvents.map((event) => ({
        actorUid: sanitizeOptionalText(event.actorUid),
        createdAt: toIsoString(event.createdAt),
        details: event.details ?? null,
        eventType: event.eventType,
        id: event.id,
        note: sanitizeOptionalText(event.note),
      })),
    }),
  };
});

exports.upsertDispatchRiderProfile = onCall(async (request) => {
  const { authRole, uid } = await getAuthenticatedUserContext(request);
  requireRole(authRole, ["dispatch", "admin"]);

  await assertRateLimit({
    scope: "upsert_dispatch_rider",
    uid,
    windowMs: 60 * 1000,
    maxRequests: 20,
  });

  const requestedRiderId = sanitizeText(request.data?.riderId);
  const riderId = requestedRiderId || (authRole === "dispatch" ? uid : db.collection("dispatchProfiles").doc().id);
  const draft = normalizeDispatchRiderDraft(request.data);
  let persistedDraft = draft;

  if (authRole === "dispatch") {
    if (riderId !== uid) {
      throw new HttpsError("permission-denied", "Dispatch riders can only update their own rider profile.");
    }

    const sql = requireSql();
    const existingRider = await sql.dispatchRiderRecord.findUnique({
      where: { id: riderId },
    });

    if (!existingRider) {
      throw new HttpsError(
        "failed-precondition",
        "Your rider profile must be provisioned by admin approval before you can update live dispatch status."
      );
    }

    persistedDraft = {
      acceptanceRate: existingRider.acceptanceRate,
      activeLoad: existingRider.activeLoad,
      completedTrips: existingRider.completedTrips,
      displayName: existingRider.displayName,
      latitude: draft.latitude,
      longitude: draft.longitude,
      status: draft.status,
      vehicleType: existingRider.vehicleType,
      zone: draft.zone,
    };
  }

  await upsertSqlDispatchRider({
    riderId,
    ...persistedDraft,
  });

  await db.collection("dispatchProfiles").doc(riderId).set(
    {
      acceptanceRate: persistedDraft.acceptanceRate,
      activeLoad: persistedDraft.activeLoad,
      completedTrips: persistedDraft.completedTrips,
      createdAt: serverTimestamp(),
      displayName: persistedDraft.displayName,
      latitude: persistedDraft.latitude,
      longitude: persistedDraft.longitude,
      status: persistedDraft.status,
      updatedAt: serverTimestamp(),
      vehicleType: persistedDraft.vehicleType,
      zone: persistedDraft.zone,
    },
    { merge: true }
  );

  await auditSqlAction({
    actorUid: uid,
    action: "dispatch_rider_upserted",
    targetType: "dispatch_rider",
    targetId: riderId,
    details: {
      status: persistedDraft.status,
      zone: persistedDraft.zone,
    },
  });

  return {
    rider: buildDispatchRiderResponse({
      id: riderId,
      updatedAt: new Date(),
      ...persistedDraft,
    }),
  };
});

exports.upsertPartnerRestaurantMenu = onCall(async (request) => {
  const { authRole, uid, user } = await getAuthenticatedUserContext(request);
  assertPartnerRestaurantRole(authRole);

  await assertRateLimit({
    scope: "upsert_partner_menu",
    uid,
    windowMs: 60 * 1000,
    maxRequests: 20,
  });

  const restaurantId = sanitizeText(request.data?.restaurantId);
  if (!restaurantId) {
    throw new HttpsError("invalid-argument", "A restaurant id is required.");
  }

  const menu = normalizePartnerMenuInput(request.data?.menu);
  const restaurantRef = db.collection("restaurants").doc(restaurantId);

  await db.runTransaction(async (transaction) => {
    const restaurantSnapshot = await transaction.get(restaurantRef);

    if (!restaurantSnapshot.exists) {
      throw new HttpsError("not-found", "The selected restaurant could not be found.");
    }

    const restaurant = {
      id: restaurantSnapshot.id,
      ...restaurantSnapshot.data(),
    };

    if (authRole !== "admin" && !canManageRestaurant(restaurant, user, uid)) {
      throw new HttpsError("permission-denied", "You are not allowed to update this restaurant's menu.");
    }

    transaction.set(
      restaurantRef,
      {
        menu,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  });

  const savedRestaurantSnapshot = await restaurantRef.get();
  if (savedRestaurantSnapshot.exists) {
    const savedRestaurant = {
      id: savedRestaurantSnapshot.id,
      ...savedRestaurantSnapshot.data(),
    };
    await syncSqlRestaurantFromProfile({
      restaurantId,
      profile: savedRestaurant,
      approvedByUid: authRole === "admin" && savedRestaurant.isPublished === true ? uid : null,
      approvedAt: authRole === "admin" && savedRestaurant.isPublished === true ? new Date() : null,
    });
  }

  await auditSqlAction({
    actorUid: uid,
    action: "partner_menu_upserted",
    targetType: "restaurant",
    targetId: restaurantId,
    details: {
      categories: menu.length,
      items: menu.reduce((sum, category) => sum + category.items.length, 0),
    },
  });

  return {
    categories: menu.length,
    items: menu.reduce((sum, category) => sum + category.items.length, 0),
    restaurantId,
  };
});

exports.placeCustomerOrder = onCall(async (request) => {
  const { authRole, uid } = await getAuthenticatedUserContext(request);
  requireRole(authRole, ["customer"]);

  await assertRateLimit({
    scope: "place_customer_order",
    uid,
    windowMs: 60 * 1000,
    maxRequests: 8,
  });

  const restaurantId = sanitizeText(request.data?.restaurantId);
  const fulfillmentType = sanitizeText(request.data?.fulfillmentType, "delivery");
  const paymentMethod = sanitizeText(request.data?.paymentMethod, PAYMENT_METHOD.CARD);
  const idempotencyKey = sanitizeText(request.data?.idempotencyKey);
  const tip = roundCurrency(parseNumber(request.data?.tipAmount, 0));

  if (!restaurantId) {
    throw new HttpsError("invalid-argument", "A restaurant is required to place an order.");
  }

  if (!["delivery", "pickup"].includes(fulfillmentType)) {
    throw new HttpsError("invalid-argument", "Unsupported fulfillment type.");
  }

  if (![PAYMENT_METHOD.CARD, PAYMENT_METHOD.CASH, PAYMENT_METHOD.WALLET].includes(paymentMethod)) {
    throw new HttpsError("invalid-argument", "Unsupported payment method.");
  }

  if (isPrepaidMethod(paymentMethod)) {
    throw new HttpsError("failed-precondition", PREPAID_CHECKOUT_DISABLED_MESSAGE);
  }

  if (tip < 0 || tip > 100) {
    throw new HttpsError("invalid-argument", "Tip amount is outside the allowed range.");
  }

  if (idempotencyKey) {
    const existingIdempotencyRecord = await getSqlIdempotencyRecord({
      key: `${uid}:place_customer_order:${idempotencyKey}`,
    });

    if (existingIdempotencyRecord?.response) {
      return existingIdempotencyRecord.response;
    }
  }

  const restaurantRef = db.collection("restaurants").doc(restaurantId);
  const restaurantSnapshot = await restaurantRef.get();

  if (!restaurantSnapshot.exists) {
    throw new HttpsError("not-found", "The selected restaurant no longer exists.");
  }

  const restaurant = {
    id: restaurantSnapshot.id,
    ...restaurantSnapshot.data(),
  };

  if (restaurant.isPublished === false || restaurant.isOpen === false) {
    throw new HttpsError("failed-precondition", "This restaurant is not accepting orders right now.");
  }

  if (sanitizeOptionalText(restaurant.approvalStatus) && sanitizeText(restaurant.approvalStatus) !== "approved") {
    throw new HttpsError("failed-precondition", "This restaurant is not accepting orders right now.");
  }

  if (fulfillmentType === "delivery" && restaurant.supportsDelivery === false) {
    throw new HttpsError("failed-precondition", "This restaurant does not support delivery.");
  }

  if (fulfillmentType === "pickup" && restaurant.supportsPickup === false) {
    throw new HttpsError("failed-precondition", "This restaurant does not support pickup.");
  }

  const items = buildOrderItems(request.data?.items, restaurantId, restaurant);
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const deliveryFee = fulfillmentType === "delivery" ? parseNumber(restaurant.deliveryFee, 0) : 0;
  const minOrder = parseNumber(restaurant.minOrder, 0);

  if (subtotal < minOrder) {
    throw new HttpsError(
      "failed-precondition",
      `This restaurant requires a minimum order of ${minOrder.toFixed(2)}.`
    );
  }

  const deliveryLocation = fulfillmentType === "delivery" ? normalizeDeliveryLocation(request.data?.deliveryLocation) : null;
  if (fulfillmentType === "delivery" && !deliveryLocation) {
    throw new HttpsError("invalid-argument", "A valid delivery location is required.");
  }

  const pricing = calculatePricing({
    deliveryFee,
    subtotal,
    tip,
  });
  const payment = buildInitialPaymentSummary({
    paymentMethod,
    total: pricing.total,
  });

  const orderRef = db.collection("orders").doc();
  const now = new Date();
  const initialTimeline = {
    placedAt: now.toISOString(),
  };
  const orderPayload = {
    createdAt: serverTimestamp(),
    customerId: uid,
    deliveryAddress: deliveryLocation?.address ?? null,
    deliveryLocation,
    fulfillmentType,
    items,
    payment,
    pricing,
    restaurantId,
    restaurantName: sanitizeText(restaurant.name, "Restaurant"),
    status: ORDER_STATUS.PLACED,
    timeline: {
      placedAt: serverTimestamp(),
    },
    total: pricing.total,
    updatedAt: serverTimestamp(),
  };

  await createSqlOrder({
    orderId: orderRef.id,
    customerId: uid,
    restaurantId,
    restaurantName: sanitizeText(restaurant.name, "Restaurant"),
    status: ORDER_STATUS.PLACED,
    fulfillmentType,
    pricing,
    payment,
    deliveryAddress: deliveryLocation?.address ?? null,
    deliveryLocation,
    cancellation: null,
    timeline: initialTimeline,
    createdAt: now,
    updatedAt: now,
    items,
  });

  await orderRef.set(orderPayload);

  await recordSqlDeliveryEvent({
    orderId: orderRef.id,
    eventType: "order_placed",
    actorUid: uid,
    details: {
      fulfillmentType,
      paymentMethod,
      total: pricing.total,
    },
  });

  const response = {
    orderId: orderRef.id,
    paymentStatus: payment.status,
    total: pricing.total,
    status: ORDER_STATUS.PLACED,
  };

  if (idempotencyKey) {
    await storeSqlIdempotencyRecord({
      key: `${uid}:place_customer_order:${idempotencyKey}`,
      scope: "place_customer_order",
      actorUid: uid,
      response,
    });
  }

  logStructured("info", "customer_order_placed", {
    customerId: uid,
    fulfillmentType,
    orderId: orderRef.id,
    restaurantId,
    total: pricing.total,
  });

  return response;
});

exports.partnerUpdateOrderStatus = onCall(async (request) => {
  const { authRole, uid, user } = await getAuthenticatedUserContext(request);
  requireRole(authRole, ["restaurant", "admin"]);

  await assertRateLimit({
    scope: "partner_update_order_status",
    uid,
    windowMs: 60 * 1000,
    maxRequests: 24,
  });

  const orderId = sanitizeText(request.data?.orderId);
  const action = sanitizeText(request.data?.action);

  if (!orderId) {
    throw new HttpsError("invalid-argument", "An order id is required.");
  }

  const orderRef = db.collection("orders").doc(orderId);

  const result = await db.runTransaction(async (transaction) => {
    const orderSnapshot = await transaction.get(orderRef);

    if (!orderSnapshot.exists) {
      throw new HttpsError("not-found", "The selected order could not be found.");
    }

    const order = {
      id: orderSnapshot.id,
      ...orderSnapshot.data(),
    };

    assertNonTerminalOrder(order);
    await assertPartnerCanManageOrder(transaction, order, user, uid);

    const { status, update } = buildPartnerUpdate(normalizeOrderStatus(order.status), action);
    const refundUpdate =
      action === "reject"
        ? buildRefundUpdate({
            order,
            reason: "restaurant_rejected_order",
            refundRate: 1,
          })
        : {};

    transaction.update(orderRef, {
      ...update,
      ...refundUpdate,
    });

    return {
      orderId,
      status,
    };
  });

  const updatedOrderSnapshot = await orderRef.get();
  if (updatedOrderSnapshot.exists) {
    const updatedOrder = updatedOrderSnapshot.data();
    await syncSqlOrderFromState({
      orderId,
      status: sanitizeText(updatedOrder.status, result.status),
      pricing: updatedOrder.pricing,
      payment: updatedOrder.payment,
      cancellation: updatedOrder.cancellation ?? null,
      timeline: updatedOrder.timeline ?? null,
      deliveryAddress: sanitizeOptionalText(updatedOrder.deliveryAddress),
      deliveryLocation: updatedOrder.deliveryLocation ?? null,
      assignment: updatedOrder.assignment ?? undefined,
    });
  }

  await recordSqlDeliveryEvent({
    orderId,
    eventType: `partner_${action}`,
    actorUid: uid,
    details: {
      nextStatus: result.status,
    },
  });
  logStructured("info", "partner_order_status_updated", {
    action,
    actorUid: uid,
    nextStatus: result.status,
    orderId,
  });

  return result;
});

exports.dispatchAssignOrderCourier = onCall(async (request) => {
  const { authRole, uid } = await getAuthenticatedUserContext(request);
  requireRole(authRole, ["dispatch", "admin"]);

  await assertRateLimit({
    scope: "dispatch_assign_courier",
    uid,
    windowMs: 60 * 1000,
    maxRequests: 30,
  });

  const orderId = sanitizeText(request.data?.orderId);
  const courierId = sanitizeText(request.data?.courierId);

  if (!orderId || !courierId) {
    throw new HttpsError("invalid-argument", "Order id and courier id are required.");
  }

  const orderRef = db.collection("orders").doc(orderId);
  const sql = requireSql();
  const courier = await sql.dispatchRiderRecord.findUnique({
    where: { id: courierId },
  });

  if (!courier) {
    throw new HttpsError("not-found", "The selected rider could not be found.");
  }

  const courierName =
    sanitizeText(courier.displayName) ||
    `Rider ${courier.id.slice(-4)}`;

  const result = await db.runTransaction(async (transaction) => {
    const orderSnapshot = await transaction.get(orderRef);

    if (!orderSnapshot.exists) {
      throw new HttpsError("not-found", "The selected order could not be found.");
    }

    const order = {
      id: orderSnapshot.id,
      ...orderSnapshot.data(),
    };

    assertNonTerminalOrder(order);
    const currentStatus = normalizeOrderStatus(order.status);

    if ((order.fulfillmentType ?? "delivery") !== "delivery") {
      throw new HttpsError("failed-precondition", "Only delivery orders can be assigned to riders.");
    }

    assertDispatchCanAssignCourier(currentStatus);
    const previousCourierId = sanitizeText(order.assignment?.courierId);

    transaction.update(orderRef, {
      assignment: {
        courierId: courier.id,
        courierName,
        dispatchId: uid,
        assignedAt: serverTimestamp(),
      },
      updatedAt: serverTimestamp(),
    });

    return {
      courierId: courier.id,
      courierName,
      orderId,
      wasReassigned: Boolean(previousCourierId && previousCourierId !== courier.id),
    };
  });

  const updatedOrderSnapshot = await orderRef.get();
  if (updatedOrderSnapshot.exists) {
    const updatedOrder = updatedOrderSnapshot.data();
    await syncSqlOrderFromState({
      orderId,
      status: sanitizeText(updatedOrder.status),
      pricing: updatedOrder.pricing,
      payment: updatedOrder.payment,
      cancellation: updatedOrder.cancellation ?? null,
      timeline: updatedOrder.timeline ?? null,
      deliveryAddress: sanitizeOptionalText(updatedOrder.deliveryAddress),
      deliveryLocation: updatedOrder.deliveryLocation ?? null,
      assignment: updatedOrder.assignment ?? null,
    });
  }

  await recordSqlDeliveryEvent({
    orderId,
    eventType: result.wasReassigned ? "courier_reassigned" : "courier_assigned",
    actorUid: uid,
    details: {
      courierId: result.courierId,
      courierName: result.courierName,
    },
  });
  logStructured("info", "dispatch_courier_assignment_updated", {
    actorUid: uid,
    courierId: result.courierId,
    orderId,
    reassigned: result.wasReassigned,
  });

  return result;
});

exports.dispatchUpdateOrderStatus = onCall(async (request) => {
  const { authRole, uid } = await getAuthenticatedUserContext(request);
  requireRole(authRole, ["dispatch", "admin"]);

  await assertRateLimit({
    scope: "dispatch_update_order_status",
    uid,
    windowMs: 60 * 1000,
    maxRequests: 30,
  });

  const orderId = sanitizeText(request.data?.orderId);
  const action = sanitizeText(request.data?.action);

  if (!orderId) {
    throw new HttpsError("invalid-argument", "An order id is required.");
  }

  const orderRef = db.collection("orders").doc(orderId);

  const result = await db.runTransaction(async (transaction) => {
    const orderSnapshot = await transaction.get(orderRef);

    if (!orderSnapshot.exists) {
      throw new HttpsError("not-found", "The selected order could not be found.");
    }

    const order = {
      id: orderSnapshot.id,
      ...orderSnapshot.data(),
    };

    assertNonTerminalOrder(order);

    if ((order.fulfillmentType ?? "delivery") !== "delivery") {
      throw new HttpsError("failed-precondition", "Dispatch actions are only available for delivery orders.");
    }

    const { status, update } = buildDispatchStatusUpdate(order, action);
    const paymentUpdate =
      action === "delivered" && sanitizeText(order.payment?.method, PAYMENT_METHOD.CASH) === PAYMENT_METHOD.CASH
        ? {
            "payment.capturedAmount": roundCurrency(parseNumber(order.pricing?.total, parseNumber(order.total, 0))),
            "payment.lastEvent": "cash_collected_on_delivery",
            "payment.paidAt": serverTimestamp(),
            "payment.processor": "cash_on_delivery",
            "payment.reference": sanitizeText(order.payment?.reference, `CASH-${orderId.slice(-6).toUpperCase()}`),
            "payment.status": PAYMENT_STATUS.PAID,
          }
        : {};

    transaction.update(orderRef, {
      ...update,
      ...paymentUpdate,
    });

    return {
      orderId,
      status,
    };
  });

  const updatedOrderSnapshot = await orderRef.get();
  if (updatedOrderSnapshot.exists) {
    const updatedOrder = updatedOrderSnapshot.data();
    await syncSqlOrderFromState({
      orderId,
      status: sanitizeText(updatedOrder.status, result.status),
      pricing: updatedOrder.pricing,
      payment: updatedOrder.payment,
      cancellation: updatedOrder.cancellation ?? null,
      timeline: updatedOrder.timeline ?? null,
      deliveryAddress: sanitizeOptionalText(updatedOrder.deliveryAddress),
      deliveryLocation: updatedOrder.deliveryLocation ?? null,
      assignment: updatedOrder.assignment ?? null,
    });
  }

  await recordSqlDeliveryEvent({
    orderId,
    eventType: `dispatch_${action}`,
    actorUid: uid,
    details: {
      nextStatus: result.status,
    },
  });
  logStructured("info", "dispatch_order_status_updated", {
    action,
    actorUid: uid,
    nextStatus: result.status,
    orderId,
  });

  return result;
});

exports.cancelCustomerOrder = onCall(async (request) => {
  const { authRole, uid } = await getAuthenticatedUserContext(request);
  requireRole(authRole, ["customer", "admin"]);

  await assertRateLimit({
    scope: "cancel_customer_order",
    uid,
    windowMs: 60 * 1000,
    maxRequests: 12,
  });

  const orderId = sanitizeText(request.data?.orderId);
  if (!orderId) {
    throw new HttpsError("invalid-argument", "An order id is required.");
  }

  const orderRef = db.collection("orders").doc(orderId);

  const result = await db.runTransaction(async (transaction) => {
    const orderSnapshot = await transaction.get(orderRef);

    if (!orderSnapshot.exists) {
      throw new HttpsError("not-found", "The selected order could not be found.");
    }

    const order = {
      id: orderSnapshot.id,
      ...orderSnapshot.data(),
    };

    const currentStatus = assertCustomerCanCancelOrder(order, uid, authRole);
    const refundRate = getCustomerCancellationRefundRate(currentStatus);
    const refundUpdate = buildRefundUpdate({
      order,
      reason: refundRate === 1 ? "customer_cancelled_full_refund" : "customer_cancelled_partial_refund",
      refundRate,
    });

    transaction.update(orderRef, {
      ...refundUpdate,
      cancellation: {
        actor: authRole === "admin" ? "admin" : "customer",
        refundRate,
      },
      status: ORDER_STATUS.CANCELLED,
      "timeline.cancelledAt": serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return {
      orderId,
      refundRate,
      status: ORDER_STATUS.CANCELLED,
    };
  });

  const updatedOrderSnapshot = await orderRef.get();
  if (updatedOrderSnapshot.exists) {
    const updatedOrder = updatedOrderSnapshot.data();
    await syncSqlOrderFromState({
      orderId,
      status: sanitizeText(updatedOrder.status, result.status),
      pricing: updatedOrder.pricing,
      payment: updatedOrder.payment,
      cancellation: updatedOrder.cancellation ?? null,
      timeline: updatedOrder.timeline ?? null,
      deliveryAddress: sanitizeOptionalText(updatedOrder.deliveryAddress),
      deliveryLocation: updatedOrder.deliveryLocation ?? null,
      assignment: updatedOrder.assignment ?? null,
    });
  }

  await recordSqlDeliveryEvent({
    orderId,
    eventType: "order_cancelled",
    actorUid: uid,
    details: {
      actorRole: authRole,
      refundRate: result.refundRate,
    },
  });
  logStructured("info", "customer_order_cancelled", {
    actorRole: authRole,
    actorUid: uid,
    orderId,
    refundRate: result.refundRate,
  });

  return result;
});

exports.adminUpdateRestaurantApproval = onCall(async (request) => {
  const { authRole, uid } = await getAuthenticatedUserContext(request);
  requireRole(authRole, ["admin"]);

  await assertRateLimit({
    scope: "admin_update_restaurant_approval",
    uid,
    windowMs: 60 * 1000,
    maxRequests: 24,
  });

  const restaurantId = sanitizeText(request.data?.restaurantId);
  const nextPublished =
    typeof request.data?.isPublished === "boolean" ? request.data.isPublished : undefined;
  const nextOpen = typeof request.data?.isOpen === "boolean" ? request.data.isOpen : undefined;

  if (!restaurantId) {
    throw new HttpsError("invalid-argument", "A restaurant id is required.");
  }

  if (nextPublished === undefined && nextOpen === undefined) {
    throw new HttpsError("invalid-argument", "Provide a publish or open-state change.");
  }

  const restaurantRef = db.collection("restaurants").doc(restaurantId);

  const result = await db.runTransaction(async (transaction) => {
    const restaurantSnapshot = await transaction.get(restaurantRef);

    if (!restaurantSnapshot.exists) {
      throw new HttpsError("not-found", "The selected restaurant could not be found.");
    }

    const restaurant = restaurantSnapshot.data();
    const nextApprovalStatus =
      nextPublished === undefined
        ? sanitizeText(restaurant.approvalStatus, restaurant.isPublished === true ? "approved" : "pending")
        : nextPublished
          ? "approved"
          : "unpublished";
    const updates = {
      approvalStatus: nextApprovalStatus,
      ...(nextPublished !== undefined
        ? {
            approvedAt: nextPublished ? serverTimestamp() : null,
            approvedByUid: nextPublished ? uid : null,
          }
        : {}),
      ...(nextPublished !== undefined ? { isPublished: nextPublished } : {}),
      ...(nextOpen !== undefined ? { isOpen: nextOpen } : {}),
      updatedAt: serverTimestamp(),
    };

    transaction.set(restaurantRef, updates, { merge: true });

    return {
      approvalStatus: nextApprovalStatus,
      id: restaurantId,
      isOpen: nextOpen ?? restaurant.isOpen !== false,
      isPublished: nextPublished ?? restaurant.isPublished === true,
      name: sanitizeText(restaurant.name, "Restaurant"),
    };
  });

  const updatedRestaurantSnapshot = await restaurantRef.get();
  if (updatedRestaurantSnapshot.exists) {
    const updatedRestaurant = {
      id: updatedRestaurantSnapshot.id,
      ...updatedRestaurantSnapshot.data(),
    };
    await syncSqlRestaurantFromProfile({
      restaurantId,
      profile: updatedRestaurant,
      approvalStatus: result.approvalStatus,
      approvedByUid: result.isPublished ? uid : null,
      approvedAt: result.isPublished ? new Date() : null,
    });
  }

  await auditSqlAction({
    actorUid: uid,
    action: "restaurant_approval_updated",
    targetType: "restaurant",
    targetId: restaurantId,
    details: {
      isOpen: result.isOpen,
      isPublished: result.isPublished,
    },
  });
  logStructured("info", "restaurant_approval_updated", {
    actorUid: uid,
    isOpen: result.isOpen,
    isPublished: result.isPublished,
    restaurantId,
  });

  return result;
});

exports.claimPartnerRestaurantLink = onCall(async (request) => {
  const { authRole, uid } = await getAuthenticatedUserContext(request);
  assertPartnerRestaurantRole(authRole);

  await assertRateLimit({
    scope: "claim_partner_restaurant_link",
    uid,
    windowMs: 60 * 1000,
    maxRequests: 12,
  });

  const restaurantId = sanitizeText(request.data?.restaurantId);
  if (!restaurantId) {
    throw new HttpsError("invalid-argument", "A restaurant id is required.");
  }

  const restaurantRef = db.collection("restaurants").doc(restaurantId);
  const userRef = db.collection("users").doc(uid);
  const isAdmin = authRole === "admin";

  const result = await db.runTransaction(async (transaction) => {
    const restaurantSnapshot = await transaction.get(restaurantRef);

    if (!restaurantSnapshot.exists) {
      throw new HttpsError("not-found", "The selected restaurant could not be found.");
    }

    const restaurant = {
      id: restaurantSnapshot.id,
      ...restaurantSnapshot.data(),
    };

    assertRestaurantOwnershipAssignable({
      existingOwnerId: sanitizeText(restaurant.ownerId),
      isAdmin,
      uid,
    });

    transaction.set(
      restaurantRef,
      {
        ownerId: uid,
        ownerLinkedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    transaction.set(
      userRef,
      {
        restaurantId: restaurant.id,
        restaurantLinkedAt: serverTimestamp(),
        restaurantLinkSource: "partner_claim",
        restaurantName: sanitizeText(restaurant.name, "Restaurant"),
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    return {
      id: restaurant.id,
      name: sanitizeText(restaurant.name, "Restaurant"),
    };
  });

  const restaurantSnapshot = await restaurantRef.get();
  if (restaurantSnapshot.exists) {
    const restaurant = {
      id: restaurantSnapshot.id,
      ...restaurantSnapshot.data(),
    };
    await syncSqlRestaurantFromProfile({
      restaurantId: restaurant.id,
      profile: restaurant,
      approvedByUid: isAdmin && restaurant.isPublished === true ? uid : null,
      approvedAt: isAdmin && restaurant.isPublished === true ? new Date() : null,
    });
  }

  await auditSqlAction({
    actorUid: uid,
    action: "restaurant_link_claimed",
    targetType: "restaurant",
    targetId: result.id,
    details: {
      isAdmin,
    },
  });

  await syncSqlUserRole({
    uid,
    role: authRole,
    assignedByUid: isAdmin ? uid : null,
    restaurantId: result.id,
  });
  await getUserDocument(uid);

  return result;
});

exports.upsertPartnerRestaurantProfile = onCall(async (request) => {
  const { authRole, uid, user } = await getAuthenticatedUserContext(request);
  assertPartnerRestaurantRole(authRole);

  await assertRateLimit({
    scope: "upsert_partner_restaurant_profile",
    uid,
    windowMs: 60 * 1000,
    maxRequests: 16,
  });

  const requestedRestaurantId = sanitizeText(request.data?.restaurantId);
  const linkedRestaurantId = sanitizeText(user.restaurantId);
  const isAdmin = authRole === "admin";
  const userRef = db.collection("users").doc(uid);

  const result = await db.runTransaction(async (transaction) => {
    let restaurantRef;
    let existingRestaurant = null;

    if (requestedRestaurantId) {
      restaurantRef = db.collection("restaurants").doc(requestedRestaurantId);
      const restaurantSnapshot = await transaction.get(restaurantRef);

      if (!restaurantSnapshot.exists) {
        throw new HttpsError("not-found", "The selected restaurant could not be found.");
      }

      existingRestaurant = {
        id: restaurantSnapshot.id,
        ...restaurantSnapshot.data(),
      };

      if (!isAdmin && linkedRestaurantId && linkedRestaurantId !== requestedRestaurantId) {
        throw new HttpsError(
          "permission-denied",
          "This partner account is already linked to a different restaurant."
        );
      }

      assertRestaurantOwnershipAssignable({
        existingOwnerId: sanitizeText(existingRestaurant.ownerId),
        isAdmin,
        uid,
      });
    } else if (linkedRestaurantId) {
      restaurantRef = db.collection("restaurants").doc(linkedRestaurantId);
      const linkedSnapshot = await transaction.get(restaurantRef);

      if (!linkedSnapshot.exists) {
        throw new HttpsError("failed-precondition", "Your linked restaurant record no longer exists.");
      }

      existingRestaurant = {
        id: linkedSnapshot.id,
        ...linkedSnapshot.data(),
      };

      assertRestaurantOwnershipAssignable({
        existingOwnerId: sanitizeText(existingRestaurant.ownerId),
        isAdmin,
        uid,
      });
    } else {
      restaurantRef = db.collection("restaurants").doc();
    }

    const profile = buildPartnerRestaurantPayload(request.data, uid, {
      allowPublish: isAdmin,
      existingPublished: existingRestaurant?.isPublished === true,
    });
    transaction.set(
      restaurantRef,
      {
        ...profile,
        ...(existingRestaurant ? {} : { createdAt: serverTimestamp() }),
      },
      { merge: true }
    );

    transaction.set(
      userRef,
      {
        restaurantId: restaurantRef.id,
        restaurantLinkedAt: serverTimestamp(),
        restaurantLinkSource: existingRestaurant ? "partner_update" : "partner_create",
        restaurantName: profile.name,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    return {
      id: restaurantRef.id,
      name: profile.name,
    };
  });

  const savedRestaurantSnapshot = await db.collection("restaurants").doc(result.id).get();
  if (savedRestaurantSnapshot.exists) {
    const savedRestaurant = {
      id: savedRestaurantSnapshot.id,
      ...savedRestaurantSnapshot.data(),
    };

    await syncSqlRestaurantFromProfile({
      restaurantId: result.id,
      profile: savedRestaurant,
      approvedByUid: isAdmin && savedRestaurant.isPublished === true ? uid : null,
      approvedAt: isAdmin && savedRestaurant.isPublished === true ? new Date() : null,
    });
  }

  await auditSqlAction({
    actorUid: uid,
    action: requestedRestaurantId || linkedRestaurantId ? "restaurant_profile_updated" : "restaurant_profile_created",
    targetType: "restaurant",
    targetId: result.id,
    details: {
      isAdmin,
    },
  });

  await syncSqlUserRole({
    uid,
    role: authRole,
    assignedByUid: isAdmin ? uid : null,
    restaurantId: result.id,
  });
  await getUserDocument(uid);

  return result;
});
