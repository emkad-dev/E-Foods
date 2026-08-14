import { assertAccountAccessible } from './request-context.ts';

const base = { uid: 'u1', email: 'a@b.co', role: 'customer' };

Deno.test('a healthy account passes', () => {
  assertAccountAccessible({ ...base, accountDisabled: false, deletionRequestedAt: null });
});

Deno.test('a disabled account is rejected with 403', () => {
  try {
    assertAccountAccessible({ ...base, accountDisabled: true, deletionRequestedAt: null });
  } catch (error) {
    if ((error as { status?: number }).status !== 403) throw new Error('should be 403');
    return;
  }
  throw new Error('should have thrown');
});

Deno.test('a pending-deletion account is rejected with the code and purge date', () => {
  try {
    assertAccountAccessible({
      ...base,
      accountDisabled: false,
      deletionRequestedAt: '2026-08-07T00:00:00.000Z',
      purgeScheduledAt: '2026-09-06T00:00:00.000Z',
    });
  } catch (error) {
    const typed = error as { status?: number; code?: string; details?: Record<string, unknown> };
    if (typed.status !== 403) throw new Error('should be 403');
    if (typed.code !== 'ACCOUNT_PENDING_DELETION') throw new Error('should carry the code');
    if (typed.details?.purgeScheduledAt !== '2026-09-06T00:00:00.000Z') {
      throw new Error('should carry the purge date');
    }
    return;
  }
  throw new Error('should have thrown');
});

Deno.test('the exemption lets a pending-deletion account through', () => {
  assertAccountAccessible(
    { ...base, accountDisabled: false, deletionRequestedAt: '2026-08-07T00:00:00.000Z' },
    { allowPendingDeletion: true }
  );
});

Deno.test('the exemption does NOT rescue a disabled account', () => {
  try {
    assertAccountAccessible(
      { ...base, accountDisabled: true, deletionRequestedAt: '2026-08-07T00:00:00.000Z' },
      { allowPendingDeletion: true }
    );
  } catch (error) {
    // Disabled is checked first, so this is the disabled rejection, not the
    // deletion one — it must NOT carry the pending-deletion code.
    if ((error as { status?: number }).status !== 403) throw new Error('should be 403');
    if ((error as { code?: string }).code !== undefined) {
      throw new Error('disabled rejection must not carry ACCOUNT_PENDING_DELETION');
    }
    return;
  }
  throw new Error('should have thrown');
});
