/**
 * Run with: node --test --experimental-strip-types packages/auth/src/sessionLock.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { boundedNavigatorLock, withExecutionTimeout } from './sessionLock.ts';

/**
 * Minimal fake of the Web Locks API's `navigator.locks.request`, just
 * enough to exercise `boundedNavigatorLock`'s own control flow (queue while
 * held, reject the queued wait when its signal aborts, grant immediately on
 * `steal`) without a real browser. Single lock name, which is all this
 * module ever uses.
 */
const installFakeLockManager = (initiallyHeldForever: boolean) => {
  let held = initiallyHeldForever;
  const calls: Array<{ steal?: boolean; ifAvailable?: boolean }> = [];

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
    locks: {
      request: (_name: string, options: { signal?: AbortSignal; steal?: boolean; ifAvailable?: boolean }, cb: (lock: unknown) => Promise<unknown>) => {
        calls.push({ ifAvailable: options.ifAvailable, steal: options.steal });

        if (options.steal) {
          held = true;
          return Promise.resolve(cb({ name: 'fake-lock' })).finally(() => {
            held = false;
          });
        }

        if (options.ifAvailable) {
          return Promise.resolve(cb(held ? null : { name: 'fake-lock' }));
        }

        if (held) {
          // Never grants on its own -- simulates a permanently orphaned holder.
          // Only settles if the caller's own signal aborts.
          return new Promise((_resolve, reject) => {
            options.signal?.addEventListener('abort', () => {
              const err = new Error('The request was aborted.');
              (err as Error & { name: string }).name = 'AbortError';
              reject(err);
            });
          });
        }

        held = true;
        return Promise.resolve(cb({ name: 'fake-lock' })).finally(() => {
          held = false;
        });
      },
    },
    },
  });

  return { calls, isHeld: () => held };
};

test('resolves with the value when fn finishes before the timeout', async () => {
  const result = await withExecutionTimeout(() => Promise.resolve('ok'), 50, 'test');
  assert.equal(result, 'ok');
});

test("rejects with fn's own error when fn rejects before the timeout", async () => {
  await assert.rejects(
    () => withExecutionTimeout(() => Promise.reject(new Error('boom')), 50, 'test'),
    /boom/
  );
});

test('rejects with a labelled timeout error when fn never settles', async () => {
  await assert.rejects(
    () => withExecutionTimeout(() => new Promise(() => {}), 20, 'test-lock'),
    /test-lock did not resolve within 20ms/
  );
});

test('a late resolution after the timeout already fired does not crash or reject again', async () => {
  let resolveLate: (value: string) => void = () => {};
  const latePromise = new Promise<string>((resolve) => {
    resolveLate = resolve;
  });

  const racing = withExecutionTimeout(() => latePromise, 10, 'test');
  await assert.rejects(() => racing, /did not resolve within 10ms/);

  resolveLate('too late');
  // Give the orphaned promise a tick to settle; nothing should observe or throw.
  await new Promise((resolve) => setTimeout(resolve, 20));
});

test('boundedNavigatorLock grants immediately when the lock is free', async () => {
  installFakeLockManager(false);
  const result = await boundedNavigatorLock('t', 1000, () => Promise.resolve('ok'));
  assert.equal(result, 'ok');
});

test('boundedNavigatorLock steals an orphaned lock once the acquire timeout fires, instead of waiting forever', async () => {
  const fake = installFakeLockManager(true);
  const result = await boundedNavigatorLock('t', 30, () => Promise.resolve('recovered'));
  assert.equal(result, 'recovered');
  assert.ok(fake.calls.some((c) => c.steal), 'expected a steal:true request after the acquire timeout');
});

test('an undefined acquireTimeout (what GoTrueClient actually passes in this app) still waits a sane amount before stealing, not near-instantly', async () => {
  // Regression test: Object.assign merging an explicitly-undefined
  // lockAcquireTimeout over the library's own 5000 default means
  // GoTrueClient's real calls arrive here with acquireTimeout === undefined,
  // not 5000. `undefined > 0` is false, so a naive `acquireTimeout <= 0`
  // check never catches it either, and `setTimeout(fn, undefined)` fires at
  // effectively 0ms -- a storm of near-instant steals instead of one orderly
  // wait. boundedNavigatorLock must substitute a sane default instead.
  installFakeLockManager(true);
  const t0 = Date.now();
  await boundedNavigatorLock('t', undefined as unknown as number, () => Promise.resolve('recovered'));
  const elapsed = Date.now() - t0;
  assert.ok(elapsed > 50, `expected a real wait before stealing, got ${elapsed}ms (looks like the undefined bug)`);
});

