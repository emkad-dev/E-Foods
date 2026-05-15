import { callAdminBackendRpc } from './backendRpc';

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

export const reviewDispatchApplication = async (input: {
  applicationId: string;
  decision: 'approve' | 'reject';
  rejectionReason?: string;
}) => callAdminBackendRpc<ReviewDispatchApplicationResult>('adminReviewDispatchApplication', input);

export const reviewPartnerApplication = async (input: {
  applicationId: string;
  decision: 'approve' | 'reject';
  rejectionReason?: string;
}) => callAdminBackendRpc<ReviewPartnerApplicationResult>('adminReviewPartnerApplication', input);
