/**
 * Run with: node --test --experimental-strip-types packages/design-system/src/fontsReadiness.test.ts
 *
 * The rule these guard used to be `loaded || Boolean(error)`, under a comment
 * promising that a font failure must never brick the app. It kept that promise
 * for a load that REJECTS and broke it for one that HANGS -- and every app root
 * in this repo holds a full-screen skeleton until `fontsReady` flips, so a
 * stalled font request is a screen that never appears.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FONT_LOAD_TIMEOUT_MS, resolveFontsReady } from './fontsReadiness.ts';

test('the ordinary case: fonts loaded, render', () => {
  assert.equal(resolveFontsReady({ loaded: true, error: null, timedOut: false }), true);
});

test('a rejected load renders anyway, in the platform face', () => {
  assert.equal(
    resolveFontsReady({ loaded: false, error: new Error('network'), timedOut: false }),
    true
  );
});

test('A HANG RENDERS TOO, which is the whole point of this module', () => {
  // No error, nothing loaded, and the clock ran out -- the exact state observed
  // on the running app, where the root held its skeleton indefinitely.
  assert.equal(resolveFontsReady({ loaded: false, error: null, timedOut: true }), true);
});

test('before the timeout, a pending load still holds the splash', () => {
  // The hold is what stops a flash of fallback type on a normal load, so it
  // must survive: a timeout that fires immediately would be its own defect.
  assert.equal(resolveFontsReady({ loaded: false, error: null, timedOut: false }), false);
});

test('a load that arrives after the timeout is still ready, never flips back', () => {
  assert.equal(resolveFontsReady({ loaded: true, error: null, timedOut: true }), true);
});

test('undefined error is treated as no error, not as a failure', () => {
  // expo-font hands back `undefined`, not `null`, before anything goes wrong.
  assert.equal(resolveFontsReady({ loaded: false, error: undefined, timedOut: false }), false);
});

test('the timeout is long enough to be invisible and short enough to matter', () => {
  assert.ok(
    FONT_LOAD_TIMEOUT_MS >= 1500,
    'too short and a normal load flashes the fallback face'
  );
  assert.ok(
    FONT_LOAD_TIMEOUT_MS <= 5000,
    'too long and a stalled load is indistinguishable from a broken app'
  );
});
