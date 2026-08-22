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
  'dispatchGetOrderDetail',
  'upsertDispatchRiderProfile',
  'syncDispatchRiderLocation',
  'dispatchAssignOrderCourier',
  'dispatchUpdateOrderStatus',
  'submitDispatchApplication',
  'dispatchAcceptOffer',
  'dispatchDeclineOffer',
] as const;

export const PARTNER_ACTIONS = [
  'partnerGetRestaurantContext',
  'partnerGetRestaurantOrders',
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
] as const;

export const ADMIN_ACTIONS = [
  'adminGetApprovalQueue',
  'adminReviewDispatchApplication',
  'adminReviewPartnerApplication',
  'adminSetRestaurantPublished',
  'adminGetDashboardSnapshot',
  'adminGetAccessOverview',
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
  'getPolicyAcceptance',
  'recordPolicyAcceptance',
  'provisionStaffAccount',
  'assignUserRole',
  'updateUserRestaurantLink',
  'revokeUserRole',
  'disableUserAccess',
  'enableUserAccess',
  'syncUserClaims',
  'deleteOwnAccount',
  'deleteAdminAccess',
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
