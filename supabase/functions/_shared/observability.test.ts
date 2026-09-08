import { ClientSafeError, clientErrorExtras } from './observability.ts';

Deno.test('ClientSafeError keeps the two-argument form working', () => {
  const error = new ClientSafeError(401, 'Please sign in.');
  if (error.status !== 401) throw new Error('status should be 401');
  if (error.message !== 'Please sign in.') throw new Error('message should round-trip');
  if (error.code !== undefined) throw new Error('code should be undefined');
});

Deno.test('ClientSafeError carries code and details', () => {
  const error = new ClientSafeError(403, 'Scheduled for deletion.', {
    code: 'ACCOUNT_PENDING_DELETION',
    details: { purgeScheduledAt: '2026-09-06T00:00:00.000Z' },
  });
  if (error.code !== 'ACCOUNT_PENDING_DELETION') throw new Error('code should round-trip');
  if (error.details?.purgeScheduledAt !== '2026-09-06T00:00:00.000Z') {
    throw new Error('details should round-trip');
  }
});

Deno.test('clientErrorExtras surfaces code and details for a 4xx', () => {
  const extras = clientErrorExtras(
    new ClientSafeError(403, 'nope', { code: 'ACCOUNT_PENDING_DELETION', details: { a: 1 } })
  );
  if (extras.code !== 'ACCOUNT_PENDING_DELETION') throw new Error('should expose code');
  if ((extras.details as { a?: number })?.a !== 1) throw new Error('should expose details');
});

Deno.test('clientErrorExtras hides everything for a 5xx', () => {
  const extras = clientErrorExtras(new ClientSafeError(500, 'boom', { code: 'INTERNAL' }));
  if (extras.code !== undefined) throw new Error('5xx must not expose a code');
});

Deno.test('clientErrorExtras returns nothing for a plain Error', () => {
  const extras = clientErrorExtras(new Error('plain'));
  if (Object.keys(extras).length !== 0) throw new Error('plain errors expose nothing');
});
