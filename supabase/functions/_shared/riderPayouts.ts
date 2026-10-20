// Rider payouts: batching pending RiderEarning rows into Paystack transfers.
//
// WHERE THE GUARANTEES LIVE. This module PLANS (pure, unit-tested) and
// ORCHESTRATES. The never-double-pay and cap guarantees are enforced again,
// under row locks, by ebuy_create_rider_payout / ebuy_settle_rider_payout
// (supabase/migrations/20261020_rider_payouts.sql). A planning bug here can at
// worst produce a refused payout, never a second transfer:
//   * each payout has a deterministic Paystack reference ('feasty_rp_' + id),
//     created in the DB BEFORE Paystack is called, and Paystack refuses a
//     second transfer with the same reference;
//   * a rider can have only one payout 'processing' at a time (unique index);
//   * an earning is attached to at most one payout (status/payoutId check).
//
// SAFETY POSTURE.
//   * rider_auto_payouts flag OFF  -> the run returns before any other read.
//   * an ambiguous Paystack answer (timeout/5xx) -> the payout stays
//     'processing', the run stops, and a later run reconciles it by
//     verifying the reference before ever re-sending.
//   * a definitive rejection (e.g. insufficient balance) -> that payout is
//     failed and its earnings released, and the run STOPS (circuit breaker).
//   * transfer OTP enabled on the Paystack account -> alert and stop; the
//     owner must disable OTP for automated transfers.

import { serviceClient } from './client.ts';
import { isFeatureEnabled, loadFeatureFlagMap } from './featureFlags.ts';
import {
  initiatePaystackTransfer,
  verifyPaystackTransfer,
  type PaystackCallOutcome,
} from './paystack.ts';
import { recordOperationalAlert, type RecordOperationalAlertInput } from './operationalAlerts.ts';
import { parseNumber, sanitizeOptionalText, sanitizeText } from './rpc/coercion.ts';

export const RIDER_AUTO_PAYOUTS_FLAG = 'rider_auto_payouts';

// Config constants (naira). Changing any of these is a reviewed code change on
// purpose: they bound how much money one bad run can move. The SQL function
// rejects a payout outside them regardless of what the planner decided.
export const RIDER_PAYOUT_LIMITS = {
  /** Smaller balances roll over to the next run (Paystack charges per transfer). */
  minPayout: 1_000,
  /** No single transfer above this. An earning larger than this alone is held for review. */
  maxPerTransfer: 50_000,
  /** Per rider, per Lagos calendar day, counting processing + paid payouts. */
  maxPerRiderPerDay: 100_000,
  /** Whole platform, per Lagos calendar day: the blast-radius cap. */
  maxPlatformPerDay: 500_000,
  /** Transfers initiated per run; keeps one invocation well inside the edge time limit. */
  maxTransfersPerRun: 25,
  /** A 'processing' payout untouched this long is reconciled against Paystack. */
  reconcileAfterMinutes: 30,
  /** Past this age a never-confirmed payout is only alerted on, never re-sent. */
  reinitiateWithinHours: 24,
} as const;

export type RiderPayoutLimits = typeof RIDER_PAYOUT_LIMITS;

export const TRANSFER_REFERENCE_PREFIX = 'feasty_rp_';
export const RIDER_PAYOUT_TRANSFER_REASON = 'FEASTY rider payout';

export const toKobo = (amount: unknown) => Math.round(parseNumber(amount, 0) * 100);
const fromKobo = (kobo: number) => Math.round(kobo) / 100;

// ── Planning (pure) ─────────────────────────────────────────────────────────

export type PendingEarning = {
  amount: number | string;
  deliveredAt?: string | null;
  id: string;
  riderId: string;
};

export type RecipientState = {
  holdUntil?: string | null;
  recipientCode?: string | null;
  riderId: string;
  verifiedAt?: string | null;
};

export type PlannedPayout = { amount: number; earningIds: string[]; riderId: string };

