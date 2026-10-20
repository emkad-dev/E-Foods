// TEST-ONLY in-memory mirror of the rider-pay ledger and of Paystack's
// transfer API, shared by riderPayouts.test.ts and
// paystack-webhook/transfers.test.ts. Not imported by any function.
//
// createPayout and settle reproduce ebuy_create_rider_payout /
// ebuy_settle_rider_payout (20261020_rider_payouts.sql) guard-for-guard, so
// the orchestration is exercised against the same refusals the database
// makes. The fake Paystack enforces reference uniqueness and counts every
// transfer it accepts, which is what the "never double-pay" assertions read.

import type { PaystackCallOutcome } from './paystack.ts';
import type { RecordOperationalAlertInput } from './operationalAlerts.ts';
import {
  RIDER_PAYOUT_LIMITS,
  isRecipientOnHold,
  type CreatePayoutResult,
  type RiderPayoutDeps,
  type SettleResult,
} from './riderPayouts.ts';

export type FakeEarning = {
  amountKobo: number;
  deliveredAt: string;
  id: string;
  payoutId: string | null;
  riderId: string;
  status: 'pending' | 'processing' | 'paid';
};

export type FakePayout = {
  amountKobo: number;
  createdAt: string;
  id: string;
  recipientCode: string;
  reference: string;
  riderId: string;
  status: 'processing' | 'paid' | 'failed' | 'reversed';
  transferCode: string | null;
  updatedAt: string;
};

export type FakeRecipient = {
  holdReason: string | null;
  holdUntil: string | null;
  recipientCode: string;
  riderId: string;
  verifiedAt: string | null;
};

/** What the fake Paystack does with the NEXT initiate call. */
export type InitiateBehaviour =
  | 'pending'
  | 'success'
  | 'failed'
  | 'otp'
  | 'reject'
  | 'unknown' // network died before Paystack saw it
  | 'unknown_but_landed'; // Paystack created it, but the response was lost

