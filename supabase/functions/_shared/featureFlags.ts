export { isFeatureEnabled, normalizeFeatureFlagMap } from '../../../packages/domain/src/featureFlags.ts';
import {
  normalizeFeatureFlagMap,
  type FeatureFlagMap,
  type FeatureFlagRow as DomainFeatureFlagRow,
} from '../../../packages/domain/src/featureFlags.ts';
import { serviceClient } from './client.ts';
import { nowIso, sanitizeOptionalText, sanitizeText } from './rpc/coercion.ts';

export type FeatureFlagRow = {
  description?: string | null;
  enabled?: boolean | null;
  key: string;
  updatedAt?: string | null;
};

export const FEATURE_FLAG_COLUMNS = 'key,enabled,description,updatedAt';
export type FeatureFlagRecord = {
  description: string | null;
  enabled: boolean;
  key: string;
  updatedAt: string;
};

const normalizeFeatureFlagRecord = (row: unknown): FeatureFlagRecord | null => {
  if (!row || typeof row !== 'object') {
    return null;
  }

  const record = row as Record<string, unknown>;
  const key = sanitizeText(record.key);
  if (!key) {
    return null;
  }

  return {
    description: sanitizeOptionalText(record.description),
    enabled: record.enabled === true,
    key,
    updatedAt: sanitizeText(record.updatedAt, nowIso()),
  };
};

export const loadFeatureFlagMap = async (): Promise<FeatureFlagMap> => {
  const { data, error } = await serviceClient
    .from('FeatureFlag')
    .select(FEATURE_FLAG_COLUMNS)
    .returns<DomainFeatureFlagRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  return normalizeFeatureFlagMap(data ?? []);
};

export const listFeatureFlags = async (): Promise<FeatureFlagRecord[]> => {
  const { data, error } = await serviceClient
    .from('FeatureFlag')
    .select(FEATURE_FLAG_COLUMNS)
    .order('key', { ascending: true })
    .returns<DomainFeatureFlagRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as unknown[]).map(normalizeFeatureFlagRecord).filter((row): row is FeatureFlagRecord => row !== null);
};

export const upsertFeatureFlag = async (input: {
  description?: string | null;
  enabled: boolean;
  key: string;
}): Promise<FeatureFlagRecord> => {
  const key = sanitizeText(input.key);
  if (!key) {
    throw new Error('A feature flag key is required.');
  }

  const row = {
    description: sanitizeOptionalText(input.description),
    enabled: input.enabled === true,
    key,
    updatedAt: nowIso(),
  };

  const { data, error } = await serviceClient
    .from('FeatureFlag')
    .upsert(row, { onConflict: 'key' })
    .select(FEATURE_FLAG_COLUMNS)
    .maybeSingle<DomainFeatureFlagRow>();

  if (error) {
    throw new Error(error.message);
  }

  const normalized = normalizeFeatureFlagRecord(data);
  if (!normalized) {
    throw new Error('Failed to persist feature flag.');
  }

  return normalized;
};
