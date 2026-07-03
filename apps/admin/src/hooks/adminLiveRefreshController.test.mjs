import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminLiveRefreshController } from './adminLiveRefreshController.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('coalesces repeated refresh requests into one run', async () => {
  let callCount = 0;

  const controller = createAdminLiveRefreshController(async () => {
    callCount += 1;
  }, { debounceMs: 20 });

  controller.schedule();
  controller.schedule();
  controller.schedule();

  await wait(80);

  assert.equal(callCount, 1);
  controller.dispose();
});

test('queues one follow-up refresh when a request lands during an active run', async () => {
  let callCount = 0;
  let releaseFirstRun = () => {};

  const controller = createAdminLiveRefreshController(async () => {
    callCount += 1;

    if (callCount === 1) {
      await new Promise((resolve) => {
        releaseFirstRun = resolve;
      });
    }
  }, { debounceMs: 20 });

  controller.runNow();
  await wait(10);
  controller.schedule();
  controller.schedule();

  assert.equal(callCount, 1);

  releaseFirstRun();
  await wait(80);

  assert.equal(callCount, 2);
  controller.dispose();
});

test('stops future refreshes after dispose', async () => {
  let callCount = 0;

  const controller = createAdminLiveRefreshController(async () => {
    callCount += 1;
  }, { debounceMs: 20 });

  controller.schedule();
  controller.dispose();

  await wait(80);

  assert.equal(callCount, 0);
});
