import type { RestaurantDocument } from '../domain/entities';
import { appEnv, supabaseEnv } from '../config/env';

const resolvePublicCatalogUrl = () => {
  if (supabaseEnv.url?.trim()) {
    return `${supabaseEnv.url.trim().replace(/\/+$/, '')}/functions/v1/public-catalog`;
  }

  if (appEnv.backendRpcUrl?.trim()) {
    const backendRpcUrl = appEnv.backendRpcUrl.trim();

    if (backendRpcUrl.endsWith('/functions/v1/app-rpc')) {
      return `${backendRpcUrl.slice(0, -'/app-rpc'.length)}/public-catalog`;
    }

    if (backendRpcUrl.endsWith('/functions/v1/public-catalog')) {
      return backendRpcUrl;
    }

    throw new Error(
      'EXPO_PUBLIC_BACKEND_RPC_URL must point to the Supabase app-rpc or public-catalog Edge Function.'
    );
  }

  throw new Error(
    'Missing public catalog configuration. Set EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_BACKEND_RPC_URL for the Supabase Edge Function.'
  );
};

const callPublicCatalog = async <T>(action: string, data?: Record<string, unknown>) => {
  const response = await fetch(resolvePublicCatalogUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action,
      data: data ?? {},
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        data?: T;
        error?: { message?: string };
      }
    | null;

  if (!response.ok) {
    throw new Error(payload?.error?.message || `Public catalog request failed with status ${response.status}`);
  }

  return payload?.data as T;
};

export const getPublishedRestaurants = async () =>
  callPublicCatalog<{ restaurants: RestaurantDocument[] }>('customerGetPublishedRestaurants');

export const getPublishedRestaurantDetail = async (restaurantId: string) =>
  callPublicCatalog<{ restaurant: RestaurantDocument | null }>('customerGetPublishedRestaurantDetail', {
    restaurantId,
  });
