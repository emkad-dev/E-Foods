import { callAdminRpc } from '../lib/rpc';

type SetRestaurantPublishedInput = {
  restaurantId: string;
  isPublished: boolean;
};

type SetRestaurantPublishedResult = {
  id: string;
  isPublished: boolean;
  name: string;
};

export const setRestaurantPublished = (input: SetRestaurantPublishedInput) =>
  callAdminRpc<SetRestaurantPublishedResult>('adminSetRestaurantPublished', input, { write: true });

type ReviewDispatchApplicationResult = {
  applicationId: string;
  approvedByUid: string | null;
  decision: 'approve' | 'reject';
  role: 'dispatch' | 'customer';
  tokenRefreshRequired: boolean;
};

type ReviewPartnerApplicationResult = {
  applicationId: string;
  approvedByUid: string | null;
  decision: 'approve' | 'reject';
  restaurantId: string | null;
  role: 'restaurant' | 'customer';
  tokenRefreshRequired: boolean;
};

export const reviewDispatchApplication = (input: {
  applicationId: string;
  decision: 'approve' | 'reject';
  rejectionReason?: string;
}) => callAdminRpc<ReviewDispatchApplicationResult>('adminReviewDispatchApplication', input, { write: true });

export const reviewPartnerApplication = (input: {
  applicationId: string;
  decision: 'approve' | 'reject';
  rejectionReason?: string;
}) => callAdminRpc<ReviewPartnerApplicationResult>('adminReviewPartnerApplication', input, { write: true });
