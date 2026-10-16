import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { isRiderEligibleForOffer, DISPATCH_MAX_LOCATION_AGE_SECONDS } from './riderEligibility.ts';

const now = 1_000_000_000_000;
Deno.test('approved + fresh location is eligible', () => {
  assertEquals(isRiderEligibleForOffer({ verificationStatus: 'approved', lastLocationAtMs: now - 10_000, nowMs: now, maxAgeSeconds: 120 }), true);
});
Deno.test('unapproved is ineligible even if fresh', () => {
  assertEquals(isRiderEligibleForOffer({ verificationStatus: 'pending', lastLocationAtMs: now, nowMs: now, maxAgeSeconds: 120 }), false);
});
Deno.test('stale location is ineligible', () => {
  assertEquals(isRiderEligibleForOffer({ verificationStatus: 'approved', lastLocationAtMs: now - 200_000, nowMs: now, maxAgeSeconds: 120 }), false);
});
Deno.test('missing location is ineligible', () => {
  assertEquals(isRiderEligibleForOffer({ verificationStatus: 'approved', lastLocationAtMs: null, nowMs: now, maxAgeSeconds: 120 }), false);
});
Deno.test('default max age is 120s', () => { assertEquals(DISPATCH_MAX_LOCATION_AGE_SECONDS, 120); });
