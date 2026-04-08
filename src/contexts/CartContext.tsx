// src/contexts/CartContext.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AddressRecord, OrderItemDocument } from '../domain/entities';
import type { FulfillmentType } from '../domain/orders';

export type CartItem = OrderItemDocument;
export type DeliveryLocation = AddressRecord;

interface CartContextType {
  items: CartItem[];
  restaurantId: string | null;
  restaurantName: string | null;
  deliveryLocation: DeliveryLocation | null;
  fulfillmentType: FulfillmentType;
  addItem: (item: CartItem, restaurantId: string, restaurantName: string) => void;
  updateQuantity: (itemId: string, quantity: number) => void;
  removeItem: (itemId: string) => void;
  clearCart: () => void;
  setDeliveryLocation: (location: DeliveryLocation | null) => void;
  setFulfillmentType: (fulfillmentType: FulfillmentType) => void;
  total: number;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

const CART_STORAGE_KEY = 'cart';

export const CartProvider = ({ children }: { children: React.ReactNode }) => {
  const [items, setItems] = useState<CartItem[]>([]);
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [restaurantName, setRestaurantName] = useState<string | null>(null);
  const [deliveryLocation, setDeliveryLocation] = useState<DeliveryLocation | null>(null);
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>('delivery');

  // Load cart from AsyncStorage on mount
  useEffect(() => {
    const loadCart = async () => {
      try {
        const stored = await AsyncStorage.getItem(CART_STORAGE_KEY);
        if (stored) {
          const { items, restaurantId, restaurantName, deliveryLocation, fulfillmentType } = JSON.parse(stored);
          setItems(items);
          setRestaurantId(restaurantId);
          setRestaurantName(restaurantName);
          setDeliveryLocation(deliveryLocation ?? null);
          setFulfillmentType(fulfillmentType ?? 'delivery');
        }
      } catch (error) {
        console.error('Failed to load cart', error);
      }
    };
    loadCart();
  }, []);

  // Save cart to AsyncStorage whenever it changes
  useEffect(() => {
    const saveCart = async () => {
      try {
        await AsyncStorage.setItem(CART_STORAGE_KEY, JSON.stringify({
          items,
          restaurantId,
          restaurantName,
          deliveryLocation,
          fulfillmentType,
        }));
      } catch (error) {
        console.error('Failed to save cart', error);
      }
    };
    saveCart();
  }, [deliveryLocation, fulfillmentType, items, restaurantId, restaurantName]);

  const addItem = (item: CartItem, newRestaurantId: string, newRestaurantName: string) => {
    // If cart already has items from another restaurant, warn (UI should handle)
    if (restaurantId && restaurantId !== newRestaurantId) {
      // For simplicity, we'll clear and start new – but you might want to show an alert
      setItems([]);
      setRestaurantId(newRestaurantId);
      setRestaurantName(newRestaurantName);
    } else if (!restaurantId) {
      setRestaurantId(newRestaurantId);
      setRestaurantName(newRestaurantName);
    }

    setItems((prev) => {
      const existing = prev.find((i) => i.id === item.id);
      if (existing) {
        return prev.map((i) =>
          i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      } else {
        return [...prev, { ...item, quantity: 1 }];
      }
    });
  };

  const updateQuantity = (itemId: string, quantity: number) => {
    if (quantity <= 0) {
      removeItem(itemId);
      return;
    }
    setItems((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, quantity } : item))
    );
  };

  const removeItem = (itemId: string) => {
    setItems((prev) => {
      const newItems = prev.filter((item) => item.id !== itemId);
      if (newItems.length === 0) {
        setRestaurantId(null);
        setRestaurantName(null);
      }
      return newItems;
    });
  };

  const clearCart = () => {
    setItems([]);
    setRestaurantId(null);
    setRestaurantName(null);
    setFulfillmentType('delivery');
  };

  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        restaurantId,
        restaurantName,
        deliveryLocation,
        fulfillmentType,
        addItem,
        updateQuantity,
        removeItem,
        clearCart,
        setDeliveryLocation,
        setFulfillmentType,
        total,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used within CartProvider');
  return context;
};
