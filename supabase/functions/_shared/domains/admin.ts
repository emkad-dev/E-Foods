// Admin domain: the approval queue and application reviews, platform
// dashboards, the support agent inbox, broadcasts, promos, and the one-shot
// first-admin bootstrap.

import {
  USER_ACCOUNT_COLUMNS,
  buildUserAccountResponse,
  loadUserRoles,
  syncUserRoleState,
  updateUserAccount,
  type UserAccountRow,
} from '../accounts.ts';
import {
  DISPATCH_APPLICATION_COLUMNS,
  DISPATCH_APPLICATION_STATUS,
  PARTNER_APPLICATION_COLUMNS,
  PARTNER_APPLICATION_STATUS,
  buildDispatchApplicationResponse,
  buildPartnerApplicationResponse,
  loadDispatchApplication,
  loadPartnerApplication,
  type DispatchApplicationRow,
  type PartnerApplicationRow,
} from '../applications.ts';
import { createAuditEntry } from '../auditLog.ts';
import { resolveBroadcastAudience, type BroadcastSegment } from '../broadcast.ts';
import { serviceClient } from '../client.ts';
import { PROMO_CODE_COLUMNS, normalizePromoCode, type PromoCodeRow } from '../promoCodes.ts';
import {
  DEFAULT_DISPATCH_STATUS,
  DEFAULT_DISPATCH_VEHICLE,
  DISPATCH_RIDER_COLUMNS,
  buildDispatchRiderResponse,
  ensureDispatchRiderRecord,
  type DispatchRiderRow,
} from '../dispatchRiders.ts';
import { buildTransactionalEmailHtml, loadUserEmailRecipient, sendTransactionalEmail } from '../email.ts';
import { DEFAULT_NIGERIA_COORDINATE } from '../nigeriaGeography.ts';
import {
  buildNotificationData,
  notifyUsers,
  sendPushNotificationsToUsers,
} from '../notifications.ts';
import {
  CUSTOMER_ORDER_COLUMNS,
  isOrderCleanForReporting,
  loadOrderRelations,
  maybeExpireUnpaidOrder,
  toOrderSnapshotResponse,
  type CustomerOrderRow,
} from '../orders.ts';
import {
  broadcastPromosChanged,
  broadcastRestaurantsChanged,
  broadcastSupportInboxChanged,
  broadcastSupportThreadChanged,
} from '../realtime.ts';
import {
  DEFAULT_DELIVERY_TIME,
  RESTAURANT_APPROVAL_COLUMNS,
  RESTAURANT_COLUMNS,
  buildRestaurantResponse,
  type RestaurantApprovalRow,
  type RestaurantRecordRow,
} from '../restaurants.ts';
import { ADMIN_ACTIONS } from '../rpc/actions.ts';
import { buildNameKey, nowIso, parseInteger, parseNumber, roundCurrency, sanitizeOptionalText, sanitizeText } from '../rpc/coercion.ts';
import {
  ensureRole,
  getBootstrapRequestContext,
  type AuthenticatedRequestContext,
} from '../rpc/context.ts';
import { defineRpcDomain, type AnonymousRpcHandler, type RpcHandler } from '../rpc/registry.ts';
import { fail, json } from '../rpc/respond.ts';
import { appendSupportMessage, isSupportStatus, type SupportConversationRow, type SupportMessageRow } from '../support.ts';

type Handler = RpcHandler<AuthenticatedRequestContext>;

type BroadcastRow = {
  id: string;
  title: string;
  category: string;
  channels: string[];
  segment: BroadcastSegment;
  emailSubject: string | null;
  emailBody: string | null;
  pushTitle: string | null;
  pushBody: string | null;
  status: string;
  scheduledAt: string | null;
  recipientCount: number;
  sentEmail: number;
  failedEmail: number;
  sentPush: number;
  failedPush: number;
  createdByUid: string;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
};

type PromoRow = {
  id: string;
  title: string;
  body: string;
  actionUrl: string | null;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdByUid: string;
  createdAt: string;
  updatedAt: string;
};

