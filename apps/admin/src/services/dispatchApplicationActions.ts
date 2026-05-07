import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase/config';

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

const adminReviewDispatchApplicationCallable = httpsCallable<
  {
    applicationId: string;
    decision: 'approve' | 'reject';
    rejectionReason?: string;
  },
  ReviewDispatchApplicationResult
>(functions, 'adminReviewDispatchApplication');

const adminReviewPartnerApplicationCallable = httpsCallable<
  {
    applicationId: string;
    decision: 'approve' | 'reject';
    rejectionReason?: string;
  },
  ReviewPartnerApplicationResult
>(functions, 'adminReviewPartnerApplication');

export const reviewDispatchApplication = async (input: {
  applicationId: string;
  decision: 'approve' | 'reject';
  rejectionReason?: string;
}) => {
  const result = await adminReviewDispatchApplicationCallable(input);
  return result.data;
};

export const reviewPartnerApplication = async (input: {
  applicationId: string;
  decision: 'approve' | 'reject';
  rejectionReason?: string;
}) => {
  const result = await adminReviewPartnerApplicationCallable(input);
  return result.data;
};
