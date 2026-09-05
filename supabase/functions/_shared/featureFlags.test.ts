Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { normalizeFeatureFlagMap, isFeatureEnabled } = await import('./featureFlags.ts');

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

Deno.test('normalizeFeatureFlagMap defaults unknown rows to false', () => {
  const flags = normalizeFeatureFlagMap([
    { enabled: true, key: 'risky_flow' },
    { enabled: false, key: 'dark_launch' },
    { enabled: true, key: '' },
    null,
  ]);

  expectEqual(flags.risky_flow, true, 'enabled flag stays true');
  expectEqual(flags.dark_launch, false, 'disabled flag stays false');
  expectEqual(isFeatureEnabled(flags, 'missing_flag'), false, 'missing flag defaults off');
});
