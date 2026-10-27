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

// vehicleType defaults to 'Car' (not 'Bike'/'Scooter') so these fixtures land
// on a type where make, model and plate are all unconditionally required --
// the Bike/Scooter exemption gets its own dedicated test below instead of
// silently defanging the general-purpose cases here.
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
  vehicleType: 'Car',
  ...overrides,
});

test('a fully filled form can be submitted', () => {
  assert.equal(canSubmitDispatchOnboarding(completeForm()), true);
  assert.equal(firstIncompleteStep(completeForm()), 'review');
});

test('every field required for a car/van still blocks submission', () => {
  // The fixture's vehicleType ('Car') requires make, model and plate same as
  // before the bike/scooter exemption existed.
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
  assert.equal(firstIncompleteStep(completeForm({ vehicleModel: '' })), 'vehicle');
  assert.equal(firstIncompleteStep(completeForm({ hasLicenceFront: false })), 'licence');

  assert.equal(
    firstIncompleteStep(completeForm({ hasLicenceFront: false, lga: '' })),
    'area',
    'the earliest gap wins, so a courier is sent to the first thing actually missing'
  );
});

test('vehicle make, model and plate are all optional for a bike or scooter', () => {
  // Bikes and scooters are frequently unbadged and unplated in practice --
  // none of the three detail fields can be demanded of them.
  for (const vehicleType of ['Bike', 'Scooter'] as const) {
    assert.equal(
      canSubmitDispatchOnboarding(completeForm({ vehicleType, vehicleMake: '' })),
      true,
      `${vehicleType}: make should be optional`
    );
    assert.equal(
      canSubmitDispatchOnboarding(completeForm({ vehicleType, vehicleModel: '   ' })),
      true,
      `${vehicleType}: model should be optional`
    );
    assert.equal(
      canSubmitDispatchOnboarding(completeForm({ vehicleType, vehiclePlateNumber: '' })),
      true,
      `${vehicleType}: plate number should be optional`
    );
    assert.equal(
      canSubmitDispatchOnboarding(
        completeForm({ vehicleType, vehicleMake: '', vehicleModel: '', vehiclePlateNumber: '' })
      ),
      true,
      `${vehicleType}: all three left blank together should still submit`
    );
  }
});

test('vehicle make, model and plate stay required for a car or van', () => {
  for (const vehicleType of ['Car', 'Van'] as const) {
    assert.equal(canSubmitDispatchOnboarding(completeForm({ vehicleType, vehicleMake: '' })), false);
    assert.equal(canSubmitDispatchOnboarding(completeForm({ vehicleType, vehicleModel: '' })), false);
    assert.equal(canSubmitDispatchOnboarding(completeForm({ vehicleType, vehiclePlateNumber: '' })), false);
  }
});

test('review is never "complete" - it is the submit gate', () => {
  assert.equal(isStepComplete('review', completeForm()), false);
});
