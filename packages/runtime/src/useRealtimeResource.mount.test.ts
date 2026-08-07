/**
 * Run with: node --test --experimental-strip-types packages/runtime/src/useRealtimeResource.mount.test.ts
 *
 * useRealtimeResource.ts is a thin React wrapper (useEffect/useRef) around
 * createRealtimeResourceController. This project's node --test suite has no
 * React renderer, so these tests replicate the hook's exact mount sequence
 * (verbatim from useRealtimeResource.ts's mount effect) directly against the
 * controller -- the same technique used to find and verify the B1-review
 * round-2 regression: an ordinary visible mount called load() twice, because
 * the controller treated a fresh channel's first-ever status report as a
 * reconnect. realtimeResource.test.ts exercises the controller in isolation
 * and never caught this; this file exercises the load()-then-subscribe()
 * combination the hook actually performs, which is where the bug lived.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRealtimeResourceController, type RealtimeChannelStatus } from './realtimeResource.ts';

type StatusHandler = (status: RealtimeChannelStatus) => void;

// Verbatim replication of useRealtimeResource.ts's mount effect: create the
// controller, report visibility, conditionally load(), then subscribe -- in
// that exact order, since the order is what makes the bug order-dependent
// (subscribe() can report a status synchronously, before this function
// returns, or asynchronously, well after).
const simulateMount = (options: {
  isVisible: boolean;
  fallbackMs?: number;
  debounceMs?: number;
  // Mirrors RealtimeResourceSubscribe: given (onChanged, onStatusChange),
  // opens the subscription and returns an unsubscribe function -- called
  // synchronously here, exactly like useRealtimeResource's effect calls the
  // real `subscribe` prop.
  subscribeImpl: (onChanged: () => void, onStatusChange: StatusHandler) => () => void;
}) => {
  let loadCount = 0;
  const load = () => {
    loadCount += 1;
  };

  const controller = createRealtimeResourceController(load, options.fallbackMs ?? 120_000, options.debounceMs ?? 400);
  controller.setVisible(options.isVisible);

  // Mirrors: if (isVisibleRef.current) { void load(); }
  if (options.isVisible) {
    load();
  }

  const unsubscribe = options.subscribeImpl(
    () => controller.notifyChanged(),
    (status) => controller.setChannelStatus(status)
  );

  return {
    controller,
    getLoadCount: () => loadCount,
    unsubscribe,
  };
};

test('cold mount, visible, synchronous SUBSCRIBED replay (already-live shared topic) fetches exactly once', () => {
  const { getLoadCount } = simulateMount({
    isVisible: true,
    subscribeImpl: (_onChanged, onStatusChange) => {
      // A shared topic that is already SUBSCRIBED by the time this hook
      // joins replays that status synchronously, before subscribeImpl even
      // returns -- see subscribeToRealtimeChanges in
      // packages/auth/src/realtime.ts ("Replay the current status
      // immediately so a subscriber that joins an already-connected topic
      // learns it right away").
      onStatusChange('SUBSCRIBED');
      return () => {};
    },
  });

  assert.equal(getLoadCount(), 1);
});

test('cold mount, visible, async first-time SUBSCRIBED fetches exactly once', async () => {
  let reportStatus: StatusHandler = () => {};

  const { getLoadCount } = simulateMount({
    isVisible: true,
    subscribeImpl: (_onChanged, onStatusChange) => {
      reportStatus = onStatusChange;
      return () => {};
    },
  });

  assert.equal(getLoadCount(), 1, 'the mount-time load() call should have fired synchronously');

  // A first-time join resolves asynchronously against the real Supabase
  // client -- simulate that with a microtask before the channel reports in.
  await Promise.resolve();
  reportStatus('SUBSCRIBED');

  assert.equal(getLoadCount(), 1, 'the first-ever status report must not add a second fetch');
});

test('a genuine disconnect -> reconnect after mount still fetches exactly once more (F1 must not regress)', async () => {
  let reportStatus: StatusHandler = () => {};

  const { getLoadCount } = simulateMount({
    isVisible: true,
    subscribeImpl: (_onChanged, onStatusChange) => {
      reportStatus = onStatusChange;
      return () => {};
    },
  });

  assert.equal(getLoadCount(), 1);

  await Promise.resolve();
  reportStatus('SUBSCRIBED');
  assert.equal(getLoadCount(), 1, 'settling to SUBSCRIBED for the first time is still not a reconnect');

  reportStatus('DISCONNECTED');
  assert.equal(getLoadCount(), 1, 'going disconnected does not itself fetch');

  reportStatus('SUBSCRIBED');
  assert.equal(getLoadCount(), 2, 'the genuine reconnect fetches exactly once more');
});

test('cold mount hidden: no mount fetch; SUBSCRIBED while still hidden does not fetch; becoming visible fetches exactly once', () => {
  let reportStatus: StatusHandler = () => {};

  const { controller, getLoadCount } = simulateMount({
    isVisible: false,
    subscribeImpl: (_onChanged, onStatusChange) => {
      reportStatus = onStatusChange;
      return () => {};
    },
  });

  assert.equal(getLoadCount(), 0, 'mounting hidden must not fetch');

  reportStatus('SUBSCRIBED');
  assert.equal(getLoadCount(), 0, 'a status report while still hidden must not fetch (F3)');

  // Mirrors useRealtimeResource's second effect:
  // controllerRef.current?.setVisible(isVisible)
  controller.setVisible(true);
  assert.equal(getLoadCount(), 1, 'the foreground-resume catch-up fetches exactly once');
});
