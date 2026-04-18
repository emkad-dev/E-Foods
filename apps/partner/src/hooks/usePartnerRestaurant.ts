import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase/config';

export type RestaurantProfile = {
  id: string;
  address?: string | null;
  cuisine?: string | null;
  deliveryRadiusKm?: number | string | null;
  description?: string | null;
  deliveryFee?: number | null;
  deliveryTime?: string | number | null;
  image?: string | null;
  isPublished?: boolean | null;
  isOpen?: boolean | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  menu?: {
    category: string;
    items: {
      description?: string;
      id: string;
      image?: string;
      isAvailable?: boolean;
      name: string;
      price: number;
    }[];
  }[] | null;
  minOrder?: number | null;
  name: string;
  rating?: number | null;
  supportsDelivery?: boolean | null;
  supportsPickup?: boolean | null;
};

const matchesUser = (restaurant: Record<string, unknown>, userId: string, displayName?: string | null) => {
  const ownerFields = [restaurant.ownerId, restaurant.ownerUid, restaurant.userId, restaurant.managerId];

  if (ownerFields.some((value) => typeof value === 'string' && value === userId)) {
    return true;
  }

  if (restaurant.id === userId) {
    return true;
  }

  if (displayName && typeof restaurant.name === 'string') {
    return restaurant.name.trim().toLowerCase() === displayName.trim().toLowerCase();
  }

  return false;
};

export const usePartnerRestaurant = () => {
  const { user } = useAuth();
  const [restaurants, setRestaurants] = useState<RestaurantProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setRestaurants([]);
      setLoading(false);
      return;
    }

    const unsubscribe = onSnapshot(
      collection(db, 'restaurants'),
      (snapshot) => {
        const nextRestaurants = snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          ...(docSnapshot.data() as Record<string, unknown>),
        })) as RestaurantProfile[];

        setRestaurants(nextRestaurants);
        setError(null);
        setLoading(false);
      },
      (nextError) => {
        console.error('Error loading partner restaurant:', nextError);
        setRestaurants([]);
        setError(nextError.message);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [user]);

  const restaurant = useMemo(() => {
    if (!user) {
      return null;
    }

    if (user.restaurantId) {
      const linkedRestaurant = restaurants.find((candidate) => candidate.id === user.restaurantId);

      if (linkedRestaurant) {
        return linkedRestaurant;
      }
    }

    if (user.restaurantName) {
      const namedRestaurant = restaurants.find(
        (candidate) => candidate.name.trim().toLowerCase() === user.restaurantName?.trim().toLowerCase()
      );

      if (namedRestaurant) {
        return namedRestaurant;
      }
    }

    return (
      restaurants.find((candidate) => matchesUser(candidate as unknown as Record<string, unknown>, user.uid, user.displayName)) ??
      null
    );
  }, [restaurants, user]);

  return {
    error,
    loading,
    restaurants,
    restaurant,
  };
};
