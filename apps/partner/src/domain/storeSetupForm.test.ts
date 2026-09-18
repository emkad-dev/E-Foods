/**
 * Run with: node --test --experimental-strip-types apps/partner/src/domain/storeSetupForm.test.ts
 *
 * Two things are pinned here.
 *
 * FIRST, that nothing is invented. The screen this replaces seeded '25-35 min',
 * '08:00', '22:00', '0', '0' and '12' into fields the record had no value for,
 * and Save persisted them as if the partner had typed them. The seeding cases
 * below fail the moment any stand-in value comes back.
 *
 * SECOND, that the validation mirrors the server. Every rule
 * `buildPartnerRestaurantPayload` (supabase/functions/_shared/domains/partner.ts)
 * fails a request on has a case here, so a partner sees the field rather than a
 * bare 400 with nothing attached to it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EMPTY_STORE_SETUP_DRAFT,
  STORE_SETUP_MESSAGES,
  draftFromStore,
  hasStoreSetupErrors,
  isDeliveryRadiusMissing,
  storeSetupGaps,
  storeTradingState,
  toNumberOrNull,
  validateStoreSetup,
  type StoreSetupDraft,
} from './storeSetupForm.ts';

const validDraft = (overrides: Partial<StoreSetupDraft> = {}): StoreSetupDraft => ({
  ...EMPTY_STORE_SETUP_DRAFT,
  name: 'Ada Obi Kitchen',
  address: '12 Admiralty Way, Lekki',
  openingTime: '08:00',
  closingTime: '22:00',
  supportsPickup: true,
  ...overrides,
});

test('a store with no record seeds every field empty, not with stand-in values', () => {
  const draft = draftFromStore(null);

  assert.equal(draft.deliveryTime, '');
  assert.equal(draft.openingTime, '');
  assert.equal(draft.closingTime, '');
  assert.equal(draft.deliveryFee, '');
  assert.equal(draft.minOrder, '');
  assert.equal(draft.deliveryRadiusKm, '');
  assert.equal(draft.isPublished, false);
});

test('a saved record with unset fields still seeds them empty', () => {
  const draft = draftFromStore({
    name: 'Ada Obi Kitchen',
    address: '12 Admiralty Way, Lekki',
    deliveryTime: null,
    openingTime: null,
    closingTime: null,
    deliveryFee: null,
    minOrder: null,
    deliveryRadiusKm: null,
    latitude: null,
    longitude: null,
  });

  assert.equal(draft.name, 'Ada Obi Kitchen');
  assert.equal(draft.deliveryTime, '');
  assert.equal(draft.openingTime, '');
  assert.equal(draft.deliveryFee, '');
  assert.equal(draft.deliveryRadiusKm, '');
  assert.equal(draft.latitude, '');
});

test('a saved zero is a saved zero, not an empty field', () => {
  const draft = draftFromStore({ name: 'Ada Obi Kitchen', deliveryFee: 0, minOrder: 0 });

  assert.equal(draft.deliveryFee, '0');
  assert.equal(draft.minOrder, '0');
});

test('blank numeric fields send null rather than a number the partner never typed', () => {
  assert.equal(toNumberOrNull(''), null);
  assert.equal(toNumberOrNull('   '), null);
  assert.equal(toNumberOrNull('0'), 0);
  assert.equal(toNumberOrNull('12.5'), 12.5);
});

test('a complete unpublished draft passes', () => {
  assert.equal(hasStoreSetupErrors(validateStoreSetup(validDraft())), false);
});

test('name and address are required, as the server requires them', () => {
  const errors = validateStoreSetup(validDraft({ name: '  ', address: '' }));

  assert.equal(errors.name, STORE_SETUP_MESSAGES.name);
  assert.equal(errors.address, STORE_SETUP_MESSAGES.address);
});

test('trading hours are required and must be 24-hour HH:mm', () => {
  const missing = validateStoreSetup(validDraft({ openingTime: '', closingTime: '' }));
  assert.equal(missing.openingTime, STORE_SETUP_MESSAGES.openingTime);
  assert.equal(missing.closingTime, STORE_SETUP_MESSAGES.closingTime);

  const malformed = validateStoreSetup(validDraft({ openingTime: '8am', closingTime: '25:00' }));
  assert.equal(malformed.openingTime, STORE_SETUP_MESSAGES.openingTime);
  assert.equal(malformed.closingTime, STORE_SETUP_MESSAGES.closingTime);
});

test('a store has to offer delivery, pickup, or both', () => {
  const errors = validateStoreSetup(validDraft({ supportsDelivery: false, supportsPickup: false }));

  assert.equal(errors.fulfilment, STORE_SETUP_MESSAGES.fulfilment);
});

test('one coordinate without the other is rejected before it reaches the server', () => {
  const errors = validateStoreSetup(validDraft({ latitude: '6.43', longitude: '' }));

  assert.equal(errors.longitude, STORE_SETUP_MESSAGES.coordinatePair);
  assert.equal(errors.latitude, undefined);
});

test('both coordinates blank is fine while the store is hidden', () => {
  const errors = validateStoreSetup(validDraft({ latitude: '', longitude: '' }));

  assert.equal(errors.latitude, undefined);
  assert.equal(errors.longitude, undefined);
});

test('making the store visible requires coordinates', () => {
  const missing = validateStoreSetup(validDraft({ isPublished: true }));
  assert.equal(missing.latitude, STORE_SETUP_MESSAGES.location);
  assert.equal(missing.longitude, STORE_SETUP_MESSAGES.location);

  const complete = validateStoreSetup(validDraft({ isPublished: true, latitude: '6.43', longitude: '3.42' }));
  assert.equal(hasStoreSetupErrors(complete), false);
});

test('a store that delivers needs a distance above zero, published or not', () => {
  const missing = validateStoreSetup(validDraft({ supportsDelivery: true }));
  assert.equal(missing.deliveryRadiusKm, STORE_SETUP_MESSAGES.deliveryRadiusKm);

  const zero = validateStoreSetup(validDraft({ supportsDelivery: true, deliveryRadiusKm: '0' }));
  assert.equal(zero.deliveryRadiusKm, STORE_SETUP_MESSAGES.deliveryRadiusKm);

  const set = validateStoreSetup(validDraft({ supportsDelivery: true, deliveryRadiusKm: '8' }));
  assert.equal(set.deliveryRadiusKm, undefined);

  // The radius belongs to delivery, not to visibility: a published pickup-only
  // store is not asked for a number it has no use for.
  const publishedPickupOnly = validateStoreSetup(
    validDraft({ isPublished: true, latitude: '6.43', longitude: '3.42' })
  );
  assert.equal(publishedPickupOnly.deliveryRadiusKm, undefined);
});

/**
 * The drift guard. `storeSetupGaps` (the Store tab) and `validateStoreSetup`
 * (the store-details Save button) used to disagree about the delivery radius,
 * so a store could be shown as fully set up on one screen and refused on the
 * other. Every combination is asserted to give the SAME verdict from both.
 */
