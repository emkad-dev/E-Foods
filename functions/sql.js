const { PrismaClient } = require("@prisma/client");

const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.__feastyPrisma ??
  new PrismaClient({
    log: ["error"],
  });

let validatedDatabaseUrl = null;

if (!globalForPrisma.__feastyPrisma) {
  globalForPrisma.__feastyPrisma = prisma;
}

const validateDatabaseUrl = (rawValue) => {
  if (validatedDatabaseUrl === rawValue) {
    return;
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(rawValue);
  } catch {
    throw createConfigError("DATABASE_URL must be a valid PostgreSQL connection URI.");
  }

  if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol)) {
    throw createConfigError("DATABASE_URL must use the postgres:// or postgresql:// protocol.");
  }

  if (!parsedUrl.username || !parsedUrl.password || !parsedUrl.hostname) {
    throw createConfigError("DATABASE_URL is missing required username, password, or host details.");
  }

  if (rawValue.includes("[") || rawValue.includes("]")) {
    throw createConfigError(
      "DATABASE_URL still contains placeholder brackets. Replace template placeholders with the real encoded password."
    );
  }

  if (parsedUrl.hostname.endsWith(".supabase.co") && parsedUrl.searchParams.get("sslmode") !== "require") {
    throw createConfigError(
      "Supabase direct Postgres connections must include ?sslmode=require in DATABASE_URL. If this machine cannot reach the direct host, switch DATABASE_URL to the Supavisor Session pooler URI instead."
    );
  }

  validatedDatabaseUrl = rawValue;
};

const requireSql = () => {
  if (!process.env.DATABASE_URL) {
    throw createConfigError(
      "SQL migration is enabled in code, but DATABASE_URL is not configured for functions yet."
    );
  }

  validateDatabaseUrl(process.env.DATABASE_URL);

  return prisma;
};

const parseDateValue = (value) => {
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

const toJsonValue = (value) => {
  if (value === undefined) {
    return null;
  }

  return JSON.parse(JSON.stringify(value));
};

const toOptionalNumber = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsedValue = Number.parseFloat(value);
    return Number.isFinite(parsedValue) ? parsedValue : null;
  }

  return null;
};

const toOptionalInteger = (value, fallback = 0) => {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsedValue = Number.parseInt(value, 10);
    return Number.isInteger(parsedValue) ? parsedValue : fallback;
  }

  return fallback;
};

const syncSqlUserAccount = async ({
  uid,
  email,
  displayName,
  phoneNumber,
  photoURL,
  emailVerified,
  roleDisplay,
  partnerApplicationStatus,
  partnerApplicationReviewedAt,
  partnerApplicationRejectionReason,
  dispatchApplicationStatus,
  dispatchApplicationReviewedAt,
  dispatchApplicationRejectionReason,
  expoPushToken,
  pushTokenUpdatedAt,
  activeSessionId,
  activeSessionUpdatedAt,
  accountDisabled,
  disabledAt,
  disabledByUid,
  lastPrivilegedRole,
  restaurantId,
  restaurantName,
  restaurantLinkedAt,
  restaurantLinkSource,
  createdAt,
  updatedAt,
}) => {
  const sql = requireSql();

  return sql.userAccount.upsert({
    where: { uid },
    create: {
      uid,
      email,
      displayName: displayName ?? null,
      phoneNumber: phoneNumber ?? null,
      photoURL: photoURL ?? null,
      emailVerified: emailVerified === true,
      roleDisplay: roleDisplay ?? null,
      partnerApplicationStatus: partnerApplicationStatus ?? null,
      partnerApplicationReviewedAt: parseDateValue(partnerApplicationReviewedAt),
      partnerApplicationRejectionReason: partnerApplicationRejectionReason ?? null,
      dispatchApplicationStatus: dispatchApplicationStatus ?? null,
      dispatchApplicationReviewedAt: parseDateValue(dispatchApplicationReviewedAt),
      dispatchApplicationRejectionReason: dispatchApplicationRejectionReason ?? null,
      expoPushToken: expoPushToken ?? null,
      pushTokenUpdatedAt: parseDateValue(pushTokenUpdatedAt),
      activeSessionId: activeSessionId ?? null,
      activeSessionUpdatedAt: parseDateValue(activeSessionUpdatedAt),
      accountDisabled: accountDisabled === true,
      disabledAt: parseDateValue(disabledAt),
      disabledByUid: disabledByUid ?? null,
      lastPrivilegedRole: lastPrivilegedRole ?? null,
      restaurantId: restaurantId ?? null,
      restaurantName: restaurantName ?? null,
      restaurantLinkedAt: parseDateValue(restaurantLinkedAt),
      restaurantLinkSource: restaurantLinkSource ?? null,
      createdAt: parseDateValue(createdAt) ?? new Date(),
      updatedAt: parseDateValue(updatedAt) ?? new Date(),
    },
    update: {
      email,
      displayName: displayName ?? null,
      phoneNumber: phoneNumber ?? null,
      photoURL: photoURL ?? null,
      emailVerified: emailVerified === true,
      roleDisplay: roleDisplay ?? null,
      partnerApplicationStatus: partnerApplicationStatus ?? null,
      partnerApplicationReviewedAt: parseDateValue(partnerApplicationReviewedAt),
      partnerApplicationRejectionReason: partnerApplicationRejectionReason ?? null,
      dispatchApplicationStatus: dispatchApplicationStatus ?? null,
      dispatchApplicationReviewedAt: parseDateValue(dispatchApplicationReviewedAt),
      dispatchApplicationRejectionReason: dispatchApplicationRejectionReason ?? null,
      expoPushToken: expoPushToken ?? null,
      pushTokenUpdatedAt: parseDateValue(pushTokenUpdatedAt),
      activeSessionId: activeSessionId ?? null,
      activeSessionUpdatedAt: parseDateValue(activeSessionUpdatedAt),
      accountDisabled: accountDisabled === true,
      disabledAt: parseDateValue(disabledAt),
      disabledByUid: disabledByUid ?? null,
      lastPrivilegedRole: lastPrivilegedRole ?? null,
      restaurantId: restaurantId ?? null,
      restaurantName: restaurantName ?? null,
      restaurantLinkedAt: parseDateValue(restaurantLinkedAt),
      restaurantLinkSource: restaurantLinkSource ?? null,
      updatedAt: parseDateValue(updatedAt) ?? new Date(),
    },
  });
};

