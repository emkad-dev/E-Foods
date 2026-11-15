import assert from 'node:assert/strict';
import test from 'node:test';
import { alertsAfterResolve, isAlertResolved } from './alertResolution.ts';

const open = (id: string) => ({ id, resolvedAt: null as string | null });
const resolvedCopy = (id: string) => ({ id, resolvedAt: '2026-11-14T12:00:00.000Z' });

test('an alert counts as resolved only with a resolvedAt timestamp', () => {
  assert.equal(isAlertResolved({ id: 'a' }), false);
  assert.equal(isAlertResolved(open('a')), false);
  assert.equal(isAlertResolved({ id: 'a', resolvedAt: '' }), false);
  assert.equal(isAlertResolved(resolvedCopy('a')), true);
});

test('resolving drops the alert from an open-only list and keeps the rest in order', () => {
  const next = alertsAfterResolve([open('a'), open('b'), open('c')], resolvedCopy('b'), false);
  assert.deepEqual(
    next.map((alert) => alert.id),
    ['a', 'c']
  );
});

test('resolving keeps the alert, now marked resolved, when resolved alerts are shown', () => {
  const next = alertsAfterResolve([open('a'), open('b')], resolvedCopy('b'), true);
  assert.deepEqual(
    next.map((alert) => [alert.id, isAlertResolved(alert)]),
    [
      ['a', false],
      ['b', true],
    ]
  );
});

test('an alert the server reports as still open stays in the list', () => {
  const next = alertsAfterResolve([open('a')], open('a'), false);
  assert.equal(next.length, 1);
});
