// Rider pay, part 3: transfer webhooks - state transitions and redelivery.

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { handleRiderTransferWebhook, isTransferEvent } = await import('./transfers.ts');
const { runRiderPayouts } = await import('../_shared/riderPayouts.ts');
const { createTestLedger } = await import('../_shared/riderPayoutsTestLedger.ts');

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

// One rider, two earnings, one payout in flight.
const setup = async () => {
  const { deps, ledger } = createTestLedger();
  ledger.addRecipient('r1');
  ledger.addEarning('r1', 1_500);
  ledger.addEarning('r1', 1_000);
  await runRiderPayouts(deps);
  const payout = [...ledger.payouts.values()][0]!;
  const webhookDeps = { alert: deps.alert, settle: deps.settle };
  const send = (eventType: 'transfer.success' | 'transfer.failed' | 'transfer.reversed', amount = payout.amountKobo) =>
    handleRiderTransferWebhook(
      { data: { amount, reference: payout.reference, transfer_code: 'TRF_1' }, eventType },
      webhookDeps
    );
  const earningStatuses = () => [...ledger.earnings.values()].map((e) => e.status);
  return { deps, earningStatuses, ledger, payout, send, webhookDeps };
};

Deno.test('only the three transfer events are routed here', () => {
  expectEqual(isTransferEvent('transfer.success'), true, 'success');
  expectEqual(isTransferEvent('transfer.failed'), true, 'failed');
  expectEqual(isTransferEvent('transfer.reversed'), true, 'reversed');
  expectEqual(isTransferEvent('charge.success'), false, 'charge stays on the payment path');
  expectEqual(isTransferEvent('transfer.otp'), false, 'unknown transfer events ignored');
});

Deno.test('a transfer that is not a FEASTY rider payout is ignored without touching the ledger', async () => {
  let settleCalls = 0;
  const result = await handleRiderTransferWebhook(
    { data: { amount: 100, reference: 'manual-dashboard-transfer' }, eventType: 'transfer.success' },
    {
      alert: async () => {},
      settle: async () => {
        settleCalls += 1;
        return { changed: false, matched: false };
      },
    }
  );
  expectEqual(result, { ignored: true, reason: 'not_a_rider_payout' }, 'ignored');
  expectEqual(settleCalls, 0, 'no DB call');
});

Deno.test('transfer.success: processing -> paid, earnings paid; a redelivery changes nothing', async () => {
  const { earningStatuses, ledger, payout, send } = await setup();
  const first = await send('transfer.success');
  expectEqual([first.ignored, 'changed' in first && first.changed], [false, true], 'first delivery applies');
  expectEqual(ledger.payouts.get(payout.id)?.status, 'paid', 'paid');
  expectEqual(earningStatuses(), ['paid', 'paid'], 'earnings paid');

  const again = await send('transfer.success');
  expectEqual('changed' in again && again.changed, false, 'redelivery is a no-op');
  expectEqual(ledger.alerts.length, 0, 'no alert for a duplicate success');
  expectEqual(ledger.transfers.size, 1, 'still one transfer');
});

Deno.test('transfer.failed: releases earnings, holds the rider, alerts once; redelivery is a no-op', async () => {
  const { deps, earningStatuses, ledger, payout, send } = await setup();
  await send('transfer.failed');
  expectEqual(ledger.payouts.get(payout.id)?.status, 'failed', 'failed');
  expectEqual(earningStatuses(), ['pending', 'pending'], 'back to pending');
  expectEqual(ledger.recipients.get('r1')?.holdUntil, 'infinity', 'recipient held');
  expectEqual(ledger.alerts.map((a) => a.alertType), ['rider_payout_failed'], 'one alert');

  const again = await send('transfer.failed');
  expectEqual('changed' in again && again.changed, false, 'no second release');
  expectEqual(ledger.alerts.length, 1, 'no second alert');

  // The held rider is NOT re-paid by the next run.
  const run = await runRiderPayouts(deps);
  expectEqual(run.created, 0, 'no new payout while held');
  expectEqual(run.skipped.map((s) => s.reason), ['recipient_on_hold'], 'skipped as held');
});

Deno.test('success arriving after a failure is reported as an anomaly and changes nothing', async () => {
  const { earningStatuses, ledger, payout, send } = await setup();
  await send('transfer.failed');
  const late = await send('transfer.success');
  expectEqual('anomaly' in late && late.anomaly, 'success_after_release', 'anomaly');
  expectEqual(ledger.payouts.get(payout.id)?.status, 'failed', 'status unchanged');
  expectEqual(earningStatuses(), ['pending', 'pending'], 'earnings unchanged');
  expectEqual(ledger.alerts.at(-1)?.alertType, 'rider_payout_anomaly', 'high alert');
  expectEqual(ledger.alerts.at(-1)?.severity, 'high', 'high severity');
});

Deno.test('failed arriving after success is an anomaly; reversed after success releases', async () => {
  const { earningStatuses, ledger, payout, send } = await setup();
  await send('transfer.success');
  const failedLate = await send('transfer.failed');
  expectEqual('anomaly' in failedLate && failedLate.anomaly, 'failed_after_paid', 'anomaly');
  expectEqual(ledger.payouts.get(payout.id)?.status, 'paid', 'still paid');

  await send('transfer.reversed');
  expectEqual(ledger.payouts.get(payout.id)?.status, 'reversed', 'reversed');
  expectEqual(earningStatuses(), ['pending', 'pending'], 'reversal returns the money to the ledger');
  const again = await send('transfer.reversed');
  expectEqual('changed' in again && again.changed, false, 'duplicate reversal is a no-op');
});

Deno.test('an amount that disagrees with the payout is an anomaly and changes nothing', async () => {
  const { earningStatuses, ledger, payout, send } = await setup();
  const result = await send('transfer.success', payout.amountKobo + 1);
  expectEqual('anomaly' in result && result.anomaly, 'amount_mismatch', 'anomaly');
  expectEqual(ledger.payouts.get(payout.id)?.status, 'processing', 'not marked paid');
  expectEqual(earningStatuses(), ['processing', 'processing'], 'earnings untouched');
});

Deno.test('an unknown feasty_rp_ reference is ignored (200), not an error', async () => {
  const { webhookDeps } = await setup();
  const result = await handleRiderTransferWebhook(
    { data: { amount: 100, reference: 'feasty_rp_' + 'f'.repeat(32) }, eventType: 'transfer.success' },
    webhookDeps
  );
  expectEqual(result, { ignored: true, reason: 'unknown_reference' }, 'ignored');
});