export type PayoutSkipReason =
  | 'no_verified_recipient'
  | 'recipient_on_hold'
  | 'payout_in_flight'
  | 'earning_exceeds_transfer_cap'
  | 'below_minimum'
  | 'daily_cap_reached'
  | 'run_limit_reached';

export type PayoutPlan = {
  batches: PlannedPayout[];
  skipped: Array<{ amount: number; reason: PayoutSkipReason; riderId: string }>;
};

/** Fails closed: an unparsable hold (e.g. Postgres 'infinity') counts as held. */
export const isRecipientOnHold = (holdUntil: string | null | undefined, now: Date) => {
  const raw = sanitizeOptionalText(holdUntil);
  if (!raw) {
    return false;
  }
  const parsed = Date.parse(raw);
  return !Number.isFinite(parsed) || parsed > now.getTime();
};

export const planRiderPayouts = (input: {
  earnings: PendingEarning[];
  limits?: RiderPayoutLimits;
  now: Date;
  platformPaidToday: number;
  recipients: RecipientState[];
  riderPaidToday: Map<string, number>;
  ridersWithInFlight: Set<string>;
}): PayoutPlan => {
  const limits = input.limits ?? RIDER_PAYOUT_LIMITS;
  const plan: PayoutPlan = { batches: [], skipped: [] };
  const recipients = new Map(input.recipients.map((recipient) => [recipient.riderId, recipient]));

  const byRider = new Map<string, Array<{ deliveredAt: string; id: string; kobo: number }>>();
  for (const earning of input.earnings) {
    const kobo = toKobo(earning.amount);
    if (!earning.id || !earning.riderId || kobo <= 0) {
      continue;
    }
    const list = byRider.get(earning.riderId) ?? [];
    list.push({ deliveredAt: sanitizeText(earning.deliveredAt), id: earning.id, kobo });
    byRider.set(earning.riderId, list);
  }

  const minKobo = toKobo(limits.minPayout);
  const maxTransferKobo = toKobo(limits.maxPerTransfer);
  let platformRemainingKobo = Math.max(toKobo(limits.maxPlatformPerDay) - toKobo(input.platformPaidToday), 0);

  for (const riderId of [...byRider.keys()].sort()) {
    // Oldest first, id as a deterministic tiebreak.
    const earnings = byRider.get(riderId)!.sort((a, b) =>
      a.deliveredAt === b.deliveredAt ? a.id.localeCompare(b.id) : a.deliveredAt.localeCompare(b.deliveredAt)
    );
    const totalKobo = earnings.reduce((sum, earning) => sum + earning.kobo, 0);
    const skip = (reason: PayoutSkipReason) => plan.skipped.push({ amount: fromKobo(totalKobo), reason, riderId });

    const recipient = recipients.get(riderId);
    if (!recipient || !sanitizeOptionalText(recipient.verifiedAt) || !sanitizeOptionalText(recipient.recipientCode)) {
      skip('no_verified_recipient');
      continue;
    }
    if (isRecipientOnHold(recipient.holdUntil, input.now)) {
      skip('recipient_on_hold');
      continue;
    }
    if (input.ridersWithInFlight.has(riderId)) {
      skip('payout_in_flight');
      continue;
    }
    if (earnings.some((earning) => earning.kobo > maxTransferKobo)) {
      skip('earning_exceeds_transfer_cap');
      continue;
    }
    if (totalKobo < minKobo) {
      skip('below_minimum');
      continue;
    }
    if (plan.batches.length >= limits.maxTransfersPerRun) {
      skip('run_limit_reached');
      continue;
    }

    const riderRemainingKobo = Math.max(
      toKobo(limits.maxPerRiderPerDay) - toKobo(input.riderPaidToday.get(riderId) ?? 0),
      0
    );
    const capKobo = Math.min(maxTransferKobo, riderRemainingKobo, platformRemainingKobo);

    // FIFO: stop at the first earning that does not fit, so the oldest money
    // is always paid first and nothing jumps the queue.
    const selected: string[] = [];
    let selectedKobo = 0;
    for (const earning of earnings) {
      if (selectedKobo + earning.kobo > capKobo) {
        break;
      }
      selected.push(earning.id);
      selectedKobo += earning.kobo;
    }

    if (selectedKobo < minKobo) {
      skip('daily_cap_reached');
      continue;
    }

    plan.batches.push({ amount: fromKobo(selectedKobo), earningIds: selected, riderId });
    platformRemainingKobo -= selectedKobo;
  }

  return plan;
};

