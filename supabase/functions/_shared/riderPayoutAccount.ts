// RPC handlers for rider pay:
//   riderSubmitPayoutBank  (rider)  - resolve the account with Paystack, create a
//                                     transfer recipient, store it masked.
//   riderGetPayoutProfile  (rider)  - masked recipient + earnings/payout summary.
//   adminGetRiderPayouts   (admin)  - recent payouts and ledger totals.
//
// Registered in the ACCOUNT and ADMIN domains rather than DISPATCH because the
// dispatch domain's handler map lives in domains/dispatch.ts, which is owned
// by separate in-flight work; the account domain is the self-service home for
// a caller's own account data, and the role gate below restricts the two rider
// actions to dispatch accounts in the FEASTY global pool.

import { serviceClient } from './client.ts';
import { isFeatureEnabled, loadFeatureFlagMap } from './featureFlags.ts';
import { recordOperationalAlert } from './operationalAlerts.ts';
import {
  assertPaystackConfigured,
  createPaystackTransferRecipient,
  resolvePaystackBankAccount,
} from './paystack.ts';
import { RIDER_AUTO_PAYOUTS_FLAG, RIDER_PAYOUT_LIMITS } from './riderPayouts.ts';
import { nowIso, parseNumber, sanitizeOptionalText, sanitizeText } from './rpc/coercion.ts';
import { ensureRole, type AuthenticatedRequestContext } from './rpc/context.ts';
import type { RpcHandler } from './rpc/registry.ts';
import { fail, json } from './rpc/respond.ts';

type Handler = RpcHandler<AuthenticatedRequestContext>;

/** A rider who changes bank account cannot be paid for this long (takeover brake). */
export const BANK_CHANGE_HOLD_HOURS = 24;
/** Minimum gap between submissions; each one costs two Paystack calls. */
export const BANK_SUBMIT_COOLDOWN_SECONDS = 60;

export const maskAccountNumber = (accountNumber: string) =>
  accountNumber.length >= 4 ? `******${accountNumber.slice(-4)}` : '******';

export const validateRiderBankInput = (data: Record<string, unknown>) => {
  const bankCode = sanitizeText(data.bankCode);
  const accountNumber = sanitizeText(data.accountNumber).replace(/\s+/g, '');
  if (!/^[0-9A-Za-z]{2,12}$/.test(bankCode)) {
    return { error: 'A valid bank is required.' } as const;
  }
  if (!/^\d{10}$/.test(accountNumber)) {
    return { error: 'Enter your 10-digit NUBAN account number.' } as const;
  }
  return { accountNumber, bankCode, bankName: sanitizeOptionalText(data.bankName) } as const;
};

type RecipientRow = {
  accountName: string;
  accountNumberMasked: string;
  bankCode: string;
  bankName: string | null;
  holdReason: string | null;
  holdUntil: string | null;
  recipientCode: string;
  riderId: string;
  updatedAt: string;
  verifiedAt: string | null;
};

/**
 * Decides the hold after a (re)submission. Pure so the rule is testable:
 *   first submission                 -> no hold
 *   same account re-submitted        -> clears a failure hold (the rider is
 *                                       confirming the account), keeps any
 *                                       unexpired bank-change hold
 *   different account                -> BANK_CHANGE_HOLD_HOURS hold
 */
export const resolveBankSubmissionHold = (
  existing: Pick<RecipientRow, 'holdReason' | 'holdUntil' | 'recipientCode'> | null,
  nextRecipientCode: string,
  now: Date
): { changed: boolean; holdReason: string | null; holdUntil: string | null } => {
  if (!existing) {
    return { changed: false, holdReason: null, holdUntil: null };
  }
  if (existing.recipientCode !== nextRecipientCode) {
    return {
      changed: true,
      holdReason: 'bank_details_changed',
      holdUntil: new Date(now.getTime() + BANK_CHANGE_HOLD_HOURS * 3_600_000).toISOString(),
    };
  }
  const keepsChangeHold =
    existing.holdReason === 'bank_details_changed' &&
    Number.isFinite(Date.parse(existing.holdUntil ?? '')) &&
    Date.parse(existing.holdUntil ?? '') > now.getTime();
  return keepsChangeHold
    ? { changed: false, holdReason: existing.holdReason, holdUntil: existing.holdUntil }
    : { changed: false, holdReason: null, holdUntil: null };
};

const RECIPIENT_COLUMNS =
  'riderId,recipientCode,accountName,accountNumberMasked,bankCode,bankName,verifiedAt,holdUntil,holdReason,updatedAt';

