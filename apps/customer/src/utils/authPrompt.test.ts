import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { DEFAULT_AUTH_REDIRECT, resolveAuthRedirectTo } from './authPrompt.ts';

describe('resolveAuthRedirectTo', () => {
  it('returns the screen the visitor is standing on', () => {
    assert.equal(resolveAuthRedirectTo('/home/restaurant/abc123'), '/home/restaurant/abc123');
    assert.equal(resolveAuthRedirectTo('/favorites'), '/favorites');
    assert.equal(resolveAuthRedirectTo('/cart'), '/cart');
  });

  it('falls back to home when the path is missing or unusable', () => {
    assert.equal(resolveAuthRedirectTo(null), DEFAULT_AUTH_REDIRECT);
    assert.equal(resolveAuthRedirectTo(undefined), DEFAULT_AUTH_REDIRECT);
    assert.equal(resolveAuthRedirectTo(''), DEFAULT_AUTH_REDIRECT);
    assert.equal(resolveAuthRedirectTo('   '), DEFAULT_AUTH_REDIRECT);
  });

  it('never bounces the visitor back to an auth screen', () => {
    // Signing in from /login and landing on /login again is the loop the auth
    // layout also guards against; not producing it in the first place keeps the
    // two in agreement.
    assert.equal(resolveAuthRedirectTo('/login'), DEFAULT_AUTH_REDIRECT);
    assert.equal(resolveAuthRedirectTo('/register'), DEFAULT_AUTH_REDIRECT);
  });

  it('trims incidental whitespace', () => {
    assert.equal(resolveAuthRedirectTo('  /favorites  '), '/favorites');
  });
});
