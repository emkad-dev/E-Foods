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
 * SINCE VERIFIED BY RENDERING, on the signed-in partner console: the control
 * measures 56x28, with a 56x20 track and a 28x28 thumb, exactly as the
 * arithmetic said. Seeing it also turned up what arithmetic could not -- the
 * ON thumb was Material Teal. See `switchColorProps`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SWITCH_HEIGHT,
  SWITCH_OFF_THUMB,
  SWITCH_OFF_TRACK,
  switchColorProps,
  switchControlStyle,
} from './switchControl.ts';

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


/**
 * react-native-web's rule, quoted from exports/Switch/index.js:
 *
 *     const thumbCurrentColor = value
 *       ? (activeThumbColor ?? '#009688')
 *       : (thumbColor ?? '#FAFAFA');
 *
 * Reproduced here so these assertions resolve the colour the same way the
 * browser does, rather than asserting that some prop was merely passed.
 */
const webThumbColor = (props: ReturnType<typeof switchColorProps>, value: boolean) =>
  value ? (props.activeThumbColor ?? '#009688') : (props.thumbColor ?? '#FAFAFA');

const ACTIVE_TRACK = '#c8e6c9';
const ACTIVE_THUMB = '#2e7d32';

test('the ON thumb is the brand colour on web, not the library default', () => {
  const props = switchColorProps(true, ACTIVE_TRACK, ACTIVE_THUMB);

  // The regression: every call site passed `thumbColor` alone, which web reads
  // only in the off state, so each of these toggles -- the ones that decide
  // whether a restaurant can trade -- rendered in Material Teal.
  assert.equal(webThumbColor(props, true), ACTIVE_THUMB);
  assert.notEqual(webThumbColor(props, true), '#009688');
});

test('the OFF thumb is still the grey', () => {
  const props = switchColorProps(false, ACTIVE_TRACK, ACTIVE_THUMB);

  assert.equal(webThumbColor(props, false), SWITCH_OFF_THUMB);
  assert.equal(props.thumbColor, SWITCH_OFF_THUMB);
});

test('native keeps a value-dependent thumbColor, since it ignores activeThumbColor', () => {
  // Android's Switch reads `thumbColor` in both states and never sees
  // `activeThumbColor`, so dropping the ternary would have fixed web by
  // breaking native.
  assert.equal(switchColorProps(true, ACTIVE_TRACK, ACTIVE_THUMB).thumbColor, ACTIVE_THUMB);
  assert.equal(switchColorProps(false, ACTIVE_TRACK, ACTIVE_THUMB).thumbColor, SWITCH_OFF_THUMB);
});

test('the track carries both states at once and does not depend on the value', () => {
  for (const value of [true, false]) {
    assert.deepEqual(switchColorProps(value, ACTIVE_TRACK, ACTIVE_THUMB).trackColor, {
      false: SWITCH_OFF_TRACK,
      true: ACTIVE_TRACK,
    });
  }
});
