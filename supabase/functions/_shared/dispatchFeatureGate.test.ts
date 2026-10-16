// Auto-dispatch is gated behind the `platform_dispatch` feature flag. With the
// flag absent (the default until the pilot) it must be a complete no-op: no
// candidate load, no events, no admin notifications.
//
// Env stubs MUST be set before the dynamic import: client.ts reads them at
// module load and throws if they are missing.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

const { runAutomaticDispatchAssignment } = await import('./dispatchSelection.ts');
const { serviceClient } = await import('./client.ts');

const originalFrom = serviceClient.from.bind(serviceClient);

Deno.test('auto-dispatch is a no-op when the platform_dispatch flag is off', async () => {
  const tablesTouched: string[] = [];
  let weightsLoaded = 0;

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    tablesTouched.push(table);
    if (table === 'FeatureFlag') {
      // Flag row absent => disabled.
      return { select: () => ({ returns: async () => ({ data: [], error: null }) }) };
    }
    throw new Error(`dispatchFeatureGate.test.ts: auto-dispatch must not touch "${table}" while the flag is off`);
  };

  try {
    const order = {
      fulfillmentType: 'delivery',
      id: 'o1',
      restaurantId: 'r1',
      status: 'ready_for_pickup',
    } as never;

    const result = await runAutomaticDispatchAssignment(order, null, 'actor', 'ready_for_pickup', async () => {
      weightsLoaded += 1;
      return { load: 1, distance: 0.15 } as never;
    });

    assertEquals(result.outcome, 'skipped');
    assertEquals(weightsLoaded, 0);
    assertEquals(tablesTouched, ['FeatureFlag']);
  } finally {
    // deno-lint-ignore no-explicit-any
    (serviceClient as any).from = originalFrom;
  }
});

Deno.test('a non-delivery order short-circuits before reading the flag', async () => {
  const tablesTouched: string[] = [];

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    tablesTouched.push(table);
    throw new Error(`dispatchFeatureGate.test.ts: pickup order must not read "${table}"`);
  };

  try {
    const order = { fulfillmentType: 'pickup', id: 'o2', restaurantId: 'r1', status: 'ready_for_pickup' } as never;
    const result = await runAutomaticDispatchAssignment(order, null, 'actor', 'ready_for_pickup', async () => {
      throw new Error('weights must not load');
    });
    assertEquals(result.outcome, 'skipped');
    assertEquals(tablesTouched, []);
  } finally {
    // deno-lint-ignore no-explicit-any
    (serviceClient as any).from = originalFrom;
  }
});