const getBootstrapAdminEmails = () =>
  (Deno.env.get('BOOTSTRAP_ADMIN_EMAILS') ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

const validatePromoComposition = (input: {
  actionUrl: unknown;
  startsAt: unknown;
  endsAt: unknown;
}) => {
  const actionUrlRaw = sanitizeText(input.actionUrl);
  // Only in-app deep links are allowed — an absolute/external URL in a banner
  // that every user sees is an open-redirect footgun.
  if (actionUrlRaw && !actionUrlRaw.startsWith('/')) {
    fail(400, 'actionUrl must be an in-app path starting with "/".');
  }
  const actionUrl = actionUrlRaw || null;

  const parseWindow = (value: unknown, label: string): string | null => {
    const raw = sanitizeText(value);
    if (!raw) {
      return null;
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      fail(400, `A valid ${label} timestamp is required.`);
    }
    return parsed.toISOString();
  };

  const startsAt = parseWindow(input.startsAt, 'startsAt');
  const endsAt = parseWindow(input.endsAt, 'endsAt');
  if (startsAt && endsAt && new Date(endsAt).getTime() < new Date(startsAt).getTime()) {
    fail(400, 'endsAt must be after startsAt.');
  }
  return { actionUrl, startsAt, endsAt };
};

const BROADCAST_CATEGORIES = ['marketing', 'transactional'] as const;
const isBroadcastCategory = (value: unknown): value is (typeof BROADCAST_CATEGORIES)[number] =>
  typeof value === 'string' && (BROADCAST_CATEGORIES as readonly string[]).includes(value);

const validateBroadcastComposition = (input: {
  category: unknown;
  channels: unknown;
  segment: unknown;
  emailSubject: unknown;
  emailBody: unknown;
  pushTitle: unknown;
  pushBody: unknown;
}) => {
  if (!isBroadcastCategory(input.category)) {
    fail(400, 'A valid category is required.');
  }
  const channels = Array.isArray(input.channels)
    ? input.channels.filter((channel) => channel === 'email' || channel === 'push')
    : [];
  if (channels.length === 0) {
    fail(400, 'At least one channel (email or push) is required.');
  }
  if (channels.includes('email') && (!sanitizeText(input.emailSubject) || !sanitizeText(input.emailBody))) {
    fail(400, 'Email subject and body are required for the email channel.');
  }
  if (channels.includes('push') && (!sanitizeText(input.pushTitle) || !sanitizeText(input.pushBody))) {
    fail(400, 'Push title and body are required for the push channel.');
  }
  const segment = (input.segment && typeof input.segment === 'object' ? input.segment : {}) as BroadcastSegment;
  if (
    input.category === 'marketing' &&
    !(segment.roles ?? []).includes('customer') &&
    !segment.activity &&
    !segment.restaurantId
  ) {
    fail(400, 'Marketing broadcasts must target customers.');
  }
  return { channels, segment };
};

/**
 * One-shot escalation for a brand new deployment: only an allow-listed email
 * may run it, and only while no admin exists at all.
 */
const bootstrapFirstAdmin: AnonymousRpcHandler = async ({ request }) => {
  const context = await getBootstrapRequestContext(request);
  const allowedEmails = getBootstrapAdminEmails();
  if (!allowedEmails.includes(context.email.toLowerCase())) {
    fail(403, 'This account is not allowed to run the first-admin bootstrap flow.');
  }

  const { count, error } = await serviceClient
    .from('UserRole')
    .select('userId', { count: 'exact', head: true })
    .eq('role', 'admin');

  if (error) {
    throw new Error(error.message);
  }

  if ((count ?? 0) > 0) {
    fail(412, 'An admin account already exists. Use the admin access tools for further role changes.');
  }

  await syncUserRoleState(context.uid, 'admin', context.uid, {
    accountDisabled: false,
    disabledAt: null,
    disabledByUid: null,
    lastPrivilegedRole: 'admin',
  });
  await createAuditEntry(context.uid, 'first_admin_bootstrapped', 'user_role', context.uid, {
    email: context.email.toLowerCase(),
  });
  await notifyUsers([context.uid], {
    title: 'Admin access enabled',
    body: 'This account is now the first platform admin.',
    data: buildNotificationData({
      app: 'admin',
      routeKey: 'admin_access',
      type: 'staff_access',
    }),
  });

  return json(200, {
    data: {
      role: 'admin',
      targetUid: context.uid,
      tokenRefreshRequired: true,
    },
  });
};

const adminGetApprovalQueue: Handler = async ({ context }) => {
  ensureRole(context.role, ['admin']);

  const [
    { data: restaurants, error: restaurantError },
    { data: approvals, error: approvalError },
    { data: dispatchApplications, error: dispatchError },
    { data: partnerApplications, error: partnerError },
  ] = await Promise.all([
    serviceClient
      .from('RestaurantRecord')
      .select(RESTAURANT_COLUMNS)
      .order('isPublished', { ascending: true })
      .order('updatedAt', { ascending: false }),
    serviceClient
      .from('RestaurantApproval')
      .select(RESTAURANT_APPROVAL_COLUMNS),
    serviceClient
      .from('DispatchApplicationRecord')
      .select(DISPATCH_APPLICATION_COLUMNS)
      .eq('status', DISPATCH_APPLICATION_STATUS.PENDING)
      .order('submittedAt', { ascending: false }),
    serviceClient
      .from('PartnerApplicationRecord')
      .select(PARTNER_APPLICATION_COLUMNS)
      .eq('status', PARTNER_APPLICATION_STATUS.PENDING)
      .order('submittedAt', { ascending: false }),
  ]);

  if (restaurantError) {
    throw new Error(restaurantError.message);
  }
  if (approvalError) {
    throw new Error(approvalError.message);
  }
  if (dispatchError) {
    throw new Error(dispatchError.message);
  }
  if (partnerError) {
    throw new Error(partnerError.message);
  }

  const approvalByRestaurantId = new Map(
    ((approvals ?? []) as RestaurantApprovalRow[]).map((approval) => [approval.restaurantId, approval])
  );

  return json(200, {
    data: {
      dispatchApplications: ((dispatchApplications ?? []) as DispatchApplicationRow[]).map(
        buildDispatchApplicationResponse
      ),
      partnerApplications: ((partnerApplications ?? []) as PartnerApplicationRow[]).map(
        buildPartnerApplicationResponse
      ),
      restaurants: ((restaurants ?? []) as RestaurantRecordRow[]).map((restaurant) =>
        buildRestaurantResponse(restaurant, approvalByRestaurantId.get(restaurant.id) ?? null)
      ),
    },
  });
};

const adminReviewDispatchApplication: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin']);
  const applicationId = sanitizeText(data.applicationId);
  const decision = sanitizeText(data.decision);
  const rejectionReason = sanitizeOptionalText(data.rejectionReason);

  if (!applicationId) {
    fail(400, 'A dispatch application id is required.');
  }
  if (!['approve', 'reject'].includes(decision)) {
    fail(400, 'Use approve or reject when reviewing a dispatch application.');
  }

  const application = await loadDispatchApplication(applicationId);
  if (!application) {
    fail(404, 'The selected dispatch application could not be found.');
  }

  // Re-deciding the same way is idempotent, so a double-click in the console
  // does not 412 the operator.
  const currentStatus = sanitizeText(application.status, DISPATCH_APPLICATION_STATUS.PENDING);
  if (decision === 'approve' && currentStatus === DISPATCH_APPLICATION_STATUS.APPROVED) {
    return json(200, {
      data: {
        approvedByUid: sanitizeOptionalText(application.approvedByUid),
        applicationId,
        decision,
        role: 'dispatch',
        tokenRefreshRequired: true,
      },
    });
  }
  if (decision === 'reject' && currentStatus === DISPATCH_APPLICATION_STATUS.REJECTED) {
    return json(200, {
      data: {
        approvedByUid: sanitizeOptionalText(application.approvedByUid),
        applicationId,
        decision,
        role: 'customer',
        tokenRefreshRequired: false,
      },
    });
  }
  if (currentStatus !== DISPATCH_APPLICATION_STATUS.PENDING) {
    fail(412, `This dispatch application has already been reviewed as ${currentStatus}.`);
  }

  const reviewedAt = nowIso();
  if (decision === 'approve') {
    await syncUserRoleState(applicationId, 'dispatch', context.uid, {
      accountDisabled: false,
      disabledAt: null,
      disabledByUid: null,
      lastPrivilegedRole: 'dispatch',
    });
    await updateUserAccount(applicationId, {
      dispatchApplicationStatus: DISPATCH_APPLICATION_STATUS.APPROVED,
      dispatchApplicationReviewedAt: reviewedAt,
      dispatchApplicationRejectionReason: null,
      displayName: sanitizeText(application.displayName, application.email.split('@')[0]),
      phoneNumber: sanitizeText(application.phoneNumber),
      updatedAt: reviewedAt,
    });
    await ensureDispatchRiderRecord(applicationId, {
      acceptanceRate: 100,
      completedTrips: 0,
      currentAddress: application.currentAddress,
      displayName: sanitizeText(application.displayName, 'Dispatch rider'),
      lga: application.lga,
      latitude: parseNumber(application.latitude, DEFAULT_NIGERIA_COORDINATE.latitude),
      longitude: parseNumber(application.longitude, DEFAULT_NIGERIA_COORDINATE.longitude),
      phoneNumber: application.phoneNumber,
      region: application.region,
      status: DEFAULT_DISPATCH_STATUS,
      vehicleType: sanitizeText(application.vehicleType, DEFAULT_DISPATCH_VEHICLE),
      zone: sanitizeText(application.region),
    });

    const { error: applicationError } = await serviceClient
      .from('DispatchApplicationRecord')
      .update({
        approvedByUid: context.uid,
        rejectionReason: null,
        reviewedAt,
        status: DISPATCH_APPLICATION_STATUS.APPROVED,
        updatedAt: reviewedAt,
      })
      .eq('id', applicationId);

    if (applicationError) {
      throw new Error(applicationError.message);
    }
  } else {
    const { error: applicationError } = await serviceClient
      .from('DispatchApplicationRecord')
      .update({
        approvedByUid: context.uid,
        rejectionReason: rejectionReason ?? 'Application rejected by admin review.',
        reviewedAt,
        status: DISPATCH_APPLICATION_STATUS.REJECTED,
        updatedAt: reviewedAt,
      })
      .eq('id', applicationId);

    if (applicationError) {
      throw new Error(applicationError.message);
    }

    await updateUserAccount(applicationId, {
      dispatchApplicationStatus: DISPATCH_APPLICATION_STATUS.REJECTED,
      dispatchApplicationReviewedAt: reviewedAt,
      dispatchApplicationRejectionReason: rejectionReason ?? 'Application rejected by admin review.',
      updatedAt: reviewedAt,
    });
  }

  await createAuditEntry(
    context.uid,
    decision === 'approve' ? 'dispatch_application_approved' : 'dispatch_application_rejected',
    'dispatch_application',
    applicationId,
    {
      rejectionReason: rejectionReason ?? null,
      vehicleType: sanitizeText(application.vehicleType),
    }
  );
  await notifyUsers([applicationId], {
    title:
      decision === 'approve' ? 'Dispatch application approved' : 'Dispatch application update',
    body:
      decision === 'approve'
        ? 'Your dispatch application was approved. Sign in to access the dispatch workspace.'
        : rejectionReason ?? 'Your dispatch application was rejected by admin review.',
    data: buildNotificationData({
      app: 'dispatch',
      routeKey: decision === 'approve' ? 'dispatch_profile' : 'dispatch_login',
      status: decision === 'approve' ? DISPATCH_APPLICATION_STATUS.APPROVED : DISPATCH_APPLICATION_STATUS.REJECTED,
      type: 'application_reviewed',
    }),
  });

  return json(200, {
    data: {
      approvedByUid: decision === 'approve' ? context.uid : null,
      applicationId,
      decision,
      role: decision === 'approve' ? 'dispatch' : 'customer',
      tokenRefreshRequired: decision === 'approve',
    },
  });
};