const loadRecipient = async (riderId: string) => {
  const { data, error } = await serviceClient
    .from('RiderPayoutRecipient')
    .select(RECIPIENT_COLUMNS)
    .eq('riderId', riderId)
    .maybeSingle<RecipientRow>();
  if (error) {
    throw new Error(error.message);
  }
  return data ?? null;
};

const isPlatformRider = async (uid: string) => {
  const { data, error } = await serviceClient
    .from('UserRole')
    .select('userId')
    .eq('userId', uid)
    .eq('role', 'dispatch')
    .is('restaurantId', null)
    .limit(1);
  if (error) {
    throw new Error(error.message);
  }
  return Array.isArray(data) && data.length > 0;
};

const toRecipientResponse = (recipient: RecipientRow | null) =>
  recipient
    ? {
        accountName: recipient.accountName,
        accountNumberMasked: recipient.accountNumberMasked,
        bankCode: recipient.bankCode,
        bankName: recipient.bankName,
        // 'infinity' (failed/reversed transfer) is reported as an open-ended hold.
        holdReason: recipient.holdReason,
        holdUntil: recipient.holdUntil,
        verifiedAt: recipient.verifiedAt,
      }
    : null;

export const riderSubmitPayoutBank: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['dispatch']);
  if (!(await isPlatformRider(context.uid))) {
    fail(403, 'Only FEASTY platform riders are paid through FEASTY payouts.');
  }

  const input = validateRiderBankInput(data);
  if ('error' in input) {
    fail(400, input.error ?? 'Invalid bank details.');
  }
  const { accountNumber, bankCode, bankName } = input as { accountNumber: string; bankCode: string; bankName: string | null };

  const existing = await loadRecipient(context.uid);
  if (existing && Date.now() - Date.parse(existing.updatedAt) < BANK_SUBMIT_COOLDOWN_SECONDS * 1000) {
    fail(429, 'Please wait a minute before changing your bank details again.');
  }

  assertPaystackConfigured();
  let accountName = '';
  try {
    accountName = (await resolvePaystackBankAccount({ accountNumber, bankCode })).accountName;
  } catch (_error) {
    fail(422, 'We could not verify that bank account. Check the number and bank, then try again.');
  }
  if (!accountName) {
    fail(422, 'That bank account could not be verified. Check the details and try again.');
  }

  let created: { bankName: string | null; recipientCode: string };
  try {
    created = await createPaystackTransferRecipient({ accountName, accountNumber, bankCode });
  } catch (_error) {
    fail(502, 'We could not register that account for payouts right now. Please try again shortly.');
  }

  const now = new Date();
  const hold = resolveBankSubmissionHold(existing, created!.recipientCode, now);
  const row = {
    accountName,
    accountNumberMasked: maskAccountNumber(accountNumber),
    bankCode,
    bankName: created!.bankName ?? bankName,
    holdReason: hold.holdReason,
    holdUntil: hold.holdUntil,
    recipientCode: created!.recipientCode,
    riderId: context.uid,
    updatedAt: now.toISOString(),
    verifiedAt: now.toISOString(),
  };
  const { error } = await serviceClient.from('RiderPayoutRecipient').upsert(row, { onConflict: 'riderId' });
  if (error) {
    throw new Error(error.message);
  }

  if (hold.changed) {
    await recordOperationalAlert({
      alertType: 'rider_payout_bank_changed',
      dedupeKey: `ops:rider_payout_bank_changed:${context.uid}:${now.toISOString().slice(0, 10)}`,
      details: `Rider ${context.uid} changed their payout account to ${row.bankName ?? bankCode} ${row.accountNumberMasked} (${accountName}). Payouts are held until ${hold.holdUntil}. If the rider did not make this change, keep the hold and contact them.`,
      metadata: { holdUntil: hold.holdUntil, riderId: context.uid },
      severity: 'medium',
      subjectId: context.uid,
      subjectType: 'rider',
      title: 'Rider changed payout bank account',
    });
  }

  return json(200, { data: { recipient: toRecipientResponse(row) } });
};

