// Rider pay, part 2: batching, caps, the flag, and the never-double-pay
// guarantees of the payout run (against the in-memory ledger mirror).

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { RIDER_PAYOUT_LIMITS, classifyTransferStatus, isRecipientOnHold, planRiderPayouts, runRiderPayouts } =
  await import('./riderPayouts.ts');
const { createTestLedger } = await import('./riderPayoutsTestLedger.ts');

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const NOW = new Date('2026-10-20T08:00:00.000Z');
const verified = (riderId: string, extra: Record<string, unknown> = {}) => ({
  recipientCode: `RCP_${riderId}`,
  riderId,
  verifiedAt: NOW.toISOString(),
  ...extra,
});
const earning = (id: string, riderId: string, amount: number, deliveredAt = '2026-10-19T10:00:00.000Z') => ({
  amount,
  deliveredAt,
  id,
  riderId,
});
const plan = (overrides: Partial<Parameters<typeof planRiderPayouts>[0]>) =>
  planRiderPayouts({
    earnings: [],
    now: NOW,
    platformPaidToday: 0,
    recipients: [],
    riderPaidToday: new Map(),
    ridersWithInFlight: new Set(),
    ...overrides,
  });

// ── Flag ────────────────────────────────────────────────────────────────────

Deno.test('flag off: the run returns before reading or writing anything else', async () => {
  const explode = () => {
    throw new Error('must not be called while the flag is off');
  };
  const summary = await runRiderPayouts({
    alert: explode,
    createPayout: explode,
    initiateTransfer: explode,
    isFlagEnabled: async () => false,
    loadInFlightRiders: explode,
    loadPaidToday: explode,
    loadPendingEarnings: explode,
    loadRecipients: explode,
    loadStaleProcessing: explode,
    markInitiated: explode,
    newPayoutId: explode,
    now: () => NOW,
    settle: explode,
    verifyTransfer: explode,
  });
  expectEqual(summary.status, 'flag_off', 'flag off');
  expectEqual(summary.created, 0, 'nothing created');
});

// ── Planner ─────────────────────────────────────────────────────────────────

Deno.test('planner: skips riders without a verified recipient, on hold, or with a payout in flight', () => {
  const result = plan({
    earnings: [earning('e1', 'r-none', 2000), earning('e2', 'r-unverified', 2000), earning('e3', 'r-held', 2000), earning('e4', 'r-inflight', 2000), earning('e5', 'r-infinity', 2000)],
    recipients: [
      verified('r-unverified', { verifiedAt: null }),
      verified('r-held', { holdUntil: '2026-10-21T00:00:00.000Z' }),
      verified('r-inflight'),
      verified('r-infinity', { holdUntil: 'infinity' }),
    ],
    ridersWithInFlight: new Set(['r-inflight']),
  });
  expectEqual(result.batches, [], 'no batches');
  expectEqual(
    result.skipped.map((s) => `${s.riderId}:${s.reason}`),
    [
      'r-held:recipient_on_hold',
      'r-infinity:recipient_on_hold',
      'r-inflight:payout_in_flight',
      'r-none:no_verified_recipient',
      'r-unverified:no_verified_recipient',
    ],
    'skip reasons'
  );
});

Deno.test('planner: holds fail closed and expire', () => {
  expectEqual(isRecipientOnHold('infinity', NOW), true, 'Postgres infinity is held');
  expectEqual(isRecipientOnHold('garbage', NOW), true, 'unparsable is held');
  expectEqual(isRecipientOnHold('2026-10-19T00:00:00.000Z', NOW), false, 'expired hold');
  expectEqual(isRecipientOnHold(null, NOW), false, 'no hold');
});

Deno.test('planner: below the minimum rolls over; exactly the minimum pays', () => {
  const result = plan({
    earnings: [earning('e1', 'r1', 999.99), earning('e2', 'r2', 600), earning('e3', 'r2', 400)],
    recipients: [verified('r1'), verified('r2')],
  });
  expectEqual(result.batches, [{ amount: 1000, earningIds: ['e2', 'e3'], riderId: 'r2' }], 'r2 at exactly min');
  expectEqual(result.skipped, [{ amount: 999.99, reason: 'below_minimum', riderId: 'r1' }], 'r1 rolls over');
});

Deno.test('planner: per-transfer cap takes the oldest earnings FIFO and leaves the rest', () => {
  const result = plan({
    earnings: [
      earning('new', 'r1', 20_000, '2026-10-19T12:00:00.000Z'),
      earning('old', 'r1', 30_000, '2026-10-19T08:00:00.000Z'),
      earning('mid', 'r1', 15_000, '2026-10-19T10:00:00.000Z'),
    ],
    recipients: [verified('r1')],
  });
  // cap 50,000: old 30k + mid 15k = 45k; new 20k would exceed -> stop.
  expectEqual(result.batches, [{ amount: 45_000, earningIds: ['old', 'mid'], riderId: 'r1' }], 'FIFO under cap');
});