const syncSqlUserRole = async ({ uid, role, assignedByUid = null, restaurantId = null }) => {
  const sql = requireSql();

  await sql.userRole.deleteMany({
    where: {
      userId: uid,
      role: {
        not: role,
      },
    },
  });

  return sql.userRole.upsert({
    where: {
      userId_role: {
        userId: uid,
        role,
      },
    },
    create: {
      userId: uid,
      role,
      assignedByUid,
      restaurantId,
    },
    update: {
      assignedByUid,
      restaurantId,
      updatedAt: new Date(),
    },
  });
};

const auditSqlAction = async ({ actorUid, action, targetType, targetId = null, details = null }) => {
  const sql = requireSql();

  return sql.adminAuditLog.create({
    data: {
      action,
      actorUid: actorUid ?? null,
      details: toJsonValue(details),
      targetId,
      targetType,
    },
  });
};

const syncSqlRestaurant = async ({
  restaurantId,
  ownerId = null,
  name,
  nameKey = null,
  cuisine = null,
  address = null,
  description = null,
  image = null,
  menu = [],
  deliveryFee = null,
  deliveryRadiusKm = null,
  deliveryTime = null,
  openingTime = null,
  closingTime = null,
  latitude = null,
  longitude = null,
  minOrder = null,
  paystackSubaccountCode = null,
  supportsDelivery = true,
  supportsPickup = true,
  isOpen = true,
  isPublished = false,
  createdAt = null,
  updatedAt = null,
}) => {
  const sql = requireSql();

  return sql.restaurantRecord.upsert({
    where: { id: restaurantId },
    create: {
      id: restaurantId,
      ownerId,
      name,
      nameKey,
      cuisine,
      address,
      description,
      image,
      menu: toJsonValue(menu ?? []),
      deliveryFee,
      deliveryRadiusKm,
      deliveryTime,
      openingTime,
      closingTime,
      latitude,
      longitude,
      minOrder,
      paystackSubaccountCode,
      supportsDelivery,
      supportsPickup,
      isOpen,
      isPublished,
      createdAt: parseDateValue(createdAt) ?? new Date(),
      updatedAt: parseDateValue(updatedAt) ?? new Date(),
    },
    update: {
      ownerId,
      name,
      nameKey,
      cuisine,
      address,
      description,
      image,
      menu: toJsonValue(menu ?? []),
      deliveryFee,
      deliveryRadiusKm,
      deliveryTime,
      openingTime,
      closingTime,
      latitude,
      longitude,
      minOrder,
      paystackSubaccountCode,
      supportsDelivery,
      supportsPickup,
      isOpen,
      isPublished,
      updatedAt: parseDateValue(updatedAt) ?? new Date(),
    },
  });
};