test('the Store tab and the Save button answer the delivery radius identically', () => {
  const cases = [
    { supportsDelivery: false, deliveryRadiusKm: '', isPublished: false },
    { supportsDelivery: false, deliveryRadiusKm: '', isPublished: true },
    { supportsDelivery: false, deliveryRadiusKm: '0', isPublished: true },
    { supportsDelivery: true, deliveryRadiusKm: '', isPublished: false },
    { supportsDelivery: true, deliveryRadiusKm: '0', isPublished: false },
    { supportsDelivery: true, deliveryRadiusKm: '8', isPublished: false },
    { supportsDelivery: true, deliveryRadiusKm: '', isPublished: true },
    { supportsDelivery: true, deliveryRadiusKm: '8', isPublished: true },
  ];

  for (const testCase of cases) {
    const saveRefuses = Boolean(
      validateStoreSetup(validDraft({ ...testCase, latitude: '6.43', longitude: '3.42' })).deliveryRadiusKm
    );
    const tabWarns = storeSetupGaps({
      address: '12 Admiralty Way, Lekki',
      openingTime: '08:00',
      closingTime: '22:00',
      latitude: 6.43,
      longitude: 3.42,
      supportsDelivery: testCase.supportsDelivery,
      deliveryRadiusKm: testCase.deliveryRadiusKm === '' ? null : Number(testCase.deliveryRadiusKm),
      isPublished: testCase.isPublished,
    }).some((gap) => /delivery distance/.test(gap));

    assert.equal(tabWarns, saveRefuses, `disagreement on ${JSON.stringify(testCase)}`);
    assert.equal(
      saveRefuses,
      isDeliveryRadiusMissing({
        deliveryRadiusKm: testCase.deliveryRadiusKm,
        supportsDelivery: testCase.supportsDelivery,
      })
    );
  }
});

