import { assertEquals } from 'jsr:@std/assert';
import { buildPartnerVerificationDocPath, normalizePartnerOnboardingState } from './partnerOnboarding.ts';

Deno.test('builds a stable verification document path', () => {
  assertEquals(
    buildPartnerVerificationDocPath({
      uid: 'u1',
      restaurantId: 'r1',
      kind: 'nin-front',
      extension: 'png',
    }),
    'partner-verification-documents/u1/r1/nin-front.png'
  );
});

Deno.test('normalizes pending approval state', () => {
  assertEquals(
    normalizePartnerOnboardingState({ partnerApplicationStatus: 'pending_verification', role: 'customer' }).kind,
    'pending-verification'
  );
});
