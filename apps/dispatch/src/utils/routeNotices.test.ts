/**
 * Run with: node --test --experimental-strip-types apps/dispatch/src/utils/routeNotices.test.ts
 *
 * These resolvers exist because a message has to cross a navigation. The
 * failure mode they replace is silence, so the case that matters most is the
 * one where a resolver is handed something it does not know: it must return
 * null (the destination renders no banner) rather than throw or render junk.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  DISPATCH_OFFER_NOTICES,
  DISPATCH_SUCCESS_NOTICES,
  resolveDispatchOfferNotice,
  resolveDispatchSuccessNotice,
} from './routeNotices.js';

describe('resolveDispatchSuccessNotice', () => {
  it('resolves every declared key to a non-empty message', () => {
    for (const key of Object.keys(DISPATCH_SUCCESS_NOTICES)) {
      const message = resolveDispatchSuccessNotice(key);
      assert.equal(typeof message, 'string');
      assert.ok((message ?? '').length > 0, `${key} resolved to an empty message`);
    }
  });

  it('keeps resolving the key reset-password already shipped', () => {
    // reset-password.tsx routes with this exact literal; renaming the key would
    // silently strand the confirmation it sends.
    assert.match(resolveDispatchSuccessNotice('password-updated') ?? '', /Password updated/);
  });

  it('takes the first entry when expo-router hands back an array', () => {
    assert.match(resolveDispatchSuccessNotice(['password-updated', 'login-ready']) ?? '', /Password updated/);
  });

  it('returns null for anything unrecognised', () => {
    for (const value of ['nope', '', undefined, null, 42, {}, [], ['nope']]) {
      assert.equal(resolveDispatchSuccessNotice(value), null);
    }
  });

  it('does not resolve inherited Object properties', () => {
    // A bare `key in NOTICES` check would make `?notice=toString` render
    // Function.prototype.toString as a banner.
    assert.equal(resolveDispatchSuccessNotice('toString'), null);
    assert.equal(resolveDispatchSuccessNotice('constructor'), null);
  });
});

describe('resolveDispatchOfferNotice', () => {
  it('resolves both outcomes to a non-empty message', () => {
    for (const key of Object.keys(DISPATCH_OFFER_NOTICES)) {
      assert.ok((resolveDispatchOfferNotice(key) ?? '').length > 0, `${key} resolved to an empty message`);
    }
  });

  it('distinguishes accept from decline', () => {
    const accepted = resolveDispatchOfferNotice('offer-accept-failed');
    const declined = resolveDispatchOfferNotice('offer-decline-failed');
    assert.notEqual(accepted, declined);
  });

  it('returns null for anything unrecognised, success keys included', () => {
    // The two namespaces render with different tones, so a success key must not
    // leak into the failure banner.
    assert.equal(resolveDispatchOfferNotice('password-updated'), null);
    assert.equal(resolveDispatchOfferNotice('constructor'), null);
    assert.equal(resolveDispatchOfferNotice(undefined), null);
  });
});
