// support.ts pulls in client.ts, which throws at load without these. The
// helper under test is pure, so dummy values are enough; the dynamic import
// makes sure they are set before the module graph loads.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key');
const { shouldReopenOnCustomerMessage } = await import('./support.ts');

const check = (actual: boolean, expected: boolean, what: string) => {
  if (actual !== expected) throw new Error(`${what}: expected ${expected}, got ${actual}`);
};

Deno.test('a customer message on an open thread leaves it open', () =>
  check(shouldReopenOnCustomerMessage('open'), false, 'open'));
Deno.test('a customer message on a pending thread reopens it', () =>
  check(shouldReopenOnCustomerMessage('pending'), true, 'pending'));
Deno.test('a customer message on a closed thread reopens it', () =>
  check(shouldReopenOnCustomerMessage('closed'), true, 'closed'));
