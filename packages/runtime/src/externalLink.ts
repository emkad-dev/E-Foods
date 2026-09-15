import { Linking, Platform } from 'react-native';

import {
  OPEN_EXTERNAL_LINK_OK,
  isHandoffLink,
  resolveWindowOpenResult,
  type ExternalLinkResult,
} from './externalLinkPolicy';

export {
  describeExternalLinkFailure,
  isHandoffLink,
  type ExternalLinkFailure,
  type ExternalLinkResult,
} from './externalLinkPolicy';

/**
 * Opens an external URL and actually reports whether it worked.
 *
 * Use this instead of `Linking.openURL` anywhere the result matters. On the web
 * build `Linking.openURL` resolves even when the browser refuses, because
 * react-native-web calls `window.open` and never looks at its return value —
 * see externalLinkPolicy.ts. Calling `window.open` here is the only way to see
 * the `null` that means "blocked".
 *
 * Never throws: the caller gets a result to render, because the failure this
 * replaces was silence.
 *
 * MUST be called synchronously from the user's gesture. Browsers only honour
 * `window.open` while a real click is being handled, so an `await` before this
 * spends the gesture and the popup is blocked for that reason alone.
 */
export const openExternalLink = async (url: string): Promise<ExternalLinkResult> => {
  if (Platform.OS !== 'web') {
    try {
      await Linking.openURL(url);
      return OPEN_EXTERNAL_LINK_OK;
    } catch {
      return { ok: false, reason: 'failed' };
    }
  }

  if (typeof window === 'undefined') {
    return { ok: false, reason: 'unsupported' };
  }

  try {
    // tel: and mailto: hand off to another app rather than opening a window, so
    // there is no handle to check. A same-tab assignment is also what lets them
    // work at all on mobile browsers; window.open would be blocked far more
    // often. Reported as ok because "the browser did not refuse" is genuinely
    // all that is knowable here — the caller pairs these with the number or
    // address on screen so there is still a way through if nothing happens.
    if (isHandoffLink(url)) {
      window.location.href = url;
      return OPEN_EXTERNAL_LINK_OK;
    }

    return resolveWindowOpenResult(window.open(url, '_blank', 'noopener'));
  } catch {
    // `new URL(...)` inside react-native-web throws on a malformed string, and
    // assigning window.location can throw on a scheme the browser refuses.
    return { ok: false, reason: 'failed' };
  }
};

/**
 * Navigates THIS window to a URL instead of opening a second one.
 *
 * WHY THIS EXISTS BESIDE `openExternalLink`: that one sends every non-handoff
 * URL to `window.open(url, '_blank')`, and there are flows where a second tab is
 * the defect rather than the feature. The customer payment handoff is the case
 * that forced it. Paystack returns to a callback URL built from
 * `window.location.origin` — a top-level return — and each tab runs its own copy
 * of the app, so the tab that receives the callback is the tab whose CartContext
 * clears. Open checkout in a new tab and the ORIGIN tab keeps the paid basket in
 * memory, re-serialises it to storage on its next change (CartContext saves on
 * every change), and goes on offering a live Pay button for an order already
 * paid for. A payment bug must not be fixed by introducing a duplicate-order
 * bug, so that flow navigates in place.
 *
 * On native there is no second window to avoid and `Linking.openURL` is what
 * "go to this URL" means, so this behaves exactly like `openExternalLink`
 * there. It deliberately does NOT refuse off web: a function that errors or
 * quietly does nothing on native is how a third copy of this gets written.
 *
 * Never throws. Success means only that the browser did not refuse — a
 * committed navigation reports nothing back — so callers pair this with the
 * destination visible on screen, the same bargain the `tel:`/`mailto:` branch
 * above makes. `blocked` is not among the reasons it can return: that reason is
 * `window.open` handing back `null`, and a top-level navigation is not a popup,
 * so no popup blocker can refuse it. Callers must not render pop-up copy here.
 */
export const openInSameWindow = async (url: string): Promise<ExternalLinkResult> => {
  if (Platform.OS !== 'web') {
    try {
      await Linking.openURL(url);
      return OPEN_EXTERNAL_LINK_OK;
    } catch {
      return { ok: false, reason: 'failed' };
    }
  }

  if (typeof window === 'undefined') {
    return { ok: false, reason: 'unsupported' };
  }

  try {
    window.location.href = url;
    return OPEN_EXTERNAL_LINK_OK;
  } catch {
    // Assigning window.location throws on a malformed URL, and on a scheme the
    // browser refuses.
    return { ok: false, reason: 'failed' };
  }
};
