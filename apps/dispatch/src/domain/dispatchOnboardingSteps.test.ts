/**
 * Run with: node --test --experimental-strip-types apps/dispatch/src/domain/dispatchOnboardingSteps.test.ts
 *
 * The screen used to enforce these rules as one all-or-nothing check before
 * submit. Stepping the flow must not have loosened any of them, so each field
 * the old check refused to submit without gets a case here.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canSubmitDispatchOnboarding,
  firstIncompleteStep,
  isStepComplete,
  type DispatchOnboardingFormState,
} from './dispatchOnboardingSteps.js';

const completeForm = (overrides: Partial<DispatchOnboardingFormState> = {}): DispatchOnboardingFormState => ({
  currentAddress: '12 Admiralty Way, Lekki',
  hasLicenceBack: true,
  hasLicenceFront: true,
  lga: 'Eti-Osa',
  licenseNumber: 'LAG12345678',
  region: 'Lagos',
  vehicleMake: 'Honda',
  vehicleModel: 'CB125',
  vehiclePlateNumber: 'LAG-123-XY',
  vehicleType: 'Bike',
  ...overrides,
});

test('a fully filled form can be submitted', () => {
  assert.equal(canSubmitDispatchOnboarding(completeForm()), true);
  assert.equal(firstIncompleteStep(completeForm()), 'review');
});

test('every field the old single check required still blocks submission', () => {
  const requiredText: (keyof DispatchOnboardingFormState)[] = [
    'region',
    'lga',
    'currentAddress',
    'vehicleType',
    'vehicleMake',
    'vehicleModel',
    'vehiclePlateNumber',
    'licenseNumber',
  ];

  for (const field of requiredText) {
    const form = completeForm({ [field]: '' } as Partial<DispatchOnboardingFormState>);
    assert.equal(
      canSubmitDispatchOnboarding(form),
      false,
      `${String(field)} was required before the flow was stepped and must still be`
    );
  }
});

test('both licence sides are required', () => {
  assert.equal(
    canSubmitDispatchOnboarding(completeForm({ hasLicenceFront: false })),
    false,
    'the front is required'
  );
  assert.equal(
    canSubmitDispatchOnboarding(completeForm({ hasLicenceBack: false })),
    false,
    'and so is the back - a licence is only verifiable with both faces'
  );
  assert.equal(isStepComplete('licence', completeForm({ hasLicenceBack: false })), false);
});

test('whitespace does not satisfy a required field', () => {
  assert.equal(canSubmitDispatchOnboarding(completeForm({ vehiclePlateNumber: '   ' })), false);
});

test('firstIncompleteStep walks the steps in order', () => {
  assert.equal(firstIncompleteStep(completeForm({ lga: '' })), 'area');
  assert.equal(firstIncompleteStep(completeForm({ vehicleMake: '' })), 'vehicle');
  assert.equal(firstIncompleteStep(completeForm({ hasLicenceFront: false })), 'licence');

  assert.equal(
    firstIncompleteStep(completeForm({ hasLicenceFront: false, lga: '' })),
    'area',
    'the earliest gap wins, so a courier is sent to the first thing actually missing'
  );
});

test('review is never "complete" - it is the submit gate', () => {
  assert.equal(isStepComplete('review', completeForm()), false);
});
