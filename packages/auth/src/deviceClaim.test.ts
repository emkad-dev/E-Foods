/**
 * Run with: node --test --experimental-strip-types packages/auth/src/deviceClaim.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createDeviceClaims,
  DEVICE_CLAIM_RETRY_DELAY_MS,
  DEVICE_CLAIM_WAIT_CAP_MS,
} from './deviceClaim.ts';

type Deferred<T = void> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };

const deferred = <T = void>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/** Lets every already-queued promise continuation run. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * A harness whose remote write is scripted per call: each entry is what that
 * write does ('ok', 'fail', or a Deferred the test settles by hand). Delays
 * resolve immediately unless the test supplies a controller for that duration.
 */
const harness = (writes: Array<'ok' | 'fail' | Deferred>, delayControl: Record<number, Deferred> = {}) => {
  const log: string[] = [];
  const reported: unknown[] = [];
  const stored: string[] = [];
  const delays: number[] = [];
  let writeCalls = 0;
  let ids = 0;

  const claims = createDeviceClaims({
    createSessionId: () => `id-${++ids}`,
    writeRemote: async (userId, sessionId) => {
      log.push(`write:${userId}:${sessionId}`);
      const script = writes[Math.min(writeCalls, writes.length - 1)];
      writeCalls += 1;
      if (script === 'fail') {
        throw new Error('write failed');
      }
      if (script !== 'ok') {
        await script.promise;
      }
    },
    storeLocal: async (sessionId) => {
      log.push(`store:${sessionId}`);
      stored.push(sessionId);
    },
    report: (error) => reported.push(error),
    delay: async (ms) => {
      delays.push(ms);
      await delayControl[ms]?.promise;
    },
  });

  return { claims, log, reported, stored, delays, writeCalls: () => writeCalls };
};

test('a claim writes remote first, then stores locally, and releases the guard when done', async () => {
  const h = harness(['ok']);
  const attempt = await h.claims.beginSignIn();
  assert.equal(h.claims.isGuardHeld(), true);

  attempt.startClaim('user-a');
  assert.equal(h.claims.isGuardHeld(), true, 'the guard outlasts the call that started the claim');
  await settle();

  assert.deepEqual(h.log, ['write:user-a:id-1', 'store:id-1']);
  assert.equal(h.claims.isGuardHeld(), false);
  assert.equal(h.reported.length, 0);
});

test('the guard is held while the remote write is still pending', async () => {
  const write = deferred();
  const h = harness([write]);
  const attempt = await h.claims.beginSignIn();
  attempt.startClaim('user-a');
  await settle();

  assert.equal(h.claims.isGuardHeld(), true);
  write.resolve();
  await settle();
  assert.equal(h.claims.isGuardHeld(), false);
  assert.deepEqual(h.stored, ['id-1']);
});

test('a failed first write is retried once, after a pause, and the retry is stored', async () => {
  const h = harness(['fail', 'ok']);
  const attempt = await h.claims.beginSignIn();
  attempt.startClaim('user-a');
  await settle();

  assert.deepEqual(h.delays, [DEVICE_CLAIM_RETRY_DELAY_MS]);
  assert.equal(DEVICE_CLAIM_RETRY_DELAY_MS, 1_000);
  assert.deepEqual(h.log, ['write:user-a:id-1', 'write:user-a:id-2', 'store:id-2']);
  assert.equal(h.reported.length, 0);
  assert.equal(h.claims.isGuardHeld(), false);
});

test('when both attempts fail the failure is reported, nothing is stored, and the guard is released', async () => {
  const h = harness(['fail']);
  const attempt = await h.claims.beginSignIn();
  attempt.startClaim('user-a');
  await settle();

  assert.equal(h.writeCalls(), 2, 'one try plus exactly one retry');
  assert.equal(h.reported.length, 1);
  assert.match((h.reported[0] as Error).message, /write failed/);
  // Local stays empty (the next reconcile adopts). The claim has no way to sign
  // anybody out: its only outputs are the two writes and the report.
  assert.deepEqual(h.stored, []);
  assert.equal(h.claims.isGuardHeld(), false, 'a failed claim must not leave the single-device check off');
});

test('a claim made stale before its retry neither retries nor reports', async () => {
  const firstWrite = deferred();
  const h = harness([firstWrite]);
  const attempt = await h.claims.beginSignIn();
  attempt.startClaim('user-a');
  await settle();

  h.claims.invalidate();
  firstWrite.reject(new Error('write failed'));
  await settle();

  assert.equal(h.writeCalls(), 1, 'no retry');
  assert.deepEqual(h.delays, []);
  assert.equal(h.reported.length, 0, 'a stale failure is noise');
  assert.deepEqual(h.stored, []);
});