const syncSqlRestaurantApproval = async ({
  restaurantId,
  status,
  approvedByUid = null,
  approvedAt = null,
}) => {
  const sql = requireSql();

  return sql.restaurantApproval.upsert({
    where: { restaurantId },
    create: {
      restaurantId,
      status,
      approvedByUid,
      approvedAt: parseDateValue(approvedAt),
    },
    update: {
      status,
      approvedByUid,
      approvedAt: parseDateValue(approvedAt),
      updatedAt: new Date(),
    },
  });
};

const deleteSqlRestaurant = async ({ restaurantId }) => {
  const sql = requireSql();

  return sql.restaurantRecord.deleteMany({
    where: { id: restaurantId },
  });
};

const createSqlOrder = async ({
  orderId,
  customerId,
  restaurantId,
  restaurantName,
  status,
  fulfillmentType,
  pricing,
  payment,
  deliveryAddress = null,
  deliveryLocation = null,
  cancellation = null,
  timeline = null,
  createdAt = null,
  updatedAt = null,
  items,
}) => {
  const sql = requireSql();

  return sql.customerOrder.create({
    data: {
      id: orderId,
      customerId,
      restaurantId,
      restaurantName,
      status,
      fulfillmentType,
      pricing: toJsonValue(pricing),
      payment: toJsonValue(payment),
      deliveryAddress,
      deliveryLocation: toJsonValue(deliveryLocation),
      cancellation: toJsonValue(cancellation),
      timeline: toJsonValue(timeline),
      createdAt: parseDateValue(createdAt) ?? new Date(),
      updatedAt: parseDateValue(updatedAt) ?? new Date(),
      items: {
        create: items.map((item) => ({
          itemId: item.id,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          restaurantId: item.restaurantId,
          restaurantName: item.restaurantName,
        })),
      },
    },
  });
};

const updateSqlOrder = async ({
  orderId,
  status,
  pricing,
  payment,
  cancellation,
  timeline,
  deliveryAddress,
  deliveryLocation,
}) => {
  const sql = requireSql();

  return sql.customerOrder.update({
    where: { id: orderId },
    data: {
      ...(status ? { status } : {}),
      ...(pricing !== undefined ? { pricing: toJsonValue(pricing) } : {}),
      ...(payment !== undefined ? { payment: toJsonValue(payment) } : {}),
      ...(cancellation !== undefined ? { cancellation: toJsonValue(cancellation) } : {}),
      ...(timeline !== undefined ? { timeline: toJsonValue(timeline) } : {}),
      ...(deliveryAddress !== undefined ? { deliveryAddress } : {}),
      ...(deliveryLocation !== undefined ? { deliveryLocation: toJsonValue(deliveryLocation) } : {}),
      updatedAt: new Date(),
    },
  });
};

const getSqlPaymentTransactionByReference = async ({ reference }) => {
  const sql = requireSql();

  return sql.paymentTransaction.findUnique({
    where: { reference },
  });
};

const upsertSqlPaymentTransaction = async ({
  orderId,
  customerId,
  restaurantId,
  provider,
  method,
  reference,
  currency,
  amount,
  status,
  accessCode = null,
  authorizationUrl = null,
  externalTransactionId = null,
  channel = null,
  gatewayStatus = null,
  lastError = null,
  paidAt = null,
  failedAt = null,
  verifiedAt = null,
  splitSubaccountCode = null,
  initializeResponse = null,
  verificationResponse = null,
  webhookEvent = null,
}) => {
  const sql = requireSql();

  return sql.paymentTransaction.upsert({
    where: { reference },
    create: {
      orderId,
      customerId,
      restaurantId,
      provider,
      method,
      reference,
      currency,
      amount,
      status,
      accessCode,
      authorizationUrl,
      externalTransactionId,
      channel,
      gatewayStatus,
      lastError,
      paidAt: parseDateValue(paidAt),
      failedAt: parseDateValue(failedAt),
      verifiedAt: parseDateValue(verifiedAt),
      splitSubaccountCode,
      initializeResponse: toJsonValue(initializeResponse),
      verificationResponse: toJsonValue(verificationResponse),
      webhookEvent: toJsonValue(webhookEvent),
    },
    update: {
      orderId,
      customerId,
      restaurantId,
      provider,
      method,
      currency,
      amount,
      status,
      accessCode,
      authorizationUrl,
      externalTransactionId,
      channel,
      gatewayStatus,
      lastError,
      paidAt: parseDateValue(paidAt),
      failedAt: parseDateValue(failedAt),
      verifiedAt: parseDateValue(verifiedAt),
      splitSubaccountCode,
      initializeResponse: toJsonValue(initializeResponse),
      verificationResponse: toJsonValue(verificationResponse),
      webhookEvent: toJsonValue(webhookEvent),
      updatedAt: new Date(),
    },
  });
};

