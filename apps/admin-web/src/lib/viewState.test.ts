/**
 * Run with: node --test --experimental-strip-types apps/admin-web/src/lib/viewState.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveViewState, type ViewState } from './viewState.ts';

test('first load shows loading, never an empty state', () => {
  assert.equal(resolveViewState({ hasData: false, error: null }), 'loading');
  assert.equal(resolveViewState({ hasData: false, error: null, isEmpty: true }), 'loading');
});

test('a failed fetch shows the error, not zeros', () => {
  // The regression this guards: SnapshotContext keeps EMPTY_SNAPSHOT on the
  // catch path, so the page is handed a snapshot full of zeros that looks
  // exactly like a platform with no orders.
  assert.equal(resolveViewState({ hasData: false, error: 'boom' }), 'error');
  assert.equal(resolveViewState({ hasData: false, error: 'boom', isEmpty: true }), 'error');
});

test('arrived data renders: empty only when it really is empty', () => {
  assert.equal(resolveViewState({ hasData: true, error: null, isEmpty: true }), 'empty');
  assert.equal(resolveViewState({ hasData: true, error: null, isEmpty: false }), 'ready');
  assert.equal(resolveViewState({ hasData: true, error: null }), 'ready');
});

test('a failed refresh never blanks data already on screen', () => {
  // Stale-but-real data plus the banner beats an empty shell.
  assert.equal(resolveViewState({ hasData: true, error: 'poll failed' }), 'ready');
  assert.equal(resolveViewState({ hasData: true, error: 'poll failed', isEmpty: true }), 'empty');
});

test('every input resolves to exactly one of the four states', () => {
  const states: ViewState[] = ['loading', 'error', 'empty', 'ready'];

  for (const hasData of [true, false]) {
    for (const error of [null, 'boom']) {
      for (const isEmpty of [true, false, undefined]) {
        const state = resolveViewState({ hasData, error, isEmpty });
        assert.ok(states.includes(state), `unexpected state ${state}`);
        // The exclusivity the audit found violated: an empty state is only
        // ever reachable once real data has arrived and is genuinely empty.
        if (state === 'empty') {
          assert.equal(hasData, true);
          assert.equal(isEmpty, true);
        }
      }
    }
  }
});
