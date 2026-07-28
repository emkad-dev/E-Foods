import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getPublishedRestaurants } from '../services/publicRestaurantReadModel';
import { getPlatformCoverage, type DiscoveryRestaurant } from '../utils/restaurantAvailability';
import { useCart } from './CartContext';

type CoverageContextValue = {
  isCovered: boolean;
  nearestDeliverableKm: number | null;
  isLoading: boolean;
};

const CoverageContext = createContext<CoverageContextValue>({
  isCovered: true,
  nearestDeliverableKm: null,
  isLoading: true,
});

export const CoverageProvider = ({ children }: { children: ReactNode }) => {
  const { deliveryLocation } = useCart();
  const [restaurants, setRestaurants] = useState<DiscoveryRestaurant[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // getPublishedRestaurants caches through callPublicCatalog, so this shares the home
    // screen's fetch rather than adding a round trip.
    getPublishedRestaurants()
      .then(({ restaurants: catalog }) => {
        if (!cancelled) {
          setRestaurants(catalog as DiscoveryRestaurant[]);
        }
      })
      .catch((error) => {
        // A catalogue failure must not gate anyone. Leave the list empty and stay
        // permissive via the isLoading guard below.
        console.warn('Failed to load coverage catalog', error);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<CoverageContextValue>(() => {
    // Never flash a coming-soon screen at someone who may well be in range.
    if (isLoading || restaurants.length === 0) {
      return { isCovered: true, nearestDeliverableKm: null, isLoading };
    }

    const coverage = getPlatformCoverage(restaurants, deliveryLocation);
    return { ...coverage, isLoading };
  }, [deliveryLocation, isLoading, restaurants]);

  return <CoverageContext.Provider value={value}>{children}</CoverageContext.Provider>;
};

export const useCoverage = () => useContext(CoverageContext);