Deno.test('planner: an earning larger than the transfer cap is never auto-paid', () => {
  const result = plan({ earnings: [earning('huge', 'r1', 50_000.01)], recipients: [verified('r1')] });
  expectEqual(result.batches, [], 'nothing paid');
  expectEqual(result.skipped[0]?.reason, 'earning_exceeds_transfer_cap', 'flagged');
});

Deno.test('planner: per-rider and platform daily caps', () => {
  const riderCapped = plan({
    earnings: [earning('e1', 'r1', 5_000)],
    recipients: [verified('r1')],
    riderPaidToday: new Map([['r1', RIDER_PAYOUT_LIMITS.maxPerRiderPerDay - 4_000]]),
  });
  expectEqual(riderCapped.skipped[0]?.reason, 'daily_cap_reached', 'rider daily cap');

  const platformCapped = plan({
    earnings: [earning('a1', 'a', 40_000), earning('b1', 'b', 40_000)],
    platformPaidToday: RIDER_PAYOUT_LIMITS.maxPlatformPerDay - 50_000,
    recipients: [verified('a'), verified('b')],
  });
  expectEqual(platformCapped.batches.map((b) => b.riderId), ['a'], 'only the first fits under the platform cap');
  expectEqual(platformCapped.skipped[0], { amount: 40_000, reason: 'daily_cap_reached', riderId: 'b' }, 'b waits');
});

Deno.test('planner: stops at maxTransfersPerRun', () => {
  const earnings = Array.from({ length: RIDER_PAYOUT_LIMITS.maxTransfersPerRun + 2 }, (_, i) =>
    earning(`e${i}`, `r${String(i).padStart(3, '0')}`, 1_500)
  );
  const result = plan({ earnings, recipients: earnings.map((e) => verified(e.riderId)) });
  expectEqual(result.batches.length, RIDER_PAYOUT_LIMITS.maxTransfersPerRun, 'capped per run');
  expectEqual(result.skipped.filter((s) => s.reason === 'run_limit_reached').length, 2, 'rest next run');
});

Deno.test('classifyTransferStatus maps Paystack statuses conservatively', () => {
  expectEqual(classifyTransferStatus('success'), 'success', 'success');
  expectEqual(classifyTransferStatus('failed'), 'failed', 'failed');
  expectEqual(classifyTransferStatus('reversed'), 'reversed', 'reversed');
  expectEqual(classifyTransferStatus('otp'), 'otp', 'otp');
  expectEqual(classifyTransferStatus('pending'), 'in_progress', 'pending is not final');
  expectEqual(classifyTransferStatus(undefined), 'in_progress', 'missing is not final');
});

// ── Runs ────────────────────────────────────────────────────────────────────

Deno.test('run: batches per rider, sends one transfer each, and a second run sends nothing more', async () => {
  const { deps, ledger } = createTestLedger();
  ledger.addRecipient('r1');
  ledger.addRecipient('r2');
  ledger.addEarning('r1', 800);
  ledger.addEarning('r1', 1_000);
  ledger.addEarning('r2', 1_200);
  ledger.addEarning('r3', 5_000); // no recipient

  const first = await runRiderPayouts(deps);
  expectEqual([first.created, first.initiated, first.halted], [2, 2, null], 'two payouts sent');
  expectEqual(ledger.sentToRider('r1'), 180_000, 'r1 sent 1,800 in one transfer');
  expectEqual(ledger.sentToRider('r2'), 120_000, 'r2 sent 1,200');
  expectEqual(first.skipped.map((s) => `${s.riderId}:${s.reason}`), ['r3:no_verified_recipient'], 'r3 skipped');
  expectEqual([...ledger.earnings.values()].filter((e) => e.status === 'processing').length, 3, 'attached');

  const second = await runRiderPayouts(deps);
  expectEqual([second.created, ledger.transfers.size], [0, 2], 'nothing new while payouts are processing');
});

Deno.test('run: a payout confirmed immediately by Paystack is marked paid', async () => {
  const { deps, ledger } = createTestLedger();
  ledger.addRecipient('r1');
  const id = ledger.addEarning('r1', 2_000);
  ledger.queueInitiate('success');
  const summary = await runRiderPayouts(deps);
  expectEqual(summary.paidImmediately, 1, 'paid');
  expectEqual(ledger.earnings.get(id)?.status, 'paid', 'earning paid');
  expectEqual([...ledger.payouts.values()][0]?.status, 'paid', 'payout paid');
});

