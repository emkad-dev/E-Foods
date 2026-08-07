/**
 * Run with: node --test --experimental-strip-types packages/runtime/src/realtimeResource.test.ts
 * (Node 22.6+ strips types natively; no build step.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRealtimeResourceController, type RealtimeResourceTimers } from './realtimeResource.ts';

// Virtual-clock timer harness: unlike a simple "fire N times" fake, this
// tracks due-at timestamps so sub-interval windows (the 400ms debounce
// against a 120000ms fallback) can be exercised precisely with `advance`.
const createFakeTimers = () => {
  let now = 0;
  let nextHandle = 1;
  const entries = new Map<number, { fn: () => void; dueAt: number; intervalMs: number | null }>();

  const timers: RealtimeResourceTimers = {
    setInterval: (fn, ms) => {
      const handle = nextHandle++;
      entries.set(handle, { fn, dueAt: now + ms, intervalMs: ms });
      return handle;
    },
    clearInterval: (handle) => {
      entries.delete(handle as number);
    },
    setTimeout: (fn, ms) => {
      const handle = nextHandle++;
      entries.set(handle, { fn, dueAt: now + ms, intervalMs: null });
      return handle;
    },
    clearTimeout: (handle) => {
      entries.delete(handle as number);
    },
  };

  return {
    timers,
    /** Advances the virtual clock by `ms`, firing everything due (including
     * chained reschedules of repeating intervals) along the way. */
    advance: (ms: number) => {
      now += ms;
      let firedSomething = true;
      let guard = 0;

      while (firedSomething && guard < 10_000) {
        firedSomething = false;
        guard += 1;

        for (const [handle, entry] of [...entries.entries()]) {
          if (!entries.has(handle) || entry.dueAt > now) {
            continue;
          }

          firedSomething = true;

          if (entry.intervalMs === null) {
            entries.delete(handle);
          } else {
            entry.dueAt += entry.intervalMs;
          }

          entry.fn();
        }
      }
    },
    get liveIntervalCount() {
      return [...entries.values()].filter((entry) => entry.intervalMs !== null).length;
    },
    get liveTimeoutCount() {
      return [...entries.values()].filter((entry) => entry.intervalMs === null).length;
    },
    get intervalMsValues() {
      return [...entries.values()].filter((entry) => entry.intervalMs !== null).map((entry) => entry.intervalMs);
    },
  };
};

const setup = (fallbackMs = 120_000, debounceMs = 400) => {
  const fake = createFakeTimers();
  let refetchCount = 0;
  const controller = createRealtimeResourceController(
    () => {
      refetchCount += 1;
    },
    fallbackMs,
    debounceMs,
    fake.timers
  );

  return { fake, controller, refetchCount: () => refetchCount };
};

test('a SUBSCRIBED channel keeps the fallback interval off', () => {
  const { fake, controller } = setup();

  controller.setChannelStatus('SUBSCRIBED');
  controller.setVisible(true);

  assert.equal(fake.liveIntervalCount, 0);
});

test('a disconnected channel starts the 120s fallback interval while visible', () => {
  const { fake, controller, refetchCount } = setup();

  controller.setVisible(true);
  controller.setChannelStatus('DISCONNECTED');

  assert.equal(fake.liveIntervalCount, 1);
  assert.deepEqual(fake.intervalMsValues, [120_000]);

  fake.advance(120_000);
  assert.equal(refetchCount(), 1);

  fake.advance(120_000);
  assert.equal(refetchCount(), 2);
});

test('reconnecting to SUBSCRIBED clears the fallback interval', () => {
  const { fake, controller } = setup();

  controller.setVisible(true);
  controller.setChannelStatus('DISCONNECTED');
  assert.equal(fake.liveIntervalCount, 1);

  controller.setChannelStatus('SUBSCRIBED');
  assert.equal(fake.liveIntervalCount, 0);
});

test('DISCONNECTED to SUBSCRIBED while visible triggers exactly one refetch', () => {
  const { fake, controller, refetchCount } = setup();

  controller.setVisible(true);
  controller.setChannelStatus('DISCONNECTED');
  assert.equal(refetchCount(), 0);

  controller.setChannelStatus('SUBSCRIBED');
  assert.equal(refetchCount(), 1);
  assert.equal(fake.liveIntervalCount, 0);

  // A second, redundant SUBSCRIBED report (setChannelStatus is idempotent on
  // an unchanged value) must not refetch again.
  controller.setChannelStatus('SUBSCRIBED');
  assert.equal(refetchCount(), 1);
});

