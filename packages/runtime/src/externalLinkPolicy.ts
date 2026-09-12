/**
 * Pure decisions behind opening an external link. No React, no react-native and
 * no DOM, so it runs under `node --test` — the platform call itself lives in
 * `externalLink.ts` beside this (same split as `noticePolicy.ts` next to
 * `Notice.tsx`).
 *
 * WHY THIS EXISTS: `Linking.openURL` cannot report failure on the web build.
 * react-native-web's implementation is
 *
 *   var open = (url, target) => {
 *     if (canUseDOM) {
 *       var urlToOpen = new URL(url, window.location).toString();
 *       if (urlToOpen.indexOf('tel:') === 0) { window.location = urlToOpen; }
 *       else { window.open(urlToOpen, target, 'noopener'); }
 *     }
 *   };
 *
 * and `openURL` resolves as long as that does not throw. But a popup blocker
 * does not throw — `window.open` simply returns `null`. So a blocked maps
 * window resolved successfully, the `catch` never ran, and the customer got
 * nothing at all. The return value is the only signal there is, which is why
 * the caller has to make the `window.open` call itself rather than delegate.
 */

export type ExternalLinkFailure = 'blocked' | 'unsupported' | 'failed';

export type ExternalLinkResult = { ok: true } | { ok: false; reason: ExternalLinkFailure };

export const OPEN_EXTERNAL_LINK_OK: ExternalLinkResult = { ok: true };

/** `tel:` and `mailto:` hand off to another app instead of opening a window. */
export const isHandoffLink = (url: string): boolean => {
  const trimmed = url.trim().toLowerCase();

  return trimmed.startsWith('tel:') || trimmed.startsWith('mailto:');
};

/**
 * Turns a `window.open` return value into a result.
 *
 * `null` means the browser refused — a popup blocker, or a gesture the browser
 * did not consider user-initiated. Anything else is a real window.
 */
export const resolveWindowOpenResult = (opened: unknown): ExternalLinkResult =>
  opened ? OPEN_EXTERNAL_LINK_OK : { ok: false, reason: 'blocked' };

/**
 * What to tell the person, given what failed and what they were trying to do.
 *
 * `subject` names the destination in the user's terms ("the map", "the phone
 * app"), so one helper serves every call site without the messages drifting.
 * Every string says what to do next: a dead end is what this whole module
 * exists to stop.
 */
export const describeExternalLinkFailure = (reason: ExternalLinkFailure, subject: string): string => {
  if (reason === 'blocked') {
    return `Your browser blocked ${subject} from opening. Allow pop-ups for this site, then try again.`;
  }

  if (reason === 'unsupported') {
    return `This device cannot open ${subject}.`;
  }

  return `Could not open ${subject} right now. Please try again.`;
};
