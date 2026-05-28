/// <reference path="../_shared/edge-runtime.d.ts" />

import { corsHeaders } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/client.ts';

type RestaurantApprovalRow = {
  approvedAt?: string | null;
  approvedByUid?: string | null;
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
  ownerId?: string | null;
  paystackSubaccountCode?: string | null;
  supportsDelivery?: boolean | null;
  supportsPickup?: boolean | null;
  updatedAt?: string | null;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
    status,
  });

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
  approvedByUid: sanitizeOptionalText(approval?.approvedByUid),
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
  ownerId: sanitizeOptionalText(restaurant.ownerId),
  paystackSubaccountCode: sanitizeOptionalText(restaurant.paystackSubaccountCode),
  supportsDelivery: restaurant.supportsDelivery !== false,
  supportsPickup: restaurant.supportsPickup !== false,
  updatedAt: restaurant.updatedAt ?? null,
});

const loadApprovedRestaurantCatalog = async () => {
  const [{ data: restaurants, error: restaurantError }, { data: approvals, error: approvalError }] = await Promise.all([
    serviceClient
      .from('RestaurantRecord')
      .select(
        'id,name,ownerId,address,cuisine,description,image,logoImage,menu,deliveryFee,deliveryRadiusKm,deliveryTime,openingTime,closingTime,latitude,longitude,minOrder,paystackSubaccountCode,supportsDelivery,supportsPickup,isOpen,isPublished,updatedAt'
      )
      .eq('isPublished', true)
      .order('updatedAt', { ascending: false }),
    serviceClient
      .from('RestaurantApproval')
      .select('restaurantId,status,approvedByUid,approvedAt')
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

  return (restaurants ?? [])
    .filter((restaurant) => approvalByRestaurantId.has(restaurant.id))
    .map((restaurant) => toRestaurantResponse(restaurant, approvalByRestaurantId.get(restaurant.id) ?? null));
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
      status: 204,
    });
  }

  if (request.method !== 'POST') {
    return json(405, {
      error: {
        message: 'Use POST for public catalog requests.',
      },
    });
  }

  try {
    const { action, data } = (await request.json().catch(() => ({}))) as {
      action?: string;
      data?: { restaurantId?: string };
    };

    if (action === 'customerGetPublishedRestaurants') {
      const restaurants = await loadApprovedRestaurantCatalog();
      return json(200, { data: { restaurants } });
    }

    if (action === 'customerGetPublishedRestaurantDetail') {
      const restaurantId = sanitizeText(data?.restaurantId);
      if (!restaurantId) {
        return json(400, {
          error: {
            message: 'A restaurant id is required.',
          },
        });
      }

      const restaurants = await loadApprovedRestaurantCatalog();
      const restaurant = restaurants.find((entry) => entry.id === restaurantId) ?? null;
      return json(200, { data: { restaurant } });
    }

    return json(404, {
      error: {
        message: 'The requested public action was not found.',
      },
    });
  } catch (error) {
    return json(500, {
      error: {
        message: error instanceof Error ? error.message : 'Unexpected public catalog failure.',
      },
    });
  }
});
