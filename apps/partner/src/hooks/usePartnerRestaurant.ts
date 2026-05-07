import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type { RestaurantDocument } from '../domain/entities';
import { getPartnerRestaurantContext } from '../services/partnerReadModel';

export type RestaurantProfile = RestaurantDocument;

export const usePartnerRestaurant = () => {
  const { user } = useAuth();
  const [restaurants, setRestaurants] = useState<RestaurantProfile[]>([]);
  const [claimableRestaurants, setClaimableRestaurants] = useState<RestaurantProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requiresVerifiedLink, setRequiresVerifiedLink] = useState(false);
  const [restaurant, setRestaurant] = useState<RestaurantProfile | null>(null);

  useEffect(() => {
    if (!user) {
      setRestaurants([]);
      setClaimableRestaurants([]);
      setRestaurant(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const loadContext = async () => {
      try {
        const nextContext = await getPartnerRestaurantContext();

        if (cancelled) {
          return;
        }

        setRestaurants(nextContext.restaurants);
        setClaimableRestaurants(nextContext.claimableRestaurants);
        setRestaurant(nextContext.restaurant);
        setRequiresVerifiedLink(nextContext.requiresVerifiedLink);
        setError(null);
      } catch (nextError: any) {
        if (cancelled) {
          return;
        }

        console.error('Error loading partner restaurant:', nextError);
        setRestaurants([]);
        setClaimableRestaurants([]);
        setRestaurant(null);
        setRequiresVerifiedLink(false);
        setError(nextError.message ?? 'Unable to load restaurant context right now.');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadContext();
    const interval = setInterval(() => {
      void loadContext();
    }, 20000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user]);

  return {
    claimableRestaurants,
    error,
    loading,
    restaurants,
    requiresVerifiedLink,
    restaurant,
  };
};
