/**
 * Run with: node --test --experimental-strip-types packages/auth/src/backendRpc.test.ts
 *
 * These guard the parsing half of the RPC transport. Before it was fixed, the
 * parser looked for a STRING under `message`/`error`/`msg`, while every edge
 * function answers `{ error: { message } }` (supabase/functions/_shared/rpc/
 * respond.ts, `errorResponse`). `body.error` is an object, the string check
 * rejected it, and the caller fell through to `response.text()` — so every
 * server rejection in all four apps was shown to a user as a raw JSON envelope
 * instead of the sentence the server wrote.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseBackendRpcErrorBody } from './backendRpc.ts';

test('the canonical envelope yields the sentence the server wrote', () => {
  const parsed = parseBackendRpcErrorBody({
    error: { message: 'This restaurant is paused right now.' },
  });

  assert.equal(parsed.message, 'This restaurant is paused right now.');
});

test('structured code and details ride along from the same object as the message', () => {
  const parsed = parseBackendRpcErrorBody({
    error: {
      message: 'This account is scheduled for deletion.',
      code: 'ACCOUNT_PENDING_DELETION',
      details: { purgeScheduledAt: '2026-10-01T00:00:00Z' },
    },
  });

  assert.equal(parsed.message, 'This account is scheduled for deletion.');
  assert.equal(parsed.code, 'ACCOUNT_PENDING_DELETION');
  assert.deepEqual(parsed.details, { purgeScheduledAt: '2026-10-01T00:00:00Z' });
});

test('a flat message field still works, so nothing that relied on it regresses', () => {
  assert.equal(parseBackendRpcErrorBody({ message: 'Flat shape.' }).message, 'Flat shape.');
});

test('a string error field still works', () => {
  assert.equal(parseBackendRpcErrorBody({ error: 'String shape.' }).message, 'String shape.');
});

test('a msg field still works', () => {
  assert.equal(parseBackendRpcErrorBody({ msg: 'Legacy shape.' }).message, 'Legacy shape.');
});

test('a bare JSON string body is its own message, without its quotes', () => {
  assert.equal(parseBackendRpcErrorBody('Just a sentence.').message, 'Just a sentence.');
});

test('an error object carrying no message yields nothing rather than "[object Object]"', () => {
  // The exact shape that produced the bug: something under `error`, but no
  // usable sentence in it. Returning null lets the caller fall back rather
  // than rendering a stringified object at a customer.
  assert.equal(parseBackendRpcErrorBody({ error: {} }).message, null);
  assert.equal(parseBackendRpcErrorBody({ error: { code: 'X' } }).message, null);
});

test('bodies with no message at all yield null', () => {
  assert.equal(parseBackendRpcErrorBody(null).message, null);
  assert.equal(parseBackendRpcErrorBody(undefined).message, null);
  assert.equal(parseBackendRpcErrorBody(42).message, null);
  assert.equal(parseBackendRpcErrorBody({}).message, null);
  assert.equal(parseBackendRpcErrorBody([]).message, null);
});

test('whitespace-only messages count as absent, not as an empty error', () => {
  assert.equal(parseBackendRpcErrorBody({ error: { message: '   ' } }).message, null);
  assert.equal(parseBackendRpcErrorBody({ message: '\n\t' }).message, null);
  assert.equal(parseBackendRpcErrorBody('   ').message, null);
});

test('an array under error is not treated as a nested envelope', () => {
  // Arrays are objects, so without the Array.isArray guard this would read
  // `.message` off an array and quietly return undefined-shaped output.
  assert.equal(parseBackendRpcErrorBody({ error: [{ message: 'nope' }] }).message, null);
});

test('an over-long message is bounded, so a stack trace cannot fill the screen', () => {
  const long = 'x'.repeat(900);
  const parsed = parseBackendRpcErrorBody({ error: { message: long } });

  assert.ok(parsed.message, 'a long message is still returned');
  assert.ok(
    parsed.message.length < long.length,
    'an over-long message must be truncated rather than passed through whole'
  );
  assert.ok(parsed.message.endsWith('…'), 'truncation is marked so the reader knows it was cut');
});

test('details must be an object, never an array or a scalar', () => {
  assert.equal(
    parseBackendRpcErrorBody({ error: { message: 'm', details: ['a'] } }).details,
    undefined
  );
  assert.equal(parseBackendRpcErrorBody({ error: { message: 'm', details: 7 } }).details, undefined);
});
