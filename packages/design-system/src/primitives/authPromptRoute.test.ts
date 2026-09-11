import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { AUTH_PROMPT_PATHNAMES, buildAuthPromptHref } from './authPromptRoute.ts';

describe('buildAuthPromptHref', () => {
  it('routes sign in to /login and sign up to /register', () => {
    assert.equal(buildAuthPromptHref('signIn').pathname, '/login');
    assert.equal(buildAuthPromptHref('signUp').pathname, '/register');
    assert.deepEqual(AUTH_PROMPT_PATHNAMES, { signIn: '/login', signUp: '/register' });
  });

  it('attaches redirectTo as a param, matching the convention the auth screens read', () => {
    assert.deepEqual(buildAuthPromptHref('signIn', '/home/restaurant/abc123'), {
      pathname: '/login',
      params: { redirectTo: '/home/restaurant/abc123' },
    });
    assert.deepEqual(buildAuthPromptHref('signUp', '/favorites'), {
      pathname: '/register',
      params: { redirectTo: '/favorites' },
    });
  });

  it('omits params entirely when no redirect is supplied', () => {
    // Not `params: { redirectTo: '' }` — expo-router would serialize the empty
    // value into the URL and the auth layout would have to special-case it.
    assert.deepEqual(buildAuthPromptHref('signIn'), { pathname: '/login' });
    assert.deepEqual(buildAuthPromptHref('signIn', undefined), { pathname: '/login' });
    assert.deepEqual(buildAuthPromptHref('signIn', null), { pathname: '/login' });
    assert.deepEqual(buildAuthPromptHref('signIn', ''), { pathname: '/login' });
    assert.deepEqual(buildAuthPromptHref('signIn', '   '), { pathname: '/login' });
  });

  it('trims surrounding whitespace', () => {
    assert.deepEqual(buildAuthPromptHref('signIn', '  /cart  '), {
      pathname: '/login',
      params: { redirectTo: '/cart' },
    });
  });

  it('guarantees a leading slash so the auth layout can compare paths', () => {
    assert.deepEqual(buildAuthPromptHref('signIn', 'favorites'), {
      pathname: '/login',
      params: { redirectTo: '/favorites' },
    });
  });

  it('leaves an already-qualified path untouched, query string included', () => {
    assert.deepEqual(buildAuthPromptHref('signUp', '/home/restaurant/abc?item=xyz'), {
      pathname: '/register',
      params: { redirectTo: '/home/restaurant/abc?item=xyz' },
    });
  });
});
