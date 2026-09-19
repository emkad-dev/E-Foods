// The RPC action contract, split by domain.
//
// This module is deliberately dependency-free so the registry test can import
// it without pulling in the Supabase client (which throws at module scope when
// SUPABASE_URL / SERVICE_ROLE_KEY are absent). Each domain module declares its
// list here and `defineRpcDomain` refuses to build a domain whose handler map
// does not match its list exactly, so a dropped or renamed handler fails at
// cold start instead of silently 501-ing at runtime.

export const ORDER_ACTIONS = [
  'customerGetOrders',
  'customerGetOrderDetail',
  'customerListFavoriteRestaurants',
  'customerToggleFavoriteRestaurant',
  'placeCustomerOrder',
  'initializeCustomerPayment',
  'refreshCustomerPaymentStatus',
  'cancelCustomerOrder',
  'customerSendSupportMessage',
  'customerGetSupportThread',
  'customerSubmitOrderRating',
  'customerGetPendingRatings',
  // Task 17 (G1): validate a promo code / preview its discount, and surface
  // eligible automatic offers, before placing. Advisory — placement
  // re-validates and redeems server-side.
  'customerValidatePromoCode',
] as const;

export const DISPATCH_ACTIONS = [
  'dispatchGetDeliveryQueue',
  'dispatchGetRiders',
  'dispatchGetWeeklyEarnings',
  'dispatchGetShiftSlots',
  'dispatchGetOrderDetail',
  'upsertDispatchRiderProfile',
  'dispatchUpsertShiftSlots',
  'syncDispatchRiderLocation',
  'dispatchGetNearestRiders',
  'dispatchAssignOrderCourier',
  'dispatchUpdateOrderStatus',
  'submitDispatchApplication',
  'dispatchAcceptOffer',
  'dispatchDeclineOffer',
] as const;

export const PARTNER_ACTIONS = [
  'partnerGetRestaurantContext',
  'partnerGetRestaurantOrders',
  'partnerGetRestaurantRatings',
  'partnerInviteStaff',
  'partnerListStaff',
  'partnerRevokeStaffAccess',
  'partnerRevokeStaffInvite',
  'partnerGetRestaurantOrder',
  'upsertPartnerRestaurantProfile',
  'claimPartnerRestaurantLink',
  'upsertPartnerRestaurantMenu',
  'partnerUpdateOrderStatus',
  'submitPartnerApplication',
  // Task 16 (F2): dedicated lightweight actions so marking a single item or
  // the whole store unavailable is "two taps", not a full-menu re-upload.
  'partnerSetMenuItemAvailability',
  'partnerSetStorePause',
  // Partner onboarding single flow (KYC + payout bank): a live bank-account
  // name check, signed upload URLs for verification documents, and the single
  // submit that writes the application, KYC and payout rows together.
  'resolvePartnerBankAccount',
  'requestPartnerVerificationUploadUrl',
  'submitPartnerOnboarding',
] as const;

export const ADMIN_ACTIONS = [
  'adminGetApprovalQueue',
  'adminReviewDispatchApplication',
  'adminReviewPartnerApplication',
  'adminSetRestaurantPublished',
  'adminGetDashboardSnapshot',
  'adminGetAccessOverview',
  'adminGetAuditLog',
  'adminGetRiskEvents',
  'adminListFeatureFlags',
  'adminUpsertFeatureFlag',
  'adminGetOperationalAlerts',
  'supportGetInbox',
  'supportGetConversation',
  'supportSendAgentReply',
  'supportSetConversationStatus',
  'supportAssignConversation',
  'broadcastList',
  'broadcastGet',
  'broadcastPreviewAudience',
  'broadcastCreate',
  'broadcastSchedule',
  'broadcastCancel',
  'promoList',
  'promoCreate',
  'promoSetActive',
  // Task 17 (G1): admin CRUD for the NEW discount-code engine — distinct from
  // the banner promos above (promoList/promoCreate/promoSetActive).
  'adminListPromoCodes',
  'adminCreatePromoCode',
  'adminSetPromoCodeActive',
  'bootstrapFirstAdmin',
] as const;

export const ACCOUNT_ACTIONS = [
  'promoTrack',
  'getFeatureFlags',
  'getPolicyAcceptance',
  'recordPolicyAcceptance',
  'provisionStaffAccount',
  'redeemStaffInvite',
  'assignUserRole',
  'updateUserRestaurantLink',
  'revokeUserRole',
  'disableUserAccess',
  'enableUserAccess',
  'syncUserClaims',
  'deleteOwnAccount',
  'deleteAdminAccess',
  // The admin-side counterpart to deleteAdminAccess, covering every NON-admin
  // role: it is how an emailed deletion request from the published
  // feasty.com.ng/account-deletion page is actually honoured, instead of with
  // raw SQL. deleteAdminAccess refuses non-admin targets and this one refuses
  // admin targets, so the two partition the role space exactly.
  'deleteUserAccountOnRequest',
] as const;

// The two actions that must run before authentication:
//   promoTrack          — browsing customers are frequently signed out.
//   bootstrapFirstAdmin — resolves its own bootstrap context (see rpc/context.ts).
// Every other action authenticates first; so does an unknown action, which is
// why an unauthenticated request for a nonexistent action still gets a 401.
export const ANONYMOUS_ACTIONS = ['promoTrack', 'bootstrapFirstAdmin'] as const;

export const ALL_RPC_ACTIONS = [
  ...ORDER_ACTIONS,
  ...DISPATCH_ACTIONS,
  ...PARTNER_ACTIONS,
  ...ADMIN_ACTIONS,
  ...ACCOUNT_ACTIONS,
] as const;

export type RpcActionName = (typeof ALL_RPC_ACTIONS)[number];

/**
 * Actions a caller may still invoke while their account is pending deletion.
 *
 * **This list is empty, and that is correct as of 2026-09-11.** FEASTY ships
 * IMMEDIATE account deletion (`deleteOwnAccount` in
 * `_shared/domains/account.ts`): audit, ban, cascade cleanup, delete the auth
 * user, roll back to 409 if cleanup fails. Nothing in this repository ever
 * writes `UserAccount.deletionRequestedAt`, so in practice no caller is ever
 * in the pending-deletion state and nothing needs an exemption.
 *
 * The 30-day grace period this list belongs to is ENFORCED but DORMANT: the
 * columns, the `ebuy_account_pending_deletion()` predicate, the
 * `ebuy_guard_useraccount_sensitive_update` freeze and five RLS policies are
 * all live in production, and `assertAccountAccessible` 403s with
 * `ACCOUNT_PENDING_DELETION` the moment `deletionRequestedAt` is set. What is
 * missing is every writer and every way back out.
 *
 * So: setting `deletionRequestedAt` on a real account today PERMANENTLY LOCKS
 * THAT ACCOUNT OUT of every authenticated action, and the RLS freeze stops the
 * user clearing it themselves. Read `docs/account-deletion-design.md` BEFORE
 * you add a writer.
 *
 * This is deliberately `readonly string[]` and not `readonly RpcActionName[]`:
 * the guarantee that every entry is a real, dispatchable action is enforced at
 * RUNTIME by `actionReferences.test.ts`, which also covers the `--no-check`
 * half of `test:deno` where a type annotation would buy nothing. An earlier
 * version of this exemption was the bare literal
 * `action === 'cancelAccountDeletion'` — an action that has never existed in
 * any action list and has never had a handler — which is exactly the drift
 * that test now makes impossible.
 */
export const PENDING_DELETION_EXEMPT_ACTIONS: readonly string[] = [];
