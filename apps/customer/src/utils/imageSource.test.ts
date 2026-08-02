/**
 * Run with: node --test --experimental-strip-types apps/customer/src/utils/imageSource.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildImageCandidates } from './imageSource.ts';

const TRANSFORMED =
  'https://img.feasty.com.ng/cdn-cgi/image/format=auto,quality=78,width=800,onerror=redirect/https://rgfbheorvtolixdcpjhy.supabase.co/storage/v1/object/public/restaurant-assets/logos/abc/1.jpg';
const ORIGINAL =
  'https://rgfbheorvtolixdcpjhy.supabase.co/storage/v1/object/public/restaurant-assets/logos/abc/1.jpg';

test('falls back from a transformation URL to the original it wraps', () => {
  assert.deepEqual(buildImageCandidates(TRANSFORMED), [TRANSFORMED, ORIGINAL]);
});

test('keeps query strings and encoded characters in the wrapped original', () => {
  const original = 'https://cdn.example.com/a%20b.jpg?v=2';
  const wrapped = `https://img.feasty.com.ng/cdn-cgi/image/width=800/${original}`;
  assert.deepEqual(buildImageCandidates(wrapped), [wrapped, original]);
});

test('offers a plain URL as its only candidate', () => {
  assert.deepEqual(buildImageCandidates('https://cheflolaskitchen.com/eba.webp'), [
    'https://cheflolaskitchen.com/eba.webp',
  ]);
});

test('returns no candidates for empty input', () => {
  assert.deepEqual(buildImageCandidates(null), []);
  assert.deepEqual(buildImageCandidates(undefined), []);
  assert.deepEqual(buildImageCandidates(''), []);
  assert.deepEqual(buildImageCandidates('   '), []);
});

test('does not invent a fallback when the wrapped source is not an absolute URL', () => {
  const relative = 'https://img.feasty.com.ng/cdn-cgi/image/width=800/local/a.jpg';
  assert.deepEqual(buildImageCandidates(relative), [relative]);
});

test('ignores a cdn-cgi path that is not an image transformation', () => {
  const trace = 'https://img.feasty.com.ng/cdn-cgi/trace/https://example.com/a.jpg';
  assert.deepEqual(buildImageCandidates(trace), [trace]);
});