const adminReviewPartnerApplication: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin']);
  const applicationId = sanitizeText(data.applicationId);
  const decision = sanitizeText(data.decision);
  const rejectionReason = sanitizeOptionalText(data.rejectionReason);

  if (!applicationId) {
    fail(400, 'A partner application id is required.');
  }
  if (!['approve', 'reject'].includes(decision)) {
    fail(400, 'Use approve or reject when reviewing a partner application.');
  }

  const application = await loadPartnerApplication(applicationId);
  if (!application) {
    fail(404, 'The selected partner application could not be found.');
  }

  const currentStatus = sanitizeText(application.status, PARTNER_APPLICATION_STATUS.PENDING);
  if (decision === 'approve' && currentStatus === PARTNER_APPLICATION_STATUS.APPROVED) {
    return json(200, {
      data: {
        applicationId,
        approvedByUid: sanitizeOptionalText(application.approvedByUid),
        decision,
        restaurantId: sanitizeOptionalText(application.restaurantId),
        role: 'restaurant',
        tokenRefreshRequired: true,
      },
    });
  }
  if (decision === 'reject' && currentStatus === PARTNER_APPLICATION_STATUS.REJECTED) {
    return json(200, {
      data: {
        applicationId,
        approvedByUid: sanitizeOptionalText(application.approvedByUid),
        decision,
        restaurantId: sanitizeOptionalText(application.restaurantId),
        role: 'customer',
        tokenRefreshRequired: false,
      },
    });
  }
  if (currentStatus !== PARTNER_APPLICATION_STATUS.PENDING) {
    fail(412, `This partner application has already been reviewed as ${currentStatus}.`);
  }

  const reviewedAt = nowIso();
  let restaurantId: string | null = null;
  if (decision === 'approve') {
    restaurantId = sanitizeText(application.restaurantId) || crypto.randomUUID();
    await syncUserRoleState(applicationId, 'restaurant', context.uid, {
      accountDisabled: false,
      disabledAt: null,
      disabledByUid: null,
      lastPrivilegedRole: 'restaurant',
      restaurantId,
      restaurantLinkedAt: reviewedAt,
      restaurantLinkSource: 'partner_application_approved',
      restaurantName: sanitizeText(application.restaurantName, 'Restaurant'),
    });
    await updateUserAccount(applicationId, {
      displayName: sanitizeText(application.contactName, application.email.split('@')[0]),
      phoneNumber: sanitizeText(application.phoneNumber),
      partnerApplicationStatus: PARTNER_APPLICATION_STATUS.APPROVED,
      partnerApplicationReviewedAt: reviewedAt,
      partnerApplicationRejectionReason: null,
      updatedAt: reviewedAt,
    });

    const { error: restaurantError } = await serviceClient.from('RestaurantRecord').upsert(
      {
        id: restaurantId,
        ownerId: applicationId,
        name: sanitizeText(application.restaurantName, 'Restaurant'),
        nameKey: buildNameKey(sanitizeText(application.restaurantName, 'Restaurant')),
        cuisine: sanitizeOptionalText(application.cuisine),
        address: sanitizeOptionalText(application.address),
        description: sanitizeOptionalText(application.description) ?? '',
        image: '',
        logoImage: sanitizeOptionalText(application.logoImage) ?? '',
        menu: [],
        deliveryFee: 0,
        deliveryRadiusKm: 12,
        deliveryTime: sanitizeOptionalText(application.deliveryTime) ?? DEFAULT_DELIVERY_TIME,
        latitude: application.latitude ?? null,
        longitude: application.longitude ?? null,
        minOrder: 0,
        // Delivery is opt-in — restaurant enables its own delivery later.
        supportsDelivery: false,
        supportsPickup: true,
        isOpen: true,
        isPublished: false,
        updatedAt: reviewedAt,
      },
      { onConflict: 'id' }
    );

    if (restaurantError) {
      throw new Error(restaurantError.message);
    }

    await broadcastRestaurantsChanged({ restaurantId });

    const { error: approvalError } = await serviceClient.from('RestaurantApproval').upsert(
      {
        restaurantId,
        // Approval and publication are separate concerns: the restaurant is
        // approved here but stays isPublished=false until it completes setup
        // and goes live. Order placement refuses any restaurant whose
        // approval row is not 'approved', so this write is what lets an
        // approved restaurant take orders at all.
        status: 'approved',
        approvedByUid: context.uid,
        approvedAt: reviewedAt,
        updatedAt: reviewedAt,
      },
      { onConflict: 'restaurantId' }
    );

    if (approvalError) {
      throw new Error(approvalError.message);
    }

    const { error: applicationError } = await serviceClient
      .from('PartnerApplicationRecord')
      .update({
        approvedByUid: context.uid,
        rejectionReason: null,
        reviewedAt,
        restaurantId,
        status: PARTNER_APPLICATION_STATUS.APPROVED,
        updatedAt: reviewedAt,
      })
      .eq('id', applicationId);

    if (applicationError) {
      throw new Error(applicationError.message);
    }
  } else {
    const { error: applicationError } = await serviceClient
      .from('PartnerApplicationRecord')
      .update({
        approvedByUid: context.uid,
        rejectionReason: rejectionReason ?? 'Partner application rejected by admin review.',
        reviewedAt,
        status: PARTNER_APPLICATION_STATUS.REJECTED,
        updatedAt: reviewedAt,
      })
      .eq('id', applicationId);

    if (applicationError) {
      throw new Error(applicationError.message);
    }

    await updateUserAccount(applicationId, {
      partnerApplicationStatus: PARTNER_APPLICATION_STATUS.REJECTED,
      partnerApplicationReviewedAt: reviewedAt,
      partnerApplicationRejectionReason: rejectionReason ?? 'Partner application rejected by admin review.',
      updatedAt: reviewedAt,
    });
  }

  await createAuditEntry(
    context.uid,
    decision === 'approve' ? 'partner_application_approved' : 'partner_application_rejected',
    'partner_application',
    applicationId,
    {
      rejectionReason: rejectionReason ?? null,
      restaurantId,
    }
  );
  await notifyUsers([applicationId], {
    title: decision === 'approve' ? 'Partner application approved' : 'Partner application update',
    body:
      decision === 'approve'
        ? 'Your partner application was approved. Sign in to complete your restaurant setup.'
        : rejectionReason ?? 'Your partner application was rejected by admin review.',
    data: buildNotificationData({
      app: 'partner',
      restaurantId,
      routeKey: decision === 'approve' ? 'partner_profile' : 'partner_login',
      status: decision === 'approve' ? PARTNER_APPLICATION_STATUS.APPROVED : PARTNER_APPLICATION_STATUS.REJECTED,
      type: 'application_reviewed',
    }),
  });

  return json(200, {
    data: {
      applicationId,
      approvedByUid: decision === 'approve' ? context.uid : null,
      decision,
      restaurantId,
      role: decision === 'approve' ? 'restaurant' : 'customer',
      tokenRefreshRequired: decision === 'approve',
    },
  });
};