// ── Paystack outcome interpretation (pure) ──────────────────────────────────

export type TransferState = 'success' | 'failed' | 'reversed' | 'otp' | 'in_progress';

export const classifyTransferStatus = (status: unknown): TransferState => {
  switch (sanitizeText(status).toLowerCase()) {
    case 'success':
      return 'success';
    case 'failed':
    case 'abandoned':
    case 'rejected':
      return 'failed';
    case 'reversed':
      return 'reversed';
    case 'otp':
      return 'otp';
    default:
      // pending, processing, queued, received, blocked: not final.
      return 'in_progress';
  }
};

// ── Orchestration ───────────────────────────────────────────────────────────

export type CreatePayoutResult =
  | { amount: number; ok: true; payoutId: string; recipientCode: string; reference: string }
  | { ok: false; reason: string };

export type SettleResult = {
  anomaly?: string;
  changed: boolean;
  matched: boolean;
  payoutId?: string;
  previousStatus?: string;
  released?: number;
  riderId?: string;
  status?: string;
};

export type StaleProcessingPayout = {
  amount: number | string;
  createdAt: string;
  id: string;
  recipientCode: string;
  reference: string;
  riderId: string;
  transferCode?: string | null;
};

export type RiderPayoutDeps = {
  alert: (input: RecordOperationalAlertInput) => Promise<unknown>;
  createPayout: (input: { amount: number; earningIds: string[]; payoutId: string; riderId: string }) => Promise<CreatePayoutResult>;
  initiateTransfer: (input: {
    amountKobo: number;
    reason: string;
    recipientCode: string;
    reference: string;
  }) => Promise<PaystackCallOutcome>;
  isFlagEnabled: () => Promise<boolean>;
  loadInFlightRiders: () => Promise<Set<string>>;
  loadPaidToday: () => Promise<{ byRider: Map<string, number>; platform: number }>;
  loadPendingEarnings: () => Promise<PendingEarning[]>;
  loadRecipients: (riderIds: string[]) => Promise<RecipientState[]>;
  loadStaleProcessing: (olderThanIso: string) => Promise<StaleProcessingPayout[]>;
  markInitiated: (input: { payoutId: string; paystackStatus: string; transferCode: string | null }) => Promise<void>;
  newPayoutId: () => string;
  now: () => Date;
  settle: (input: {
    amountKobo: number | null;
    holdRecipient: boolean;
    outcome: 'success' | 'failed' | 'reversed';
    reason: string | null;
    reference: string;
    transferCode: string | null;
  }) => Promise<SettleResult>;
  verifyTransfer: (reference: string) => Promise<PaystackCallOutcome>;
};

export type RiderPayoutRunSummary = {
  created: number;
  halted: string | null;
  initiated: number;
  paidImmediately: number;
  reconciled: number;
  refused: Array<{ reason: string; riderId: string }>;
  skipped: PayoutPlan['skipped'];
  status: 'flag_off' | 'ran';
};

const alertPayout = (
  deps: RiderPayoutDeps,
  payoutId: string,
  alertType: string,
  title: string,
  details: string,
  severity: 'medium' | 'high',
  metadata: Record<string, unknown> = {}
) =>
  deps.alert({
    alertType,
    dedupeKey: `ops:${alertType}:${payoutId}`,
    details,
    metadata: { payoutId, ...metadata },
    severity,
    subjectId: payoutId,
    subjectType: 'rider_payout',
    title,
  });

const transferCodeOf = (data: Record<string, unknown> | null) => sanitizeOptionalText(data?.transfer_code);

