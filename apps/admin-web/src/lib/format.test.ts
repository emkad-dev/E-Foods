import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatCurrency } from './format.ts';

// Compare digits and separators only: the naira sign Intl prints can vary by
// runtime, the grouping and kobo cannot.
const digits = (value: string) => value.replace(/[^\d.,-]/g, '');

test('whole naira amounts show no kobo', () => {
  assert.equal(digits(formatCurrency(9500)), '9,500');
  assert.equal(digits(formatCurrency(0)), '0');
});

test('an amount with kobo always shows both digits', () => {
  // Read as "₦6,938.4" in the running console before the fix.
  assert.equal(digits(formatCurrency(6938.4)), '6,938.40');
  assert.equal(digits(formatCurrency(12.05)), '12.05');
});

test('float noise below a kobo counts as whole', () => {
  assert.equal(digits(formatCurrency(0.1 + 0.2 + 99.7)), '100');
});