const adminGetDashboardSnapshot: Handler = async ({ context }) => {
  ensureRole(context.role, ['admin']);
  const [usersResult, restaurantsResult, ordersResult, ridersResult] = await Promise.all([
    serviceClient
      .from('UserAccount')
      .select(USER_ACCOUNT_COLUMNS)
      .order('createdAt', { ascending: false }),
    serviceClient
      .from('RestaurantRecord')
      .select(RESTAURANT_COLUMNS)
      .order('updatedAt', { ascending: false }),
    serviceClient
      .from('CustomerOrder')
      .select(CUSTOMER_ORDER_COLUMNS)
      .order('createdAt', { ascending: false }),
    serviceClient
      .from('DispatchRiderRecord')
      .select(DISPATCH_RIDER_COLUMNS)
      .order('updatedAt', { ascending: false }),
  ]);

  if (usersResult.error || restaurantsResult.error || ordersResult.error || ridersResult.error) {
    throw new Error(
      usersResult.error?.message ??
        restaurantsResult.error?.message ??
        ordersResult.error?.message ??
        ridersResult.error?.message ??
        'Failed to load admin dashboard snapshot.'
    );
  }

  const users = (usersResult.data ?? []) as UserAccountRow[];
  const rolesByUserId = await loadUserRoles(users.map((user) => user.uid));
  const restaurants = (restaurantsResult.data ?? []) as RestaurantRecordRow[];
  const orders = (
    await Promise.all(
      ((ordersResult.data ?? []) as CustomerOrderRow[]).map((order) => maybeExpireUnpaidOrder(order))
    )
  ).filter(isOrderCleanForReporting);
  const riders = (ridersResult.data ?? []) as DispatchRiderRow[];
  const orderRelations = await loadOrderRelations(orders.map((order) => order.id));
  const { data: restaurantApprovals, error: restaurantApprovalError } = await serviceClient
    .from('RestaurantApproval')
    .select(RESTAURANT_APPROVAL_COLUMNS)
    .in(
      'restaurantId',
      restaurants.map((restaurant) => restaurant.id)
    );

  if (restaurantApprovalError) {
    throw new Error(restaurantApprovalError.message);
  }

  const approvalByRestaurantId = new Map(
    ((restaurantApprovals ?? []) as RestaurantApprovalRow[]).map((approval) => [approval.restaurantId, approval])
  );

  return json(200, {
    data: {
      dispatchProfiles: riders.map((rider) => buildDispatchRiderResponse(rider)),
      orders: orders.map((order) =>
        toOrderSnapshotResponse(
          order,
          orderRelations.itemsByOrderId.get(order.id) ?? [],
          orderRelations.assignmentsByOrderId.get(order.id) ?? null
        )
      ),
      restaurants: restaurants.map((restaurant) => ({
        ...buildRestaurantResponse(restaurant, approvalByRestaurantId.get(restaurant.id) ?? null),
        // Admin-only surface (Task 14 / E3): kept out of the shared wire shape
        // so it never reaches partner/customer reads.
        missedOrderCount: restaurant.missedOrderCount ?? 0,
      })),
      users: users.map((user) => buildUserAccountResponse(user, rolesByUserId.get(user.uid) ?? [])),
    },
  });
};

