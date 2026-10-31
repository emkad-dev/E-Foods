/**
 * Run with: node --test --experimental-strip-types packages/auth/src/boundedFetch.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { boundedFetch, createBoundedFetch, FETCH_TIMEOUT_MS } from './boundedFetch.ts';

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
