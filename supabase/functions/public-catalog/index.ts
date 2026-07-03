/// <reference path="../_shared/edge-runtime.d.ts" />

import { corsHeaders } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/client.ts';
import {
  createEdgeObservation,
  finishEdgeObservation,
  jsonResponse,
  logEdgeEvent,
} from '../_shared/observability.ts';

type RestaurantApprovalRow = {
  approvedAt?: string | null;
  restaurantId: string;
  status: string;
};

type RestaurantRecordRow = {
  address?: string | null;
  closingTime?: string | null;
  createdAt?: string | null;
  cuisine?: string | null;
  deliveryFee?: number | null;
  deliveryRadiusKm?: number | null;
  deliveryTime?: string | number | null;
  description?: string | null;
  id: string;
  image?: string | null;
  logoImage?: string | null;
  isOpen?: boolean | null;
  isPublished?: boolean | null;
  latitude?: number | null;
  longitude?: number | null;
  menu?: unknown[] | null;
  minOrder?: number | null;
  name: string;
  openingTime?: string | null;
  supportsDelivery?: boolean | null;
  supportsPickup?: boolean | null;
  updatedAt?: string | null;
};

const sanitizeText = (value: unknown, fallback = '') =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const sanitizeOptionalText = (value: unknown) => {
  const nextValue = sanitizeText(value);
  return nextValue || null;
};

const toRestaurantResponse = (
  restaurant: RestaurantRecordRow,
  approval: RestaurantApprovalRow | null
) => ({
  address: sanitizeOptionalText(restaurant.address),
  approvalStatus: approval?.status ?? (restaurant.isPublished ? 'approved' : 'pending'),
  approvedAt: approval?.approvedAt ?? null,
  cuisine: sanitizeOptionalText(restaurant.cuisine),
  deliveryFee: restaurant.deliveryFee ?? 0,
  deliveryRadiusKm: restaurant.deliveryRadiusKm ?? null,
  deliveryTime: restaurant.deliveryTime ?? null,
  description: sanitizeOptionalText(restaurant.description),
  closingTime: sanitizeOptionalText(restaurant.closingTime),
  id: restaurant.id,
  image: sanitizeOptionalText(restaurant.image),
  logoImage: sanitizeOptionalText(restaurant.logoImage),
  isOpen: restaurant.isOpen !== false,
  isPublished: restaurant.isPublished === true,
  latitude: restaurant.latitude ?? null,
  longitude: restaurant.longitude ?? null,
  menu: Array.isArray(restaurant.menu) ? restaurant.menu : [],
  minOrder: restaurant.minOrder ?? 0,
  name: sanitizeText(restaurant.name, 'Restaurant'),
  openingTime: sanitizeOptionalText(restaurant.openingTime),
  supportsDelivery: restaurant.supportsDelivery !== false,
  supportsPickup: restaurant.supportsPickup !== false,
  updatedAt: restaurant.updatedAt ?? null,
});

const loadPublishedRestaurantCatalog = async () => {
  const [{ data: restaurants, error: restaurantError }, { data: approvals, error: approvalError }] =
    await Promise.all([
      serviceClient
        .from('RestaurantRecord')
        .select(
          'id,name,address,cuisine,description,image,logoImage,menu,deliveryFee,deliveryRadiusKm,deliveryTime,openingTime,closingTime,latitude,longitude,minOrder,supportsDelivery,supportsPickup,isOpen,isPublished,updatedAt'
        )
        .eq('isPublished', true)
        .order('updatedAt', { ascending: false }),
      serviceClient
        .from('RestaurantApproval')
        .select('restaurantId,status,approvedAt')
        .eq('status', 'approved'),
    ]);

  if (restaurantError) {
    throw new Error(restaurantError.message);
  }

  if (approvalError) {
    throw new Error(approvalError.message);
  }

  const approvalByRestaurantId = new Map(
    (approvals ?? []).map((approval) => [approval.restaurantId, approval] as const)
  );

  return (restaurants ?? []).map((restaurant) =>
    toRestaurantResponse(restaurant, approvalByRestaurantId.get(restaurant.id) ?? null)
  );
};

Deno.serve(async (request) => {
  const observation = createEdgeObservation(request, 'public-catalog');

  if (request.method === 'OPTIONS') {
    const response = new Response('ok', {
      headers: corsHeaders,
      status: 204,
    });
    finishEdgeObservation(observation, { status: response.status });
    return response;
  }

  if (request.method !== 'POST') {
    const response = jsonResponse(
      405,
      {
        error: {
          message: 'Use POST for public catalog requests.',
        },
      },
      corsHeaders
    );
    finishEdgeObservation(observation, { status: response.status });
    return response;
  }

  try {
    const { action, data } = (await request.json().catch(() => ({}))) as {
      action?: string;
      data?: { restaurantId?: string };
    };

    logEdgeEvent('debug', 'public-catalog action received', {
      action: action ?? null,
      requestId: observation.requestId,
    });

    if (action === 'customerGetPublishedRestaurants') {
      const restaurants = await loadPublishedRestaurantCatalog();
      const response = jsonResponse(
        200,
        { data: { restaurants } },
        {
          ...corsHeaders,
          'Cache-Control': 'public, max-age=45, stale-while-revalidate=120',
        }
      );
      finishEdgeObservation(observation, { status: response.status });
      return response;
    }

    if (action === 'customerGetPublishedRestaurantDetail') {
      const restaurantId = sanitizeText(data?.restaurantId);
      if (!restaurantId) {
        const response = jsonResponse(
          400,
          {
            error: {
              message: 'A restaurant id is required.',
            },
          },
          corsHeaders
        );
        finishEdgeObservation(observation, { status: response.status });
        return response;
      }

      const restaurants = await loadPublishedRestaurantCatalog();
      const restaurant = restaurants.find((entry) => entry.id === restaurantId) ?? null;
      const response = jsonResponse(
        200,
        { data: { restaurant } },
        {
          ...corsHeaders,
          'Cache-Control': 'public, max-age=30, stale-while-revalidate=90',
        }
      );
      finishEdgeObservation(observation, { status: response.status });
      return response;
    }

    const response = jsonResponse(
      404,
      {
        error: {
          message: 'The requested public action was not found.',
        },
      },
      corsHeaders
    );
    finishEdgeObservation(observation, { status: response.status });
    return response;
  } catch (error) {
    const response = jsonResponse(
      500,
      {
        error: {
          message: error instanceof Error ? error.message : 'Unexpected public catalog failure.',
        },
      },
      corsHeaders
    );
    finishEdgeObservation(observation, { status: response.status, error });
    return response;
  }
});
