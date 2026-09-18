/**
 * Run with: node --test --experimental-strip-types apps/partner/src/theme/switchControl.test.ts
 *
 * Pins the one number behind every `<Switch>` in the partner console.
 *
 * It needs pinning because the value that was there before was not chosen at
 * all: none of the five call sites passed a style, so they inherited
 * react-native-web's fallback. From its Switch implementation:
 *
 *     const height = styleHeight || '20px';
 *     const minWidth = multiplyStyleLengthValue(height, 2);
 *     const thumbHeight = height;
 *
 * A 20x40 control -- on "Available for ordering", "Customers can collect",
 * "Published" and "Open", which are the four toggles that decide whether a
 * restaurant can trade.
 *
 * NOT VERIFIED BY RENDERING. The partner console sits behind a login, and its
 * session reconcile clears a seeded profile, so the only evidence here is the
 * library source above plus this arithmetic. That is enough to know the
 * control grows and stays in proportion; it is not enough to know it LOOKS
 * right, and that still wants an eye on it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SWITCH_HEIGHT, switchControlStyle } from './switchControl.ts';

/** WCAG 2.5.8 Target Size (Minimum), the AA floor. */
const MINIMUM_TARGET = 24;

/** What react-native-web derives from the height it is given. */
const derivedWidth = (height: number) => height * 2;

test('the switch clears the minimum target size on both axes', () => {
  assert.ok(
    SWITCH_HEIGHT >= MINIMUM_TARGET,
    `a switch ${SWITCH_HEIGHT}pt tall fails WCAG 2.5.8's ${MINIMUM_TARGET}pt floor; ` +
      'the inherited default was 20'
  );
  assert.ok(derivedWidth(SWITCH_HEIGHT) >= MINIMUM_TARGET, 'width is twice the height, so this follows');
});

test('it stays a switch rather than becoming a slab', () => {
  // 44 is the tap floor for a BUTTON. A switch is sized by convention -- iOS
  // ships 31x51 -- and 44 here would render 44x88, which reads as a mistake.
  // The assertion is deliberately "below 44": this control is the exception,
  // and the exception should fail loudly if someone "fixes" it upward.
  assert.ok(
    SWITCH_HEIGHT < 44,
    'a 44pt switch is 88pt wide; that is not the platform convention for this control'
  );
  assert.ok(SWITCH_HEIGHT <= 32, 'iOS ships 31; anything much past that stops reading as a switch');
});

test('the exported style is what the call sites spread, and carries only the height', () => {
  // Only `height`: react-native-web computes width, thumb size and track
  // radius from it, so setting any of those by hand would fight the library.
  assert.deepEqual(switchControlStyle, { height: SWITCH_HEIGHT });
});
