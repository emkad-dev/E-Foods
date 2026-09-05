import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AddressRecord } from '../domain/entities';
import { getRestaurantList } from '../services/publicRestaurantReadModel';
import { getPlatformCoverage, type DiscoveryRestaurant, type PlatformCoverage } from '../utils/restaurantAvailability';
import { useCart } from './CartContext';

type CoverageContextValue = {
  isCovered: boolean;
  nearestOrderableKm: number | null;
  isLoading: boolean;
  checkCoverage: (location: AddressRecord | null) => PlatformCoverage;
};

// Fails open: a consumer that somehow renders outside CoverageProvider must never be gated.
const failOpenCheckCoverage = (): PlatformCoverage => ({ isCovered: true, nearestOrderableKm: null });

const CoverageContext = createContext<CoverageContextValue>({
  isCovered: true,
  nearestOrderableKm: null,
  isLoading: true,
  checkCoverage: failOpenCheckCoverage,
});

export const CoverageProvider = ({ children }: { children: ReactNode }) => {
  const { deliveryLocation } = useCart();
  const [restaurants, setRestaurants] = useState<DiscoveryRestaurant[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // getRestaurantList() with no params caches through callPublicCatalog on the same
    // key as home's identical no-coords call, so this shares that fetch rather than
    // adding a round trip -- and coverage needs the full published set (in- and
    // out-of-radius alike) to compute nearestOrderableKm, so it must not pass coords
    // either (the server's coords filter is a hard exclude, not a sort key).
    getRestaurantList()
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
    (location: AddressRecord | null): PlatformCoverage => {
      // Mirror the fail-open guard below: loading or an empty catalogue (including a
      // permanent-for-the-session fetch failure) must never gate a customer, whether the
      // rendered isCovered is read or checkCoverage is called directly.
      if (isLoading || restaurants.length === 0) {
        return { isCovered: true, nearestOrderableKm: null };
      }

      return getPlatformCoverage(restaurants, location);
    },
    [isLoading, restaurants]
  );

  const value = useMemo<CoverageContextValue>(() => {
    // Never flash a coming-soon screen at someone who may well be in range.
    if (isLoading || restaurants.length === 0) {
      return { isCovered: true, nearestOrderableKm: null, isLoading, checkCoverage };
    }

    const coverage = getPlatformCoverage(restaurants, deliveryLocation);
    return { ...coverage, isLoading, checkCoverage };
  }, [checkCoverage, deliveryLocation, isLoading, restaurants]);

  return <CoverageContext.Provider value={value}>{children}</CoverageContext.Provider>;
};

export const useCoverage = () => useContext(CoverageContext);
