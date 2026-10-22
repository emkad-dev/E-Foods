# Rider payouts: operating notes

Automatic Paystack transfers of FEASTY platform riders' earnings (delivery pay + tips).
Code: `supabase/functions/_shared/riderPayouts.ts` (run), `supabase/functions/rider-payouts/`
(cron entrypoint), `supabase/functions/paystack-webhook/transfers.ts` (webhooks),
`supabase/migrations/20261020_rider_payouts.sql` (ledger + the two authoritative SQL functions).

## What gets paid, and when

An earning (`RiderEarning`) is created when a **platform-delivered** order is delivered by a
FEASTY global-pool rider with a verified handoff code. The daily run (09:00 UTC) pays an
earning only when **all** of these hold, checked in the planner and again in
`ebuy_create_rider_payout`:

- `rider_auto_payouts` feature flag is on;
- the delivery is older than the **clearing delay** (`RIDER_PAYOUT_LIMITS.clearingDays`, default
  7 days), so card chargebacks and refunds surface first;
- the rider is approved (`DispatchRiderRecord.verificationStatus = 'approved'`) and not suspended
  (`UserAccount.accountDisabled` not true);
- the rider has a verified payout account and neither hold is live:
  - **failure hold** (`holdUntil = 'infinity'`), set when a transfer fails or is reversed and
    cleared when the rider re-submits bank details;
  - **bank-change brake** (`bankChangedAt` + 24h), set when the rider switches to a different
    account. Re-submitting never clears it early;
- no other payout of theirs is `processing`, and the batch fits the caps (minimum ₦1,000,
  ₦50,000 per transfer, ₦100,000 per rider per Lagos day, ₦500,000 platform per day,
  25 transfers per run).

Only one run executes at a time (lease row `RiderPayoutRunLease`, 15-minute TTL). A run that
finds the lease held returns `status: 'lease_held'` and does nothing.

## IMPORTANT: one stuck payout halts every rider's payouts

Each run first **reconciles** payouts that have been `processing` for more than 30 minutes,
and **stops the whole run** (no new payouts for anyone) when it meets any of:

| Situation | Alert type | Why it halts |
|---|---|---|
| Re-sending a never-confirmed payout was rejected by Paystack (often "duplicate reference": the transfer exists after all) | `rider_payout_stuck` | The money may already have left; a human must look |
| Paystack reports an outcome that contradicts the ledger (success after release, failed after paid, amount mismatch) | `rider_payout_anomaly` | Possible double payment or wrong amount |
| The transfer is waiting for an OTP | `rider_payout_otp_required` | Transfer OTP is enabled on the Paystack account |
| Paystack rejected a new transfer (e.g. insufficient balance) | `rider_payout_failed` | Circuit breaker; the earnings were already returned to pending |
| Paystack gave no definite answer | `rider_payout_outcome_unknown` | Retried by the next run after verifying the reference |

The last two clear themselves on the next run once the cause is fixed. The first three halt
**every** run until the payout is resolved, because the same stuck payout is reconciled again
each time. A payout stuck for more than 24 hours is alerted on (`rider_payout_stuck`) and then
left alone; it does not halt the run.

### How to clear a stuck payout

1. Admin web, Dispatch page, **Rider payouts** card: note the payout's `reference`
   (`feasty_rp_…`). The alert also names it.
2. Paystack dashboard, Transfers: search for that reference.
3. Settle the ledger to match Paystack. Run this in the Supabase SQL editor; it is the same
   idempotent, row-locked function the webhook uses:
   - Paystack shows the transfer **succeeded**:
     `select public.ebuy_settle_rider_payout('<reference>', 'success', null, null, 'manual: verified in dashboard', false);`
   - Paystack shows it **failed / reversed**, or it does **not exist** (and you are sure it
     never will; cancel it in the dashboard if it is waiting for OTP):
     `select public.ebuy_settle_rider_payout('<reference>', 'failed', null, null, 'manual: not in dashboard', false);`
     This returns the earnings to pending so the next run pays them.
   - Pass `true` as the last argument instead to also put the rider on a failure hold
     (do this if the bank account itself is the problem).
4. If the alert was `rider_payout_anomaly`, do not settle anything until you have worked out
   from Paystack how much was actually paid. If a rider was paid twice, recover the money from
   them before releasing anything.
5. If the alert was `rider_payout_otp_required`: disable OTP for transfers in Paystack
   (Settings, Preferences), then finalise or cancel the waiting transfer in the dashboard and
   settle as above.

To stop all payouts immediately, turn off `rider_auto_payouts` (admin web, feature flags).
The cron keeps firing but every run returns `flag_off` before reading anything else.

### Releasing a failure hold or the bank-change brake by hand

Prefer having the rider re-submit their bank details. If an operator must:

- failure hold: `update public."RiderPayoutRecipient" set "holdUntil" = null, "holdReason" = null, "updatedAt" = now() where "riderId" = '<uid>';`
- bank-change brake (only after confirming the change with the rider by phone):
  `update public."RiderPayoutRecipient" set "bankChangedAt" = null, "updatedAt" = now() where "riderId" = '<uid>';`

## Turning it on

1. Apply `20261020_rider_payouts.sql`, deploy `rider-payouts`, `paystack-webhook` and the RPC
   functions, then apply `20261020b_rider_payouts_schedule.sql`.
2. Paystack: Transfers enabled, OTP for transfers **off**, IP whitelist off or covering the
   edge functions, balance funded, webhook URL subscribed.
3. Admin web, Restaurants: switch the pilot restaurant to **FEASTY riders** (requires the
   `platform_dispatch` flag for checkout to honour it).
4. Pilot riders submit bank details in the rider app.
5. Turn on `rider_auto_payouts`. The first payouts happen once the first earnings are older than
   the clearing delay.
