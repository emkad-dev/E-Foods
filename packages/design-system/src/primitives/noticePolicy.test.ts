import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  NOTICE_DEFAULT_DURATION_MS,
  NOTICE_MIN_ERROR_DURATION_MS,
  noticeLiveRegion,
  noticeRole,
  resolveNoticeDurationMs,
} from './noticePolicy.ts';

describe('resolveNoticeDurationMs', () => {
  it('never auto-dismisses an error, because the error is the only report of the failure', () => {
    assert.equal(NOTICE_DEFAULT_DURATION_MS.error, null);
    assert.equal(resolveNoticeDurationMs('error'), null);
    assert.equal(resolveNoticeDurationMs('error', undefined), null);
  });

  it('lets a success fade and gives info long enough to read', () => {
    assert.equal(resolveNoticeDurationMs('success'), 4000);
    assert.equal(resolveNoticeDurationMs('info'), 6000);
  });

  it('clamps an explicit error duration up to the readable floor', () => {
    // A caller passing 800ms for a failure would produce a notice a customer
    // could miss entirely between glancing down and glancing back.
    assert.equal(resolveNoticeDurationMs('error', 800), NOTICE_MIN_ERROR_DURATION_MS);
    assert.equal(resolveNoticeDurationMs('error', 6000), 6000);
    assert.equal(resolveNoticeDurationMs('error', 20000), 20000);
  });

  it('does not clamp the non-error tones', () => {
    assert.equal(resolveNoticeDurationMs('success', 1200), 1200);
    assert.equal(resolveNoticeDurationMs('info', 1200), 1200);
  });

  it('treats null as "stays until dismissed" for every tone', () => {
    assert.equal(resolveNoticeDurationMs('success', null), null);
    assert.equal(resolveNoticeDurationMs('info', null), null);
    assert.equal(resolveNoticeDurationMs('error', null), null);
  });

  it('treats a nonsensical duration as sticky rather than as an instant flash', () => {
    // A duration computed from data (a config value, a parsed string) can come
    // out as 0 or NaN. Sticky is the safe failure: the user sees the notice.
    assert.equal(resolveNoticeDurationMs('success', 0), null);
    assert.equal(resolveNoticeDurationMs('success', -1), null);
    assert.equal(resolveNoticeDurationMs('info', Number.NaN), null);
    assert.equal(resolveNoticeDurationMs('info', Number.POSITIVE_INFINITY), null);
  });
});

describe('noticeRole / noticeLiveRegion', () => {
  it('announces failures assertively and everything else politely', () => {
    assert.equal(noticeRole('error'), 'alert');
    assert.equal(noticeLiveRegion('error'), 'assertive');

    assert.equal(noticeRole('success'), 'status');
    assert.equal(noticeLiveRegion('success'), 'polite');
    assert.equal(noticeRole('info'), 'status');
    assert.equal(noticeLiveRegion('info'), 'polite');
  });

  it('keeps the idle host a live region so it is already in the a11y tree', () => {
    // The host stays mounted while nothing is showing; it must still carry a
    // live-region role, or the first notice lands in a region the screen
    // reader has not registered.
    assert.equal(noticeRole(null), 'status');
    assert.equal(noticeLiveRegion(null), 'polite');
  });
});
