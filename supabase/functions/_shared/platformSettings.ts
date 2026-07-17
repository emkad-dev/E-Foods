/// <reference path="./edge-runtime.d.ts" />

import { serviceClient } from './client.ts';
import { logEdgeEvent } from './observability.ts';
import { DEFAULT_PRICING_CONFIG, parsePricingConfig, type PricingConfig } from './pricing.ts';

const CACHE_TTL_MS = 60_000;

let cached: { config: PricingConfig; expiresAt: number } | null = null;

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