/**
 * Applies a Paystack answer about one payout. Returns 'halt' when the run must
 * stop sending further transfers.
 */
const applyTransferOutcome = async (
  deps: RiderPayoutDeps,
  payout: { amount: number; payoutId: string; reference: string; riderId: string },
  outcome: PaystackCallOutcome,
  source: 'initiate' | 'reconcile'
): Promise<'continue' | 'halt' | 'paid'> => {
  if (outcome.kind === 'unknown') {
    await alertPayout(
      deps,
      payout.payoutId,
      'rider_payout_outcome_unknown',
      'Rider payout outcome unknown',
      `Paystack gave no definite answer for payout ${payout.reference} (${outcome.message}). It stays processing and will be verified before any retry. Do not pay this rider by hand until it is resolved.`,
      'medium',
      { riderId: payout.riderId, source }
    );
    return 'halt';
  }

  if (outcome.kind === 'rejected') {
    // Definitive: Paystack created nothing. Release the earnings (no recipient
    // hold - a balance or config problem is not the rider's fault) and stop.
    const settled = await deps.settle({
      amountKobo: null,
      holdRecipient: false,
      outcome: 'failed',
      reason: `initiation rejected: ${outcome.message}`,
      reference: payout.reference,
      transferCode: null,
    });
    await alertPayout(
      deps,
      payout.payoutId,
      'rider_payout_failed',
      'Rider payout rejected by Paystack',
      `Paystack rejected payout ${payout.reference} for rider ${payout.riderId} (₦${payout.amount}): ${outcome.message}. Earnings were returned to pending; automatic payouts stopped for this run. Check the Paystack balance and Transfers settings.`,
      'high',
      { released: settled.released ?? 0, riderId: payout.riderId }
    );
    return 'halt';
  }

  const data = outcome.data as Record<string, unknown> | null;
  const transferCode = transferCodeOf(data);
  const state = classifyTransferStatus(data?.status);
  const amountKobo = Number.isFinite(Number(data?.amount)) && data?.amount !== undefined ? Number(data?.amount) : null;

  if (state === 'success' || state === 'failed' || state === 'reversed') {
    const settled = await deps.settle({
      amountKobo,
      // An immediate failure at initiation is treated like a rejection (no
      // hold); a failure discovered later (reconcile) is a bank-side failure
      // and holds the recipient until the rider re-submits their bank.
      holdRecipient: state !== 'success' && source === 'reconcile',
      outcome: state,
      reason: sanitizeOptionalText(data?.reason) ?? sanitizeOptionalText(data?.gateway_response) ?? state,
      reference: payout.reference,
      transferCode,
    });
    if (settled.anomaly) {
      await alertPayout(
        deps,
        payout.payoutId,
        'rider_payout_anomaly',
        'Rider payout anomaly',
        `Payout ${payout.reference}: ${settled.anomaly} (status ${settled.previousStatus}). No state was changed; reconcile by hand.`,
        'high',
        { anomaly: settled.anomaly, riderId: payout.riderId }
      );
      return 'halt';
    }
    if (state === 'success') {
      return 'paid';
    }
    await alertPayout(
      deps,
      payout.payoutId,
      'rider_payout_failed',
      'Rider payout failed',
      `Paystack reports payout ${payout.reference} for rider ${payout.riderId} as ${state}. Earnings were returned to pending.`,
      'high',
      { riderId: payout.riderId }
    );
    return state === 'failed' && source === 'initiate' ? 'halt' : 'continue';
  }

  await deps.markInitiated({ payoutId: payout.payoutId, paystackStatus: state, transferCode });

  if (state === 'otp') {
    await alertPayout(
      deps,
      payout.payoutId,
      'rider_payout_otp_required',
      'Paystack transfer OTP is enabled',
      `Payout ${payout.reference} is waiting for an OTP. Automatic rider payouts need transfer OTP disabled in the Paystack dashboard (Settings > Preferences). Finalize or cancel this transfer in the dashboard.`,
      'high',
      { riderId: payout.riderId }
    );
    return 'halt';
  }

  return 'continue';
};

