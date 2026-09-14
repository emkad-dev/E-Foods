import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  DELIVERY_SUMMARY_EMPTY_TITLE,
  PROFILE_INITIALS_FALLBACK,
  formatDeliverySummary,
  getProfileInitials,
  summarizeOrders,
} from './profileSummary.ts';

describe('getProfileInitials', () => {
  it('takes one letter from each of the first two words of a display name', () => {
    assert.equal(getProfileInitials('Ada Lovelace'), 'AL');
    assert.equal(getProfileInitials('Ada Byron Lovelace'), 'AB');
  });

  it('returns a single letter for a single name', () => {
    assert.equal(getProfileInitials('Ada'), 'A');
  });

  it('ignores surrounding and repeated whitespace', () => {
    assert.equal(getProfileInitials('   ada   lovelace  '), 'AL');
  });

  it('skips a leading non-letter instead of rendering it', () => {
    assert.equal(getProfileInitials('_ada 1lovelace'), 'AL');
  });

  it('falls back to the email local part when no name is set', () => {
    assert.equal(getProfileInitials(null, 'ada.lovelace@gmail.com'), 'AL');
    assert.equal(getProfileInitials('   ', 'ada@gmail.com'), 'A');
  });

  it('keeps accented Latin names', () => {
    assert.equal(getProfileInitials('Ébun Okafor'), 'ÉO');
  });

  it('returns the fallback rather than an empty avatar when nothing has a letter', () => {
    assert.equal(getProfileInitials(null, '08031234567@gmail.com'), PROFILE_INITIALS_FALLBACK);
    assert.equal(getProfileInitials(undefined, undefined), PROFILE_INITIALS_FALLBACK);
  });
});

describe('summarizeOrders', () => {
  it('counts every order and the ones still moving', () => {
    const summary = summarizeOrders([
      { status: 'placed' },
      { status: 'on_the_way' },
      { status: 'delivered' },
      { status: 'cancelled' },
    ]);

    assert.deepEqual(summary, { activeCount: 2, totalCount: 4 });
  });

  it('treats a scheduled order as still in progress', () => {
    assert.equal(summarizeOrders([{ status: 'scheduled' }]).activeCount, 1);
  });

  it('does not count drafts or unrecognised statuses as in progress', () => {
    // Both normalize to 'draft', which is NOT terminal — the trap this guards.
    const summary = summarizeOrders([{ status: 'draft' }, { status: 'who_knows' }, { status: null }]);

    assert.deepEqual(summary, { activeCount: 0, totalCount: 3 });
  });

  it('survives a missing or non-array payload', () => {
    assert.deepEqual(summarizeOrders([]), { activeCount: 0, totalCount: 0 });
    assert.deepEqual(summarizeOrders(null), { activeCount: 0, totalCount: 0 });
    assert.deepEqual(summarizeOrders(undefined), { activeCount: 0, totalCount: 0 });
  });
});

describe('formatDeliverySummary', () => {
  it('prompts for a location when there is none', () => {
    assert.deepEqual(formatDeliverySummary(null), {
      title: DELIVERY_SUMMARY_EMPTY_TITLE,
      subtitle: null,
    });
    assert.deepEqual(formatDeliverySummary({ address: '   ', shortAddress: null }), {
      title: DELIVERY_SUMMARY_EMPTY_TITLE,
      subtitle: null,
    });
  });

  it('leads with the short address and keeps the full one underneath', () => {
    assert.deepEqual(
      formatDeliverySummary({ address: '12 Adeola Odeku St, Victoria Island, Lagos', shortAddress: 'Victoria Island' }),
      { title: 'Victoria Island', subtitle: '12 Adeola Odeku St, Victoria Island, Lagos' }
    );
  });

  it('does not repeat the address as its own subtitle', () => {
    assert.deepEqual(formatDeliverySummary({ address: 'Victoria Island', shortAddress: null }), {
      title: 'Victoria Island',
      subtitle: null,
    });
    assert.deepEqual(
      formatDeliverySummary({ address: 'Victoria Island', shortAddress: 'Victoria Island' }),
      { title: 'Victoria Island', subtitle: null }
    );
  });
});
