/**
 * Run with: node --test --experimental-strip-types packages/domain/src/rpcUrl.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveRpcFunctionUrl } from './rpcUrl.ts';

// deriveRpcFunctionUrl takes knownTargets as an explicit parameter rather
// than importing it from './rpcRoutes' (see rpcUrl.ts's top comment for
// why: a bare './rpcRoutes' specifier can't resolve under
// `node --experimental-strip-types`, and an explicit './rpcRoutes.ts'
// specifier fails tsc for apps/partner and apps/dispatch). This is a
// literal, independently-maintained mirror of rpcRoutes.ts's
// KNOWN_RPC_TARGETS — deliberately not imported from it, so this file stays
// dependency-free and this test doesn't rubber-stamp itself against
// whatever rpcRoutes.ts happens to currently export.
const KNOWN_TARGETS = ['feasty-orders', 'feasty-dispatch', 'feasty-partner', 'feasty-admin', 'feasty-account', 'app-rpc'];

test('rewrites the last path segment of a Supabase functions URL', () => {
  assert.equal(
    deriveRpcFunctionUrl('https://project.functions.supabase.co/app-rpc', 'feasty-orders', KNOWN_TARGETS),
    'https://project.functions.supabase.co/feasty-orders'
  );
});

test('rewrites the last path segment of a custom-domain URL', () => {
  assert.equal(
    deriveRpcFunctionUrl('https://api.feasty.com.ng/functions/v1/app-rpc', 'feasty-admin', KNOWN_TARGETS),
    'https://api.feasty.com.ng/functions/v1/feasty-admin'
  );
});

test('handles a trailing slash on the base URL', () => {
  assert.equal(
    deriveRpcFunctionUrl('https://project.functions.supabase.co/app-rpc/', 'feasty-partner', KNOWN_TARGETS),
    'https://project.functions.supabase.co/feasty-partner'
  );
});

test('appends the function name when the base URL has no path', () => {
  assert.equal(
    deriveRpcFunctionUrl('https://project.functions.supabase.co', 'feasty-dispatch', KNOWN_TARGETS),
    'https://project.functions.supabase.co/feasty-dispatch'
  );
  assert.equal(
    deriveRpcFunctionUrl('https://project.functions.supabase.co/', 'feasty-dispatch', KNOWN_TARGETS),
    'https://project.functions.supabase.co/feasty-dispatch'
  );
});

test('preserves query strings', () => {
  assert.equal(
    deriveRpcFunctionUrl('https://project.functions.supabase.co/app-rpc?foo=bar', 'feasty-account', KNOWN_TARGETS),
    'https://project.functions.supabase.co/feasty-account?foo=bar'
  );
});

test('round-trips to the same URL when the function name is unchanged', () => {
  assert.equal(
    deriveRpcFunctionUrl('https://project.functions.supabase.co/app-rpc', 'app-rpc', KNOWN_TARGETS),
    'https://project.functions.supabase.co/app-rpc'
  );
});

test('accepts a known split-mode domain function as the segment being replaced', () => {
  assert.equal(
    deriveRpcFunctionUrl('https://project.functions.supabase.co/feasty-orders', 'feasty-admin', KNOWN_TARGETS),
    'https://project.functions.supabase.co/feasty-admin'
  );
});

test('accepts a Set as well as an array for knownTargets', () => {
  assert.equal(
    deriveRpcFunctionUrl('https://project.functions.supabase.co/app-rpc', 'feasty-orders', new Set(KNOWN_TARGETS)),
    'https://project.functions.supabase.co/feasty-orders'
  );
});

test('throws on a malformed base URL rather than silently reusing it', () => {
  assert.throws(() => deriveRpcFunctionUrl('not-a-url', 'feasty-orders', KNOWN_TARGETS));
});

test('throws rather than clobbering a real path segment when the base URL has no function segment', () => {
  // A base URL misconfigured to the bare functions path (no function name at
  // all) must not silently guess that "v1" is the function-name slot — that
  // would clobber it and produce a URL that always 404s.
  assert.throws(
    () => deriveRpcFunctionUrl('https://project.functions.supabase.co/functions/v1', 'feasty-orders', KNOWN_TARGETS),
    /not "app-rpc" or a known Edge Function name/
  );
});

test('throws on the same misconfigured base URL with a trailing slash', () => {
  assert.throws(
    () =>
      deriveRpcFunctionUrl('https://project.functions.supabase.co/functions/v1/', 'feasty-orders', KNOWN_TARGETS),
    /not "app-rpc" or a known Edge Function name/
  );
});
