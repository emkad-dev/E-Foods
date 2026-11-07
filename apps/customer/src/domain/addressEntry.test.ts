/**
 * Run with: node --test --experimental-strip-types apps/customer/src/domain/addressEntry.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  addressEntryReducer,
  initAddressEntry,
  pinBesideText,
  toSavedAddress,
  type AddressEntryAction,
  type AddressEntryState,
  type AddressPin,
} from './addressEntry.ts';

const MARKET: AddressPin = { latitude: 7.4352, longitude: 3.9133, label: 'Bodija Market, Ibadan', source: 'suggestion' };
const JUNCTION: AddressPin = { latitude: 7.4011, longitude: 3.9172, label: 'Mokola Roundabout, Ibadan', source: 'gps' };

const run = (state: AddressEntryState, ...actions: AddressEntryAction[]) => actions.reduce(addressEntryReducer, state);
const empty = () => initAddressEntry(null);

test('starting empty: no pin, empty text that follows the first pin', () => {
  assert.deepEqual(empty(), { text: '', textOrigin: 'pin', pin: null });
  const pinned = run(empty(), { type: 'pinned', pin: MARKET });
  assert.equal(pinned.text, 'Bodija Market, Ibadan');
  assert.equal(pinned.textOrigin, 'pin');
  assert.deepEqual(pinned.pin, { ...MARKET, shortLabel: null });
});

test('auto-filled text follows the next pin, and a new pin always replaces the old one', () => {
  const state = run(empty(), { type: 'pinned', pin: MARKET }, { type: 'pinned', pin: JUNCTION });
  assert.equal(state.text, 'Mokola Roundabout, Ibadan');
  assert.deepEqual(state.pin, { ...JUNCTION, shortLabel: null });
  assert.equal(pinBesideText(state), null);
});

test('typed text is kept when a new pin arrives, and the pin is shown beside it', () => {
  const state = run(
    empty(),
    { type: 'pinned', pin: MARKET },
    { type: 'typed', text: 'Shop 4, behind the bank' },
    { type: 'pinned', pin: JUNCTION }
  );
  assert.equal(state.text, 'Shop 4, behind the bank');
  assert.deepEqual(state.pin, { ...JUNCTION, shortLabel: null });
  assert.equal(pinBesideText(state), 'Pin: Mokola Roundabout, Ibadan');
});

test('editing text never clears or moves the pin', () => {
  const pinned = run(empty(), { type: 'pinned', pin: MARKET });
  const edited = run(pinned, { type: 'typed', text: 'Gate 2' }, { type: 'typed', text: '' });
  assert.deepEqual(edited.pin, pinned.pin);
  assert.deepEqual(edited.pin, { ...MARKET, shortLabel: null });
});

test('clearing the text hands it back to the pin', () => {
  const state = run(
    empty(),
    { type: 'pinned', pin: MARKET },
    { type: 'typed', text: 'mine' },
    { type: 'typed', text: '   ' },
    { type: 'pinned', pin: JUNCTION }
  );
  assert.equal(state.text, 'Mokola Roundabout, Ibadan');
  assert.equal(state.textOrigin, 'pin');
});

test('a pin with no place name fills the text with its coordinates and shows them beside typed text', () => {
  const unnamed: AddressPin = { latitude: 7.4, longitude: 3.9, label: null, source: 'gps' };
  assert.equal(run(empty(), { type: 'pinned', pin: unnamed }).text, 'Pinned location (7.40000, 3.90000)');
  const typed = run(empty(), { type: 'typed', text: 'Blue gate' }, { type: 'pinned', pin: unnamed });
  assert.equal(pinBesideText(typed), 'Pin: 7.40000, 3.90000');
});

test('an unusable pin is ignored rather than replacing a good one', () => {
  const pinned = run(empty(), { type: 'pinned', pin: MARKET });
  for (const [latitude, longitude] of [
    [0, 0],
    [95, 3],
    [Number.NaN, 3],
  ] as const) {
    assert.deepEqual(run(pinned, { type: 'pinned', pin: { ...JUNCTION, latitude, longitude } }), pinned);
  }
});

test('use-pin-text adopts the pinned place as the address text', () => {
  const state = run(
    empty(),
    { type: 'typed', text: 'old words' },
    { type: 'pinned', pin: MARKET },
    { type: 'use-pin-text' }
  );
  assert.equal(state.text, 'Bodija Market, Ibadan');
  assert.equal(state.textOrigin, 'pin');
  assert.equal(pinBesideText(state), null);
  assert.deepEqual(run(empty(), { type: 'use-pin-text' }), empty());
});

test('a saved address restores its pin and whether its text followed the pin', () => {
  const followed = initAddressEntry({
    address: 'Bodija Market, Ibadan',
    latitude: 7.4352,
    longitude: 3.9133,
    pinLabel: 'Bodija Market, Ibadan',
    addressTextSource: 'pin',
  });
  assert.equal(followed.textOrigin, 'pin');
  assert.deepEqual(followed.pin, {
    latitude: 7.4352,
    longitude: 3.9133,
    label: 'Bodija Market, Ibadan',
    shortLabel: null,
    source: 'saved',
  });
  // The bug this replaces: a GPS tap on a saved address kept the old text.
  assert.equal(run(followed, { type: 'pinned', pin: JUNCTION }).text, 'Mokola Roundabout, Ibadan');

  const typed = initAddressEntry({ address: 'Shop 4', latitude: 7.4352, longitude: 3.9133, addressTextSource: 'typed' });
  assert.equal(run(typed, { type: 'pinned', pin: JUNCTION }).text, 'Shop 4');
});

test('older saved addresses: unknown text origin is kept as typed; text-only has no pin', () => {
  const legacy = initAddressEntry({ address: 'Shop 4', latitude: 7.4352, longitude: 3.9133 });
  assert.equal(legacy.textOrigin, 'typed');
  assert.equal(legacy.pin?.label, null);

  const textOnly = initAddressEntry({ address: 'Shop 4, Bodija', latitude: null, longitude: null });
  assert.equal(textOnly.pin, null);
  assert.equal(textOnly.text, 'Shop 4, Bodija');
  assert.equal(textOnly.textOrigin, 'typed');

  assert.equal(initAddressEntry({ address: '', latitude: 0, longitude: 0 }).pin, null);
});

test('toSavedAddress refuses text without a pin', () => {
  assert.equal(toSavedAddress(run(empty(), { type: 'typed', text: 'Shop 4, Bodija' })), null);
});

test('toSavedAddress saves the pin, the free text, and where each came from', () => {
  const state = run(empty(), { type: 'pinned', pin: MARKET }, { type: 'typed', text: '  Shop 4, behind the bank ' });
  assert.deepEqual(toSavedAddress(state, { label: ' Home ', note: ' Blue gate ' }), {
    address: 'Shop 4, behind the bank',
    label: 'Home',
    latitude: 7.4352,
    longitude: 3.9133,
    note: 'Blue gate',
    shortAddress: 'Home',
    coordinateSource: 'Search result',
    pinLabel: 'Bodija Market, Ibadan',
    pinShortLabel: null,
    addressTextSource: 'typed',
  });
  // Without a nickname, typed text is what heads the address, not the pin name.
  assert.equal(toSavedAddress(state)?.shortAddress, 'Shop 4, behind the bank');
});

test('toSavedAddress with blank text saves the pin name as the address', () => {
  const state = run(empty(), { type: 'pinned', pin: JUNCTION }, { type: 'typed', text: '' });
  const saved = toSavedAddress(state);
  assert.equal(saved?.address, 'Mokola Roundabout, Ibadan');
  assert.equal(saved?.shortAddress, 'Mokola Roundabout, Ibadan');
  assert.equal(saved?.addressTextSource, 'pin');
  assert.equal(saved?.coordinateSource, 'Current location');
  assert.equal(saved?.label, null);
  assert.equal(saved?.note, null);
});

test('a short place name heads the saved address unless a nickname was given', () => {
  const gps: AddressPin = { ...JUNCTION, label: '12 Mokola Road, Mokola, Ibadan, Oyo, Nigeria', shortLabel: 'Mokola Road, Mokola' };
  const state = run(empty(), { type: 'pinned', pin: gps });
  assert.equal(toSavedAddress(state)?.shortAddress, 'Mokola Road, Mokola');
  assert.equal(toSavedAddress(state, { label: 'Office' })?.shortAddress, 'Office');

  const restored = initAddressEntry(toSavedAddress(state));
  assert.equal(restored.pin?.shortLabel, 'Mokola Road, Mokola');
  // The pin's short name survives a nickname, because it is saved on its own.
  assert.equal(initAddressEntry(toSavedAddress(state, { label: 'Office' })).pin?.shortLabel, 'Mokola Road, Mokola');

  // Once the customer types, the short name no longer heads the address.
  const typed = run(state, { type: 'typed', text: 'Blue gate, opposite the school' });
  assert.equal(toSavedAddress(typed)?.shortAddress, 'Blue gate, opposite the school');
});

test('shortLabel is restored only from the pin short name, never from shortAddress or a nickname', () => {
  const legacy = initAddressEntry({
    address: 'Bodija Market, Ibadan',
    shortAddress: 'Home',
    label: null,
    latitude: 7.4352,
    longitude: 3.9133,
    addressTextSource: 'pin',
  });
  assert.equal(legacy.pin?.shortLabel, null);
  const saved = toSavedAddress(legacy);
  assert.equal(saved?.shortAddress, 'Bodija Market, Ibadan');
});

test('a legacy record restored, its text edited and saved: shortAddress is the new text', () => {
  const legacy = initAddressEntry({
    address: '12 Old Road, Ibadan',
    shortAddress: 'Old Road, Ibadan',
    latitude: 7.4352,
    longitude: 3.9133,
  });
  const edited = run(legacy, { type: 'typed', text: '14 New Road, Ibadan' });
  assert.equal(toSavedAddress(edited)?.shortAddress, '14 New Road, Ibadan');
});
