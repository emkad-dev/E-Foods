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
