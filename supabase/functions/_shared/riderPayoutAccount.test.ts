// Rider bank onboarding: input validation, masking, and the bank-change hold.

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { BANK_CHANGE_HOLD_HOURS, maskAccountNumber, resolveBankSubmissionHold, validateRiderBankInput } = await import(
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
  expectEqual(resolveBankSubmissionHold(null, 'RCP_1', NOW), { changed: false, holdReason: null, holdUntil: null }, 'no hold');
});

Deno.test('changing to a different account holds payouts for 24 hours', () => {
  const result = resolveBankSubmissionHold({ holdReason: null, holdUntil: null, recipientCode: 'RCP_old' }, 'RCP_new', NOW);
  expectEqual(result.changed, true, 'changed');
  expectEqual(result.holdReason, 'bank_details_changed', 'reason');
  expectEqual(result.holdUntil, new Date(NOW.getTime() + BANK_CHANGE_HOLD_HOURS * 3_600_000).toISOString(), 'until');
});

Deno.test('re-submitting the same account clears a failed-transfer hold but not a live bank-change hold', () => {
  expectEqual(
    resolveBankSubmissionHold({ holdReason: 'transfer_failed', holdUntil: 'infinity', recipientCode: 'RCP_1' }, 'RCP_1', NOW),
    { changed: false, holdReason: null, holdUntil: null },
    'failure hold cleared by confirmation'
  );
  const live = { holdReason: 'bank_details_changed', holdUntil: '2026-10-20T20:00:00.000Z', recipientCode: 'RCP_1' };
  expectEqual(
    resolveBankSubmissionHold(live, 'RCP_1', NOW),
    { changed: false, holdReason: live.holdReason, holdUntil: live.holdUntil },
    'cannot shortcut the 24h brake by re-submitting'
  );
});