test('trading state is unknown until both hours are saved in HH:mm', () => {
  const at = (hours: number, minutes = 0) => new Date(2026, 8, 18, hours, minutes);

  assert.equal(storeTradingState(null, at(12)), 'unknown');
  assert.equal(storeTradingState({ openingTime: '08:00', closingTime: null }, at(12)), 'unknown');
  assert.equal(storeTradingState({ openingTime: '8am', closingTime: '10pm' }, at(12)), 'unknown');
  assert.equal(storeTradingState({ openingTime: '24:00', closingTime: '22:00' }, at(12)), 'unknown');
});

test('a same-day window is open between the hours and closed outside them', () => {
  const window = { openingTime: '08:00', closingTime: '22:00' };
  const at = (hours: number, minutes = 0) => new Date(2026, 8, 18, hours, minutes);

  assert.equal(storeTradingState(window, at(3)), 'closed');
  assert.equal(storeTradingState(window, at(7, 59)), 'closed');
  assert.equal(storeTradingState(window, at(8)), 'open');
  assert.equal(storeTradingState(window, at(21, 59)), 'open');
  // Closing time is the minute service stops, not a minute of it.
  assert.equal(storeTradingState(window, at(22)), 'closed');
  assert.equal(storeTradingState(window, at(23, 30)), 'closed');
});

test('a window that wraps past midnight stays open through its busiest hours', () => {
  const window = { openingTime: '18:00', closingTime: '02:00' };
  const at = (hours: number, minutes = 0) => new Date(2026, 8, 18, hours, minutes);

  assert.equal(storeTradingState(window, at(17, 59)), 'closed');
  assert.equal(storeTradingState(window, at(18)), 'open');
  assert.equal(storeTradingState(window, at(23, 59)), 'open');
  assert.equal(storeTradingState(window, at(0)), 'open');
  assert.equal(storeTradingState(window, at(1, 59)), 'open');
  assert.equal(storeTradingState(window, at(2)), 'closed');
  assert.equal(storeTradingState(window, at(12)), 'closed');
});

test('equal opening and closing times mean around the clock, not a zero-length window', () => {
  const window = { openingTime: '00:00', closingTime: '00:00' };

  assert.equal(storeTradingState(window, new Date(2026, 8, 18, 3)), 'open');
  assert.equal(storeTradingState(window, new Date(2026, 8, 18, 15)), 'open');
});

test('amounts must be numbers, and negative ones are refused', () => {
  const unreadable = validateStoreSetup(validDraft({ deliveryFee: '500 naira' }));
  assert.equal(unreadable.deliveryFee, STORE_SETUP_MESSAGES.number);

  const negative = validateStoreSetup(validDraft({ minOrder: '-5' }));
  assert.equal(negative.minOrder, STORE_SETUP_MESSAGES.negative);

  const negativeLatitude = validateStoreSetup(validDraft({ latitude: '-6.43', longitude: '3.42' }));
  assert.equal(negativeLatitude.latitude, undefined);
});

test('setup gaps describe the saved record, and an unsaved store says so', () => {
  assert.deepEqual(storeSetupGaps(null), ['Your store record has not been created yet.']);

  const complete = storeSetupGaps({
    address: '12 Admiralty Way, Lekki',
    openingTime: '08:00',
    closingTime: '22:00',
    latitude: 6.43,
    longitude: 3.42,
    supportsDelivery: true,
    deliveryRadiusKm: 8,
  });
  assert.deepEqual(complete, []);

  const deliveryWithoutRadius = storeSetupGaps({
    address: '12 Admiralty Way, Lekki',
    openingTime: '08:00',
    closingTime: '22:00',
    latitude: 6.43,
    longitude: 3.42,
    supportsDelivery: true,
    deliveryRadiusKm: null,
  });
  assert.equal(deliveryWithoutRadius.length, 1);
  assert.match(deliveryWithoutRadius[0], /delivery distance/);
});
