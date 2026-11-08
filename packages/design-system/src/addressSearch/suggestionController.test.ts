/**
 * Run with: node --test --experimental-strip-types packages/design-system/src/addressSearch/suggestionController.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AddressSearchResult } from '../../../runtime/src/addressSearch.ts';
import {
  SUGGESTION_DEBOUNCE_MS,
  canSearchMapFor,
  createSuggestionController,
  moveHighlight,
  selectableResults,
  type MapSearchOutcome,
  type SuggestionTimers,
  type SuggestionView,
} from './suggestionController.ts';

const place = (label: string) => ({ label, latitude: 7.4352, longitude: 3.9133 });

/** Manual clock: `tick(ms)` fires every timer that falls due. */
const fakeTimers = () => {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const timers: SuggestionTimers = {
    set: (callback, ms) => {
      const id = nextId++;
      pending.set(id, { at: now + ms, callback });
      return id;
    },
    clear: (handle) => {
      pending.delete(handle as number);
    },
  };
  const tick = (ms: number) => {
    now += ms;
    for (const [id, entry] of [...pending.entries()].sort((a, b) => a[1].at - b[1].at)) {
      if (entry.at <= now) {
        pending.delete(id);
        entry.callback();
      }
    }
  };
  return { timers, tick, pendingCount: () => pending.size };
};

/** A search whose answers the test releases by hand, recording every call. */
const controlledSearch = () => {
  const calls: { query: string; signal: AbortSignal; resolve: (result: AddressSearchResult) => void }[] = [];
  const search = (query: string, { signal }: { signal: AbortSignal }) =>
    new Promise<AddressSearchResult>((resolve) => {
      calls.push({ query, signal, resolve });
    });
  return { search, calls };
};

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

const setup = (searchMap?: (query: string) => Promise<MapSearchOutcome>) => {
  const clock = fakeTimers();
  const { search, calls } = controlledSearch();
  const views: SuggestionView[] = [];
  const controller = createSuggestionController({
    search,
    searchMap,
    onChange: (view) => views.push(view),
    timers: clock.timers,
  });
  return { clock, calls, views, controller };
};

test('nothing is sent under three characters, and the list closes', () => {
  const { clock, calls, controller } = setup();
  controller.update('B');
  controller.update('Bo');
  clock.tick(SUGGESTION_DEBOUNCE_MS * 2);
  assert.equal(calls.length, 0);
  assert.deepEqual(controller.getView(), { kind: 'idle' });
});

test('one request after the pause, for the last text typed', () => {
  const { clock, calls, controller } = setup();
  assert.equal(SUGGESTION_DEBOUNCE_MS, 400);
  controller.update('Bod');
  clock.tick(200);
  controller.update('Bodi');
  clock.tick(399);
  assert.equal(calls.length, 0);
  clock.tick(1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.query, 'Bodi');
  assert.deepEqual(controller.getView(), { kind: 'loading', query: 'Bodi' });
});

test('results show at most five; an empty answer is the empty state', async () => {
  const { clock, calls, controller } = setup();
  controller.update('Bodija');
  clock.tick(400);
  calls[0]!.resolve({ kind: 'results', results: Array.from({ length: 7 }, (_, i) => place(`P${i}`)) });
  await flush();
  const view = controller.getView();
  assert.equal(view.kind, 'results');
  assert.equal(selectableResults(view).length, 5);

  controller.update('Bodija Zz');
  clock.tick(400);
  calls[1]!.resolve({ kind: 'results', results: [] });
  await flush();
  assert.deepEqual(controller.getView(), { kind: 'empty', query: 'Bodija Zz' });
});

test('a new keystroke aborts the request in flight and its late answer is dropped', async () => {
  const { clock, calls, controller } = setup();
  controller.update('Bodija');
  clock.tick(400);
  controller.update('Bodija Market');
  assert.equal(calls[0]!.signal.aborted, true);
  clock.tick(400);
  calls[1]!.resolve({ kind: 'results', results: [place('Bodija Market')] });
  calls[0]!.resolve({ kind: 'results', results: [place('Stale')] });
  await flush();
  assert.deepEqual(selectableResults(controller.getView()), [place('Bodija Market')]);
});

test('a whitespace-only change neither re-sends nor flashes the list', async () => {
  const { clock, calls, controller, views } = setup();
  controller.update('Bodija');
  clock.tick(400);
  calls[0]!.resolve({ kind: 'results', results: [place('A')] });
  await flush();
  const before = views.length;
  controller.update('Bodija ');
  controller.update('  Bodija');
  clock.tick(400);
  assert.equal(calls.length, 1);
  assert.equal(views.length, before);
});

