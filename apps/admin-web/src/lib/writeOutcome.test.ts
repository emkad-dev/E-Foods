import assert from 'node:assert/strict';
import test from 'node:test';
import { SESSION_EXPIRED_WRITE_MESSAGE, UNCONFIRMED_WRITE_MESSAGE, describeWriteFailure, isUnconfirmedWrite } from './writeOutcome.ts';

const named = (name: string, message = 'x') => Object.assign(new Error(message), { name });
const withStatus = (status: number, message = 'refused') => Object.assign(new Error(message), { status });

test('transport failures and timeouts leave the outcome unknown', () => {
  assert.equal(isUnconfirmedWrite(named('NetworkError', 'Failed to fetch')), true);
  assert.equal(isUnconfirmedWrite(named('TimeoutError')), true);
  assert.equal(isUnconfirmedWrite(new TypeError('Failed to fetch')), true);
  assert.equal(isUnconfirmedWrite(new TypeError('NetworkError when attempting to fetch resource.')), true);
  assert.equal(isUnconfirmedWrite(new TypeError('Load failed')), true);
});

test('a 5xx leaves the outcome unknown', () => {
  assert.equal(isUnconfirmedWrite(withStatus(500)), true);
  assert.equal(isUnconfirmedWrite(withStatus(503)), true);
});

test('a 4xx is a definite refusal, not an unknown outcome', () => {
  for (const status of [400, 403, 404, 409, 412, 429]) {
    assert.equal(isUnconfirmedWrite(withStatus(status, 'Failed to fetch')), false, String(status));
  }
});

test('ordinary errors and non-errors are not transport failures', () => {
  assert.equal(isUnconfirmedWrite(new Error('Your session has expired.')), false);
  assert.equal(isUnconfirmedWrite(null), false);
  assert.equal(isUnconfirmedWrite('Failed to fetch'), false);
});

test('an unknown outcome reloads before answering, and a failed reload is swallowed', async () => {
  let reloads = 0;
  const message = await describeWriteFailure(named('NetworkError'), {
    fallback: 'fallback',
    reload: async () => {
      reloads += 1;
      throw new Error('still offline');
    },
  });
  assert.equal(message, UNCONFIRMED_WRITE_MESSAGE);
  assert.equal(reloads, 1);
});

test('a refusal keeps the server message and does not reload', async () => {
  let reloads = 0;
  const reload = () => {
    reloads += 1;
  };
  assert.equal(await describeWriteFailure(withStatus(412, 'No payout details'), { fallback: 'f', reload }), 'No payout details');
  assert.equal(await describeWriteFailure({}, { fallback: 'fallback', reload }), 'fallback');
  assert.equal(reloads, 0);
});

test('a session-refresh failure says the session expired, not that the save is unconfirmed', async () => {
  let reloads = 0;
  const error = named('SessionRefreshError', 'Backend RPC x could not refresh the session');
  assert.equal(isUnconfirmedWrite(error), false);
  const message = await describeWriteFailure(error, {
    fallback: 'fallback',
    reload: () => {
      reloads += 1;
    },
  });
  assert.equal(message, SESSION_EXPIRED_WRITE_MESSAGE);
  assert.equal(message, 'Your session expired. Sign in again.');
  assert.equal(reloads, 0);
});
