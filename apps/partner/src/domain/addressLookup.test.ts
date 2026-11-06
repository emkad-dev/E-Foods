/**
 * Run with: node --test --experimental-strip-types apps/partner/src/domain/addressLookup.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ADDRESS_LOOKUP_MESSAGES,
  APPROXIMATE_PIN_WARNING,
  DEVICE_POSITION_MESSAGES,
  NOMINATIM_USER_AGENT,
  addressMatchConfirmCopy,
  buildAddressSearchUrl,
  devicePositionConfirmCopy,
  formatCoordinate,
  locationDisclosureCopy,
  lookupFailureMessage,
  normalizeAddressQuery,
  parseGeocodeResults,
} from './addressLookup.ts';

const IKEJA = {
  lat: '6.6018',
  lon: '3.3515',
  display_name: 'Ikeja, Lagos, Nigeria',
  name: 'Ikeja',
};

test('parseGeocodeResults reads the string coordinates Nominatim sends', () => {
  assert.deepEqual(parseGeocodeResults([IKEJA]), {
    latitude: 6.6018,
    longitude: 3.3515,
    placeName: 'Ikeja, Lagos, Nigeria',
  });
});

test('parseGeocodeResults accepts numeric coordinates and falls back to the short name', () => {
  assert.deepEqual(parseGeocodeResults([{ lat: 6.5, lon: 3.4, name: 'Yaba' }]), {
    latitude: 6.5,
    longitude: 3.4,
    placeName: 'Yaba',
  });
});

test('parseGeocodeResults answers null for no result', () => {
  assert.equal(parseGeocodeResults([]), null);
});

test('parseGeocodeResults answers null for payloads that are not a result list', () => {
  for (const payload of [null, undefined, {}, 'oops', 42, { error: 'rate limited' }, '<html>blocked</html>']) {
    assert.equal(parseGeocodeResults(payload), null);
  }
});

test('parseGeocodeResults skips malformed entries and takes the first usable one', () => {
  const result = parseGeocodeResults([
    null,
    'x',
    { lat: 'abc', lon: '3.3', display_name: 'Bad lat' },
    { lat: '6.5', display_name: 'No lon' },
    { lat: '6.5', lon: '3.4' },
    IKEJA,
  ]);

  assert.equal(result?.placeName, 'Ikeja, Lagos, Nigeria');
});

test('parseGeocodeResults never returns 0,0 or an out-of-range pin', () => {
  assert.equal(parseGeocodeResults([{ lat: '0', lon: '0', display_name: 'Null Island' }]), null);
  assert.equal(parseGeocodeResults([{ lat: '95', lon: '3', display_name: 'Off the map' }]), null);
  assert.equal(parseGeocodeResults([{ lat: '6', lon: '-200', display_name: 'Off the map' }]), null);
  assert.equal(parseGeocodeResults([{ lat: '', lon: '', display_name: 'Blank' }]), null);
});

test('parseGeocodeResults bounds an absurdly long place name', () => {
  const match = parseGeocodeResults([{ lat: '6.5', lon: '3.4', display_name: 'A'.repeat(500) }]);
  assert.equal(match?.placeName.length, 200);
});

test('normalizeAddressQuery trims, collapses whitespace and refuses a too-short query', () => {
  assert.equal(normalizeAddressQuery('  12   Allen   Avenue,\n Ikeja '), '12 Allen Avenue, Ikeja');
  assert.equal(normalizeAddressQuery(''), null);
  assert.equal(normalizeAddressQuery('   '), null);
  assert.equal(normalizeAddressQuery('ab'), null);
});

test('buildAddressSearchUrl asks for one Nigerian result and encodes the query', () => {
  const url = new URL(buildAddressSearchUrl('12 Allen Avenue & Co, Ikeja'));

  assert.equal(url.origin + url.pathname, 'https://nominatim.openstreetmap.org/search');
  assert.equal(url.searchParams.get('q'), '12 Allen Avenue & Co, Ikeja');
  assert.equal(url.searchParams.get('format'), 'jsonv2');
  assert.equal(url.searchParams.get('limit'), '1');
  assert.equal(url.searchParams.get('countrycodes'), 'ng');
});

test('the User-Agent names the app and a contact, as the usage policy asks', () => {
  assert.match(NOMINATIM_USER_AGENT, /^FEASTY-Partner\/\d/);
  assert.match(NOMINATIM_USER_AGENT, /@feasty\.com\.ng/);
});

test('formatCoordinate keeps six decimals and drops padding', () => {
  assert.equal(formatCoordinate(6.5244), '6.5244');
  assert.equal(formatCoordinate(6.52440123456), '6.524401');
  assert.equal(formatCoordinate(3), '3');
  assert.equal(formatCoordinate(-33.9), '-33.9');
});

test('every lookup failure has its own wording', () => {
  assert.equal(lookupFailureMessage('no-result'), ADDRESS_LOOKUP_MESSAGES.noResult);
  assert.equal(lookupFailureMessage('offline'), ADDRESS_LOOKUP_MESSAGES.offline);
  assert.equal(lookupFailureMessage('timeout'), ADDRESS_LOOKUP_MESSAGES.timeout);
  assert.equal(lookupFailureMessage('unavailable'), ADDRESS_LOOKUP_MESSAGES.unavailable);

  const messages = new Set([
    ADDRESS_LOOKUP_MESSAGES.noResult,
    ADDRESS_LOOKUP_MESSAGES.offline,
    ADDRESS_LOOKUP_MESSAGES.timeout,
    ADDRESS_LOOKUP_MESSAGES.unavailable,
  ]);
  assert.equal(messages.size, 4);
});

test('every device failure reads as an instruction, not a code', () => {
  for (const message of Object.values(DEVICE_POSITION_MESSAGES)) {
    assert.ok(message.length > 20);
    assert.match(message, /\.$/);
  }
});

test('the address confirmation shows the matched place and the approximate-pin caveat', () => {
  const copy = addressMatchConfirmCopy({ latitude: 6.6018, longitude: 3.3515, placeName: 'Ikeja, Lagos, Nigeria' });

  assert.ok(copy.paragraphs.some((paragraph) => paragraph.includes('Ikeja, Lagos, Nigeria')));
  assert.ok(copy.paragraphs.includes(APPROXIMATE_PIN_WARNING));
  assert.ok(copy.paragraphs.some((paragraph) => paragraph.includes('6.6018, 3.3515')));
});

test('the approximate-pin caveat points at the exact-pin button and the manual fields', () => {
  assert.match(APPROXIMATE_PIN_WARNING, /approximate/i);
  assert.match(APPROXIMATE_PIN_WARNING, /Use my current location/);
  assert.match(APPROXIMATE_PIN_WARNING, /latitude and longitude/);
});

test('the disclosure says foreground-only and gives a way out', () => {
  const text = locationDisclosureCopy.paragraphs.join(' ');

  assert.match(text, /only while this screen is open/);
  assert.match(text, /not track you in the background/);
  assert.ok(locationDisclosureCopy.cancelLabel.length > 0);
});

test('the device-position confirmation states the position, the accuracy when known, and the at-the-restaurant condition', () => {
  const withAccuracy = devicePositionConfirmCopy({ latitude: 6.5244, longitude: 3.3792, accuracyMeters: 12.4 });
  const text = withAccuracy.paragraphs.join(' ');

  assert.match(text, /6\.5244, 3\.3792/);
  assert.match(text, /about 12 m/);
  assert.match(text, /at the restaurant/);

  const withoutAccuracy = devicePositionConfirmCopy({ latitude: 6.5244, longitude: 3.3792, accuracyMeters: null });
  assert.doesNotMatch(withoutAccuracy.paragraphs.join(' '), /accurate to/);
});
