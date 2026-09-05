import type { CartItem } from '../contexts/CartContext';

export type CheckoutRestaurantGroup = {
  items: CartItem[];
  restaurantId: string;
  restaurantName: string;
  subtotal: number;
  totalQuantity: number;
};

export const groupCartItemsByRestaurant = (items: CartItem[]): CheckoutRestaurantGroup[] => {
  const groups = new Map<string, CheckoutRestaurantGroup>();

  for (const item of items) {
    const current = groups.get(item.restaurantId);

    if (!current) {
      groups.set(item.restaurantId, {
        items: [item],
        restaurantId: item.restaurantId,
        restaurantName: item.restaurantName,
        subtotal: item.price * item.quantity,
        totalQuantity: item.quantity,
      });
      continue;
    }

    current.items.push(item);
    current.subtotal += item.price * item.quantity;
    current.totalQuantity += item.quantity;
  }

  return Array.from(groups.values());
};