const adminGetAccessOverview: Handler = async ({ context }) => {
  ensureRole(context.role, ['admin']);
  const { data: users, error } = await serviceClient
    .from('UserAccount')
    .select(USER_ACCOUNT_COLUMNS)
    .order('createdAt', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const userRows = (users ?? []) as UserAccountRow[];
  const rolesByUserId = await loadUserRoles(userRows.map((user) => user.uid));

  return json(200, {
    data: {
      users: userRows.map((user) => buildUserAccountResponse(user, rolesByUserId.get(user.uid) ?? [])),
    },
  });
};

const supportGetInbox: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin', 'support']);
  const status = sanitizeText(data.status);
  const scope = sanitizeText(data.scope) || 'all';

  let query = serviceClient
    .from('SupportConversation')
    .select('*')
    .order('lastMessageAt', { ascending: false });
  if (status && isSupportStatus(status)) {
    query = query.eq('status', status);
  }
  if (scope === 'mine') {
    query = query.eq('assignedTo', context.uid);
  } else if (scope === 'unassigned') {
    query = query.is('assignedTo', null);
  }

  const { data: conversations, error } = await query.returns<SupportConversationRow[]>();
  if (error) {
    throw new Error(error.message);
  }

  const customerIds = Array.from(new Set((conversations ?? []).map((row) => row.customerId)));
  const accountsById = new Map<string, { displayName: string | null; email: string }>();
  if (customerIds.length > 0) {
    const { data: accounts, error: accountsError } = await serviceClient
      .from('UserAccount')
      .select('uid,displayName,email')
      .in('uid', customerIds)
      .returns<Array<{ uid: string; displayName: string | null; email: string }>>();
    if (accountsError) {
      throw new Error(accountsError.message);
    }
    for (const account of accounts ?? []) {
      accountsById.set(account.uid, { displayName: account.displayName, email: account.email });
    }
  }

  const rows = (conversations ?? []).map((row) => ({
    ...row,
    customerName:
      accountsById.get(row.customerId)?.displayName ??
      accountsById.get(row.customerId)?.email ??
      row.customerId,
  }));
  return json(200, { data: { conversations: rows } });
};

const supportGetConversation: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin', 'support']);
  const conversationId = sanitizeText(data.conversationId);
  if (!conversationId) {
    fail(400, 'A conversationId is required.');
  }

  const { data: conversation, error: convError } = await serviceClient
    .from('SupportConversation')
    .select('*')
    .eq('id', conversationId)
    .maybeSingle<SupportConversationRow>();
  if (convError) {
    throw new Error(convError.message);
  }
  if (!conversation) {
    fail(404, 'Conversation not found.');
  }

  const { data: messages, error: msgError } = await serviceClient
    .from('SupportMessage')
    .select('*')
    .eq('conversationId', conversationId)
    .order('createdAt', { ascending: true })
    .returns<SupportMessageRow[]>();
  if (msgError) {
    throw new Error(msgError.message);
  }
  return json(200, { data: { conversation, messages: messages ?? [] } });
};

