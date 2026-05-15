import { callAdminBackendRpc } from './backendRpc';

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

export const updateRestaurantApproval = async (input: UpdateRestaurantApprovalInput) =>
  callAdminBackendRpc<UpdateRestaurantApprovalResult>('adminUpdateRestaurantApproval', input);
