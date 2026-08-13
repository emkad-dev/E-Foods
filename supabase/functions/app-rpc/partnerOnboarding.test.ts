import { assertEquals, assertRejects } from 'jsr:@std/assert';
import {
  buildPaystackSubaccountPayload,
  finalizePartnerApproval,
  shouldAttachPartnerSubaccount,
} from '../_shared/partnerOnboarding.ts';

Deno.test('approval activation reuses an existing subaccount code', async () => {
  let creatorCalls = 0;

  const result = await finalizePartnerApproval({
    existingSubaccountCode: 'SUB_123',
    paystackBankCode: '058',
    paystackBankName: 'GTBank',
    accountNumber: '0123456789',
    resolvedAccountName: 'Example Restaurant',
    createSubaccount: async () => {
      creatorCalls += 1;
      return 'SUB_SHOULD_NOT_BE_USED';
    },
  });

  assertEquals(result.paystackSubaccountCode, 'SUB_123');
  assertEquals(result.created, false);
  // Idempotency: a stored code must never trigger a second Paystack create.
  assertEquals(creatorCalls, 0);
});

Deno.test('approval activation creates a subaccount when none is stored', async () => {
  const seen: string[] = [];

  const result = await finalizePartnerApproval({
    existingSubaccountCode: null,
    paystackBankCode: '058',
    paystackBankName: 'GTBank',
    accountNumber: '0123456789',
    resolvedAccountName: 'Example Restaurant',
    percentageCharge: 0,
    createSubaccount: async (payload) => {
      seen.push(payload.business_name);
      return 'SUB_NEW_1';
    },
  });

  assertEquals(result.paystackSubaccountCode, 'SUB_NEW_1');
  assertEquals(result.created, true);
  assertEquals(seen, ['Example Restaurant']);
});

Deno.test('approval activation refuses to create without an injected creator', async () => {
  await assertRejects(
    () =>
      finalizePartnerApproval({
        existingSubaccountCode: null,
        paystackBankCode: '058',
        paystackBankName: 'GTBank',
        accountNumber: '0123456789',
        resolvedAccountName: 'Example Restaurant',
      }),
    Error,
    'subaccount creator is required'
  );
});

Deno.test('payment initialization only attaches an active subaccount', () => {
  assertEquals(
    shouldAttachPartnerSubaccount({ status: 'active', paystackSubaccountCode: 'SUB_123' }),
    true
  );
});

Deno.test('payment initialization skips inactive or codeless payout profiles', () => {
  assertEquals(shouldAttachPartnerSubaccount({ status: 'pending', paystackSubaccountCode: 'SUB_1' }), false);
  assertEquals(shouldAttachPartnerSubaccount({ status: 'active', paystackSubaccountCode: '' }), false);
  assertEquals(shouldAttachPartnerSubaccount({ status: 'active', paystackSubaccountCode: null }), false);
  assertEquals(shouldAttachPartnerSubaccount(null), false);
  assertEquals(shouldAttachPartnerSubaccount(undefined), false);
});

Deno.test('subaccount payload maps onboarding fields to Paystack field names', () => {
  assertEquals(
    buildPaystackSubaccountPayload({
      accountNumber: '0123 456 789',
      bankCode: '058',
      businessName: 'Example Restaurant',
      percentageCharge: 0,
    }),
    {
      account_number: '0123456789',
      business_name: 'Example Restaurant',
      settlement_bank: '058',
      percentage_charge: 0,
    }
  );
});

Deno.test('subaccount payload rejects an out-of-range percentage', () => {
  let threw = false;
  try {
    buildPaystackSubaccountPayload({
      accountNumber: '0123456789',
      bankCode: '058',
      businessName: 'Example Restaurant',
      percentageCharge: 250,
    });
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});