const supportSendAgentReply: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin', 'support']);
  const conversationId = sanitizeText(data.conversationId);
  const body = sanitizeText(data.body);
  if (!conversationId) {
    fail(400, 'A conversationId is required.');
  }
  if (!body) {
    fail(400, 'A reply body is required.');
  }

  const { data: conversation, error: convError } = await serviceClient
    .from('SupportConversation')
    .select('*')
    .eq('id', conversationId)
    .maybeSingle<SupportConversationRow>();
  if (convError) {
    throw new Error(convError.message);
  }
  if (!conversation) {
    fail(404, 'Conversation not found.');
  }

  // Persist first so the reply is never lost, even if delivery fails.
  const message = await appendSupportMessage({
    conversationId: conversation.id,
    senderType: 'agent',
    senderId: context.uid,
    body,
  });

  // In-app: broadcast to the customer's thread and the inbox.
  await broadcastSupportThreadChanged(conversation.id, { messageId: message.id });
  await broadcastSupportInboxChanged({ conversationId: conversation.id });

  // Email (best-effort).
  let emailSent = false;
  const recipient = await loadUserEmailRecipient(conversation.customerId);
  if (recipient) {
    const html = buildTransactionalEmailHtml({
      heading: 'FEASTY Support replied',
      recipientName: recipient.displayName,
      lines: [body, 'Reply to this message inside the FEASTY app to continue the conversation.'],
    });
    const emailResult = await sendTransactionalEmail({
      to: recipient.email,
      subject: 'FEASTY Support',
      html,
    });
    emailSent = emailResult.sent;
  }

  // Push (best-effort).
  let pushSent = false;
  try {
    const pushResult = await sendPushNotificationsToUsers([conversation.customerId], {
      title: 'FEASTY Support',
      body: body.length > 120 ? `${body.slice(0, 117)}…` : body,
      data: { type: 'support_reply', path: '/support', routeKey: 'customer_profile', app: 'customer' },
    });
    pushSent = pushResult.sent > 0;
  } catch (error) {
    console.error('Support push delivery failed.', error);
  }

  await serviceClient
    .from('SupportMessage')
    .update({ emailSent, pushSent })
    .eq('id', message.id);

  return json(200, { data: { message: { ...message, emailSent, pushSent } } });
};

const supportSetConversationStatus: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin', 'support']);
  const conversationId = sanitizeText(data.conversationId);
  const status = sanitizeText(data.status);
  if (!conversationId) {
    fail(400, 'A conversationId is required.');
  }
  if (!status || !isSupportStatus(status)) {
    fail(400, 'A valid status is required.');
  }

  const { data: conversation, error } = await serviceClient
    .from('SupportConversation')
    .update({ status, updatedAt: new Date().toISOString() })
    .eq('id', conversationId)
    .select('*')
    .single<SupportConversationRow>();
  if (error || !conversation) {
    throw new Error(error?.message ?? 'Failed to update the conversation status.');
  }
  await broadcastSupportInboxChanged({ conversationId: conversation.id });
  return json(200, { data: { conversation } });
};

const supportAssignConversation: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin', 'support']);
  const conversationId = sanitizeText(data.conversationId);
  if (!conversationId) {
    fail(400, 'A conversationId is required.');
  }
  const assignToRaw = sanitizeText(data.assignTo);
  const assignTo = assignToRaw === 'me' ? context.uid : assignToRaw || null;

  const { data: conversation, error } = await serviceClient
    .from('SupportConversation')
    .update({ assignedTo: assignTo, updatedAt: new Date().toISOString() })
    .eq('id', conversationId)
    .select('*')
    .single<SupportConversationRow>();
  if (error || !conversation) {
    throw new Error(error?.message ?? 'Failed to assign the conversation.');
  }
  await broadcastSupportInboxChanged({ conversationId: conversation.id });
  return json(200, { data: { conversation } });
};

const broadcastList: Handler = async ({ context }) => {
  ensureRole(context.role, ['admin']);
  const { data: broadcasts, error } = await serviceClient
    .from('Broadcast')
    .select('*')
    .order('createdAt', { ascending: false })
    .returns<BroadcastRow[]>();
  if (error) {
    throw new Error(error.message);
  }
  return json(200, { data: { broadcasts: broadcasts ?? [] } });
};

const broadcastGet: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin']);
  const broadcastId = sanitizeText(data.id);
  if (!broadcastId) {
    fail(400, 'A broadcast id is required.');
  }
  const { data: broadcast, error } = await serviceClient
    .from('Broadcast')
    .select('*')
    .eq('id', broadcastId)
    .maybeSingle<BroadcastRow>();
  if (error) {
    throw new Error(error.message);
  }
  if (!broadcast) {
    fail(404, 'Broadcast not found.');
  }
  return json(200, { data: { broadcast } });
};

const broadcastPreviewAudience: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin']);
  const category = sanitizeText(data.category) || 'transactional';
  const segment = (data.segment && typeof data.segment === 'object' ? data.segment : {}) as BroadcastSegment;
  const recipients = await resolveBroadcastAudience(segment, category);
  return json(200, { data: { recipientCount: recipients.length } });
};

const broadcastCreate: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin']);
  const title = sanitizeText(data.title);
  if (!title) {
    fail(400, 'A title is required.');
  }
  const { channels, segment } = validateBroadcastComposition({
    category: data.category,
    channels: data.channels,
    segment: data.segment,
    emailSubject: data.emailSubject,
    emailBody: data.emailBody,
    pushTitle: data.pushTitle,
    pushBody: data.pushBody,
  });
  const { data: broadcast, error } = await serviceClient
    .from('Broadcast')
    .insert({
      title,
      category: data.category,
      channels,
      segment,
      emailSubject: sanitizeText(data.emailSubject) || null,
      emailBody: typeof data.emailBody === 'string' && data.emailBody.trim() ? data.emailBody : null,
      pushTitle: sanitizeText(data.pushTitle) || null,
      pushBody: sanitizeText(data.pushBody) || null,
      status: 'draft',
      createdByUid: context.uid,
    })
    .select('*')
    .single<BroadcastRow>();
  if (error || !broadcast) {
    throw new Error(error?.message ?? 'Failed to create the broadcast.');
  }
  return json(200, { data: { broadcast } });
};

const broadcastSchedule: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin']);
  const broadcastId = sanitizeText(data.id);
  if (!broadcastId) {
    fail(400, 'A broadcast id is required.');
  }
  const scheduledAtRaw = sanitizeText(data.scheduledAt);
  if (scheduledAtRaw && Number.isNaN(new Date(scheduledAtRaw).getTime())) {
    fail(400, 'A valid scheduledAt timestamp is required.');
  }
  const scheduledAt = scheduledAtRaw ? new Date(scheduledAtRaw).toISOString() : new Date().toISOString();
  const { data: broadcast, error } = await serviceClient
    .from('Broadcast')
    .update({ status: 'scheduled', scheduledAt, updatedAt: new Date().toISOString() })
    .eq('id', broadcastId)
    .in('status', ['draft', 'scheduled', 'canceled', 'failed'])
    .select('*')
    .single<BroadcastRow>();
  if (error || !broadcast) {
    throw new Error(error?.message ?? 'Failed to schedule the broadcast.');
  }
  return json(200, { data: { broadcast } });
};

