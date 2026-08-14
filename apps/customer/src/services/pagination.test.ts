/**
 * Run with: node --test --experimental-strip-types apps/customer/src/services/pagination.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchAllPages, type Page } from './pagination.ts';

type Card = { id: string };

const buildPager = (allIds: string[], pageSize: number) => {
  const calls: (string | undefined)[] = [];

  const fetchPage = async (cursor: string | undefined): Promise<Page<Card>> => {
    calls.push(cursor);
    const startIndex = cursor ? allIds.indexOf(cursor) + 1 : 0;
    const slice = allIds.slice(startIndex, startIndex + pageSize);
    const nextIndex = startIndex + slice.length;
    const nextCursor = slice.length > 0 && nextIndex < allIds.length ? slice[slice.length - 1] : null;
    return { restaurants: slice.map((id) => ({ id })), nextCursor };
  };

  return { fetchPage, calls };
};

test('a single page under the page size makes exactly one call and returns everything', async () => {
  const { fetchPage, calls } = buildPager(['a', 'b', 'c'], 50);
  const result = await fetchAllPages(fetchPage);
  assert.deepEqual(result.map((r) => r.id), ['a', 'b', 'c']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], undefined);
});

test('follows nextCursor across multiple pages until exhausted, concatenating in order', async () => {
  const ids = Array.from({ length: 120 }, (_, i) => `r${String(i).padStart(3, '0')}`);
  const { fetchPage, calls } = buildPager(ids, 50);

  const result = await fetchAllPages(fetchPage);

  assert.equal(result.length, 120);
  assert.equal(result[0].id, 'r000');
  assert.equal(result[119].id, 'r119');
  // 3 pages: 50 + 50 + 20.
  assert.equal(calls.length, 3);
  assert.equal(calls[0], undefined);
});

test('an empty page stops the loop immediately, even if a cursor was still set', async () => {
  let callCount = 0;
  const fetchPage = async (): Promise<Page<Card>> => {
    callCount += 1;
    // Pathological: server bug returning a non-null cursor with no rows.
    // Must not spin forever chasing it.
    return { restaurants: [], nextCursor: 'still-more-allegedly' };
  };

  const result = await fetchAllPages(fetchPage);
  assert.deepEqual(result, []);
  assert.equal(callCount, 1);
});

test('a server that never sets nextCursor to null is bounded, not infinite', async () => {
  let callCount = 0;
  const fetchPage = async (): Promise<Page<Card>> => {
    callCount += 1;
    return { restaurants: [{ id: `page-${callCount}` }], nextCursor: 'always-more' };
  };

  const result = await fetchAllPages(fetchPage);
  // Bounded by the safety cap, not infinite — exact count just has to be finite and match the cap.
  assert.ok(callCount <= 40);
  assert.equal(result.length, callCount);
});

test('an unrecognized cursor coming back as an exhausted (empty) page is tolerated, not retried', async () => {
  // Mirrors catalog.ts's paginateRestaurants: a cursor pointing at a row that
  // no longer exists (deleted/unpublished between calls) returns an empty
  // page with nextCursor: null, indistinguishable from genuine exhaustion.
  const ids = ['a', 'b'];
  let calls = 0;
  const fetchPage = async (cursor: string | undefined): Promise<Page<Card>> => {
    calls += 1;
    if (calls === 1) {
      return { restaurants: ids.map((id) => ({ id })), nextCursor: 'now-deleted-row' };
    }
    // Second call: the cursor from page 1 no longer resolves.
    return { restaurants: [], nextCursor: null };
  };

  const result = await fetchAllPages(fetchPage);
  assert.deepEqual(result.map((r) => r.id), ['a', 'b']);
  assert.equal(calls, 2);
});