test('DISCONNECTED to SUBSCRIBED while hidden does not refetch -- the foreground catch-up covers it', () => {
  const { controller, refetchCount } = setup();

  controller.setVisible(false);
  controller.setChannelStatus('DISCONNECTED');
  controller.setChannelStatus('SUBSCRIBED');
  assert.equal(refetchCount(), 0);

  controller.setVisible(true);
  assert.equal(refetchCount(), 1);
});

test('two changed events inside the debounce window produce exactly one refetch', () => {
  const { fake, controller, refetchCount } = setup(120_000, 400);

  controller.notifyChanged();
  fake.advance(200);
  controller.notifyChanged(); // resets the trailing window
  fake.advance(200); // 400ms since the first event, only 200ms since the second
  assert.equal(refetchCount(), 0);

  fake.advance(200); // now 400ms since the second (and last) event
  assert.equal(refetchCount(), 1);
});

test('notifyChanged while hidden does not arm a debounce timer or refetch', () => {
  const { fake, controller, refetchCount } = setup();

  controller.setVisible(false);
  controller.notifyChanged();

  assert.equal(fake.liveTimeoutCount, 0);

  fake.advance(10_000);
  assert.equal(refetchCount(), 0);
});

test('notifyChanged that armed a debounce while visible is silenced by backgrounding, and does not fire once hidden', () => {
  const { fake, controller, refetchCount } = setup();

  controller.setVisible(true);
  controller.notifyChanged();
  assert.equal(fake.liveTimeoutCount, 1);

  controller.setVisible(false);
  assert.equal(fake.liveTimeoutCount, 0);

  fake.advance(10_000);
  assert.equal(refetchCount(), 0);
});

test('changed events outside the debounce window each produce their own refetch', () => {
  const { fake, controller, refetchCount } = setup(120_000, 400);

  controller.notifyChanged();
  fake.advance(400);
  assert.equal(refetchCount(), 1);

  controller.notifyChanged();
  fake.advance(400);
  assert.equal(refetchCount(), 2);
});

test('unmount (stop) clears the fallback interval and any pending debounce', () => {
  const { fake, controller, refetchCount } = setup();

  controller.setVisible(true);
  controller.setChannelStatus('DISCONNECTED');
  controller.notifyChanged();
  assert.equal(fake.liveIntervalCount, 1);
  assert.equal(fake.liveTimeoutCount, 1);

  controller.stop();

  assert.equal(fake.liveIntervalCount, 0);
  assert.equal(fake.liveTimeoutCount, 0);

  fake.advance(500_000);
  assert.equal(refetchCount(), 0);
});

test('backgrounding clears the fallback interval and any pending debounce', () => {
  const { fake, controller, refetchCount } = setup();

  controller.setVisible(true);
  controller.setChannelStatus('DISCONNECTED');
  controller.notifyChanged();
  assert.equal(fake.liveIntervalCount, 1);
  assert.equal(fake.liveTimeoutCount, 1);

  controller.setVisible(false);

  assert.equal(fake.liveIntervalCount, 0);
  assert.equal(fake.liveTimeoutCount, 0);

  fake.advance(500_000);
  assert.equal(refetchCount(), 0);
});

test('returning to the foreground fires one catch-up refetch and resumes the fallback interval while disconnected', () => {
  const { fake, controller, refetchCount } = setup();

  controller.setVisible(true);
  controller.setChannelStatus('DISCONNECTED');
  controller.setVisible(false);
  assert.equal(refetchCount(), 0);

  controller.setVisible(true);

  assert.equal(refetchCount(), 1);
  assert.equal(fake.liveIntervalCount, 1);
});

test('returning to the foreground while SUBSCRIBED does not start the fallback interval', () => {
  const { fake, controller, refetchCount } = setup();

  controller.setChannelStatus('SUBSCRIBED');
  controller.setVisible(true);
  controller.setVisible(false);
  controller.setVisible(true);

  assert.equal(refetchCount(), 1); // the one catch-up refetch, no interval
  assert.equal(fake.liveIntervalCount, 0);
});

test('mounting hidden never starts the fallback interval', () => {
  const { fake, controller, refetchCount } = setup();

  controller.setVisible(false);
  controller.setChannelStatus('DISCONNECTED');

  assert.equal(fake.liveIntervalCount, 0);
  assert.equal(refetchCount(), 0);
});

test('repeated setChannelStatus/setVisible calls with the same value are no-ops', () => {
  const { fake, controller } = setup();

  controller.setVisible(true);
  controller.setVisible(true);
  controller.setChannelStatus('DISCONNECTED');
  controller.setChannelStatus('DISCONNECTED');

  assert.equal(fake.liveIntervalCount, 1);
});
