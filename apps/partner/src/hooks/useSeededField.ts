import { useEffect, useState } from 'react';

/**
 * One draft field, re-seeded ONLY when its own saved value changes.
 *
 * The defect this exists to prevent: the store form hydrated all fourteen
 * fields from a single effect keyed on the whole `restaurant` object, and
 * `usePartnerRestaurant` replaces that object on every realtime broadcast and
 * every fallback poll. So a broadcast caused by somebody else's action - a menu
 * edit, an admin change, this partner's own pause from another device - re-ran
 * all fourteen setters and discarded whatever was half-typed in the form.
 *
 * Keyed per field, a re-seed can only happen when the SERVER's value for that
 * one field actually changed, which is the same shape the customer edit screen
 * settled on (apps/customer/app/(customer)/profile/edit.tsx).
 *
 * KNOWN GAP, inherited from that precedent and not worth dirty-tracking for: a
 * genuine change to that one field made elsewhere mid-typing still wins. What is
 * fixed is the far more common case - an unrelated refresh wiping the draft.
 */
export const useSeededField = <T>(savedValue: T) => {
  const [value, setValue] = useState<T>(savedValue);

  useEffect(() => {
    setValue(savedValue);
  }, [savedValue]);

  return [value, setValue] as const;
};