const syncSqlDeliveryAssignment = async ({
  orderId,
  dispatchId = null,
  courierId = null,
  courierName = null,
  assignedAt = null,
}) => {
  const sql = requireSql();

  return sql.deliveryAssignment.upsert({
    where: { orderId },
    create: {
      orderId,
      dispatchId,
      courierId,
      courierName,
      assignedAt: parseDateValue(assignedAt) ?? new Date(),
    },
    update: {
      dispatchId,
      courierId,
      courierName,
      assignedAt: parseDateValue(assignedAt) ?? new Date(),
      updatedAt: new Date(),
    },
  });
};

const upsertSqlDispatchRider = async ({
  riderId,
  displayName,
  status,
  zone,
  region = null,
  lga = null,
  phoneNumber = null,
  currentAddress = null,
  vehicleType,
  acceptanceRate = null,
  activeLoad = 0,
  completedTrips = 0,
  latitude = null,
  longitude = null,
}) => {
  const sql = requireSql();

  return sql.dispatchRiderRecord.upsert({
    where: { id: riderId },
    create: {
      id: riderId,
      displayName,
      status,
      zone,
      region,
      lga,
      phoneNumber,
      currentAddress,
      vehicleType,
      acceptanceRate: toOptionalNumber(acceptanceRate),
      activeLoad: toOptionalInteger(activeLoad, 0),
      completedTrips: toOptionalInteger(completedTrips, 0),
      latitude: toOptionalNumber(latitude),
      longitude: toOptionalNumber(longitude),
    },
    update: {
      displayName,
      status,
      zone,
      region,
      lga,
      phoneNumber,
      currentAddress,
      vehicleType,
      acceptanceRate: toOptionalNumber(acceptanceRate),
      activeLoad: toOptionalInteger(activeLoad, 0),
      completedTrips: toOptionalInteger(completedTrips, 0),
      latitude: toOptionalNumber(latitude),
      longitude: toOptionalNumber(longitude),
      updatedAt: new Date(),
    },
  });
};

const deleteSqlDispatchRider = async ({ riderId }) => {
  const sql = requireSql();

  return sql.dispatchRiderRecord.deleteMany({
    where: { id: riderId },
  });
};

const deleteSqlUserRoles = async ({ uid }) => {
  const sql = requireSql();

  return sql.userRole.deleteMany({
    where: { userId: uid },
  });
};

const deleteSqlUserAccount = async ({ uid }) => {
  const sql = requireSql();

  return sql.userAccount.deleteMany({
    where: { uid },
  });
};

const recordSqlDeliveryEvent = async ({
  orderId,
  eventType,
  actorUid = null,
  note = null,
  details = null,
}) => {
  const sql = requireSql();

  return sql.deliveryEvent.create({
    data: {
      actorUid,
      details: toJsonValue(details),
      eventType,
      note,
      orderId,
    },
  });
};

const getSqlIdempotencyRecord = async ({ key }) => {
  const sql = requireSql();
  return sql.idempotencyRecord.findUnique({
    where: { key },
  });
};

const storeSqlIdempotencyRecord = async ({ key, scope, actorUid, response = null }) => {
  const sql = requireSql();

  return sql.idempotencyRecord.upsert({
    where: { key },
    create: {
      actorUid,
      key,
      response: toJsonValue(response),
      scope,
    },
    update: {
      actorUid,
      response: toJsonValue(response),
      scope,
      updatedAt: new Date(),
    },
  });
};

module.exports = {
  auditSqlAction,
  createSqlOrder,
  deleteSqlDispatchRider,
  deleteSqlRestaurant,
  deleteSqlUserAccount,
  deleteSqlUserRoles,
  getSqlIdempotencyRecord,
  getSqlPaymentTransactionByReference,
  prisma,
  recordSqlDeliveryEvent,
  requireSql,
  storeSqlIdempotencyRecord,
  syncSqlDeliveryAssignment,
  upsertSqlDispatchRider,
  upsertSqlPaymentTransaction,
  syncSqlRestaurant,
  syncSqlRestaurantApproval,
  syncSqlUserAccount,
  syncSqlUserRole,
  updateSqlOrder,
};
const createConfigError = (message) => {
  const error = new Error(message);
  error.code = "failed-precondition";
  return error;
};