const broadcastCancel: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin']);
  const broadcastId = sanitizeText(data.id);
  if (!broadcastId) {
    fail(400, 'A broadcast id is required.');
  }
  const { data: broadcast, error } = await serviceClient
    .from('Broadcast')
    .update({ status: 'canceled', updatedAt: new Date().toISOString() })
    .eq('id', broadcastId)
    .eq('status', 'scheduled')
    .select('*')
    .single<BroadcastRow>();
  if (error || !broadcast) {
    throw new Error(error?.message ?? 'Only a scheduled broadcast can be canceled.');
  }
  return json(200, { data: { broadcast } });
};

const promoList: Handler = async ({ context }) => {
  ensureRole(context.role, ['admin']);
  const { data: promos, error } = await serviceClient
    .from('Promo')
    .select('*')
    .order('createdAt', { ascending: false })
    .returns<PromoRow[]>();
  if (error) {
    throw new Error(error.message);
  }
  const { data: stats, error: statsError } = await serviceClient.rpc('ebuy_promo_stats');
  if (statsError) {
    console.error('Promo stats lookup failed.', statsError);
  }
  const statById = new Map<string, {
    promoId: string; impressions: number; clicks: number;
    attributedOrders: number; attributedRevenue: number;
  }>(
    (stats ?? []).map((s: {
      promoId: string; impressions: number; clicks: number;
      attributedOrders: number; attributedRevenue: number;
    }) => [s.promoId, s]),
  );
  const withStats = (promos ?? []).map((p) => {
    const s = statById.get(p.id);
    return {
      ...p,
      impressions: s?.impressions ?? 0,
      clicks: s?.clicks ?? 0,
      attributedOrders: s?.attributedOrders ?? 0,
      attributedRevenue: s?.attributedRevenue ?? 0,
    };
  });
  return json(200, { data: { promos: withStats } });
};

const promoCreate: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin']);
  const title = sanitizeText(data.title);
  const body = sanitizeText(data.body);
  if (!title) {
    fail(400, 'A title is required.');
  }
  if (!body) {
    fail(400, 'A body is required.');
  }
  const { actionUrl, startsAt, endsAt } = validatePromoComposition({
    actionUrl: data.actionUrl,
    startsAt: data.startsAt,
    endsAt: data.endsAt,
  });
  const { data: promo, error } = await serviceClient
    .from('Promo')
    .insert({
      title,
      body,
      actionUrl,
      startsAt,
      endsAt,
      active: true,
      createdByUid: context.uid,
    })
    .select('*')
    .single<PromoRow>();
  if (error || !promo) {
    throw new Error(error?.message ?? 'Failed to create the promo.');
  }
  // Live push to every connected app; clients refetch the active set. A failed
  // broadcast must never fail the insert, so this is best-effort inside the helper.
  await broadcastPromosChanged({ id: promo.id });
  return json(200, { data: { promo } });
};

const promoSetActive: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin']);
  const promoId = sanitizeText(data.id);
  if (!promoId) {
    fail(400, 'A promo id is required.');
  }
  if (typeof data.active !== 'boolean') {
    fail(400, 'An active flag is required.');
  }
  const { data: promo, error } = await serviceClient
    .from('Promo')
    .update({ active: data.active, updatedAt: new Date().toISOString() })
    .eq('id', promoId)
    .select('*')
    .single<PromoRow>();
  if (error || !promo) {
    throw new Error(error?.message ?? 'Failed to update the promo.');
  }
  await broadcastPromosChanged({ id: promo.id });
  return json(200, { data: { promo } });
};

/**
 * Publishes or unpublishes an already-approved restaurant without routing it
 * back through the application flow. Unpublishing only removes the
 * restaurant from discovery and blocks new order placement — it does not
 * touch any in-flight order. `placeCustomerOrder` (via
 * `prepareCustomerOrderDraft` in `_shared/domains/orders.ts`) already refuses
 * to accept a new order for an unpublished restaurant, so that guard is not
 * duplicated here.
 */
const adminSetRestaurantPublished: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin']);
  const restaurantId = sanitizeText(data.restaurantId);
  if (!restaurantId) {
    fail(400, 'A restaurant id is required.');
  }
  if (typeof data.isPublished !== 'boolean') {
    fail(400, 'An isPublished flag is required.');
  }
  const isPublished = data.isPublished === true;
  const updatedAt = nowIso();

  const { data: updatedRestaurant, error } = await serviceClient
    .from('RestaurantRecord')
    .update({ isPublished, updatedAt })
    .eq('id', restaurantId)
    .select('id,name,isPublished')
    .maybeSingle<{ id: string; isPublished: boolean; name: string }>();

  if (error) {
    throw new Error(error.message);
  }
  if (!updatedRestaurant) {
    fail(404, 'The selected restaurant could not be found.');
  }

  await createAuditEntry(
    context.uid,
    isPublished ? 'restaurant_published' : 'restaurant_unpublished',
    'restaurant',
    restaurantId,
    { isPublished }
  );

  // Task 5 made every client realtime-driven — this is what makes the
  // publish/unpublish state appear on open customer apps without a poll.
  await broadcastRestaurantsChanged({ restaurantId });

  // `restaurantId` and `isPublished` mirror exactly what the update above
  // just persisted (the `!updatedRestaurant` check already ruled out "no
  // such row"), so the response is built from those already-validated
  // locals rather than by re-reading the nullable query result — `deno
  // check` does not narrow `updatedRestaurant` past the `fail()` call above
  // (a known, tracked gap — see scripts/deno-check-baseline.txt — shared by
  // every other `fail(404, ...)`-then-use pattern in this file), so reading
  // its fields here would reintroduce that same class of error.
  return json(200, {
    data: {
      id: restaurantId,
      isPublished,
      name: updatedRestaurant?.name ?? null,
    },
  });
};

