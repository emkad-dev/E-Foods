/**
 * Run with: node --test --experimental-strip-types packages/auth/src/boundedFetch.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  boundedFetch,
  createBoundedFetch,
  FETCH_TIMEOUT_MS,
  PASSWORD_GRANT_TIMEOUT_MS,
  resolveFetchTimeoutMs,
} from './boundedFetch.ts';

const installFakeFetch = (impl: (input: unknown, init?: { signal?: AbortSignal }) => Promise<unknown>) => {
  (globalThis as { fetch?: unknown }).fetch = impl;
};

test('passes the response through when the underlying fetch resolves before the timeout', async () => {
  installFakeFetch(async () => 'a-response');
  const result = await boundedFetch('http://example.test');
  assert.equal(result, 'a-response');
});

test('aborts the underlying fetch once the timeout elapses, for a fetch that never settles on its own', async () => {
  let sawAbort = false;
  installFakeFetch(
    (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          sawAbort = true;
          const err = new Error('The operation was aborted.');
          (err as Error & { name: string }).name = 'AbortError';
          reject(err);
        });
      })
  );

  const shortFetch = createBoundedFetch(20);
  await assert.rejects(() => shortFetch('http://example.test'), /aborted/);
  assert.ok(sawAbort, 'expected the underlying fetch to receive an abort signal');
});

test('the configured timeout is a sane, positive, bounded duration', () => {
  assert.ok(FETCH_TIMEOUT_MS > 0);
  assert.ok(FETCH_TIMEOUT_MS < 60_000);
});

const AUTH = 'https://project.supabase.co/auth/v1';

test('the password grant alone is shortened, and below the default', () => {
  assert.equal(resolveFetchTimeoutMs(`${AUTH}/token?grant_type=password`), PASSWORD_GRANT_TIMEOUT_MS);
  assert.ok(PASSWORD_GRANT_TIMEOUT_MS < FETCH_TIMEOUT_MS);
  assert.equal(PASSWORD_GRANT_TIMEOUT_MS, 7_000);
});

test('the password grant is recognised however the request is expressed', () => {
  assert.equal(resolveFetchTimeoutMs(new URL(`${AUTH}/token?grant_type=password`)), PASSWORD_GRANT_TIMEOUT_MS);
  assert.equal(
    resolveFetchTimeoutMs({ url: `${AUTH}/token?grant_type=password` } as unknown as Request),
    PASSWORD_GRANT_TIMEOUT_MS
  );
  // Parameter order is not part of the contract.
  assert.equal(resolveFetchTimeoutMs(`${AUTH}/token?redirect_to=x&grant_type=password`), PASSWORD_GRANT_TIMEOUT_MS);
});

test('refresh-token requests keep the full limit, so a rotating token is never cut off early', () => {
  assert.equal(resolveFetchTimeoutMs(`${AUTH}/token?grant_type=refresh_token`), FETCH_TIMEOUT_MS);
  assert.equal(resolveFetchTimeoutMs(new URL(`${AUTH}/token?grant_type=refresh_token`)), FETCH_TIMEOUT_MS);
});

test('every other request keeps the full limit', () => {
  assert.equal(resolveFetchTimeoutMs(`${AUTH}/user`), FETCH_TIMEOUT_MS);
  assert.equal(resolveFetchTimeoutMs(`${AUTH}/logout?scope=local`), FETCH_TIMEOUT_MS);
  assert.equal(resolveFetchTimeoutMs(`${AUTH}/token?grant_type=pkce`), FETCH_TIMEOUT_MS);
  assert.equal(resolveFetchTimeoutMs('https://project.supabase.co/rest/v1/user_profiles?select=uid'), FETCH_TIMEOUT_MS);
  // The word "password" elsewhere in a URL is not the password grant.
  assert.equal(resolveFetchTimeoutMs(`${AUTH}/recover?email=a@b.c&note=grant_type=password`), FETCH_TIMEOUT_MS);
  assert.equal(resolveFetchTimeoutMs(''), FETCH_TIMEOUT_MS);
});

test('a bounded fetch asks the policy per request, so two requests can have different limits', async () => {
  // Both requests stall for 40ms. The short-limit one is cut off; the
  // long-limit one is still waiting and gets its answer.
  installFakeFetch(
    (_input, init) =>
      new Promise((resolve, reject) => {
        const answer = setTimeout(() => resolve('answered'), 40);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(answer);
          reject(new Error('aborted'));
        });
      })
  );

  const policyFetch = createBoundedFetch((input) => (String(input).includes('short') ? 10 : 10_000));

  await assert.rejects(() => policyFetch('http://example.test/short'), /aborted/);
  assert.equal(await policyFetch('http://example.test/long'), 'answered');
});