const reconcileStaleProcessing = async (deps: RiderPayoutDeps, limits: RiderPayoutLimits) => {
  const now = deps.now();
  const staleBefore = new Date(now.getTime() - limits.reconcileAfterMinutes * 60_000).toISOString();
  const stale = await deps.loadStaleProcessing(staleBefore);
  let reconciled = 0;

  for (const payout of stale) {
    const amount = parseNumber(payout.amount, 0);
    const ref = { amount, payoutId: payout.id, reference: payout.reference, riderId: payout.riderId };
    const verified = await deps.verifyTransfer(payout.reference);

    if (verified.kind === 'ok') {
      reconciled += 1;
      const result = await applyTransferOutcome(deps, ref, verified, 'reconcile');
      if (result === 'halt') {
        return { halted: 'reconcile', reconciled };
      }
      continue;
    }

    if (verified.kind === 'unknown') {
      // Cannot tell; try again next run.
      continue;
    }

    // Paystack says it does not know this reference.
    const ageHours = (now.getTime() - Date.parse(payout.createdAt)) / 3_600_000;
    if (sanitizeOptionalText(payout.transferCode) || !Number.isFinite(ageHours) || ageHours > limits.reinitiateWithinHours) {
      await alertPayout(
        deps,
        payout.id,
        'rider_payout_stuck',
        'Rider payout stuck in processing',
        `Payout ${payout.reference} has been processing since ${payout.createdAt} and Paystack does not recognise the reference (${verified.message}). It will not be re-sent automatically; resolve it by hand.`,
        'high',
        { riderId: payout.riderId }
      );
      continue;
    }

    // Never reached Paystack (the initiation call died before it landed).
    // Re-send with the SAME reference: if it did land after all, Paystack
    // refuses the duplicate and nothing is paid twice.
    reconciled += 1;
    const resent = await deps.initiateTransfer({
      amountKobo: toKobo(amount),
      reason: RIDER_PAYOUT_TRANSFER_REASON,
      recipientCode: payout.recipientCode,
      reference: payout.reference,
    });
    if (resent.kind === 'rejected') {
      // Possibly "duplicate reference" - i.e. it exists after all. Do NOT
      // release the earnings on a re-send rejection; a human decides.
      await alertPayout(
        deps,
        payout.id,
        'rider_payout_stuck',
        'Rider payout re-send rejected',
        `Re-sending payout ${payout.reference} was rejected by Paystack (${resent.message}). It stays processing; check the transfer in the Paystack dashboard.`,
        'high',
        { riderId: payout.riderId }
      );
      return { halted: 'reconcile', reconciled };
    }
    const result = await applyTransferOutcome(deps, ref, resent, 'initiate');
    if (result === 'halt') {
      return { halted: 'reconcile', reconciled };
    }
  }

  return { halted: null as string | null, reconciled };
};

