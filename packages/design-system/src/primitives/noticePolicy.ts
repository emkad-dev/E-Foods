/**
 * The auto-dismiss policy for `useNotice`, kept in its own React-free module so
 * it can be unit tested under `node --test` (importing `Notice.tsx` would drag
 * in `react-native`, which does not load outside Metro). Same split as
 * `authPromptRoute.ts` beside `AuthPromptDialog.tsx`.
 */

export type NoticeTone = 'success' | 'error' | 'info';

/**
 * Defaults per tone. `null` means "stays until dismissed".
 *
 * A success notice is a receipt: the user already knows what they did, so it
 * may fade. An error is the ONLY report of something that did not happen — the
 * customer's phone number did not save, the payment did not refresh — so it
 * must never disappear on a timer. `info` sits between: long enough to read a
 * sentence, not permanent.
 */
export const NOTICE_DEFAULT_DURATION_MS: Readonly<Record<NoticeTone, number | null>> = {
  success: 4000,
  info: 6000,
  error: null,
};

/**
 * Floor applied to any auto-dismiss an error notice is given explicitly.
 * Callers should normally leave errors sticky; if one insists on a timer it
 * still cannot flash past faster than this. 6s is the low end of the WCAG
 * 2.2.1 reading allowance for a short sentence.
 */
export const NOTICE_MIN_ERROR_DURATION_MS = 6000;

/**
 * Resolves how long a notice should stay on screen.
 *
 * - `undefined` (the normal case) takes the tone's default.
 * - `null`, zero, a negative number, or a non-finite number all mean "sticky",
 *   so a caller computing a duration from data cannot accidentally produce a
 *   notice that vanishes on the same frame it appears.
 * - An explicit duration on an error tone is clamped up to
 *   `NOTICE_MIN_ERROR_DURATION_MS`.
 */
export function resolveNoticeDurationMs(
  tone: NoticeTone,
  requestedMs?: number | null
): number | null {
  const base = requestedMs === undefined ? NOTICE_DEFAULT_DURATION_MS[tone] : requestedMs;

  if (base === null || typeof base !== 'number' || !Number.isFinite(base) || base <= 0) {
    return null;
  }

  return tone === 'error' ? Math.max(base, NOTICE_MIN_ERROR_DURATION_MS) : base;
}

/**
 * ARIA role for the live region.
 *
 * `alert` is implicitly `aria-live="assertive"` and `aria-atomic="true"`, which
 * is what a failure needs — it interrupts. `status` is implicitly polite, which
 * is what a confirmation needs — it waits its turn rather than cutting across
 * whatever the screen reader is reading. Both register the node as a live
 * region, so the permanently-mounted host announces correctly whichever tone
 * lands in it.
 */
export function noticeRole(tone: NoticeTone | null): 'alert' | 'status' {
  return tone === 'error' ? 'alert' : 'status';
}

/** Android's `accessibilityLiveRegion`, which has no implicit-role equivalent. */
export function noticeLiveRegion(tone: NoticeTone | null): 'assertive' | 'polite' {
  return tone === 'error' ? 'assertive' : 'polite';
}
