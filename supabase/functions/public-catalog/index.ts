/// <reference path="../_shared/edge-runtime.d.ts" />

import { corsHeaders } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/client.ts';
import { loadPricingConfig } from '../_shared/platformSettings.ts';
import {
  clientErrorMessage,
  createEdgeObservation,
  finishEdgeObservation,
  getErrorStatus,
  jsonResponse,
  logEdgeEvent,
} from '../_shared/observability.ts';
import {
  DEFAULT_PAGE_SIZE,
  hasAvailableMenuItem,
  isRestaurantRowPaused,
  paginateRestaurants,
  sortRestaurantsByLocation,
  toRestaurantCard,
  toRestaurantDetail,
  type RestaurantHoursProjection,
  type GeoCoords,
  type RestaurantRow,
} from './catalog.ts';

// `menu` is selected here even though customerGetRestaurantList's response
// never includes it (toRestaurantCard drops it) — it exists solely to run
// hasAvailableMenuItem below before being stripped. That means this query's
// Postgres read volume and PostgREST-to-function transfer size are the SAME
// as the pre-B2 full-catalog query for the same restaurant count; only the
// function-to-client wire payload shrinks (see catalog.ts's toRestaurantCard
// and this task's report, section 2). The trade: preserving the pre-existing
// "don't show a restaurant with zero orderable items" UX invariant without a
// schema change. Removing this pre-filter (and `menu` from this select)
// would recover the DB-read savings but change customer-visible behavior —
// deliberately not done without a product decision. A `hasAvailableItem`
// column maintained on write would let this select drop `menu` entirely; out
// of scope here.
// `pausedUntil` is selected for the same reason `menu` is (see the comment
// above): it exists solely to run isRestaurantRowPaused in loadRestaurantRows
// below before being stripped — a paused store never reaches
// toRestaurantCard/toRestaurantDetail, so neither projection carries the
// field forward.
const CARD_COLUMNS =
  'id,name,cuisine,cuisines,image,logoImage,menu,deliveryFee,deliveryRadiusKm,deliveryTime,latitude,longitude,minOrder,supportsDelivery,supportsPickup,isOpen,isPublished,pausedUntil,updatedAt,ratingAverage,ratingCount';

const DETAIL_COLUMNS =
  'id,name,address,cuisine,description,image,logoImage,menu,deliveryFee,deliveryRadiusKm,deliveryTime,openingTime,closingTime,latitude,longitude,minOrder,supportsDelivery,supportsPickup,isOpen,isPublished,pausedUntil,updatedAt,ratingAverage,ratingCount';

