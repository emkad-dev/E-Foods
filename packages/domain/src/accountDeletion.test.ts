/**
 * Run with: node --test --experimental-strip-types packages/domain/src/accountDeletion.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACCOUNT_DELETION_CANCEL_LABEL,
  ACCOUNT_DELETION_CONFIRM_LABEL,
  ACCOUNT_DELETION_FALLBACK_MESSAGE,
  ACCOUNT_DELETION_TITLE,
  accountDeletionBody,
  accountDeletionErrorMessage,
  accountDeletionParagraphs,
  type AccountDeletionSurface,
} from './accountDeletion.ts';

const SURFACES: AccountDeletionSurface[] = ['customer', 'partner', 'dispatch'];

const SHARED = [
  'This permanently deletes your FEASTY sign-in and profile. It cannot be undone.',
  'Deleted straight away: your sign-in, name, email, phone, saved addresses, favourites and role access.',
  'Kept: past order records, which we must retain for tax, accounting and dispute resolution. They are no longer linked to a sign-in account.',
];

test('the store-facing labels are the agreed strings', () => {
  assert.equal(ACCOUNT_DELETION_TITLE, 'Delete account');
  assert.equal(ACCOUNT_DELETION_CONFIRM_LABEL, 'Delete account');
  assert.equal(ACCOUNT_DELETION_CANCEL_LABEL, 'Cancel');
});

test('every surface opens with the same three shared paragraphs, verbatim', () => {
  for (const surface of SURFACES) {
    assert.deepEqual(accountDeletionParagraphs(surface).slice(0, 3), SHARED, surface);
  }
});

test('customer gets the shared copy and nothing else', () => {
  assert.deepEqual(accountDeletionParagraphs('customer'), SHARED);
});

test('partner appends the restaurant-offboarding line', () => {
  assert.deepEqual(accountDeletionParagraphs('partner'), [
    ...SHARED,
    'If your account is linked to a restaurant, support must offboard it first so store ownership and order history stay traceable.',
  ]);
});

test('dispatch appends the active-delivery line', () => {
  assert.deepEqual(accountDeletionParagraphs('dispatch'), [
    ...SHARED,
    'If you have an active delivery, support must offboard your account after those assignments are cleared.',
  ]);
});

test('the partner and dispatch tails are not interchangeable', () => {
  const partnerTail = accountDeletionParagraphs('partner').slice(3);
  const dispatchTail = accountDeletionParagraphs('dispatch').slice(3);

  assert.equal(partnerTail.length, 1);
  assert.equal(dispatchTail.length, 1);
  assert.notDeepEqual(partnerTail, dispatchTail);
});

test('the body joins paragraphs with a blank line', () => {
  assert.equal(accountDeletionBody('customer'), SHARED.join('\n\n'));
  assert.equal(accountDeletionBody('partner'), accountDeletionParagraphs('partner').join('\n\n'));
});

test('a server refusal is passed through verbatim so the 412 text is readable', () => {
  const refusal = 'Partner accounts linked to a restaurant must be offboarded by admin.';

  assert.equal(accountDeletionErrorMessage(new Error(refusal)), refusal);
  assert.equal(accountDeletionErrorMessage({ message: refusal }), refusal);
  assert.equal(accountDeletionErrorMessage(refusal), refusal);
});

test('surrounding whitespace is trimmed off a refusal', () => {
  assert.equal(accountDeletionErrorMessage(new Error('  Dispatch accounts busy.  ')), 'Dispatch accounts busy.');
});

test('shapeless rejections collapse to the fallback instead of rendering junk', () => {
  for (const value of [undefined, null, 0, false, {}, [], new Error(''), { message: '   ' }, { message: 42 }]) {
    assert.equal(
      accountDeletionErrorMessage(value),
      ACCOUNT_DELETION_FALLBACK_MESSAGE,
      `expected fallback for ${JSON.stringify(value)}`
    );
  }
});

test('the fallback can be overridden per call site', () => {
  assert.equal(accountDeletionErrorMessage(null, 'Custom fallback'), 'Custom fallback');
  assert.equal(accountDeletionErrorMessage(new Error('real'), 'Custom fallback'), 'real');
});