// ── Task 17 (G1): admin CRUD for the discount-code engine ──────────────────
// Distinct from promoList/promoCreate/promoSetActive above (those are marketing
// BANNERS). These manage PromoCode rows — the money-moving discount codes.

const PROMO_DISCOUNT_TYPES = ['percent', 'fixed', 'free_delivery'] as const;
const PROMO_FUNDING_SOURCES = ['platform', 'restaurant'] as const;

// Optional non-negative integer cap: absent/blank ⇒ null (unlimited); a present
// value must be a positive integer.
const parseOptionalCap = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = parseInteger(value, Number.NaN);
  if (!Number.isInteger(parsed) || parsed < 1) {
    fail(400, 'Usage caps must be a positive whole number, or left blank for unlimited.');
  }
  return parsed;
};

const parseOptionalIsoDate = (value: unknown, label: string): string | null => {
  const raw = sanitizeOptionalText(value);
  if (!raw) {
    return null;
  }
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) {
    fail(400, `${label} must be a valid date.`);
  }
  return new Date(ms).toISOString();
};

const adminListPromoCodes: Handler = async ({ context }) => {
  ensureRole(context.role, ['admin']);
  const { data, error } = await serviceClient
    .from('PromoCode')
    .select(`${PROMO_CODE_COLUMNS},createdAt,updatedAt`)
    .order('createdAt', { ascending: false })
    .returns<PromoCodeRow[]>();
  if (error) {
    throw new Error(error.message);
  }
  return json(200, { data: { promoCodes: data ?? [] } });
};

const adminCreatePromoCode: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin']);

  const code = normalizePromoCode(data.code);
  if (!code || code.length > 40) {
    fail(400, 'A promo code (up to 40 characters) is required.');
  }

  const type = sanitizeText(data.type);
  if (!(PROMO_DISCOUNT_TYPES as readonly string[]).includes(type)) {
    fail(400, 'Discount type must be percent, fixed, or free_delivery.');
  }

  const fundingSource = sanitizeText(data.fundingSource, 'platform');
  if (!(PROMO_FUNDING_SOURCES as readonly string[]).includes(fundingSource)) {
    fail(400, 'Funding source must be platform or restaurant.');
  }

  const value = roundCurrency(parseNumber(data.value, 0));
  if (!Number.isFinite(value) || value < 0) {
    fail(400, 'Discount value must be a non-negative number.');
  }
  if (type === 'percent' && value > 100) {
    fail(400, 'A percent discount cannot exceed 100.');
  }

  const minBasket = roundCurrency(parseNumber(data.minBasket, 0));
  if (!Number.isFinite(minBasket) || minBasket < 0) {
    fail(400, 'Minimum basket must be a non-negative number.');
  }

  const perUserCap = parseOptionalCap(data.perUserCap);
  const globalCap = parseOptionalCap(data.globalCap);
  const startsAt = parseOptionalIsoDate(data.startsAt, 'Start date');
  const endsAt = parseOptionalIsoDate(data.endsAt, 'End date');
  if (startsAt && endsAt && Date.parse(endsAt) < Date.parse(startsAt)) {
    fail(400, 'The end date must be after the start date.');
  }

  const restaurantId = sanitizeOptionalText(data.restaurantId);
  const isAutomatic = data.isAutomatic === true;
  const now = nowIso();

  const { data: created, error } = await serviceClient
    .from('PromoCode')
    .insert({
      code,
      type,
      value,
      minBasket,
      perUserCap,
      globalCap,
      startsAt,
      endsAt,
      restaurantId: restaurantId ?? null,
      fundingSource,
      isActive: data.isActive === false ? false : true,
      isAutomatic,
      createdByUid: context.uid,
      createdAt: now,
      updatedAt: now,
    })
    .select(`${PROMO_CODE_COLUMNS},createdAt,updatedAt`)
    .maybeSingle<PromoCodeRow>();

  if (error) {
    // 23505 = the UNIQUE(code) collision.
    if (sanitizeText((error as { code?: string }).code) === '23505') {
      fail(409, 'A promo code with that name already exists.');
    }
    throw new Error(error.message);
  }

  await createAuditEntry(context.uid, 'promo_code_created', 'promo_code', code, {
    type,
    fundingSource,
    value,
  });

  return json(200, { data: { promoCode: created } });
};

const adminSetPromoCodeActive: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin']);
  const promoCodeId = sanitizeText(data.id);
  if (!promoCodeId) {
    fail(400, 'A promo code id is required.');
  }
  if (typeof data.isActive !== 'boolean') {
    fail(400, 'An isActive flag is required.');
  }

  const { data: updated, error } = await serviceClient
    .from('PromoCode')
    .update({ isActive: data.isActive, updatedAt: nowIso() })
    .eq('id', promoCodeId)
    .select(`${PROMO_CODE_COLUMNS},createdAt,updatedAt`)
    .maybeSingle<PromoCodeRow>();

  if (error) {
    throw new Error(error.message);
  }
  if (!updated) {
    fail(404, 'The selected promo code could not be found.');
  }

  await createAuditEntry(context.uid, data.isActive ? 'promo_code_activated' : 'promo_code_deactivated', 'promo_code', promoCodeId, {
    isActive: data.isActive,
  });

  return json(200, { data: { promoCode: updated } });
};

export const adminDomain = defineRpcDomain<AuthenticatedRequestContext>({
  actions: ADMIN_ACTIONS,
  name: 'admin',
  anonymousHandlers: {
    bootstrapFirstAdmin,
  },
  handlers: {
    adminCreatePromoCode,
    adminGetAccessOverview,
    adminGetApprovalQueue,
    adminGetDashboardSnapshot,
    adminListPromoCodes,
    adminReviewDispatchApplication,
    adminReviewPartnerApplication,
    adminSetPromoCodeActive,
    adminSetRestaurantPublished,
    broadcastCancel,
    broadcastCreate,
    broadcastGet,
    broadcastList,
    broadcastPreviewAudience,
    broadcastSchedule,
    promoCreate,
    promoList,
    promoSetActive,
    supportAssignConversation,
    supportGetConversation,
    supportGetInbox,
    supportSendAgentReply,
    supportSetConversationStatus,
  },
});