export const riderGetPayoutProfile: Handler = async ({ context }) => {
  ensureRole(context.role, ['dispatch']);

  const [platformRider, recipient, earningsResult, payoutsResult] = await Promise.all([
    isPlatformRider(context.uid),
    loadRecipient(context.uid),
    serviceClient.from('RiderEarning').select('amount,status').eq('riderId', context.uid).limit(5000),
    serviceClient
      .from('RiderPayout')
      .select('id,amount,status,createdAt,paidAt')
      .eq('riderId', context.uid)
      .order('createdAt', { ascending: false })
      .limit(20),
  ]);
  if (earningsResult.error) {
    throw new Error(earningsResult.error.message);
  }
  if (payoutsResult.error) {
    throw new Error(payoutsResult.error.message);
  }

  const totals = { paid: 0, pending: 0, processing: 0 };
  for (const row of (earningsResult.data ?? []) as Array<{ amount: unknown; status: string }>) {
    if (row.status === 'pending' || row.status === 'processing' || row.status === 'paid') {
      totals[row.status] = Math.round((totals[row.status] + parseNumber(row.amount, 0)) * 100) / 100;
    }
  }

  return json(200, {
    data: {
      isPlatformRider: platformRider,
      minimumPayout: RIDER_PAYOUT_LIMITS.minPayout,
      payouts: ((payoutsResult.data ?? []) as Array<Record<string, unknown>>).map((payout) => ({
        amount: parseNumber(payout.amount, 0),
        createdAt: sanitizeOptionalText(payout.createdAt),
        id: sanitizeText(payout.id),
        paidAt: sanitizeOptionalText(payout.paidAt),
        status: sanitizeText(payout.status),
      })),
      recipient: toRecipientResponse(recipient),
      totals,
    },
  });
};

export const adminGetRiderPayouts: Handler = async ({ context }) => {
  ensureRole(context.role, ['admin']);

  const [payoutsResult, earningsResult, recipientsResult, flags] = await Promise.all([
    serviceClient
      .from('RiderPayout')
      .select('id,riderId,amount,status,reference,transferCode,failureReason,earningCount,createdAt,paidAt,updatedAt')
      .order('createdAt', { ascending: false })
      .limit(100),
    serviceClient.from('RiderEarning').select('riderId,amount,status').in('status', ['pending', 'processing']).limit(10000),
    serviceClient.from('RiderPayoutRecipient').select('riderId,holdUntil,holdReason,verifiedAt').limit(5000),
    loadFeatureFlagMap(),
  ]);
  for (const result of [payoutsResult, earningsResult, recipientsResult]) {
    if (result.error) {
      throw new Error(result.error.message);
    }
  }

  const payouts = (payoutsResult.data ?? []) as Array<Record<string, unknown>>;
  const recipients = (recipientsResult.data ?? []) as Array<{ holdReason: string | null; holdUntil: string | null; riderId: string; verifiedAt: string | null }>;
  const riderIds = [...new Set([...payouts.map((payout) => sanitizeText(payout.riderId)), ...recipients.map((r) => r.riderId)])].filter(Boolean);

  const names = new Map<string, string>();
  if (riderIds.length > 0) {
    const { data: riders, error } = await serviceClient
      .from('DispatchRiderRecord')
      .select('id,displayName')
      .in('id', riderIds.slice(0, 500));
    if (error) {
      throw new Error(error.message);
    }
    for (const rider of (riders ?? []) as Array<{ displayName: string; id: string }>) {
      names.set(rider.id, rider.displayName);
    }
  }

  const sum = (rows: Array<{ amount: unknown }>) =>
    Math.round(rows.reduce((total, row) => total + parseNumber(row.amount, 0), 0) * 100) / 100;
  const earnings = (earningsResult.data ?? []) as Array<{ amount: unknown; riderId: string; status: string }>;
  const nowMs = Date.now();
  const heldRecipients = recipients.filter((recipient) => {
    if (!recipient.holdUntil) return false;
    const parsed = Date.parse(recipient.holdUntil);
    return !Number.isFinite(parsed) || parsed > nowMs;
  });

  return json(200, {
    data: {
      autoPayoutsEnabled: isFeatureEnabled(flags, RIDER_AUTO_PAYOUTS_FLAG),
      generatedAt: nowIso(),
      heldRiders: heldRecipients.map((recipient) => ({
        displayName: names.get(recipient.riderId) ?? null,
        holdReason: recipient.holdReason,
        holdUntil: recipient.holdUntil,
        riderId: recipient.riderId,
      })),
      limits: RIDER_PAYOUT_LIMITS,
      payouts: payouts.map((payout) => ({
        amount: parseNumber(payout.amount, 0),
        createdAt: sanitizeOptionalText(payout.createdAt),
        earningCount: parseNumber(payout.earningCount, 0),
        failureReason: sanitizeOptionalText(payout.failureReason),
        id: sanitizeText(payout.id),
        paidAt: sanitizeOptionalText(payout.paidAt),
        reference: sanitizeText(payout.reference),
        riderId: sanitizeText(payout.riderId),
        riderName: names.get(sanitizeText(payout.riderId)) ?? null,
        status: sanitizeText(payout.status),
        transferCode: sanitizeOptionalText(payout.transferCode),
      })),
      totals: {
        pendingEarnings: sum(earnings.filter((row) => row.status === 'pending')),
        processingEarnings: sum(earnings.filter((row) => row.status === 'processing')),
        ridersWithRecipient: recipients.filter((recipient) => recipient.verifiedAt).length,
      },
    },
  });
};
