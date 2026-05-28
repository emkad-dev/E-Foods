import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { listFavoriteRestaurants, toggleFavoriteRestaurant } from '../services/customerFavorites';
import { useAuth } from './AuthContext';

type FavoritesContextType = {
  favoriteRestaurantIds: string[];
  isFavoriteRestaurant: (restaurantId: string) => boolean;
  loading: boolean;
  refreshFavorites: () => Promise<void>;
  toggleFavorite: (restaurantId: string, isFavorite?: boolean) => Promise<boolean>;
};

const FavoritesContext = createContext<FavoritesContextType | undefined>(undefined);

export const FavoritesProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const [favoriteRestaurantIds, setFavoriteRestaurantIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshFavorites = useCallback(async () => {
    if (!user) {
      setFavoriteRestaurantIds([]);
      return;
    }

    setLoading(true);
    try {
      const result = await listFavoriteRestaurants();
      setFavoriteRestaurantIds(result.restaurantIds);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refreshFavorites().catch(() => undefined);
  }, [refreshFavorites]);

  const favoriteRestaurantIdSet = useMemo(() => new Set(favoriteRestaurantIds), [favoriteRestaurantIds]);

  const isFavoriteRestaurant = useCallback(
    (restaurantId: string) => favoriteRestaurantIdSet.has(restaurantId),
    [favoriteRestaurantIdSet]
  );

  const toggleFavorite = useCallback(
    async (restaurantId: string, isFavorite?: boolean) => {
      const result = await toggleFavoriteRestaurant(restaurantId, isFavorite);
      setFavoriteRestaurantIds(result.restaurantIds);
      return result.isFavorite;
    },
    []
  );

  return (
    <FavoritesContext.Provider
      value={{
        favoriteRestaurantIds,
        isFavoriteRestaurant,
        loading,
        refreshFavorites,
        toggleFavorite,
      }}
    >
      {children}
    </FavoritesContext.Provider>
  );
};

export const useFavorites = () => {
  const context = useContext(FavoritesContext);

  if (!context) {
    throw new Error('useFavorites must be used within FavoritesProvider');
  }

  return context;
};
