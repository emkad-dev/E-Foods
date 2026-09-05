import { assertEquals } from 'jsr:@std/assert';
import { isMenuItemAvailable, isStorePaused } from './availability.ts';

const NOW = new Date('2026-08-21T12:00:00.000Z');
const PAST = '2026-08-21T11:00:00.000Z';
const FUTURE = '2026-08-21T13:00:00.000Z';

// --- isMenuItemAvailable ---

Deno.test('isMenuItemAvailable: available with no fields set', () => {
  assertEquals(isMenuItemAvailable({}, NOW), true);
});

Deno.test('isMenuItemAvailable: available when isAvailable is explicitly true', () => {
  assertEquals(isMenuItemAvailable({ isAvailable: true }, NOW), true);
});

Deno.test('isMenuItemAvailable: manual off (isAvailable=false, no unavailableUntil) stays unavailable', () => {
  assertEquals(isMenuItemAvailable({ isAvailable: false }, NOW), false);
});

Deno.test('isMenuItemAvailable: manual off is not undone by a PAST unavailableUntil', () => {
  // The manual, indefinite form ignores unavailableUntil entirely — it only
  // resumes when a partner explicitly flips isAvailable back to true.
  assertEquals(isMenuItemAvailable({ isAvailable: false, unavailableUntil: PAST }, NOW), false);
});

Deno.test('isMenuItemAvailable: timed off in the FUTURE is unavailable', () => {
  assertEquals(isMenuItemAvailable({ isAvailable: true, unavailableUntil: FUTURE }, NOW), false);
});

Deno.test('isMenuItemAvailable: timed off in the PAST has auto-resumed to available', () => {
  assertEquals(isMenuItemAvailable({ isAvailable: true, unavailableUntil: PAST }, NOW), true);
});

Deno.test('isMenuItemAvailable: unavailableUntil exactly equal to now has resumed (strict > comparison)', () => {
  assertEquals(isMenuItemAvailable({ unavailableUntil: NOW.toISOString() }, NOW), true);
});

Deno.test('isMenuItemAvailable: a malformed unavailableUntil string never suppresses availability', () => {
  assertEquals(isMenuItemAvailable({ unavailableUntil: 'not-a-date' }, NOW), true);
});

Deno.test('isMenuItemAvailable: a non-string unavailableUntil is ignored', () => {
  assertEquals(isMenuItemAvailable({ unavailableUntil: 12345 }, NOW), true);
});

Deno.test('isMenuItemAvailable: null/undefined item is unavailable', () => {
  assertEquals(isMenuItemAvailable(null, NOW), false);
  assertEquals(isMenuItemAvailable(undefined, NOW), false);
});

Deno.test('isMenuItemAvailable: a non-boolean isAvailable is treated as available (matches isAvailable !== false convention)', () => {
  assertEquals(isMenuItemAvailable({ isAvailable: 'nope' as unknown }, NOW), true);
});

// --- isStorePaused ---

Deno.test('isStorePaused: not paused with no pausedUntil', () => {
  assertEquals(isStorePaused({}, NOW), false);
});

Deno.test('isStorePaused: paused when pausedUntil is in the FUTURE', () => {
  assertEquals(isStorePaused({ pausedUntil: FUTURE }, NOW), true);
});

Deno.test('isStorePaused: pause has expired (auto-resumed) once pausedUntil is in the PAST', () => {
  assertEquals(isStorePaused({ pausedUntil: PAST }, NOW), false);
});

Deno.test('isStorePaused: pausedUntil exactly equal to now has resumed (strict > comparison)', () => {
  assertEquals(isStorePaused({ pausedUntil: NOW.toISOString() }, NOW), false);
});

Deno.test('isStorePaused: a malformed pausedUntil never pauses the store', () => {
  assertEquals(isStorePaused({ pausedUntil: 'garbage' }, NOW), false);
});

Deno.test('isStorePaused: null restaurant is not paused', () => {
  assertEquals(isStorePaused(null, NOW), false);
});
