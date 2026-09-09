/**
 * Run with: node --test --experimental-strip-types apps/partner/src/domain/partnerOnboardingSteps.test.ts
 *
 * These pin the wizard's gating to the server's own rules in
 * validatePartnerOnboardingSubmission. Each required field the server throws on
 * gets a case here proving the wizard refuses to submit without it — the point
 * being that a partner never fills five steps only to hit a generic failure at
 * the end, and never submits a payload approval will later choke on.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canSubmitPartnerOnboarding,
  firstIncompleteStep,
  isStepComplete,
  isValidCoordinatePair,
  isValidDeliveryRadius,
  shouldInvalidateBankVerification,
  type PartnerOnboardingFormState,
} from './partnerOnboardingSteps.js';

const completeForm = (overrides: Partial<PartnerOnboardingFormState> = {}): PartnerOnboardingFormState => ({
  accountNumber: '0123456789',
  address: '12 Admiralty Way, Lekki',
  bankCode: '058',
  bankName: 'Guaranty Trust Bank',
  bankVerifiedAccountName: 'ADA OBI KITCHEN',
  contactName: 'Ada Obi',
  cuisine: 'Nigerian',
  deliveryRadiusKm: '5',
  deliveryTime: '25-35 min',
  description: 'Home-style Nigerian cooking',
  documentBackPath: null,
  documentFrontPath: 'restaurant-kyc/uid/front.jpg',
  documentNumber: '12345678901',
  documentType: 'nin',
  email: 'ada@example.com',
  latitude: '',
  legalName: 'Ada Obi Foods Ltd',
  logoImage: null,
  longitude: '',
  phoneNumber: '08012345678',
  restaurantName: 'Ada Obi Kitchen',
  ...overrides,
});

test('a fully filled form can be submitted', () => {
  assert.equal(canSubmitPartnerOnboarding(completeForm()), true);
  assert.equal(firstIncompleteStep(completeForm()), 'review', 'nothing is missing, so review is next');
});

test('every field the server requires blocks submission when missing', () => {
  const required: [keyof PartnerOnboardingFormState, string | null][] = [
    ['restaurantName', ''],
    ['legalName', ''],
    ['contactName', ''],
    ['phoneNumber', ''],
    ['email', ''],
    ['cuisine', ''],
    ['address', ''],
    ['bankCode', ''],
    ['bankName', ''],
    ['accountNumber', ''],
    ['documentType', ''],
    ['documentNumber', ''],
    ['documentFrontPath', null],
  ];

  for (const [field, emptyValue] of required) {
    const form = completeForm({ [field]: emptyValue } as Partial<PartnerOnboardingFormState>);
    assert.equal(
      canSubmitPartnerOnboarding(form),
      false,
      `${String(field)} is required by the server, so the wizard must not submit without it`
    );
  }
});

test('an unverified bank account blocks the payout step even when the digits are filled', () => {
  const form = completeForm({ bankVerifiedAccountName: null });
  assert.equal(
    isStepComplete('payout', form),
    false,
    'typed digits are not evidence - only a successful /bank/resolve is'
  );
  assert.equal(canSubmitPartnerOnboarding(form), false);
  assert.equal(firstIncompleteStep(form), 'payout', 'and the wizard sends them back to payouts');
});

test('a back document is optional, matching the server', () => {
  assert.equal(canSubmitPartnerOnboarding(completeForm({ documentBackPath: null })), true);
});

test('delivery radius must be finite and greater than zero', () => {
  assert.equal(isValidDeliveryRadius('5'), true);
  assert.equal(isValidDeliveryRadius('0.5'), true);
  assert.equal(isValidDeliveryRadius('0'), false, 'zero is rejected by the server');
  assert.equal(isValidDeliveryRadius('-2'), false);
  assert.equal(isValidDeliveryRadius(''), false);
  assert.equal(isValidDeliveryRadius('abc'), false);
  assert.equal(
    canSubmitPartnerOnboarding(completeForm({ deliveryRadiusKm: '0' })),
    false,
    'and a zero radius blocks submission'
  );
});

test('coordinates are optional but must come as a pair', () => {
  assert.equal(isValidCoordinatePair('', ''), true, 'neither is fine');
  assert.equal(isValidCoordinatePair('6.45', '3.42'), true, 'both is fine');
  assert.equal(isValidCoordinatePair('6.45', ''), false, 'latitude alone is rejected by the server');
  assert.equal(isValidCoordinatePair('', '3.42'), false, 'longitude alone too');
  assert.equal(isValidCoordinatePair('abc', 'def'), false, 'and both must be numeric');

  assert.equal(canSubmitPartnerOnboarding(completeForm({ latitude: '6.45' })), false, 'a half pair blocks submission');
  assert.equal(canSubmitPartnerOnboarding(completeForm({ latitude: '6.45', longitude: '3.42' })), true);
});

test('an email without @ is rejected, as the server rejects it', () => {
  assert.equal(canSubmitPartnerOnboarding(completeForm({ email: 'not-an-email' })), false);
});

test('firstIncompleteStep walks the steps in order', () => {
  assert.equal(firstIncompleteStep(completeForm({ restaurantName: '' })), 'restaurant');
  assert.equal(firstIncompleteStep(completeForm({ address: '' })), 'location');
  assert.equal(firstIncompleteStep(completeForm({ bankVerifiedAccountName: null })), 'payout');
  assert.equal(firstIncompleteStep(completeForm({ documentFrontPath: null })), 'verification');

  // An earlier gap wins over a later one, so a resumed draft lands on the
  // first thing actually missing.
  assert.equal(
    firstIncompleteStep(completeForm({ address: '', documentFrontPath: null })),
    'location',
    'the earliest incomplete step is where the partner is sent'
  );
});

test('changing the bank code or account number invalidates a previous verification', () => {
  assert.equal(
    shouldInvalidateBankVerification({
      nextAccountNumber: '0123456789',
      nextBankCode: '058',
      verifiedAccountNumber: '0123456789',
      verifiedBankCode: '058',
    }),
    false,
    'an unchanged pair keeps its resolved name'
  );

  assert.equal(
    shouldInvalidateBankVerification({
      nextAccountNumber: '0123456789',
      nextBankCode: '044',
      verifiedAccountNumber: '0123456789',
      verifiedBankCode: '058',
    }),
    true,
    'a different bank means the resolve proved nothing about this pair'
  );

  assert.equal(
    shouldInvalidateBankVerification({
      nextAccountNumber: '9999999999',
      nextBankCode: '058',
      verifiedAccountNumber: '0123456789',
      verifiedBankCode: '058',
    }),
    true,
    'and so does a different account number'
  );

  assert.equal(
    shouldInvalidateBankVerification({
      nextAccountNumber: '0123456789',
      nextBankCode: '058',
      verifiedAccountNumber: null,
      verifiedBankCode: null,
    }),
    true,
    'nothing verified yet is treated as needing verification'
  );
});