const LIST_CACHE_HEADERS = { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' };
const DETAIL_CACHE_HEADERS = { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=120' };
// Unchanged from before this task — these two actions are deprecated shims
// kept only so already-installed mobile builds keep working; there is no
// reason to touch their cache behavior along with everything else here.
const LEGACY_LIST_CACHE_HEADERS = { 'Cache-Control': 'public, max-age=45, stale-while-revalidate=120' };
const LEGACY_DETAIL_CACHE_HEADERS = { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=90' };

const sanitizeText = (value: unknown, fallback = '') =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const parseCoords = (data: Record<string, unknown> | undefined): GeoCoords | null => {
  const latitude = toFiniteNumber(data?.latitude);
  const longitude = toFiniteNumber(data?.longitude);
  // Both or neither: a lone coordinate can't locate anything, so treat it as
  // "no location given" rather than filtering against a bogus (0, longitude)
  // or (latitude, 0) point.
  return latitude !== null && longitude !== null ? { latitude, longitude } : null;
};

// Shared by BOTH customerGetRestaurantList and the deprecated
// customerGetPublishedRestaurants alias below — filtering a paused store out
// HERE, at the one row-loading function both call, is what guarantees the two
// can never disagree (the same "MUST agree" lesson hasAvailableMenuItem's
// comment documents for item-level availability, applied at the row level
// instead of duplicated per call site).
const loadRestaurantRows = async (columns: string): Promise<RestaurantRow[]> => {
  const { data: restaurants, error: restaurantError } = await serviceClient
    .from('RestaurantRecord')
    .select(columns)
    .eq('isPublished', true)
    .order('updatedAt', { ascending: false });

  if (restaurantError) {
    throw new Error(restaurantError.message);
  }

  const rows = (restaurants ?? []) as unknown as RestaurantRow[];
  return rows.filter((row) => !isRestaurantRowPaused(row));
};

const loadRestaurantRowById = async (columns: string, restaurantId: string): Promise<RestaurantRow | null> => {
  const { data: restaurant, error: restaurantError } = await serviceClient
    .from('RestaurantRecord')
    .select(columns)
    .eq('id', restaurantId)
    .eq('isPublished', true)
    .maybeSingle();

  if (restaurantError) {
    throw new Error(restaurantError.message);
  }

  return (restaurant ?? null) as unknown as RestaurantRow | null;
};

// --- customerGetRestaurantList: cards only, no menu field, optional geo filter + cursor paging ---
const handleGetRestaurantList = async (data: Record<string, unknown> | undefined) => {
  const coords = parseCoords(data);
  const cursor = typeof data?.cursor === 'string' ? data.cursor : null;

  const rows = await loadRestaurantRows(CARD_COLUMNS);
  // A restaurant with zero available menu items is not orderable, so it must
  // not surface in discovery — same invariant the deprecated full-catalog
  // alias leaves to the client (isRestaurantVisibleToCustomers), enforced
  // here instead since the card response never carries the menu to check.
  const eligible = rows.filter((row) => hasAvailableMenuItem(row.menu));
  const ordered = sortRestaurantsByLocation(eligible, coords);
  const { items, nextCursor } = paginateRestaurants(ordered, cursor, DEFAULT_PAGE_SIZE);

  return {
    restaurants: items.map((row) => toRestaurantCard(row)),
    nextCursor,
  };
};

/**
 * Per-day opening hours for one restaurant (Task 30 [H6]).
 *
 * Never throws: the slot picker is an enhancement on top of checkout, so a
 * hours read that fails degrades to "no schedulable slots offered" rather than
 * failing the whole restaurant detail request. The server remains the authority
 * either way - placeCustomerOrder re-validates any scheduledFor it is sent.
 */
const loadRestaurantHoursFor = async (restaurantId: string): Promise<RestaurantHoursProjection[]> => {
  const { data, error } = await serviceClient
    .from('RestaurantHours')
    .select('dayOfWeek,isClosed,opensAt,closesAt')
    .eq('restaurantId', restaurantId);

  if (error || !Array.isArray(data)) {
    return [];
  }

  return data
    .map((row) => ({
      closesAt: sanitizeText((row as Record<string, unknown>).closesAt) || null,
      dayOfWeek: Number((row as Record<string, unknown>).dayOfWeek),
      isClosed: (row as Record<string, unknown>).isClosed === true,
      opensAt: sanitizeText((row as Record<string, unknown>).opensAt) || null,
    }))
    .filter((row) => Number.isInteger(row.dayOfWeek) && row.dayOfWeek >= 0 && row.dayOfWeek <= 6);
};

// --- customerGetRestaurantDetail: single row queried by id, not a full-catalog .find() ---
const handleGetRestaurantDetail = async (restaurantId: string) => {
  const row = await loadRestaurantRowById(DETAIL_COLUMNS, restaurantId);
  if (!row) {
    return { restaurant: null };
  }

  const [pricingConfig, hours] = await Promise.all([
    loadPricingConfig(),
    loadRestaurantHoursFor(restaurantId),
  ]);
  return { restaurant: toRestaurantDetail(row, pricingConfig, hours) };
};

Deno.serve(async (request) => {
  const observation = createEdgeObservation(request, 'public-catalog');

  if (request.method === 'OPTIONS') {
    // A 204 response must not carry a body — Deno throws a TypeError otherwise,
    // and this branch runs outside the try/catch below, so the throw escapes as a
    // bodiless 500 with no CORS headers and every browser preflight fails.
    const response = new Response(null, {
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
      data?: Record<string, unknown>;
    };

    logEdgeEvent('debug', 'public-catalog action received', {
      action: action ?? null,
      requestId: observation.requestId,
    });

    if (action === 'customerGetRestaurantList') {
      const result = await handleGetRestaurantList(data);
      const response = jsonResponse(200, { data: result }, { ...corsHeaders, ...LIST_CACHE_HEADERS });
      finishEdgeObservation(observation, { status: response.status });
      return response;
    }

    if (action === 'customerGetRestaurantDetail') {
      const restaurantId = sanitizeText(data?.restaurantId);
      if (!restaurantId) {
        const response = jsonResponse(400, { error: { message: 'A restaurant id is required.' } }, corsHeaders);
        finishEdgeObservation(observation, { status: response.status });
        return response;
      }

      const result = await handleGetRestaurantDetail(restaurantId);
      const response = jsonResponse(200, { data: result }, { ...corsHeaders, ...DETAIL_CACHE_HEADERS });
      finishEdgeObservation(observation, { status: response.status });
      return response;
    }

    // --- Deprecated aliases -------------------------------------------------
    // customerGetPublishedRestaurants / customerGetPublishedRestaurantDetail:
    // the pre-B2 shape (full restaurants incl. every menu, no pagination).
    // Kept ONLY so mobile builds installed before this release (which call
    // these action names verbatim, baked into their compiled bundle) keep
    // working. Remove both branches — and CARD/DETAIL column overlap allows
    // it — once the next mobile release ships and old clients have aged out.
    if (action === 'customerGetPublishedRestaurants') {
      const rows = await loadRestaurantRows(DETAIL_COLUMNS);
      const pricingConfig = await loadPricingConfig();
      const restaurants = rows.map((row) => toRestaurantDetail(row, pricingConfig));
      const response = jsonResponse(200, { data: { restaurants } }, { ...corsHeaders, ...LEGACY_LIST_CACHE_HEADERS });
      finishEdgeObservation(observation, { status: response.status });
      return response;
    }

    if (action === 'customerGetPublishedRestaurantDetail') {
      const restaurantId = sanitizeText(data?.restaurantId);
      if (!restaurantId) {
        const response = jsonResponse(400, { error: { message: 'A restaurant id is required.' } }, corsHeaders);
        finishEdgeObservation(observation, { status: response.status });
        return response;
      }

      // Fixed as part of B2: this used to load the whole catalog and .find()
      // the id. Same by-id query the new action uses — the deprecated alias
      // gets the perf fix for free, it just keeps the old response envelope.
      const result = await handleGetRestaurantDetail(restaurantId);
      const response = jsonResponse(200, { data: result }, { ...corsHeaders, ...LEGACY_DETAIL_CACHE_HEADERS });
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
    const status = getErrorStatus(error);
    const response = jsonResponse(
      status,
      {
        error: {
          message: clientErrorMessage(error, 'Unexpected public catalog failure.'),
        },
      },
      corsHeaders
    );
    finishEdgeObservation(observation, { status: response.status, error });
    return response;
  }
});
