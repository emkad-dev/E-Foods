/**
 * Run with: node --test --experimental-strip-types packages/domain/src/rpcUrl.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveRpcFunctionUrl } from './rpcUrl.ts';

test('rewrites the last path segment of a Supabase functions URL', () => {
  assert.equal(
    deriveRpcFunctionUrl('https://project.functions.supabase.co/app-rpc', 'feasty-orders'),
    'https://project.functions.supabase.co/feasty-orders'
  );
});

test('rewrites the last path segment of a custom-domain URL', () => {
  assert.equal(
    deriveRpcFunctionUrl('https://api.feasty.com.ng/functions/v1/app-rpc', 'feasty-admin'),
    'https://api.feasty.com.ng/functions/v1/feasty-admin'
  );
});

test('handles a trailing slash on the base URL', () => {
  assert.equal(
    deriveRpcFunctionUrl('https://project.functions.supabase.co/app-rpc/', 'feasty-partner'),
    'https://project.functions.supabase.co/feasty-partner'
  );
});

test('appends the function name when the base URL has no path', () => {
  assert.equal(
    deriveRpcFunctionUrl('https://project.functions.supabase.co', 'feasty-dispatch'),
    'https://project.functions.supabase.co/feasty-dispatch'
  );
  assert.equal(
    deriveRpcFunctionUrl('https://project.functions.supabase.co/', 'feasty-dispatch'),
    'https://project.functions.supabase.co/feasty-dispatch'
  );
});

test('preserves query strings', () => {
  assert.equal(
    deriveRpcFunctionUrl('https://project.functions.supabase.co/app-rpc?foo=bar', 'feasty-account'),
    'https://project.functions.supabase.co/feasty-account?foo=bar'
  );
});

test('round-trips to the same URL when the function name is unchanged', () => {
  assert.equal(
    deriveRpcFunctionUrl('https://project.functions.supabase.co/app-rpc', 'app-rpc'),
    'https://project.functions.supabase.co/app-rpc'
  );
});

test('throws on a malformed base URL rather than silently reusing it', () => {
  assert.throws(() => deriveRpcFunctionUrl('not-a-url', 'feasty-orders'));
});
