// assertUploadAllowed is pure, but rateLimit.ts imports client.ts (via
// enforceDispatchRateLimit), which throws at module scope without these env
// vars, so they are set before a dynamic import. Runs in the --no-check list.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { assertUploadAllowed } = await import('./rateLimit.ts');

const statusOf = (fn: () => void): number | null => {
  try {
    fn();
    return null;
    // deno-lint-ignore no-explicit-any
  } catch (e: any) {
    return e?.status ?? -1;
  }
};

const MAX = 5_000_000;

Deno.test('rejects a non-image mime with 400', () => {
  const status = statusOf(() => assertUploadAllowed({ contentType: 'application/pdf', base64: 'AAAA', maxBytes: MAX }));
  if (status !== 400) throw new Error(`expected 400, got ${status}`);
});

Deno.test('rejects a missing mime with 400 (no default to an allowed type)', () => {
  for (const contentType of [undefined, null, '']) {
    const status = statusOf(() => assertUploadAllowed({ contentType, base64: 'AAAA', maxBytes: MAX }));
    if (status !== 400) throw new Error(`expected 400 for ${String(contentType)}, got ${status}`);
  }
});

Deno.test('rejects an oversize payload with 400', () => {
  const big = 'A'.repeat(8_000_000); // ~6 MB decoded
  const status = statusOf(() => assertUploadAllowed({ contentType: 'image/png', base64: big, maxBytes: MAX }));
  if (status !== 400) throw new Error(`expected 400, got ${status}`);
});

Deno.test('rejects an empty payload with 400', () => {
  const status = statusOf(() => assertUploadAllowed({ contentType: 'image/png', base64: '', maxBytes: MAX }));
  if (status !== 400) throw new Error(`expected 400, got ${status}`);
});

Deno.test('accepts small jpeg/png/webp, tolerating case and mime parameters', () => {
  for (const contentType of ['image/jpeg', 'image/PNG', 'image/webp; charset=binary']) {
    const status = statusOf(() => assertUploadAllowed({ contentType, base64: 'AAAA', maxBytes: MAX }));
    if (status !== null) throw new Error(`expected pass for ${contentType}, got ${status}`);
  }
});
