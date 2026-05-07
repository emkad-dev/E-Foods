import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase/config';

type UpdateRestaurantApprovalInput = {
  restaurantId: string;
  isOpen?: boolean;
  isPublished?: boolean;
};

type UpdateRestaurantApprovalResult = {
  id: string;
  isOpen: boolean;
  isPublished: boolean;
  name: string;
};

const adminUpdateRestaurantApprovalCallable = httpsCallable<
  UpdateRestaurantApprovalInput,
  UpdateRestaurantApprovalResult
>(functions, 'adminUpdateRestaurantApproval');

export const updateRestaurantApproval = async (input: UpdateRestaurantApprovalInput) => {
  const result = await adminUpdateRestaurantApprovalCallable(input);
  return result.data;
};
