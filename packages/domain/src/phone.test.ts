/**
 * Run with: node --test packages/domain/src/phone.test.ts
 * (Node 22.6+ strips types natively; no build step.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatLocalPhone, normalizePhone } from './phone.ts';

const ok = (input: string, e164: string, country: 'NG' | 'GB', hint?: 'NG' | 'GB') => {
  const result = normalizePhone(input, hint);
  assert.deepEqual(result, { ok: true, e164, country, local: `0${e164.slice(country === 'NG' ? 4 : 3)}` });
};

const fail = (input: string, reason: string, hint?: 'NG' | 'GB') => {
  const result = normalizePhone(input, hint);
  assert.deepEqual(result, { ok: false, reason });
};

test('NG local formats normalize to +234', () => {
  ok('08031234567', '+2348031234567', 'NG');
  ok('0803 123 4567', '+2348031234567', 'NG');
  ok('0803-123-4567', '+2348031234567', 'NG');
  ok('(0803) 123.4567', '+2348031234567', 'NG');
  ok('09161234567', '+2349161234567', 'NG');
  ok('08131234567', '+2348131234567', 'NG');
  ok('09031234567', '+2349031234567', 'NG');
});

test('NG international formats normalize to +234', () => {
  ok('+2348031234567', '+2348031234567', 'NG');
  ok('+234 803 123 4567', '+2348031234567', 'NG');
  ok('002348031234567', '+2348031234567', 'NG');
  ok('2348031234567', '+2348031234567', 'NG');
  // Common mistake: trunk 0 kept after the country code.
  ok('+23408031234567', '+2348031234567', 'NG');
});

test('GB local and international formats normalize to +44', () => {
  ok('07123456789', '+447123456789', 'GB', 'GB');
  ok('07123 456789', '+447123456789', 'GB', 'GB');
  ok('+447123456789', '+447123456789', 'GB');
  ok('00447123456789', '+447123456789', 'GB');
  ok('447123456789', '+447123456789', 'GB');
  ok('+4407123456789', '+447123456789', 'GB');
  // GB-only shape needs no hint: 74x is not a Nigerian mobile range.
  ok('07423456789', '+447423456789', 'GB');
});

test('ambiguous 070/071 local numbers follow the hint, defaulting to NG', () => {
  ok('07031234567', '+2347031234567', 'NG');
  ok('07031234567', '+2347031234567', 'NG', 'NG');
  ok('07031234567', '+447031234567', 'GB', 'GB');
});

test('unsupported countries are rejected', () => {
  fail('+15551234567', 'unsupported_country');
  fail('+2551234567890', 'unsupported_country');
  fail('12345678901', 'unsupported_country'); // no trunk 0, no known country code
});

test('bad shapes are rejected with specific reasons', () => {
  fail('', 'empty');
  fail('   ', 'empty');
  fail('0803abc4567', 'invalid_characters');
  fail('++2348031234567', 'invalid_characters');
  fail('080312345', 'invalid_length');
  fail('080312345678', 'invalid_length');
  fail('+2346031234567', 'not_a_mobile'); // 60x is not a Nigerian mobile range
  fail('+442079460958', 'not_a_mobile'); // London landline
  fail('01234567890', 'not_a_mobile'); // landline shape in both markets
});

test('formatLocalPhone groups digits per market', () => {
  assert.equal(formatLocalPhone('08031234567', 'NG'), '0803 123 4567');
  assert.equal(formatLocalPhone('0803', 'NG'), '0803');
  assert.equal(formatLocalPhone('080312', 'NG'), '0803 12');
  assert.equal(formatLocalPhone('07123456789', 'GB'), '07123 456789');
  assert.equal(formatLocalPhone('07123', 'GB'), '07123');
  assert.equal(formatLocalPhone('0712345', 'GB'), '07123 45');
  assert.equal(formatLocalPhone('0803-123-4567', 'NG'), '0803 123 4567');
});