export const createTestLedger = (startAt = new Date('2026-10-20T08:00:00.000Z')) => {
  let clock = startAt.getTime();
  let idCounter = 0;
  const earnings = new Map<string, FakeEarning>();
  const payouts = new Map<string, FakePayout>();
  const recipients = new Map<string, FakeRecipient>();
  const alerts: RecordOperationalAlertInput[] = [];
  const transfers = new Map<string, { amountKobo: number; recipientCode: string; status: string; transferCode: string }>();
  const initiateQueue: InitiateBehaviour[] = [];
  const calls = { initiate: 0, verify: 0 };
  let flag = true;

  const nowIso = () => new Date(clock).toISOString();
  const kobo = (naira: number) => Math.round(naira * 100);

  const ledger = {
    alerts,
    calls,
    earnings,
    payouts,
    recipients,
    transfers,
    advanceMinutes: (minutes: number) => {
      clock += minutes * 60_000;
    },
    addEarning: (riderId: string, amountNaira: number, minutesAgo = 60) => {
      idCounter += 1;
      const id = `earning-${String(idCounter).padStart(3, '0')}`;
      earnings.set(id, {
        amountKobo: kobo(amountNaira),
        deliveredAt: new Date(clock - minutesAgo * 60_000).toISOString(),
        id,
        payoutId: null,
        riderId,
        status: 'pending',
      });
      return id;
    },
    addRecipient: (riderId: string, overrides: Partial<FakeRecipient> = {}) => {
      recipients.set(riderId, {
        holdReason: null,
        holdUntil: null,
        recipientCode: `RCP_${riderId}`,
        riderId,
        verifiedAt: nowIso(),
        ...overrides,
      });
    },
    queueInitiate: (...behaviours: InitiateBehaviour[]) => {
      initiateQueue.push(...behaviours);
    },
    setFlag: (enabled: boolean) => {
      flag = enabled;
    },
    /** Total kobo Paystack actually accepted for a rider, across all transfers. */
    sentToRider: (riderId: string) =>
      [...transfers.values()]
        .filter((transfer) => transfer.recipientCode === `RCP_${riderId}`)
        .reduce((sum, transfer) => sum + transfer.amountKobo, 0),

    createPayout: async (input: {
      amount: number;
      earningIds: string[];
      payoutId: string;
      riderId: string;
    }): Promise<CreatePayoutResult> => {
      const limits = RIDER_PAYOUT_LIMITS;
      const recipient = recipients.get(input.riderId);
      if (!recipient || !recipient.verifiedAt) return { ok: false, reason: 'no_verified_recipient' };
      if (isRecipientOnHold(recipient.holdUntil, new Date(clock))) return { ok: false, reason: 'recipient_on_hold' };
      if ([...payouts.values()].some((p) => p.riderId === input.riderId && p.status === 'processing')) {
        return { ok: false, reason: 'payout_in_flight' };
      }
      const ids = [...new Set(input.earningIds)];
      const locked = ids
        .map((id) => earnings.get(id))
        .filter((e): e is FakeEarning => !!e && e.riderId === input.riderId && e.status === 'pending' && e.payoutId === null);
      if (locked.length !== ids.length) return { ok: false, reason: 'earnings_changed' };
      const sum = locked.reduce((total, e) => total + e.amountKobo, 0);
      if (sum !== kobo(input.amount)) return { ok: false, reason: 'amount_mismatch' };
      if (sum < kobo(limits.minPayout)) return { ok: false, reason: 'below_minimum' };
      if (sum > kobo(limits.maxPerTransfer)) return { ok: false, reason: 'over_transfer_cap' };
      const today = [...payouts.values()].filter((p) => p.status === 'processing' || p.status === 'paid');
      const riderToday = today.filter((p) => p.riderId === input.riderId).reduce((t, p) => t + p.amountKobo, 0);
      if (riderToday + sum > kobo(limits.maxPerRiderPerDay)) return { ok: false, reason: 'over_rider_daily_cap' };
      const platformToday = today.reduce((t, p) => t + p.amountKobo, 0);
      if (platformToday + sum > kobo(limits.maxPlatformPerDay)) return { ok: false, reason: 'over_platform_daily_cap' };

      const reference = `feasty_rp_${input.payoutId}`;
      payouts.set(input.payoutId, {
        amountKobo: sum,
        createdAt: nowIso(),
        id: input.payoutId,
        recipientCode: recipient.recipientCode,
        reference,
        riderId: input.riderId,
        status: 'processing',
        transferCode: null,
        updatedAt: nowIso(),
      });
      for (const e of locked) {
        e.status = 'processing';
        e.payoutId = input.payoutId;
      }
      return { amount: sum / 100, ok: true, payoutId: input.payoutId, recipientCode: recipient.recipientCode, reference };
    },

    settle: async (input: {
      amountKobo: number | null;
      holdRecipient: boolean;
      outcome: 'success' | 'failed' | 'reversed';
      reason: string | null;
      reference: string;
      transferCode: string | null;
    }): Promise<SettleResult> => {
      const payout = [...payouts.values()].find((p) => p.reference === input.reference);
      if (!payout) return { changed: false, matched: false };
      const previous = payout.status;
      const base = { matched: true, payoutId: payout.id, previousStatus: previous, riderId: payout.riderId };
      payout.transferCode = payout.transferCode ?? input.transferCode;
      payout.updatedAt = nowIso();
      if (input.amountKobo !== null && input.amountKobo !== payout.amountKobo) {
        return { ...base, anomaly: 'amount_mismatch', changed: false, status: previous };
      }
      const mine = () => [...earnings.values()].filter((e) => e.payoutId === payout.id);
      if (input.outcome === 'success') {
        if (previous === 'paid') return { ...base, changed: false, status: 'paid' };
        if (previous === 'processing') {
          payout.status = 'paid';
          for (const e of mine()) e.status = 'paid';
          return { ...base, changed: true, status: 'paid' };
        }
        return { ...base, anomaly: 'success_after_release', changed: false, status: previous };
      }
      if (input.outcome === 'failed') {
        if (previous === 'failed' || previous === 'reversed') return { ...base, changed: false, status: previous };
        if (previous === 'paid') return { ...base, anomaly: 'failed_after_paid', changed: false, status: previous };
      }
      if (input.outcome === 'reversed' && (previous === 'failed' || previous === 'reversed')) {
        return { ...base, changed: false, status: previous };
      }
      payout.status = input.outcome;
      const released = mine();
      for (const e of released) {
        e.status = 'pending';
        e.payoutId = null;
      }
      if (input.holdRecipient) {
        const recipient = recipients.get(payout.riderId);
        if (recipient) {
          recipient.holdUntil = 'infinity';
          recipient.holdReason = `transfer_${input.outcome}`;
        }
      }
      return { ...base, changed: true, released: released.length, status: input.outcome };
    },

    initiateTransfer: async (input: {
      amountKobo: number;
      reason: string;
      recipientCode: string;
      reference: string;
    }): Promise<PaystackCallOutcome> => {
      calls.initiate += 1;
      if (transfers.has(input.reference)) {
        return { httpStatus: 400, kind: 'rejected', message: 'Duplicate Transfer Reference' };
      }
      const behaviour = initiateQueue.shift() ?? 'pending';
      const create = (status: string) => {
        const record = { amountKobo: input.amountKobo, recipientCode: input.recipientCode, status, transferCode: `TRF_${input.reference.slice(-6)}` };
        transfers.set(input.reference, record);
        return record;
      };
      switch (behaviour) {
        case 'reject':
          return { httpStatus: 400, kind: 'rejected', message: 'Your balance is not enough to fulfil this request' };
        case 'unknown':
          return { kind: 'unknown', message: 'timed out' };
        case 'unknown_but_landed':
          create('pending');
          return { kind: 'unknown', message: 'timed out' };
        default: {
          const record = create(behaviour);
          return {
            data: { amount: input.amountKobo, reference: input.reference, status: behaviour, transfer_code: record.transferCode },
            kind: 'ok',
          };
        }
      }
    },

    verifyTransfer: async (reference: string): Promise<PaystackCallOutcome> => {
      calls.verify += 1;
      const transfer = transfers.get(reference);
      if (!transfer) return { httpStatus: 404, kind: 'rejected', message: 'Transfer not found' };
      return {
        data: { amount: transfer.amountKobo, reference, status: transfer.status, transfer_code: transfer.transferCode },
        kind: 'ok',
      };
    },
  };

  const deps: RiderPayoutDeps = {
    alert: async (input) => {
      alerts.push(input);
    },
    createPayout: ledger.createPayout,
    initiateTransfer: ledger.initiateTransfer,
    isFlagEnabled: async () => flag,
    loadInFlightRiders: async () =>
      new Set([...payouts.values()].filter((p) => p.status === 'processing').map((p) => p.riderId)),
    loadPaidToday: async () => {
      const byRider = new Map<string, number>();
      let platform = 0;
      for (const p of payouts.values()) {
        if (p.status === 'processing' || p.status === 'paid') {
          byRider.set(p.riderId, (byRider.get(p.riderId) ?? 0) + p.amountKobo / 100);
          platform += p.amountKobo / 100;
        }
      }
      return { byRider, platform };
    },
    loadPendingEarnings: async () =>
      [...earnings.values()]
        .filter((e) => e.status === 'pending' && e.payoutId === null)
        .map((e) => ({ amount: String(e.amountKobo / 100), deliveredAt: e.deliveredAt, id: e.id, riderId: e.riderId })),
    loadRecipients: async (riderIds) =>
      riderIds.flatMap((id) => {
        const r = recipients.get(id);
        return r ? [{ holdUntil: r.holdUntil, recipientCode: r.recipientCode, riderId: id, verifiedAt: r.verifiedAt }] : [];
      }),
    loadStaleProcessing: async (olderThanIso) =>
      [...payouts.values()]
        .filter((p) => p.status === 'processing' && p.updatedAt < olderThanIso)
        .map((p) => ({
          amount: p.amountKobo / 100,
          createdAt: p.createdAt,
          id: p.id,
          recipientCode: p.recipientCode,
          reference: p.reference,
          riderId: p.riderId,
          transferCode: p.transferCode,
        })),
    markInitiated: async ({ payoutId, transferCode }) => {
      const payout = payouts.get(payoutId);
      if (payout && payout.status === 'processing') {
        payout.transferCode = transferCode ?? payout.transferCode;
        payout.updatedAt = nowIso();
      }
    },
    newPayoutId: () => {
      idCounter += 1;
      return idCounter.toString(16).padStart(32, '0');
    },
    now: () => new Date(clock),
    settle: ledger.settle,
    verifyTransfer: ledger.verifyTransfer,
  };

  return { deps, ledger };
};
