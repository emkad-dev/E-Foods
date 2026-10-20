// Pins the database-side money invariants of the rider-pay ledger. The SQL
// cannot run in this suite (no Postgres), so these assert the exact clauses
// that make each guarantee hold; deleting or weakening one fails here.

import { assertEquals } from 'jsr:@std/assert';

const sql = await Deno.readTextFile(new URL('../../migrations/20261020_rider_payouts.sql', import.meta.url));
const schedule = await Deno.readTextFile(
  new URL('../../migrations/20261020b_rider_payouts_schedule.sql', import.meta.url)
);

const has = (needle: string, label: string, source = sql) => assertEquals(source.includes(needle), true, label);

Deno.test('migration is additive: no drops of existing objects, no alters of existing columns', () => {
  const lowered = sql.toLowerCase();
  assertEquals(/drop\s+table/.test(lowered), false, 'no drop table');
  assertEquals(/drop\s+column/.test(lowered), false, 'no drop column');
  assertEquals(/alter\s+column/.test(lowered), false, 'no alter column');
  // The only drop is of this migration's own trigger (idempotent re-apply).
  const drops = lowered.match(/drop\s+trigger[^;]*/g) ?? [];
  assertEquals(drops, ['drop trigger if exists "riderearning_on_verified_delivery" on public."customerorder"']);
  has('add column if not exists "deliveryProvider" text not null default \'restaurant\'', 'opt-in defaults to restaurant');
});

Deno.test('ledger tables are RLS-on and service-role only', () => {
  for (const table of ['RiderPayoutRecipient', 'RiderPayout', 'RiderEarning']) {
    has(`alter table public."${table}" enable row level security;`, `${table} RLS`);
    has(`revoke all on table public."${table}" from public, anon, authenticated;`, `${table} revoked`);
  }
  assertEquals(/create\s+policy/i.test(sql), false, 'no policies: nothing but service_role can read');
});

Deno.test('one earning per order, insert-once', () => {
  has('"orderId"                text not null unique', 'unique orderId');
  has('on conflict ("orderId") do nothing;', 'reruns are a no-op, never an update of a paid row');
  has('check (("status" = \'pending\') = ("payoutId" is null))', 'attached exactly while processing/paid');
});

Deno.test('earnings require verified delivery, platform stamp, paid order and a FEASTY rider', () => {
  has("if coalesce(new.\"pricing\"->>'deliveryProvider', '') <> 'platform' then", 'platform orders only');
  has('if new."deliveryCodeVerifiedAt" is null then', 'proof of delivery required');
  has("if coalesce(new.\"payment\"->>'status', '') <> 'paid' then", 'paid orders only');
  has('and ur."restaurantId" is null', 'global-pool rider only');
  has('after update of "status", "deliveryCodeVerifiedAt" on public."CustomerOrder"', 'fires on either column');
  has("(new.\"pricing\"->>'dispatchFee')", 'rider pay = pricing.dispatchFee (same source as CourierEarning)');
});

Deno.test('payout creation re-validates every cap under a platform-wide lock', () => {
  has("perform pg_advisory_xact_lock(hashtext('ebuy_rider_payouts'));", 'serialized');
  has('for update', 'earnings row-locked');
  for (const reason of [
    'no_verified_recipient',
    'recipient_on_hold',
    'payout_in_flight',
    'earnings_changed',
    'amount_mismatch',
    'below_minimum',
    'over_transfer_cap',
    'over_rider_daily_cap',
    'over_platform_daily_cap',
  ]) {
    has(`'${reason}'`, `refusal ${reason}`);
  }
  has("v_reference := 'feasty_rp_' || p_payout_id;", 'deterministic reference');
  has('"reference"      text not null unique', 'reference unique');
  has('on public."RiderPayout" ("riderId") where "status" = \'processing\'', 'one in-flight payout per rider');
});

Deno.test('settlement is idempotent and anomalies never change state', () => {
  has("select * into v_payout from public.\"RiderPayout\" where \"reference\" = p_reference for update;", 'payout locked');
  has("'anomaly', 'success_after_release'", 'late success after release is reported, not applied');
  has("'anomaly', 'failed_after_paid'", 'failed after paid is reported, not applied');
  has("'anomaly', 'amount_mismatch'", 'amount mismatch is reported, not applied');
  has('set "status" = \'pending\', "payoutId" = null', 'release returns earnings to pending');
  has('"holdUntil" = \'infinity\'::timestamptz', 'failed/reversed recipient held');
});

Deno.test('the payout flag is seeded OFF', () => {
  assertEquals(/'rider_auto_payouts',\s*false,/.test(sql), true, 'seeded disabled');
  has('on conflict ("key") do nothing;', 'never flips an existing flag');
});

Deno.test('cron schedule targets rider-payouts with the worker token', () => {
  has("'rider-payouts-daily'", 'job name', schedule);
  has("/functions/v1/rider-payouts'", 'function url', schedule);
  has("'x-queue-worker-token', credentials.queue_worker_token", 'worker token header', schedule);
});
