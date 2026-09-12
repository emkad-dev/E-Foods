/**
 * Run with: node --test --experimental-strip-types packages/runtime/src/externalLinkPolicy.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  describeExternalLinkFailure,
  isHandoffLink,
  resolveWindowOpenResult,
} from './externalLinkPolicy.ts';

test('a null window.open is a blocked popup, not a success', () => {
  assert.deepEqual(resolveWindowOpenResult(null), { ok: false, reason: 'blocked' });
});

test('undefined is treated the same way, since that is what a stubbed open returns', () => {
  assert.deepEqual(resolveWindowOpenResult(undefined), { ok: false, reason: 'blocked' });
});

test('a real window handle is a success', () => {
  assert.deepEqual(resolveWindowOpenResult({ closed: false }), { ok: true });
});

test('tel: and mailto: are handoffs, so there is no window handle to check', () => {
  assert.equal(isHandoffLink('tel:+2348012345678'), true);
  assert.equal(isHandoffLink('mailto:support@feasty.com.ng'), true);
});

test('handoff detection is case- and whitespace-insensitive, because hrefs are not normalised', () => {
  assert.equal(isHandoffLink('  TEL:+2348012345678'), true);
  assert.equal(isHandoffLink('MailTo:a@b.ng'), true);
});

test('an http(s) link is not a handoff — it opens a window and must be checked', () => {
  assert.equal(isHandoffLink('https://www.google.com/maps/search/?api=1&query=6.45,3.38'), false);
  assert.equal(isHandoffLink('http://feasty.com.ng'), false);
});

test('a url that merely contains tel: is not a handoff', () => {
  assert.equal(
    isHandoffLink('https://example.test/tel:123'),
    false,
    'only the scheme counts — otherwise a normal link would be sent to window.location'
  );
});

test('the blocked message names the cause and the fix, not just the failure', () => {
  const message = describeExternalLinkFailure('blocked', 'the map');
  assert.match(message, /blocked/);
  assert.match(message, /pop-ups/, 'the person has to be told what to change');
  assert.match(message, /the map/, 'and which thing failed to open');
});

test('every failure reason produces an actionable, non-empty message', () => {
  for (const reason of ['blocked', 'unsupported', 'failed'] as const) {
    const message = describeExternalLinkFailure(reason, 'the phone app');
    assert.ok(message.trim().length > 0, `${reason} must say something`);
    assert.match(message, /the phone app/, `${reason} must name the subject`);
  }
});