export const runRiderPayouts = async (
  deps: RiderPayoutDeps,
  limits: RiderPayoutLimits = RIDER_PAYOUT_LIMITS
): Promise<RiderPayoutRunSummary> => {
  const summary: RiderPayoutRunSummary = {
    created: 0,
    halted: null,
    initiated: 0,
    paidImmediately: 0,
    reconciled: 0,
    refused: [],
    skipped: [],
    status: 'ran',
  };

  if (!(await deps.isFlagEnabled())) {
    return { ...summary, status: 'flag_off' };
  }

  const reconcile = await reconcileStaleProcessing(deps, limits);
  summary.reconciled = reconcile.reconciled;
  if (reconcile.halted) {
    summary.halted = reconcile.halted;
    return summary;
  }

  const earnings = await deps.loadPendingEarnings();
  if (earnings.length === 0) {
    return summary;
  }
  const riderIds = [...new Set(earnings.map((earning) => earning.riderId))];
  const [recipients, paidToday, inFlight] = await Promise.all([
    deps.loadRecipients(riderIds),
    deps.loadPaidToday(),
    deps.loadInFlightRiders(),
  ]);

  const plan = planRiderPayouts({
    earnings,
    limits,
    now: deps.now(),
    platformPaidToday: paidToday.platform,
    recipients,
    riderPaidToday: paidToday.byRider,
    ridersWithInFlight: inFlight,
  });
  summary.skipped = plan.skipped;

  for (const skipped of plan.skipped) {
    if (skipped.reason === 'earning_exceeds_transfer_cap') {
      await deps.alert({
        alertType: 'rider_payout_over_cap',
        dedupeKey: `ops:rider_payout_over_cap:${skipped.riderId}`,
        details: `Rider ${skipped.riderId} has a single earning above the ₦${limits.maxPerTransfer} per-transfer cap. It will never be paid automatically; review and pay by hand.`,
        metadata: { amount: skipped.amount, riderId: skipped.riderId },
        severity: 'high',
        subjectId: skipped.riderId,
        subjectType: 'rider',
        title: 'Rider earning above transfer cap',
      });
    }
  }

  for (const batch of plan.batches) {
    const payoutId = deps.newPayoutId();
    const created = await deps.createPayout({
      amount: batch.amount,
      earningIds: batch.earningIds,
      payoutId,
      riderId: batch.riderId,
    });
    if (!created.ok) {
      summary.refused.push({ reason: created.reason, riderId: batch.riderId });
      continue;
    }
    summary.created += 1;

    const outcome = await deps.initiateTransfer({
      amountKobo: toKobo(created.amount),
      reason: RIDER_PAYOUT_TRANSFER_REASON,
      recipientCode: created.recipientCode,
      reference: created.reference,
    });
    if (outcome.kind === 'ok') {
      summary.initiated += 1;
    }
    const result = await applyTransferOutcome(
      deps,
      { amount: created.amount, payoutId: created.payoutId, reference: created.reference, riderId: batch.riderId },
      outcome,
      'initiate'
    );
    if (result === 'paid') {
      summary.paidImmediately += 1;
    }
    if (result === 'halt') {
      summary.halted = 'initiate';
      break;
    }
  }

  return summary;
};

// ── Production wiring ───────────────────────────────────────────────────────

const lagosDayStartIso = (now: Date) => {
  // Lagos is UTC+1 with no DST. Same boundary the SQL function computes.
  const lagos = new Date(now.getTime() + 60 * 60 * 1000);
  const startUtcMs = Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate()) - 60 * 60 * 1000;
  return new Date(startUtcMs).toISOString();
};

const throwOnError = <T>(result: { data: T | null; error: { message: string } | null }) => {
  if (result.error) {
    throw new Error(result.error.message);
  }
  return result.data;
};

