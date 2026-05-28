import { callCustomerBackendRpc } from './backendRpc';

type CustomerFavoriteListResult = {
  restaurantIds: string[];
};

type CustomerFavoriteToggleResult = {
  isFavorite: boolean;
  restaurantId: string;
  restaurantIds: string[];
};

export const listFavoriteRestaurants = async () =>
  callCustomerBackendRpc<CustomerFavoriteListResult>('customerListFavoriteRestaurants');

export const toggleFavoriteRestaurant = async (restaurantId: string, isFavorite?: boolean) =>
  callCustomerBackendRpc<CustomerFavoriteToggleResult>('customerToggleFavoriteRestaurant', {
    isFavorite,
    restaurantId,
  });
