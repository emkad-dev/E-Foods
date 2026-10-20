// Paystack transfer webhooks (transfer.success / transfer.failed /
// transfer.reversed) for rider payouts. The signature is verified by
// index.ts before this runs.
//
// Idempotent by construction: the state change happens inside
// ebuy_settle_rider_payout under a row lock, so a redelivered or out-of-order
// event is either a no-op or a reported anomaly - never a second payment,
// never a second release. Anything that is not one of OUR payout references
// ('feasty_rp_...') is ignored before touching the database, so transfers
// made by hand from the Paystack dashboard are left alone.

import type { RecordOperationalAlertInput } from '../_shared/operationalAlerts.ts';
import type { SettleResult } from '../_shared/riderPayouts.ts';

export const TRANSFER_EVENTS = {
  'transfer.success': 'success',
  'transfer.failed': 'failed',
  'transfer.reversed': 'reversed',
} as const;

export type TransferEventType = keyof typeof TRANSFER_EVENTS;

export const isTransferEvent = (eventType: string): eventType is TransferEventType =>
  Object.prototype.hasOwnProperty.call(TRANSFER_EVENTS, eventType);

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export type TransferWebhookDeps = {
  alert: (input: RecordOperationalAlertInput) => Promise<unknown>;
  settle: (input: {
    amountKobo: number | null;
    holdRecipient: boolean;
    outcome: 'success' | 'failed' | 'reversed';
    reason: string | null;
    reference: string;
    transferCode: string | null;
  }) => Promise<SettleResult>;
};

export type TransferWebhookResult =
  | { ignored: true; reason: 'not_a_rider_payout' | 'unknown_reference' }
  | { anomaly?: string; changed: boolean; ignored: false; payoutId: string; status: string };

export const handleRiderTransferWebhook = async (
  input: { data: Record<string, unknown> | null; eventType: TransferEventType },
  deps: TransferWebhookDeps
): Promise<TransferWebhookResult> => {
  const reference = text(input.data?.reference);
  if (!reference.startsWith('feasty_rp_')) {
    return { ignored: true, reason: 'not_a_rider_payout' };
  }

  const outcome = TRANSFER_EVENTS[input.eventType];
  const rawAmount = input.data?.amount;
  const amountKobo =
    typeof rawAmount === 'number' && Number.isInteger(rawAmount)
      ? rawAmount
      : typeof rawAmount === 'string' && /^\d+$/.test(rawAmount.trim())
        ? Number(rawAmount.trim())
        : null;

  const settled = await deps.settle({
    amountKobo,
    // A bank-side failure or reversal: hold the rider's recipient so the
    // released earnings are not re-sent to a bad account. Cleared when the
    // rider re-submits bank details.
    holdRecipient: outcome !== 'success',
    outcome,
    reason: text(input.data?.reason) || text(input.data?.gateway_response) || outcome,
    reference,
    transferCode: text(input.data?.transfer_code) || null,
  });

  if (!settled.matched) {
    return { ignored: true, reason: 'unknown_reference' };
  }

  const payoutId = settled.payoutId ?? reference;
  if (settled.anomaly) {
    await deps.alert({
      alertType: 'rider_payout_anomaly',
      dedupeKey: `ops:rider_payout_anomaly:${payoutId}:${input.eventType}`,
      details: `Paystack sent ${input.eventType} for payout ${reference} while it was ${settled.previousStatus}: ${settled.anomaly}. Nothing was changed; reconcile by hand before paying anyone.`,
      metadata: { anomaly: settled.anomaly, eventType: input.eventType, payoutId, riderId: settled.riderId ?? null },
      severity: 'high',
      subjectId: payoutId,
      subjectType: 'rider_payout',
      title: 'Rider payout anomaly',
    });
  } else if (settled.changed && outcome !== 'success') {
    await deps.alert({
      alertType: 'rider_payout_failed',
      dedupeKey: `ops:rider_payout_failed:${payoutId}`,
      details: `Paystack reports payout ${reference} as ${outcome}. ${settled.released ?? 0} earning(s) returned to pending and rider ${settled.riderId ?? 'unknown'} is on hold until they re-submit bank details.`,
      metadata: { eventType: input.eventType, payoutId, released: settled.released ?? 0, riderId: settled.riderId ?? null },
      severity: 'high',
      subjectId: payoutId,
      subjectType: 'rider_payout',
      title: outcome === 'reversed' ? 'Rider payout reversed' : 'Rider payout failed',
    });
  }

  return {
    anomaly: settled.anomaly,
    changed: settled.changed,
    ignored: false,
    payoutId,
    status: settled.status ?? outcome,
  };
};
