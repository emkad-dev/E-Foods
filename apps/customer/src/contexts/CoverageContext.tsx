import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AddressRecord } from '../domain/entities';
import { getPublishedRestaurants } from '../services/publicRestaurantReadModel';
import { getPlatformCoverage, type DiscoveryRestaurant, type PlatformCoverage } from '../utils/restaurantAvailability';
import { useCart } from './CartContext';

type CoverageContextValue = {
  isCovered: boolean;
  nearestDeliverableKm: number | null;
  isLoading: boolean;
  checkCoverage: (location: AddressRecord | null) => PlatformCoverage;
};

// Fails open: a consumer that somehow renders outside CoverageProvider must never be gated.
const failOpenCheckCoverage = (): PlatformCoverage => ({ isCovered: true, nearestDeliverableKm: null });

const CoverageContext = createContext<CoverageContextValue>({
  isCovered: true,
  nearestDeliverableKm: null,
  isLoading: true,
  checkCoverage: failOpenCheckCoverage,
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

  const checkCoverage = useCallback(
    (location: AddressRecord | null): PlatformCoverage => getPlatformCoverage(restaurants, location),
    [restaurants]
  );

  const value = useMemo<CoverageContextValue>(() => {
    // Never flash a coming-soon screen at someone who may well be in range.
    if (isLoading || restaurants.length === 0) {
      return { isCovered: true, nearestDeliverableKm: null, isLoading, checkCoverage };
    }

    const coverage = getPlatformCoverage(restaurants, deliveryLocation);
    return { ...coverage, isLoading, checkCoverage };
  }, [checkCoverage, deliveryLocation, isLoading, restaurants]);

  return <CoverageContext.Provider value={value}>{children}</CoverageContext.Provider>;
};

export const useCoverage = () => useContext(CoverageContext);
