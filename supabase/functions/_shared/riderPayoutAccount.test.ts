// Rider bank onboarding: input validation, masking, and the bank-change hold.

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const {
  BANK_CHANGE_HOLD_HOURS,
  maskAccountNumber,
  resolveBankSubmissionHold,
  resolveEffectiveHold,
  validateRiderBankInput,
} = await import(
  './riderPayoutAccount.ts'
);

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const NOW = new Date('2026-10-20T08:00:00.000Z');

Deno.test('bank input: 10-digit NUBAN and a bank code are required; spaces are tolerated', () => {
  expectEqual(validateRiderBankInput({ accountNumber: '0123 456 789', bankCode: '058' }), {
    accountNumber: '0123456789',
    bankCode: '058',
    bankName: null,
  }, 'valid');
  expectEqual('error' in validateRiderBankInput({ accountNumber: '12345', bankCode: '058' }), true, 'short number');
  expectEqual('error' in validateRiderBankInput({ accountNumber: '0123456789', bankCode: '' }), true, 'no bank');
  expectEqual('error' in validateRiderBankInput({ accountNumber: '01234567890', bankCode: '058' }), true, '11 digits');
  expectEqual('error' in validateRiderBankInput({ accountNumber: '0123456789', bankCode: '05;8' }), true, 'bad code');
});

Deno.test('only the last four digits are ever stored', () => {
  expectEqual(maskAccountNumber('0123456789'), '******6789', 'masked');
});

Deno.test('first submission is not held', () => {
  expectEqual(
    resolveBankSubmissionHold(null, 'RCP_1', NOW),
    { bankChangedAt: null, changed: false, holdReason: null, holdUntil: null },
    'no hold'
  );
});

Deno.test('changing to a different account stamps bankChangedAt (24h brake)', () => {
  const result = resolveBankSubmissionHold({ bankChangedAt: null, recipientCode: 'RCP_old' }, 'RCP_new', NOW);
  expectEqual(result, { bankChangedAt: NOW.toISOString(), changed: true, holdReason: null, holdUntil: null }, 'stamped');
  expectEqual(BANK_CHANGE_HOLD_HOURS, 24, '24h brake');
});

Deno.test('a failed transfer then a same-account re-submit cannot shortcut the bank-change brake', () => {
  // Rider switched bank an hour ago, then a transfer failed (settle wrote the
  // failure hold), then the rider re-submits the SAME (new) account.
  const changedAt = new Date(NOW.getTime() - 3_600_000).toISOString();
  const resubmit = resolveBankSubmissionHold({ bankChangedAt: changedAt, recipientCode: 'RCP_new' }, 'RCP_new', NOW);
  expectEqual(resubmit, { bankChangedAt: changedAt, changed: false, holdReason: null, holdUntil: null }, 'brake kept');
  const effective = resolveEffectiveHold({ bankChangedAt: resubmit.bankChangedAt, holdReason: null, holdUntil: null }, NOW);
  expectEqual(effective.holdReason, 'bank_details_changed', 'still held');
  expectEqual(effective.holdUntil, new Date(Date.parse(changedAt) + 24 * 3_600_000).toISOString(), 'until change + 24h');
});

Deno.test('effective hold is the later of the two; an infinite failure hold wins', () => {
  const changedAt = new Date(NOW.getTime() - 3_600_000).toISOString();
  expectEqual(
    resolveEffectiveHold({ bankChangedAt: changedAt, holdReason: 'transfer_failed', holdUntil: 'infinity' }, NOW),
    { holdReason: 'transfer_failed', holdUntil: 'infinity' },
    'failure hold wins'
  );
  expectEqual(
    resolveEffectiveHold({ bankChangedAt: '2026-10-01T00:00:00.000Z', holdReason: null, holdUntil: null }, NOW),
    { holdReason: null, holdUntil: null },
    'expired brake'
  );
});

Deno.test('admin delivery-provider input accepts only the two exact values', async () => {
  const { parseDeliveryProviderInput } = await import('./restaurantDeliveryProviderAdmin.ts');
  expectEqual(parseDeliveryProviderInput('platform'), 'platform', 'platform');
  expectEqual(parseDeliveryProviderInput('restaurant'), 'restaurant', 'restaurant');
  expectEqual(parseDeliveryProviderInput('PLATFORM'), null, 'case-sensitive');
  expectEqual(parseDeliveryProviderInput(true), null, 'non-string');
});