Deno.test('run: a definitive rejection fails the payout, releases earnings, holds nobody, and halts', async () => {
  const { deps, ledger } = createTestLedger();
  ledger.addRecipient('r1');
  ledger.addRecipient('r2');
  const e1 = ledger.addEarning('r1', 2_000);
  ledger.addEarning('r2', 2_000);
  ledger.queueInitiate('reject');

  const summary = await runRiderPayouts(deps);
  expectEqual(summary.halted, 'initiate', 'circuit breaker');
  expectEqual(summary.created, 1, 'second rider not attempted this run');
  expectEqual(ledger.earnings.get(e1)?.status, 'pending', 'released');
  expectEqual(ledger.recipients.get('r1')?.holdUntil, null, 'no hold for a balance problem');
  expectEqual([...ledger.payouts.values()][0]?.status, 'failed', 'payout failed');
  expectEqual(ledger.alerts.some((a) => a.alertType === 'rider_payout_failed'), true, 'alerted');
  expectEqual(ledger.transfers.size, 0, 'no money sent');
});

Deno.test('run: transfer OTP enabled halts and alerts', async () => {
  const { deps, ledger } = createTestLedger();
  ledger.addRecipient('r1');
  ledger.addRecipient('r2');
  ledger.addEarning('r1', 2_000);
  ledger.addEarning('r2', 2_000);
  ledger.queueInitiate('otp');
  const summary = await runRiderPayouts(deps);
  expectEqual(summary.halted, 'initiate', 'halted');
  expectEqual(ledger.alerts.map((a) => a.alertType), ['rider_payout_otp_required'], 'otp alert');
  expectEqual(ledger.transfers.size, 1, 'only the first was attempted');
});

Deno.test('run: an ambiguous initiation that never reached Paystack is re-sent once with the SAME reference', async () => {
  const { deps, ledger } = createTestLedger();
  ledger.addRecipient('r1');
  ledger.addEarning('r1', 3_000);
  ledger.queueInitiate('unknown');

  const first = await runRiderPayouts(deps);
  expectEqual(first.halted, 'initiate', 'halts on unknown');
  const payout = [...ledger.payouts.values()][0]!;
  expectEqual(payout.status, 'processing', 'stays processing - never assumed failed');

  // Too soon to reconcile: nothing happens.
  ledger.advanceMinutes(10);
  await runRiderPayouts(deps);
  expectEqual(ledger.calls.verify, 0, 'not reconciled before 30 minutes');

  ledger.advanceMinutes(30);
  const third = await runRiderPayouts(deps);
  expectEqual(third.reconciled, 1, 'reconciled');
  expectEqual(ledger.transfers.size, 1, 'exactly one transfer exists');
  expectEqual(ledger.transfers.has(payout.reference), true, 'under the original reference');
  expectEqual(ledger.sentToRider('r1'), 300_000, 'paid once');
});

Deno.test('run: an ambiguous initiation that DID land is verified, never re-sent', async () => {
  const { deps, ledger } = createTestLedger();
  ledger.addRecipient('r1');
  ledger.addEarning('r1', 3_000);
  ledger.queueInitiate('unknown_but_landed');

  await runRiderPayouts(deps);
  ledger.advanceMinutes(45);
  const initiatesBefore = ledger.calls.initiate;
  await runRiderPayouts(deps);
  expectEqual(ledger.calls.initiate, initiatesBefore, 'no second initiate call');
  expectEqual(ledger.sentToRider('r1'), 300_000, 'paid once');
  expectEqual([...ledger.payouts.values()][0]?.transferCode !== null, true, 'transfer code recorded from verify');
});

Deno.test('run: a processing payout older than the re-send window is only alerted on', async () => {
  const { deps, ledger } = createTestLedger();
  ledger.addRecipient('r1');
  ledger.addEarning('r1', 3_000);
  ledger.queueInitiate('unknown');
  await runRiderPayouts(deps);
  ledger.advanceMinutes(60 * 25);
  await runRiderPayouts(deps);
  expectEqual(ledger.transfers.size, 0, 'not re-sent after 24h');
  expectEqual(ledger.alerts.some((a) => a.alertType === 'rider_payout_stuck'), true, 'stuck alert');
});

Deno.test('run: the database refusal is the backstop even if the planner is wrong', async () => {
  const { deps, ledger } = createTestLedger();
  ledger.addRecipient('r1');
  const id = ledger.addEarning('r1', 2_000);
  // Simulate a stale plan: the earning is already attached elsewhere.
  ledger.earnings.get(id)!.status = 'processing';
  ledger.earnings.get(id)!.payoutId = 'other';
  const result = await deps.createPayout({ amount: 2_000, earningIds: [id], payoutId: 'a'.repeat(32), riderId: 'r1' });
  expectEqual(result, { ok: false, reason: 'earnings_changed' }, 'refused');
  const mismatch = await deps.createPayout({ amount: 1_999, earningIds: [ledger.addEarning('r1', 2_000)], payoutId: 'b'.repeat(32), riderId: 'r1' });
  expectEqual(mismatch, { ok: false, reason: 'amount_mismatch' }, 'amount must match the locked rows');
});
