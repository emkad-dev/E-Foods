/**
 * Run with: node --test --experimental-strip-types packages/auth/src/otpCooldownPolicy.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  OTP_COOLDOWN_SECONDS,
  formatCooldown,
  otpCooldownStorageKey,
  remainingCooldownSeconds,
} from './otpCooldownPolicy.ts';

const NOW = 1_800_000_000_000; // fixed epoch ms so these never depend on the clock

test('the cooldown is five minutes, matching the server-side minimum interval', () => {
  assert.equal(OTP_COOLDOWN_SECONDS, 300);
});

test('never sent means no wait', () => {
  assert.equal(remainingCooldownSeconds(null, NOW), 0);
  assert.equal(remainingCooldownSeconds(undefined, NOW), 0);
});

test('a code sent just now costs the full window', () => {
  assert.equal(remainingCooldownSeconds(NOW, NOW), 300);
});

test('the remaining time counts down', () => {
  assert.equal(remainingCooldownSeconds(NOW - 60_000, NOW), 240);
  assert.equal(remainingCooldownSeconds(NOW - 299_000, NOW), 1);
});

test('the boundary releases exactly at the window, not a tick late', () => {
  assert.equal(remainingCooldownSeconds(NOW - 300_000, NOW), 0);
  assert.equal(remainingCooldownSeconds(NOW - 300_001, NOW), 0);
});

test('long past the window is still zero, never negative', () => {
  assert.equal(remainingCooldownSeconds(NOW - 86_400_000, NOW), 0);
});

test('a timestamp in the future is clamped to the full window, not a multi-hour lockout', () => {
  // Device clock moved backwards -- manual change, NTP correction, or someone
  // fiddling with the timezone to skip the timer. Naive subtraction would give a
  // huge positive remaining and strand the user.
  assert.equal(
    remainingCooldownSeconds(NOW + 86_400_000, NOW),
    300,
    'still throttled, but bounded by the policy'
  );
});

test('a non-numeric or unusable stored value is treated as never sent', () => {
  assert.equal(remainingCooldownSeconds(Number.NaN, NOW), 0);
  assert.equal(remainingCooldownSeconds(Number.POSITIVE_INFINITY, NOW), 0);
});

test('a zero or negative policy disables the cooldown rather than locking forever', () => {
  assert.equal(remainingCooldownSeconds(NOW, NOW, 0), 0);
  assert.equal(remainingCooldownSeconds(NOW, NOW, -1), 0);
});

test('under a minute reads as seconds', () => {
  assert.equal(formatCooldown(45), '45s');
  assert.equal(formatCooldown(1), '1s');
});

test('a minute and over reads as m:ss with a padded seconds field', () => {
  assert.equal(formatCooldown(60), '1:00');
  assert.equal(formatCooldown(65), '1:05');
  assert.equal(formatCooldown(300), '5:00');
});

test('the label never shows a negative', () => {
  assert.equal(formatCooldown(0), '0s');
  assert.equal(formatCooldown(-5), '0s');
});

test('the key is per purpose, so a signup cooldown does not gate a password reset', () => {
  assert.notEqual(
    otpCooldownStorageKey('signup', 'rider@feasty.com.ng'),
    otpCooldownStorageKey('recovery', 'rider@feasty.com.ng')
  );
});

test('the key is per email, so signing in as someone else does not inherit a cooldown', () => {
  assert.notEqual(
    otpCooldownStorageKey('signup', 'a@feasty.com.ng'),
    otpCooldownStorageKey('signup', 'b@feasty.com.ng')
  );
});

test('the same address typed differently is the same key', () => {
  assert.equal(
    otpCooldownStorageKey('recovery', '  Rider@Feasty.COM.ng '),
    otpCooldownStorageKey('recovery', 'rider@feasty.com.ng'),
    'otherwise changing capitalisation would reset the timer'
  );
});
