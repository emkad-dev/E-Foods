Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

import { assertEquals } from 'jsr:@std/assert';

const [
  {
    captureOrderPlacementRiskSignals,
    capturePaymentVerificationFailureSignal,
    capturePaymentVerificationReplaySignal,
    capturePaymentVerificationRiskSignals,
    captureRefundAbuseSignals,
  },
  { serviceClient },
] = await Promise.all([import('./riskSignals.ts'), import('./client.ts')]);

type MockRow = Record<string, unknown>;

const installMockFrom = (rowsByTable: Record<string, MockRow[]>, writes: MockRow[]) => {
  const originalFrom = serviceClient.from.bind(serviceClient);

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    if (table === 'RiskEvent') {
      return {
        upsert: async (payload: MockRow) => {
          writes.push(payload);
          return { error: null };
        },
      };
    }

    const rows = rowsByTable[table] ?? [];
    const query = {
      eq: () => query,
      gte: () => query,
      lt: () => query,
      returns: () =>
        Promise.resolve({
          data: rows,
          error: null,
        }),
      then: (resolve: (value: { data: MockRow[]; error: null }) => unknown, reject?: (reason?: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve, reject),
    };

    return {
      select: () => query,
    };
  };

  return () => {
    // deno-lint-ignore no-explicit-any
    (serviceClient as any).from = originalFrom;
  };
};

Deno.test('captureOrderPlacementRiskSignals records account and device velocity', async () => {
  const writes: MockRow[] = [];
  const restore = installMockFrom(
    {
      CustomerOrder: Array.from({ length: 8 }, (_, index) => ({
        createdAt: `2026-08-27T09:0${index}:00.000Z`,
        customerId: 'customer-1',
        payment: { deviceSessionId: 'device-1' },
        status: 'placed',
        updatedAt: `2026-08-27T09:0${index}:00.000Z`,
      })),
    },
    writes
  );

  try {
    await captureOrderPlacementRiskSignals({
      customerId: 'customer-1',
      deviceSessionId: 'device-1',
      orderId: 'order-8',
    });
  } finally {
    restore();
  }

  assertEquals(writes.map((row) => row.eventType).sort(), ['account_velocity', 'device_velocity']);
  assertEquals(writes.find((row) => row.eventType === 'account_velocity')?.severity, 'high');
  assertEquals(writes.find((row) => row.eventType === 'device_velocity')?.severity, 'medium');
});

Deno.test('capturePaymentVerificationRiskSignals records card velocity', async () => {
  const writes: MockRow[] = [];
  const restore = installMockFrom(
    {
      PaymentTransaction: Array.from({ length: 6 }, (_, index) => ({
        createdAt: `2026-08-27T10:0${index}:00.000Z`,
        customerId: 'customer-1',
        orderId: `order-${index + 1}`,
        reference: `ref-${index + 1}`,
        webhookEvent: {
          data: {
            authorization: {
              authorization_code: 'AUTH-123',
            },
          },
        },
      })),
    },
    writes
  );

  try {
    await capturePaymentVerificationRiskSignals({
      customerId: 'customer-1',
      orderId: 'order-6',
      paymentReference: 'ref-6',
      transactionData: {
        data: {
          authorization: {
            authorization_code: 'AUTH-123',
          },
        },
      },
    });
  } finally {
    restore();
  }

  assertEquals(writes.length, 1);
  assertEquals(writes[0].eventType, 'card_velocity');
  assertEquals(writes[0].severity, 'high');
});

Deno.test('capturePaymentVerificationReplaySignal and failure signals record terminal events', async () => {
  const writes: MockRow[] = [];
  const restore = installMockFrom({}, writes);

  try {
    await capturePaymentVerificationReplaySignal({
      orderId: 'order-1',
      paymentReference: 'ref-1',
    });

    await capturePaymentVerificationFailureSignal({
      orderId: 'order-1',
      paymentReference: 'ref-1',
      reason: 'timeout waiting for Paystack',
      retryCount: 5,
    });
  } finally {
    restore();
  }

  assertEquals(writes.map((row) => row.eventType), [
    'payment_verification_replay',
    'payment_verification_failure',
  ]);
  assertEquals(writes[0].severity, 'medium');
  assertEquals(writes[1].severity, 'high');
});

Deno.test('captureRefundAbuseSignals records repeated refund abuse', async () => {
  const writes: MockRow[] = [];
  const restore = installMockFrom(
    {
      CustomerOrder: [
        {
          createdAt: '2026-08-27T07:00:00.000Z',
          customerId: 'customer-9',
          payment: { refundedAt: '2026-08-27T08:00:00.000Z', refundAmount: 18 },
          status: 'cancelled',
          updatedAt: '2026-08-27T08:00:00.000Z',
        },
        {
          createdAt: '2026-08-27T08:00:00.000Z',
          customerId: 'customer-9',
          payment: { refundedAt: '2026-08-27T08:30:00.000Z', refundAmount: 18 },
          status: 'cancelled',
          updatedAt: '2026-08-27T08:30:00.000Z',
        },
        {
          createdAt: '2026-08-27T09:00:00.000Z',
          customerId: 'customer-9',
          payment: { refundedAt: '2026-08-27T09:30:00.000Z', refundAmount: 18 },
          status: 'cancelled',
          updatedAt: '2026-08-27T09:30:00.000Z',
        },
      ],
    },
    writes
  );

  try {
    await captureRefundAbuseSignals({
      customerId: 'customer-9',
      orderId: 'order-3',
    });
  } finally {
    restore();
  }

  assertEquals(writes.length, 1);
  assertEquals(writes[0].eventType, 'refund_abuse');
  assertEquals(writes[0].severity, 'medium');
});
