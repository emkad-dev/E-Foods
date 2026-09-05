export type FeatureFlagMap = Record<string, boolean>;

export type FeatureFlagRow = {
  description?: string | null;
  enabled?: boolean | null;
  key: string;
  updatedAt?: string | null;
};

const normalizeKey = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const normalizeRowMap = (rows: unknown): FeatureFlagMap => {
  if (!Array.isArray(rows)) {
    return {};
  }

  const flags: FeatureFlagMap = {};

  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      continue;
    }

    const record = row as Record<string, unknown>;
    const key = normalizeKey(record.key);
    if (!key) {
      continue;
    }

    flags[key] = record.enabled === true;
  }

  return flags;
};

const normalizeObjectMap = (value: unknown): FeatureFlagMap => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const flags: FeatureFlagMap = {};

  for (const [key, enabled] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey) {
      continue;
    }

    flags[normalizedKey] = enabled === true;
  }

  return flags;
};

export const normalizeFeatureFlagMap = (value: unknown): FeatureFlagMap =>
  Array.isArray(value) ? normalizeRowMap(value) : normalizeObjectMap(value);

export const isFeatureEnabled = (flags: FeatureFlagMap | null | undefined, key: string): boolean =>
  Boolean(flags && normalizeKey(key) && flags[normalizeKey(key)] === true);

export const listFeatureFlagKeys = (flags: FeatureFlagMap | null | undefined): string[] =>
  Object.keys(normalizeFeatureFlagMap(flags)).sort();
