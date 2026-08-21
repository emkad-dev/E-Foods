/// <reference path="./edge-runtime.d.ts" />

import {
  DEFAULT_ACCEPTANCE_DEADLINE,
  parseAcceptanceDeadline,
  type AcceptanceDeadlineConfig,
} from './acceptanceDeadline.ts';
import { serviceClient } from './client.ts';
import { DEFAULT_DISPATCH_TRACKING, parseDispatchTracking, type DispatchTrackingConfig } from './dispatchTracking.ts';
import { DEFAULT_DISPATCH_WEIGHTS, parseDispatchWeights, type DispatchWeights } from './dispatchWeights.ts';
import { logEdgeEvent } from './observability.ts';
import { DEFAULT_PRICING_CONFIG, parsePricingConfig, type PricingConfig } from './pricing.ts';

const CACHE_TTL_MS = 60_000;

let cached: { config: PricingConfig; expiresAt: number } | null = null;
let cachedDispatchWeights: { config: DispatchWeights; expiresAt: number } | null = null;
let cachedDispatchTracking: { config: DispatchTrackingConfig; expiresAt: number } | null = null;
let cachedAcceptanceDeadline: { config: AcceptanceDeadlineConfig; expiresAt: number } | null = null;

// Never throws: an order must not fail because the settings row is unreadable.
// The seeded row and DEFAULT_PRICING_CONFIG hold identical values, so the
// fallback cannot silently change prices unless the row was edited.
export const loadPricingConfig = async (): Promise<PricingConfig> => {
  if (cached && cached.expiresAt > Date.now()) {
    return cached.config;
  }

  try {
    const { data, error } = await serviceClient
      .from('PlatformSettings')
      .select('data')
      .eq('id', 'pricing')
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      logEdgeEvent('warn', 'PlatformSettings pricing row missing; using defaults', {});
    }

    const config = parsePricingConfig(data?.data);
    cached = { config, expiresAt: Date.now() + CACHE_TTL_MS };
    return config;
  } catch (error) {
    logEdgeEvent('warn', 'Failed to load pricing config; using defaults', {
      error: error instanceof Error ? error.message : String(error),
    });
    return DEFAULT_PRICING_CONFIG;
  }
};

// Never throws: a status transition must not fail because the settings row is
// unreadable. The seeded row and DEFAULT_DISPATCH_WEIGHTS hold identical
// values, so the fallback cannot silently change dispatch behaviour unless
// the row was edited.
export const loadDispatchWeights = async (): Promise<DispatchWeights> => {
  if (cachedDispatchWeights && cachedDispatchWeights.expiresAt > Date.now()) {
    return cachedDispatchWeights.config;
  }

  try {
    const { data, error } = await serviceClient
      .from('PlatformSettings')
      .select('data')
      .eq('id', 'dispatchWeights')
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      logEdgeEvent('warn', 'PlatformSettings dispatchWeights row missing; using defaults', {});
    }

    const config = parseDispatchWeights(data?.data);
    cachedDispatchWeights = { config, expiresAt: Date.now() + CACHE_TTL_MS };
    return config;
  } catch (error) {
    logEdgeEvent('warn', 'Failed to load dispatch weights; using defaults', {
      error: error instanceof Error ? error.message : String(error),
    });
    return DEFAULT_DISPATCH_WEIGHTS;
  }
};

// Never throws: rider tracking must not fail because the settings row is
// unreadable, and a mistyped admin speed must not break ETAs. The seeded row
// and DEFAULT_DISPATCH_TRACKING hold identical values, so the fallback cannot
// silently change ETAs unless the row was edited. Mirrors loadDispatchWeights.
export const loadDispatchTrackingConfig = async (): Promise<DispatchTrackingConfig> => {
  if (cachedDispatchTracking && cachedDispatchTracking.expiresAt > Date.now()) {
    return cachedDispatchTracking.config;
  }

  try {
    const { data, error } = await serviceClient
      .from('PlatformSettings')
      .select('data')
      .eq('id', 'dispatchTracking')
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      logEdgeEvent('warn', 'PlatformSettings dispatchTracking row missing; using defaults', {});
    }

    const config = parseDispatchTracking(data?.data);
    cachedDispatchTracking = { config, expiresAt: Date.now() + CACHE_TTL_MS };
    return config;
  } catch (error) {
    logEdgeEvent('warn', 'Failed to load dispatch tracking config; using defaults', {
      error: error instanceof Error ? error.message : String(error),
    });
    return DEFAULT_DISPATCH_TRACKING;
  }
};

// Never throws: the acceptance-deadline sweep must not fail because the
// settings row is unreadable, and a mistyped/zero/negative deadline must not
// make every fresh order instantly overdue (parseAcceptanceDeadline bounds it).
// The seeded row and DEFAULT_ACCEPTANCE_DEADLINE hold identical values, so the
// fallback cannot silently change the deadline unless the row was edited.
// Mirrors loadDispatchTrackingConfig exactly.
export const loadAcceptanceDeadlineConfig = async (): Promise<AcceptanceDeadlineConfig> => {
  if (cachedAcceptanceDeadline && cachedAcceptanceDeadline.expiresAt > Date.now()) {
    return cachedAcceptanceDeadline.config;
  }

  try {
    const { data, error } = await serviceClient
      .from('PlatformSettings')
      .select('data')
      .eq('id', 'acceptanceDeadline')
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      logEdgeEvent('warn', 'PlatformSettings acceptanceDeadline row missing; using defaults', {});
    }

    const config = parseAcceptanceDeadline(data?.data);
    cachedAcceptanceDeadline = { config, expiresAt: Date.now() + CACHE_TTL_MS };
    return config;
  } catch (error) {
    logEdgeEvent('warn', 'Failed to load acceptance deadline config; using defaults', {
      error: error instanceof Error ? error.message : String(error),
    });
    return DEFAULT_ACCEPTANCE_DEADLINE;
  }
};
