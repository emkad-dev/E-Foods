import assert from 'node:assert/strict';
import test from 'node:test';

import { filterNigeriaBanks, NIGERIA_BANKS } from './nigeriaBanks.ts';

test('filterNigeriaBanks: an empty or blank query returns every bank', () => {
  assert.equal(filterNigeriaBanks('').length, NIGERIA_BANKS.length);
  assert.equal(filterNigeriaBanks('   ').length, NIGERIA_BANKS.length);
});

test('filterNigeriaBanks: matches anywhere in the name, ignoring case', () => {
  const names = filterNigeriaBanks('bank of').map((bank) => bank.name);
  assert.ok(names.includes('First Bank of Nigeria'));
  assert.ok(names.every((name) => name.toLowerCase().includes('bank of')));
});

test('filterNigeriaBanks: reaches banks past the first screenful', () => {
  // The picker used to clip at ~5 rows; the last bank must be findable.
  const last = NIGERIA_BANKS[NIGERIA_BANKS.length - 1];
  const found = filterNigeriaBanks(last.name.slice(0, 5));
  assert.ok(found.some((bank) => bank.code === last.code));
});

test('filterNigeriaBanks: a bank code finds that bank', () => {
  assert.deepEqual(
    filterNigeriaBanks('044').map((bank) => bank.name),
    ['Access Bank']
  );
});

test('filterNigeriaBanks: no match returns an empty list', () => {
  assert.deepEqual(filterNigeriaBanks('zzzz-not-a-bank'), []);
});
