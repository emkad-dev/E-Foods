import { Platform } from 'react-native';

import { border } from '../tokens/color';

/**
 * Restores a visible keyboard focus indicator on the web builds.
 *
 * WHY: react-native-web renders every Touchable and TextInput with
 * `outline: none`, and nothing in this repo puts anything back. Measured on
 * partner's login screen (partner.feasty.com.ng ships this build): with the
 * password input genuinely focused, the input's computed style and its
 * wrapper's were byte-identical to the blurred state -- border, background,
 * outline and box-shadow all unchanged. The same held for the email field,
 * the show-password toggle and the submit button. Every control on the screen
 * is keyboard-reachable and none of them says so, which is WCAG 2.4.7
 * (Focus Visible) failing across the whole screen rather than on one control.
 *
 * WHY THIS SHAPE, rather than an `onFocus` state per component: only one of
 * the three copies of AuthPasswordField had grown a focus style, and that is
 * the argument against doing it by hand -- a per-component fix is a fix you
 * have to remember, forever, on every control anyone adds. This is one rule
 * that covers every focusable element in the app, including the ones not
 * written yet.
 *
 * WHY `:focus-visible` AND NOT `:focus`: the browser only matches
 * `:focus-visible` when focus arrived by keyboard (or another non-pointer
 * route). Tapping and clicking are unaffected, so this costs touch users
 * nothing and changes no screenshot -- it appears exactly when someone is
 * navigating without a pointer and needs to know where they are.
 *
 * No-ops off web, and deliberately idempotent: app roots remount.
 */
const STYLE_ELEMENT_ID = 'feasty-focus-ring';

export function installWebFocusRing(): void {
  if (Platform.OS !== 'web') {
    return;
  }

  // Guarded rather than assumed: this can run during a server render, or in a
  // test environment with no DOM.
  if (typeof document === 'undefined' || !document.head) {
    return;
  }

  if (document.getElementById(STYLE_ELEMENT_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = [
    // The offset keeps the ring clear of the control's own border so it reads
    // on a field that already has one.
    ':focus-visible {',
    `  outline: 2px solid ${border.focus};`,
    '  outline-offset: 2px;',
    '}',
    // RNW sets `outline: none` inline on some elements; an inline style beats
    // a stylesheet rule unless the rule is important. This is the one place in
    // the codebase where that is the right tool rather than a shortcut.
    '[data-focusvisible-polyfill], :focus-visible {',
    `  outline: 2px solid ${border.focus} !important;`,
    '  outline-offset: 2px !important;',
    '}',
  ].join('\n');

  document.head.appendChild(style);
}