test('an unavailable Worker shows the fallback state; the caller aborting does not', async () => {
  const { clock, calls, controller } = setup();
  controller.update('Bodija');
  clock.tick(400);
  calls[0]!.resolve({ kind: 'unavailable', reason: 'timeout' });
  await flush();
  assert.deepEqual(controller.getView(), { kind: 'unavailable', query: 'Bodija' });
});

test('Search the map runs once per press, with the current query, never from typing', async () => {
  const mapCalls: string[] = [];
  let release: (outcome: MapSearchOutcome) => void = () => {};
  const { clock, calls, controller } = setup((query) => {
    mapCalls.push(query);
    return new Promise((resolve) => {
      release = resolve;
    });
  });

  controller.update('Ring Road');
  clock.tick(400);
  calls[0]!.resolve({ kind: 'unavailable', reason: 'http' });
  await flush();
  assert.equal(mapCalls.length, 0);

  controller.searchMap();
  controller.searchMap();
  assert.deepEqual(mapCalls, ['Ring Road']);
  assert.deepEqual(controller.getView(), { kind: 'map-loading', query: 'Ring Road' });

  release({ kind: 'results', results: [place('Ring Road, Ibadan'), place('Ring Road, Lagos')] });
  await flush();
  const view = controller.getView();
  assert.equal(view.kind, 'map-results');
  assert.equal(selectableResults(view).length, 2);
});

test('the fallback reports nothing found and outright failure separately', async () => {
  let next: MapSearchOutcome = { kind: 'results', results: [] };
  const { controller } = setup(async () => next);
  controller.update('Ring Road');
  controller.searchMap();
  await flush();
  assert.deepEqual(controller.getView(), { kind: 'map-empty', query: 'Ring Road' });

  next = { kind: 'failed' };
  controller.searchMap();
  await flush();
  assert.deepEqual(controller.getView(), { kind: 'map-failed', query: 'Ring Road' });
});

test('typing during a map search drops its answer', async () => {
  let release: (outcome: MapSearchOutcome) => void = () => {};
  const { clock, calls, controller } = setup(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  controller.update('Ring Road');
  controller.searchMap();
  controller.update('Ring Road Ibadan');
  // The map answer belonged to the old text, so its spinner goes at once.
  assert.deepEqual(controller.getView(), { kind: 'idle' });
  release({ kind: 'results', results: [place('Old')] });
  await flush();
  assert.deepEqual(controller.getView(), { kind: 'idle' });
  clock.tick(400);
  assert.equal(calls.at(-1)!.query, 'Ring Road Ibadan');
  assert.deepEqual(controller.getView(), { kind: 'loading', query: 'Ring Road Ibadan' });
});

test('Search the map does nothing without a query or a fallback', () => {
  const noFallback = setup();
  noFallback.controller.update('Ring Road');
  noFallback.controller.searchMap();
  assert.notEqual(noFallback.controller.getView().kind, 'map-loading');

  const noQuery = setup(async () => ({ kind: 'failed' }));
  noQuery.controller.searchMap();
  assert.deepEqual(noQuery.controller.getView(), { kind: 'idle' });
});

test('reset and dispose cancel everything that is pending', () => {
  const { clock, calls, controller } = setup();
  controller.update('Bodija');
  controller.reset();
  clock.tick(400);
  assert.equal(calls.length, 0);
  assert.equal(clock.pendingCount(), 0);
  assert.deepEqual(controller.getView(), { kind: 'idle' });

  controller.update('Bodija');
  clock.tick(400);
  controller.dispose();
  assert.equal(calls[0]!.signal.aborted, true);
});

test('moveHighlight steps through the rows without wrapping', () => {
  assert.equal(moveHighlight(-1, 'down', 3), 0);
  assert.equal(moveHighlight(0, 'down', 3), 1);
  assert.equal(moveHighlight(2, 'down', 3), 2);
  assert.equal(moveHighlight(2, 'up', 3), 1);
  assert.equal(moveHighlight(0, 'up', 3), -1);
  assert.equal(moveHighlight(-1, 'up', 3), -1);
  assert.equal(moveHighlight(1, 'down', 0), -1);
});

test('Search the map is not offered or run below four characters', async () => {
  assert.equal(canSearchMapFor('Yab'), false);
  assert.equal(canSearchMapFor(' Yab '), false);
  assert.equal(canSearchMapFor('Yaba'), true);
  assert.equal(canSearchMapFor(null), false);

  const mapCalls: string[] = [];
  const { clock, calls, controller } = setup(async (query) => {
    mapCalls.push(query);
    return { kind: 'failed' };
  });
  controller.update('Yab');
  clock.tick(400);
  calls[0]!.resolve({ kind: 'unavailable', reason: 'http' });
  await flush();
  controller.searchMap();
  assert.deepEqual(mapCalls, []);
  assert.deepEqual(controller.getView(), { kind: 'unavailable', query: 'Yab' });
});