test('a claim made stale after its remote write never stores locally', async () => {
  // The hazard: a late write carrying the wrong JWT matches no row and reports
  // success; storing that id locally would evict the next account.
  const write = deferred();
  const h = harness([write]);
  const attempt = await h.claims.beginSignIn();
  attempt.startClaim('user-a');
  await settle();

  h.claims.invalidate();
  write.resolve();
  await settle();

  assert.deepEqual(h.stored, []);
  assert.equal(h.reported.length, 0);
});

test('sign-out mid-claim drops the guard at once and the late claim writes nothing locally', async () => {
  const write = deferred();
  const h = harness([write]);
  const attempt = await h.claims.beginSignIn();
  attempt.startClaim('user-a');
  await settle();
  assert.equal(h.claims.isGuardHeld(), true);

  h.claims.invalidate();
  assert.equal(h.claims.isGuardHeld(), false);

  write.resolve();
  await settle();
  assert.deepEqual(h.stored, []);
  assert.equal(h.claims.isGuardHeld(), false);
});

test("an older claim finishing does not release a newer sign-in's guard", async () => {
  const oldWrite = deferred();
  const h = harness([oldWrite, 'ok']);

  const first = await h.claims.beginSignIn();
  first.startClaim('user-a');
  await settle();

  // A newer sign-in begins while the old claim is still writing (the wait is
  // not the subject here, so delays resolve at once).
  const second = await h.claims.beginSignIn();
  assert.equal(h.claims.isGuardHeld(), true);

  oldWrite.resolve();
  await settle();
  assert.equal(h.claims.isGuardHeld(), true, 'the newer sign-in still owns the guard');
  assert.deepEqual(h.stored, [], 'and the stale claim stored nothing');

  second.startClaim('user-b');
  await settle();
  assert.equal(h.claims.isGuardHeld(), false);
  assert.deepEqual(h.stored, ['id-2']);
});

test('release() frees the guard when the sign-in failed before a claim started', async () => {
  const h = harness(['ok']);
  const attempt = await h.claims.beginSignIn();
  assert.equal(h.claims.isGuardHeld(), true);

  attempt.release();
  assert.equal(h.claims.isGuardHeld(), false);
});

test('release() after the claim started leaves the guard to the claim', async () => {
  const write = deferred();
  const h = harness([write]);
  const attempt = await h.claims.beginSignIn();
  attempt.startClaim('user-a');
  await settle();

  attempt.release();
  assert.equal(h.claims.isGuardHeld(), true);

  write.resolve();
  await settle();
  assert.equal(h.claims.isGuardHeld(), false);
});

test("a superseded attempt cannot release the newer attempt's guard", async () => {
  const h = harness(['ok']);
  const older = await h.claims.beginSignIn();
  const newer = await h.claims.beginSignIn();

  older.release();
  assert.equal(h.claims.isGuardHeld(), true);

  newer.release();
  assert.equal(h.claims.isGuardHeld(), false);
});

test('the next sign-in waits for an in-flight claim, but no longer than the cap', async () => {
  const stalledWrite = deferred();
  const cap = deferred();
  const h = harness([stalledWrite], { [DEVICE_CLAIM_WAIT_CAP_MS]: cap });

  const first = await h.claims.beginSignIn();
  first.startClaim('user-a');
  await settle();

  let secondReady = false;
  const secondBegin = h.claims.beginSignIn().then((attempt) => {
    secondReady = true;
    return attempt;
  });
  await settle();

  assert.deepEqual(h.delays, [DEVICE_CLAIM_WAIT_CAP_MS], 'the wait is capped at 5s');
  assert.equal(DEVICE_CLAIM_WAIT_CAP_MS, 5_000);
  assert.equal(secondReady, false, 'still waiting for the stalled claim');

  cap.resolve();
  await secondBegin;
  assert.equal(secondReady, true, 'the cap releases a sign-in held up by a stalled claim');
  assert.equal(h.claims.isGuardHeld(), true, 'and the guard is held for the new sign-in');
});

test('the next sign-in does not wait out the cap when the earlier claim settles first', async () => {
  const write = deferred();
  const cap = deferred(); // never resolved
  const h = harness([write, 'ok'], { [DEVICE_CLAIM_WAIT_CAP_MS]: cap });

  const first = await h.claims.beginSignIn();
  first.startClaim('user-a');
  await settle();

  const secondBegin = h.claims.beginSignIn();
  write.resolve();
  const second = await secondBegin;

  assert.ok(second, 'resolved without the cap ever firing');
});

test('the next sign-in does not wait at all when no claim is in flight', async () => {
  const h = harness(['ok']);
  await h.claims.beginSignIn();

  assert.deepEqual(h.delays, []);
});
