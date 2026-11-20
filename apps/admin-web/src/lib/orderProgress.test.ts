import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildProgressSteps } from './orderProgress.ts';

test('steps come out in the order they happened, whatever the key order', () => {
  const steps = buildProgressSteps({
    deliveredAt: '2026-11-15T13:40:00.000Z',
    placedAt: '2026-11-15T12:58:00.000Z',
    acceptedAt: '2026-11-15T13:01:00.000Z',
    readyAt: '2026-11-15T13:20:00.000Z',
  });

  assert.deepEqual(
    steps.map((step) => step.label),
    ['Placed', 'Accepted by the restaurant', 'Ready', 'Delivered']
  );
});

test('a deadline is marked as due, not as something that happened', () => {
  const steps = buildProgressSteps({
    deliveredAt: '2026-11-15T13:40:00.000Z',
    customerConfirmDueAt: '2026-11-15T16:40:00.000Z',
  });

  assert.equal(steps[1].label, 'Customer confirmation due');
  assert.equal(steps[1].due, true);
  assert.equal(steps[0].due, false);
});

test('malformed entries are skipped, unknown keys are humanised', () => {
  const steps = buildProgressSteps({
    placedAt: 'not a date',
    paymentTimedOutAt: '2026-11-15T13:00:00.000Z',
    somethingNewAt: '2026-11-15T13:05:00.000Z',
    note: 'not a timestamp key',
    paidAt: 12345,
  });

  assert.deepEqual(
    steps.map((step) => step.label),
    ['Payment timed out', 'Something new']
  );
});

test('no timeline yields no steps', () => {
  assert.deepEqual(buildProgressSteps(null), []);
  assert.deepEqual(buildProgressSteps(undefined), []);
  assert.deepEqual(buildProgressSteps({}), []);
});
