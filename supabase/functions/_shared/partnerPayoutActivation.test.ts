import { resolvePayoutActivationPlan } from './partnerPayoutActivation.ts';

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
};

Deno.test('a missing payout row blocks approval', () => {
  for (const raw of [null, undefined]) {
    const plan = resolvePayoutActivationPlan(raw);
    expectEqual(plan.action, 'blocked', `action for ${JSON.stringify(raw)}`);
    expectEqual(plan.action === 'blocked' ? plan.httpStatus : null, 412, 'httpStatus');
  }
});

Deno.test('a payout row with no subaccount code creates one', () => {
  const plan = resolvePayoutActivationPlan({ paystackSubaccountCode: null, status: 'pending' });
  expectEqual(plan.action, 'create', 'action');
});

Deno.test('a blank subaccount code is treated as absent, not reused', () => {
  for (const raw of ['', '   ']) {
    const plan = resolvePayoutActivationPlan({ paystackSubaccountCode: raw, status: 'pending' });
    expectEqual(plan.action, 'create', `action for ${JSON.stringify(raw)}`);
  }
});

Deno.test('an existing subaccount code is reused, never re-created', () => {
  const plan = resolvePayoutActivationPlan({ paystackSubaccountCode: 'ACCT_x1y2', status: 'pending' });
  expectEqual(plan.action, 'reuse', 'action');
  expectEqual(plan.action === 'reuse' ? plan.subaccountCode : null, 'ACCT_x1y2', 'subaccountCode');
});

Deno.test('an already-active payout still reuses rather than re-creating', () => {
  const plan = resolvePayoutActivationPlan({ paystackSubaccountCode: 'ACCT_x1y2', status: 'active' });
  expectEqual(plan.action, 'reuse', 'action');
});

Deno.test('a previously failed payout with no code retries creation', () => {
  const plan = resolvePayoutActivationPlan({ paystackSubaccountCode: null, status: 'failed' });
  expectEqual(plan.action, 'create', 'action');
});
