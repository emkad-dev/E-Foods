import { parseNumber, sanitizeOptionalText, sanitizeText } from './rpc/coercion.ts';

export type ModifierOptionRow = {
  id: string;
  isAvailable?: boolean | null;
  label?: string | null;
  priceDelta?: number | null;
};

export type ModifierGroupRow = {
  id: string;
  label?: string | null;
  max?: number | null;
  min?: number | null;
  mode?: string | null;
  options?: unknown[] | null;
  required?: boolean | null;
};

export type SelectedModifierRow = {
  groupId: string;
  optionId: string;
};

export type NormalizedModifierSelection = {
  groupId: string;
  groupLabel: string | null;
  optionId: string;
  optionLabel: string | null;
  priceDelta: number;
};

export type ModifierSelectionResolution =
  | { ok: true; optionDelta: number; selectedOptions: NormalizedModifierSelection[] }
  | { ok: false; reason: string };

const parseModifierOptions = (raw: unknown): ModifierOptionRow[] => {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((option) => option && typeof option === 'object')
    .map((option) => {
      const record = option as Record<string, unknown>;
      return {
        id: sanitizeText(record.id),
        isAvailable: record.isAvailable as boolean | null | undefined,
        label: sanitizeOptionalText(record.label),
        priceDelta: Number.isFinite(Number(record.priceDelta)) ? Number(record.priceDelta) : 0,
      };
    })
    .filter((option) => Boolean(option.id));
};

export const normalizeModifierGroups = (raw: unknown): ModifierGroupRow[] => {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((group) => group && typeof group === 'object')
    .map((group) => {
      const record = group as Record<string, unknown>;
      return {
        id: sanitizeText(record.id),
        label: sanitizeOptionalText(record.label),
        // `null` here means "not configured", and resolveModifierSelections
        // below derives a sensible bound for it. It must therefore survive as
        // null: `Number(null)` is 0 and 0 is finite, so a bare
        // `Number.isFinite(Number(record.max))` would normalize an absent max
        // to 0, the derived fallback would never run, and every selection would
        // be rejected with "Select no more than 0 option(s) for ..." - a 412
        // that blocks checkout outright. parseNumber keeps real numbers (0
        // included, for a genuinely configured bound) and misses on
        // null/undefined/''/false/[].
        max: parseNumber<null>(record.max, null),
        min: parseNumber<null>(record.min, null),
        mode: sanitizeOptionalText(record.mode),
        options: parseModifierOptions(record.options),
        required: typeof record.required === 'boolean' ? record.required : null,
      };
    })
    .filter((group) => Boolean(group.id));
};

export const normalizeSelectedModifiers = (raw: unknown): SelectedModifierRow[] => {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((selection) => selection && typeof selection === 'object')
    .map((selection) => {
      const record = selection as Record<string, unknown>;
      return {
        groupId: sanitizeText(record.groupId),
        optionId: sanitizeText(record.optionId),
      };
    })
    .filter((selection) => Boolean(selection.groupId && selection.optionId));
};

export const resolveModifierSelections = ({
  groups,
  selectedOptions,
}: {
  groups: unknown;
  selectedOptions: unknown;
}): ModifierSelectionResolution => {
  const normalizedGroups = normalizeModifierGroups(groups);
  const normalizedSelections = normalizeSelectedModifiers(selectedOptions);

  if (normalizedSelections.length === 0) {
    return { ok: true, optionDelta: 0, selectedOptions: [] };
  }

  const groupLookup = new Map(
    normalizedGroups.map((group) => [group.id, { ...group, options: parseModifierOptions(group.options) }])
  );
  const selectionBuckets = new Map<string, SelectedModifierRow[]>();

  for (const selection of normalizedSelections) {
    const group = groupLookup.get(selection.groupId);
    if (!group) {
      return { ok: false, reason: 'One or more selected add-on groups is unavailable.' };
    }

    const options = parseModifierOptions(group.options);
    const option = options.find((candidate) => candidate.id === selection.optionId);
    if (!option) {
      return { ok: false, reason: 'One or more selected add-ons is unavailable.' };
    }

    if (option.isAvailable === false) {
      return { ok: false, reason: 'One or more selected add-ons is unavailable.' };
    }

    const bucket = selectionBuckets.get(selection.groupId) ?? [];
    if (bucket.some((item) => item.optionId === selection.optionId)) {
      return { ok: false, reason: 'An add-on was selected more than once.' };
    }
    bucket.push(selection);
    selectionBuckets.set(selection.groupId, bucket);
  }

  const selectedOptionRecords: NormalizedModifierSelection[] = [];
  let optionDelta = 0;

  for (const [groupId, bucket] of selectionBuckets.entries()) {
    const group = groupLookup.get(groupId);
    if (!group) {
      return { ok: false, reason: 'One or more selected add-on groups is unavailable.' };
    }

    const mode = sanitizeText(group.mode, 'multi');
    const options = parseModifierOptions(group.options);
    // `group` is already normalized, so min/max are `number | null` - test the
    // type, not `Number(...)`, or a null bound coerces to 0 and shadows the
    // derived fallbacks on the branches below (see normalizeModifierGroups).
    const min = typeof group.min === 'number' && Number.isFinite(group.min)
      ? group.min
      : group.required === true || mode === 'single'
        ? 1
        : 0;
    const max = typeof group.max === 'number' && Number.isFinite(group.max)
      ? group.max
      : mode === 'single'
        ? 1
        : Math.max(min, options.length);

    if (bucket.length < min) {
      return { ok: false, reason: `Select at least ${min} option(s) for ${sanitizeText(group.label, 'this add-on group')}.` };
    }

    if (bucket.length > max) {
      return { ok: false, reason: `Select no more than ${max} option(s) for ${sanitizeText(group.label, 'this add-on group')}.` };
    }

    for (const selection of bucket) {
      const option = options.find((candidate) => candidate.id === selection.optionId);
      if (!option) {
        return { ok: false, reason: 'One or more selected add-ons is unavailable.' };
      }

      const priceDelta = Number.isFinite(Number(option.priceDelta)) ? Number(option.priceDelta) : 0;
      optionDelta += priceDelta;
      selectedOptionRecords.push({
        groupId: group.id,
        groupLabel: sanitizeOptionalText(group.label),
        optionId: option.id,
        optionLabel: sanitizeOptionalText(option.label),
        priceDelta,
      });
    }
  }

  return { ok: true, optionDelta, selectedOptions: selectedOptionRecords };
};
