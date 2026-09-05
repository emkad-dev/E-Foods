/**
 * Run with: node --test --experimental-strip-types packages/runtime/src/visiblePoller.test.ts
 * (Node 22.6+ strips types natively; no build step.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createVisiblePoller, type PollerTimers } from './visiblePoller.ts';

// Minimal deterministic timer harness. Real intervals are never used, so the
// tests assert on tick counts rather than on wall-clock behaviour.
const createFakeTimers = () => {
  let nextHandle = 1;
  const live = new Map<number, { fn: () => void; ms: number }>();

  const timers: PollerTimers = {
    setInterval: (fn, ms) => {
      const handle = nextHandle++;
      live.set(handle, { fn, ms });
      return handle;
    },
    clearInterval: (handle) => {
      live.delete(handle as number);
    },
  };

  return {
    timers,
    /** Fire every live interval `times` times, as elapsing `times * intervalMs` would. */
    advance: (times = 1) => {
      for (let i = 0; i < times; i += 1) {
        for (const entry of [...live.values()]) {
          entry.fn();
        }
      }
    },
    get liveCount() {
      return live.size;
    },
    get intervals() {
      return [...live.values()].map((entry) => entry.ms);
    },
  };
};

const setup = (intervalMs = 30_000) => {
  const fake = createFakeTimers();
  let ticks = 0;
  const poller = createVisiblePoller(
    () => {
      ticks += 1;
    },
    intervalMs,
    fake.timers
  );

  return { fake, poller, ticks: () => ticks };
};

test('mounting while visible starts the interval without an immediate tick', () => {
  const { fake, poller, ticks } = setup();

  poller.setVisible(true);

  // The call sites already issue their own initial load on mount; firing here
  // too would double every mount.
  assert.equal(ticks(), 0);
  assert.equal(fake.liveCount, 1);

  fake.advance(3);
  assert.equal(ticks(), 3);
});

test('mounting while hidden never ticks', () => {
  const { fake, poller, ticks } = setup();

  poller.setVisible(false);
  fake.advance(10);

  assert.equal(ticks(), 0);
  assert.equal(fake.liveCount, 0);
});

test('going hidden stops the interval', () => {
  const { fake, poller, ticks } = setup();

  poller.setVisible(true);
  fake.advance(2);
  assert.equal(ticks(), 2);

  poller.setVisible(false);
  fake.advance(10);

  // Still 2 — nothing fired while hidden.
  assert.equal(ticks(), 2);
  assert.equal(fake.liveCount, 0);
});

test('returning to visible ticks once immediately, then resumes on interval', () => {
  const { fake, poller, ticks } = setup();

  poller.setVisible(true);
  poller.setVisible(false);
  fake.advance(5);
  assert.equal(ticks(), 0);

  poller.setVisible(true);
  // The catch-up read, so a returning user does not stare at stale data for a
  // full interval.
  assert.equal(ticks(), 1);

  fake.advance(2);
  assert.equal(ticks(), 3);
});

test('repeated setVisible(true) does not stack timers or double-tick', () => {
  const { fake, poller, ticks } = setup();

  poller.setVisible(true);
  poller.setVisible(true);
  poller.setVisible(true);

  assert.equal(fake.liveCount, 1);
  assert.equal(ticks(), 0);

  fake.advance(1);
  assert.equal(ticks(), 1);
});

test('repeated setVisible(false) is a no-op', () => {
  const { fake, poller, ticks } = setup();

  poller.setVisible(true);
  poller.setVisible(false);
  poller.setVisible(false);

  assert.equal(fake.liveCount, 0);
  fake.advance(5);
  assert.equal(ticks(), 0);
});

test('stop clears the interval and later ticks never fire', () => {
  const { fake, poller, ticks } = setup();

  poller.setVisible(true);
  poller.stop();

  assert.equal(fake.liveCount, 0);
  fake.advance(5);
  assert.equal(ticks(), 0);
});

test('stop then setVisible(true) does not fire an immediate catch-up tick', () => {
  const { fake, poller, ticks } = setup();

  poller.setVisible(true);
  poller.setVisible(false);
  poller.stop();

  // stop() resets to the unstarted state, so this is a fresh mount, not a
  // hidden -> visible resume.
  poller.setVisible(true);
  assert.equal(ticks(), 0);
  assert.equal(fake.liveCount, 1);
});

test('uses the interval it was given', () => {
  const { fake, poller } = setup(20_000);

  poller.setVisible(true);

  assert.deepEqual(fake.intervals, [20_000]);
});
