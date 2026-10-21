// --no-check group: drainerHeartbeat.ts imports _shared/client.ts, which throws
// at module scope without these env vars.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { DRAINER_STALE_AFTER_MS, evaluateDrainerHeartbeat } = await import('./drainerHeartbeat.ts');

const assertEquals = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const NOW = Date.parse('2026-10-21T12:00:00.000Z');

Deno.test('a recent heartbeat is healthy', () => {
  assertEquals(evaluateDrainerHeartbeat('2026-10-21T11:59:00.000Z', NOW), { ageMs: 60_000, stale: false });
});

Deno.test('a heartbeat older than 5 minutes is stale', () => {
  const lastRunAt = new Date(NOW - DRAINER_STALE_AFTER_MS - 1).toISOString();
  assertEquals(evaluateDrainerHeartbeat(lastRunAt, NOW).stale, true);
});

Deno.test('a missing heartbeat is unknown, not stale (no false alarm before deploy)', () => {
  assertEquals(evaluateDrainerHeartbeat(null, NOW), { ageMs: null, stale: false });
  assertEquals(evaluateDrainerHeartbeat('not a date', NOW), { ageMs: null, stale: false });
});