export const buildDefaultRiderPayoutDeps = (): RiderPayoutDeps => ({
  alert: (input) => recordOperationalAlert(input),
  createPayout: async ({ amount, earningIds, payoutId, riderId }) => {
    const data = throwOnError(
      await serviceClient.rpc('ebuy_create_rider_payout', {
        p_amount: amount,
        p_earning_ids: earningIds,
        p_max_per_rider_day: RIDER_PAYOUT_LIMITS.maxPerRiderPerDay,
        p_max_per_transfer: RIDER_PAYOUT_LIMITS.maxPerTransfer,
        p_max_platform_day: RIDER_PAYOUT_LIMITS.maxPlatformPerDay,
        p_min_payout: RIDER_PAYOUT_LIMITS.minPayout,
        p_payout_id: payoutId,
        p_rider_id: riderId,
      })
    ) as Record<string, unknown> | null;
    if (data?.ok === true) {
      return {
        amount: parseNumber(data.amount, 0),
        ok: true,
        payoutId: sanitizeText(data.payoutId),
        recipientCode: sanitizeText(data.recipientCode),
        reference: sanitizeText(data.reference),
      };
    }
    return { ok: false, reason: sanitizeText(data?.reason, 'unknown') };
  },
  initiateTransfer: (input) => initiatePaystackTransfer(input),
  isFlagEnabled: async () => isFeatureEnabled(await loadFeatureFlagMap(), RIDER_AUTO_PAYOUTS_FLAG),
  loadInFlightRiders: async () => {
    const rows = throwOnError(
      await serviceClient.from('RiderPayout').select('riderId').eq('status', 'processing')
    ) as Array<{ riderId: string }> | null;
    return new Set((rows ?? []).map((row) => row.riderId));
  },
  loadPaidToday: async () => {
    const rows = throwOnError(
      await serviceClient
        .from('RiderPayout')
        .select('riderId,amount')
        .in('status', ['processing', 'paid'])
        .gte('createdAt', lagosDayStartIso(new Date()))
    ) as Array<{ amount: number | string; riderId: string }> | null;
    const byRider = new Map<string, number>();
    let platform = 0;
    for (const row of rows ?? []) {
      const amount = parseNumber(row.amount, 0);
      byRider.set(row.riderId, (byRider.get(row.riderId) ?? 0) + amount);
      platform += amount;
    }
    return { byRider, platform };
  },
  loadPendingEarnings: async () =>
    (throwOnError(
      await serviceClient
        .from('RiderEarning')
        .select('id,riderId,amount,deliveredAt')
        .eq('status', 'pending')
        .is('payoutId', null)
        .order('deliveredAt', { ascending: true })
        .limit(5000)
    ) as PendingEarning[] | null) ?? [],
  loadRecipients: async (riderIds) =>
    riderIds.length === 0
      ? []
      : ((throwOnError(
          await serviceClient
            .from('RiderPayoutRecipient')
            .select('riderId,recipientCode,verifiedAt,holdUntil')
            .in('riderId', riderIds)
        ) as RecipientState[] | null) ?? []),
  loadStaleProcessing: async (olderThanIso) =>
    (throwOnError(
      await serviceClient
        .from('RiderPayout')
        .select('id,riderId,amount,reference,recipientCode,transferCode,createdAt')
        .eq('status', 'processing')
        .lt('updatedAt', olderThanIso)
        .limit(50)
    ) as StaleProcessingPayout[] | null) ?? [],
  markInitiated: async ({ payoutId, paystackStatus, transferCode }) => {
    const now = new Date().toISOString();
    throwOnError(
      await serviceClient
        .from('RiderPayout')
        .update({
          initiatedAt: now,
          paystackStatus,
          updatedAt: now,
          ...(transferCode ? { transferCode } : {}),
        })
        .eq('id', payoutId)
        .eq('status', 'processing')
    );
  },
  newPayoutId: () => crypto.randomUUID().replace(/-/g, ''),
  now: () => new Date(),
  settle: async (input) => settleRiderPayout(input),
  verifyTransfer: (reference) => verifyPaystackTransfer(reference),
});

export const settleRiderPayout = async (input: {
  amountKobo: number | null;
  holdRecipient: boolean;
  outcome: 'success' | 'failed' | 'reversed';
  reason: string | null;
  reference: string;
  transferCode: string | null;
}): Promise<SettleResult> => {
  const data = throwOnError(
    await serviceClient.rpc('ebuy_settle_rider_payout', {
      p_amount_kobo: input.amountKobo,
      p_hold_recipient: input.holdRecipient,
      p_outcome: input.outcome,
      p_reason: input.reason,
      p_reference: input.reference,
      p_transfer_code: input.transferCode,
    })
  ) as Record<string, unknown> | null;
  return {
    anomaly: sanitizeOptionalText(data?.anomaly) ?? undefined,
    changed: data?.changed === true,
    matched: data?.matched === true,
    payoutId: sanitizeOptionalText(data?.payoutId) ?? undefined,
    previousStatus: sanitizeOptionalText(data?.previousStatus) ?? undefined,
    released: parseNumber(data?.released, 0),
    riderId: sanitizeOptionalText(data?.riderId) ?? undefined,
    status: sanitizeOptionalText(data?.status) ?? undefined,
  };
};
