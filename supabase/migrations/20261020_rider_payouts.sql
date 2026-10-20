-- Rider pay: the money ledger for FEASTY platform riders.
--
-- ADDITIVE ONLY. Nothing here alters or drops an existing column, table,
-- trigger or function. CourierEarning and its trigger are left exactly as they
-- are: CourierEarning stays the rider-app activity/trip-count ledger (one row
-- per delivered assignment, any rider, amount = pricing.dispatchFee, upserted
-- on re-delivery). It cannot be the payable ledger because its trigger
-- REWRITES courierId/amount on a re-delivery, which would corrupt a row that
-- had already been paid. RiderEarning below is insert-once and never rewritten
-- by a trigger; for a platform order its deliveryPay equals CourierEarning's
-- amount (both read pricing.dispatchFee), so the two agree where they overlap.
--
-- Money flow this ledger serves (see _shared/pricing.ts + deliveryProvider.ts):
--   * A 'platform' order (pricing.deliveryProvider = 'platform') settles only
--     restaurantPayable to the restaurant subaccount. The delivery fee and the
--     tip stay in the FEASTY Paystack balance.
--   * When a FEASTY rider (dispatch UserRole with restaurantId NULL) delivers
--     it AND the customer's handoff code was verified, one RiderEarning row is
--     created: deliveryPay = pricing.dispatchFee (the full delivery fee),
--     tipAmount = pricing.tip.
--   * The rider-payouts edge function batches pending earnings per rider into
--     a RiderPayout and sends a Paystack transfer with a deterministic
--     reference. Paystack transfer webhooks settle the payout.
--
-- Status machine (enforced by the two functions at the bottom, under row
-- locks, never by the edge code alone):
--   RiderEarning: pending -> processing (attached to a payout) -> paid
--                 processing -> pending (payout failed / reversed)
--   RiderPayout:  processing -> paid | failed | reversed ; paid -> reversed
--
-- All three tables are RLS-enabled with NO policies and are revoked from
-- anon/authenticated: service-role only, like OperationalAlert.
--
-- Apply order: this file first, then deploy functions, then (optionally)
-- 20261020b_rider_payouts_schedule.sql. Safe to apply before the deploy: the
-- new column defaults to 'restaurant' (today's behaviour) and the
-- rider_auto_payouts flag is seeded OFF.

-- ---------------------------------------------------------------------------
-- 1. Restaurant opt-in to FEASTY riders.
-- ---------------------------------------------------------------------------
alter table public."RestaurantRecord"
  add column if not exists "deliveryProvider" text not null default 'restaurant';

do $$
begin
  alter table public."RestaurantRecord"
    add constraint "RestaurantRecord_deliveryProvider_check"
    check ("deliveryProvider" in ('restaurant', 'platform'));
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Ledger tables.
-- ---------------------------------------------------------------------------
create table if not exists public."RiderPayoutRecipient" (
  "riderId"           text primary key,
  "recipientCode"     text not null,
  "accountName"       text not null,
  -- Masked only ('******1234'). The full number lives with Paystack.
  "accountNumberMasked" text not null,
  "bankCode"          text not null,
  "bankName"          text,
  "verifiedAt"        timestamptz,
  -- Payouts are skipped while holdUntil is in the future. Set for 24h when an
  -- existing rider changes bank account (account-takeover brake) and to
  -- 'infinity' when a transfer fails or is reversed (cleared by resubmitting).
  "holdUntil"         timestamptz,
  "holdReason"        text,
  "createdAt"         timestamptz not null default now(),
  "updatedAt"         timestamptz not null default now()
);

create table if not exists public."RiderPayout" (
  "id"             text primary key,
  "riderId"        text not null,
  "amount"         numeric(12, 2) not null check ("amount" > 0),
  "currency"       text not null default 'NGN',
  -- Deterministic: 'feasty_rp_' || id. Paystack refuses a second transfer
  -- with the same reference, so a retried initiation can never pay twice.
  "reference"      text not null unique,
  "recipientCode"  text not null,
  "status"         text not null default 'processing'
                   check ("status" in ('processing', 'paid', 'failed', 'reversed')),
  "earningCount"   integer not null default 0,
  "transferCode"   text,
  "paystackStatus" text,
  "failureReason"  text,
  "initiatedAt"    timestamptz,
  "paidAt"         timestamptz,
  "settledAt"      timestamptz,
  "lastEvent"      text,
  "lastEventAt"    timestamptz,
  "createdAt"      timestamptz not null default now(),
  "updatedAt"      timestamptz not null default now()
);

create index if not exists "RiderPayout_riderId_createdAt_idx"
  on public."RiderPayout" ("riderId", "createdAt" desc);
create index if not exists "RiderPayout_status_updatedAt_idx"
  on public."RiderPayout" ("status", "updatedAt");
-- At most one in-flight payout per rider.
create unique index if not exists "RiderPayout_one_processing_per_rider_idx"
  on public."RiderPayout" ("riderId") where "status" = 'processing';

create table if not exists public."RiderEarning" (
  "id"                     text primary key default (gen_random_uuid())::text,
  -- One earning per order, ever: the idempotency key for the trigger.
  "orderId"                text not null unique,
  "riderId"                text not null,
  "restaurantId"           text,
  "deliveryPay"            numeric(12, 2) not null default 0 check ("deliveryPay" >= 0),
  "tipAmount"              numeric(12, 2) not null default 0 check ("tipAmount" >= 0),
  "amount"                 numeric(12, 2) generated always as ("deliveryPay" + "tipAmount") stored,
  "currency"               text not null default 'NGN',
  "status"                 text not null default 'pending'
                           check ("status" in ('pending', 'processing', 'paid')),
  "payoutId"               text references public."RiderPayout" ("id"),
  "deliveredAt"            timestamptz,
  "deliveryCodeVerifiedAt" timestamptz not null,
  "createdAt"              timestamptz not null default now(),
  "updatedAt"              timestamptz not null default now(),
  -- An earning is attached to a payout exactly while it is processing or paid.
  constraint "RiderEarning_payout_matches_status"
    check (("status" = 'pending') = ("payoutId" is null))
);

create index if not exists "RiderEarning_riderId_status_idx"
  on public."RiderEarning" ("riderId", "status", "deliveredAt");
create index if not exists "RiderEarning_payoutId_idx"
  on public."RiderEarning" ("payoutId");

alter table public."RiderPayoutRecipient" enable row level security;
alter table public."RiderPayout" enable row level security;
alter table public."RiderEarning" enable row level security;

revoke all on table public."RiderPayoutRecipient" from public, anon, authenticated;
revoke all on table public."RiderPayout" from public, anon, authenticated;
revoke all on table public."RiderEarning" from public, anon, authenticated;
grant select, insert, update, delete on table public."RiderPayoutRecipient" to service_role;
grant select, insert, update, delete on table public."RiderPayout" to service_role;
grant select, insert, update, delete on table public."RiderEarning" to service_role;

-- ---------------------------------------------------------------------------
-- 3. Feature flag, seeded OFF. Nothing transfers money until an admin turns
--    this on (admin web -> feature flags).
-- ---------------------------------------------------------------------------
insert into public."FeatureFlag" ("key", "enabled", "description", "updatedAt")
values (
  'rider_auto_payouts',
  false,
  'Automatic Paystack transfers of FEASTY rider earnings (delivery pay + tips). Leave OFF until Transfers are enabled, transfer OTP is disabled and the balance is funded.',
  now()
)
on conflict ("key") do nothing;

-- ---------------------------------------------------------------------------
-- 4. Alert helper. Never raises: an alert is a signal, not a gate.
-- ---------------------------------------------------------------------------
create or replace function public.ebuy_rider_pay_alert(
  p_dedupe_key text,
  p_alert_type text,
  p_severity text,
  p_subject_type text,
  p_subject_id text,
  p_title text,
  p_details text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public."OperationalAlert" (
    "dedupeKey", "alertType", "severity", "subjectType", "subjectId", "title", "details", "metadata"
  ) values (
    p_dedupe_key, p_alert_type, p_severity, p_subject_type, p_subject_id, p_title, p_details,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict ("dedupeKey") do update set
    "details" = excluded."details",
    "metadata" = excluded."metadata",
    "updatedAt" = now();
exception
  when others then
    raise warning 'rider pay alert % not recorded: %', p_dedupe_key, sqlerrm;
end;
$$;

revoke all on function public.ebuy_rider_pay_alert(text, text, text, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.ebuy_rider_pay_alert(text, text, text, text, text, text, text, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. Earning on verified delivery.
--
-- Fires on the transition into "delivered with a verified handoff code"
-- (status and deliveryCodeVerifiedAt land in ONE update in dispatch.ts, but
-- either order of writes is handled). Creates an earning ONLY when:
--   * the order was paid under platform delivery (pricing.deliveryProvider),
--   * it is a delivery order whose payment.status is 'paid',
--   * the assigned courier is a FEASTY platform rider (global pool),
--   * deliveryCodeVerifiedAt is set (proof of delivery).
-- `on conflict ("orderId") do nothing` makes reruns (delivered -> other ->
-- delivered) a no-op and never touches an earning already being paid.
-- Anything that SHOULD have earned but cannot (admin override with no code,
-- unpaid, non-platform courier, error) raises an OperationalAlert for manual
-- review instead of silently paying or silently dropping.
-- The whole body is exception-guarded: a rider must never be unable to
-- complete a delivery because the ledger write failed.
-- ---------------------------------------------------------------------------
create or replace function public.ebuy_record_rider_earning_on_delivery()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_courier_id text;
  v_is_platform_rider boolean;
  v_delivery_pay numeric(12, 2);
  v_tip numeric(12, 2);
  v_delivered_at timestamptz;
  v_numeric constant text := '^[[:space:]]*[0-9]+(\.[0-9]+)?[[:space:]]*$';
begin
  if coalesce(new."status", '') <> 'delivered' then
    return new;
  end if;
  if coalesce(new."pricing"->>'deliveryProvider', '') <> 'platform' then
    return new;
  end if;
  -- Already handled: was delivered-and-verified before this update.
  if coalesce(old."status", '') = 'delivered' and old."deliveryCodeVerifiedAt" is not null then
    return new;
  end if;

  begin
    if new."deliveryCodeVerifiedAt" is null then
      -- Only alert on the transition into delivered, not on later edits.
      if coalesce(old."status", '') <> 'delivered' then
        perform public.ebuy_rider_pay_alert(
          'ops:rider_earning_unverified:' || new."id",
          'rider_earning_needs_review', 'medium', 'order', new."id",
          'Platform delivery completed without a verified code',
          'Order ' || new."id" || ' was marked delivered without the customer handoff code (admin override?). No rider earning was created; review and pay the rider manually if appropriate.',
          jsonb_build_object('reason', 'delivery_code_not_verified')
        );
      end if;
      return new;
    end if;

    if coalesce(new."fulfillmentType", 'delivery') <> 'delivery' then
      return new;
    end if;

    select da."courierId" into v_courier_id
      from public."DeliveryAssignment" da
     where da."orderId" = new."id"
     limit 1;

    if v_courier_id is null or btrim(v_courier_id) = '' then
      perform public.ebuy_rider_pay_alert(
        'ops:rider_earning_no_courier:' || new."id",
        'rider_earning_needs_review', 'medium', 'order', new."id",
        'Platform delivery has no assigned courier',
        'Order ' || new."id" || ' was delivered with a verified code but has no DeliveryAssignment courier. No rider earning was created.',
        jsonb_build_object('reason', 'no_courier')
      );
      return new;
    end if;

    if coalesce(new."payment"->>'status', '') <> 'paid' then
      perform public.ebuy_rider_pay_alert(
        'ops:rider_earning_unpaid_order:' || new."id",
        'rider_earning_needs_review', 'high', 'order', new."id",
        'Platform delivery on an order that is not paid',
        'Order ' || new."id" || ' was delivered by rider ' || v_courier_id || ' but its payment status is ' || coalesce(new."payment"->>'status', 'missing') || '. No rider earning was created.',
        jsonb_build_object('reason', 'order_not_paid', 'riderId', v_courier_id)
      );
      return new;
    end if;

    select exists (
      select 1 from public."UserRole" ur
       where ur."userId" = v_courier_id
         and ur."role"::text = 'dispatch'
         and ur."restaurantId" is null
    ) into v_is_platform_rider;

    if not v_is_platform_rider then
      perform public.ebuy_rider_pay_alert(
        'ops:rider_earning_not_platform_rider:' || new."id",
        'rider_earning_needs_review', 'high', 'order', new."id",
        'Platform-paid order delivered by a non-FEASTY rider',
        'Order ' || new."id" || ' kept its delivery fee with FEASTY but was delivered by ' || v_courier_id || ', who is not a FEASTY platform rider. No rider earning was created; the fee may be owed to the restaurant.',
        jsonb_build_object('reason', 'courier_not_platform_rider', 'courierId', v_courier_id)
      );
      return new;
    end if;

    -- Same source and precedence as CourierEarning: dispatchFee, then
    -- deliveryFee, then 0. Non-negative numbers only.
    v_delivery_pay := coalesce(
      (case when (new."pricing"->>'dispatchFee') ~ v_numeric then (new."pricing"->>'dispatchFee')::numeric end),
      (case when (new."pricing"->>'deliveryFee') ~ v_numeric then (new."pricing"->>'deliveryFee')::numeric end),
      0
    );
    v_tip := coalesce(
      (case when (new."pricing"->>'tip') ~ v_numeric then (new."pricing"->>'tip')::numeric end),
      0
    );

    begin
      v_delivered_at := nullif(btrim(coalesce(new."timeline"->>'deliveredAt', '')), '')::timestamptz;
    exception
      when others then
        v_delivered_at := null;
    end;
    v_delivered_at := coalesce(v_delivered_at, new."deliveryCodeVerifiedAt", now());

    insert into public."RiderEarning" (
      "orderId", "riderId", "restaurantId", "deliveryPay", "tipAmount", "currency",
      "status", "deliveredAt", "deliveryCodeVerifiedAt"
    ) values (
      new."id", v_courier_id, new."restaurantId", round(v_delivery_pay, 2), round(v_tip, 2),
      coalesce(nullif(btrim(coalesce(new."pricing"->>'currency', '')), ''), 'NGN'),
      'pending', v_delivered_at, new."deliveryCodeVerifiedAt"
    )
    on conflict ("orderId") do nothing;
  exception
    when others then
      raise warning 'rider earning not recorded for order %: %', new."id", sqlerrm;
      perform public.ebuy_rider_pay_alert(
        'ops:rider_earning_failed:' || new."id",
        'rider_earning_needs_review', 'high', 'order', new."id",
        'Rider earning could not be recorded',
        'Recording the rider earning for order ' || new."id" || ' failed: ' || sqlerrm || '. Create it manually.',
        jsonb_build_object('reason', 'insert_failed')
      );
  end;

  return new;
end;
$$;

revoke all on function public.ebuy_record_rider_earning_on_delivery() from public, anon, authenticated;

drop trigger if exists "RiderEarning_on_verified_delivery" on public."CustomerOrder";
create trigger "RiderEarning_on_verified_delivery"
  after update of "status", "deliveryCodeVerifiedAt" on public."CustomerOrder"
  for each row
  execute function public.ebuy_record_rider_earning_on_delivery();

-- ---------------------------------------------------------------------------
-- 6. Create a payout: the authority on never-double-pay and on the caps.
--
-- The edge function PLANS a batch (riderPayouts.ts, unit-tested); this
-- function re-validates every hard invariant under locks and either creates
-- the payout atomically or refuses with a reason. Serialized platform-wide by
-- an advisory xact lock because the daily caps are read-then-write.
-- ---------------------------------------------------------------------------
create or replace function public.ebuy_create_rider_payout(
  p_payout_id text,
  p_rider_id text,
  p_earning_ids text[],
  p_amount numeric,
  p_min_payout numeric,
  p_max_per_transfer numeric,
  p_max_per_rider_day numeric,
  p_max_platform_day numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recipient public."RiderPayoutRecipient"%rowtype;
  v_requested integer;
  v_locked integer;
  v_sum numeric(12, 2);
  v_day_start timestamptz := date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
  v_rider_today numeric(12, 2);
  v_platform_today numeric(12, 2);
  v_reference text;
begin
  perform pg_advisory_xact_lock(hashtext('ebuy_rider_payouts'));

  if p_payout_id is null or p_payout_id !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payout_id');
  end if;
  if p_min_payout is null or p_max_per_transfer is null or p_max_per_rider_day is null or p_max_platform_day is null
     or p_min_payout <= 0 or p_max_per_transfer <= 0 or p_max_per_rider_day <= 0 or p_max_platform_day <= 0
     or p_min_payout > p_max_per_transfer then
    return jsonb_build_object('ok', false, 'reason', 'invalid_caps');
  end if;

  select count(distinct x) into v_requested from unnest(coalesce(p_earning_ids, '{}'::text[])) as x;
  if v_requested = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_earnings');
  end if;

  select * into v_recipient from public."RiderPayoutRecipient" where "riderId" = p_rider_id for update;
  if not found or v_recipient."verifiedAt" is null then
    return jsonb_build_object('ok', false, 'reason', 'no_verified_recipient');
  end if;
  if v_recipient."holdUntil" is not null and v_recipient."holdUntil" > now() then
    return jsonb_build_object('ok', false, 'reason', 'recipient_on_hold');
  end if;

  if exists (
    select 1 from public."RiderPayout" where "riderId" = p_rider_id and "status" = 'processing'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'payout_in_flight');
  end if;

  select count(*), coalesce(sum(e."amount"), 0) into v_locked, v_sum
    from (
      select "amount" from public."RiderEarning"
       where "id" = any(p_earning_ids)
         and "riderId" = p_rider_id
         and "status" = 'pending'
         and "payoutId" is null
       for update
    ) as e;

  if v_locked <> v_requested then
    return jsonb_build_object('ok', false, 'reason', 'earnings_changed');
  end if;
  if v_sum <> round(p_amount, 2) then
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch', 'amount', v_sum);
  end if;
  if v_sum < p_min_payout then
    return jsonb_build_object('ok', false, 'reason', 'below_minimum', 'amount', v_sum);
  end if;
  if v_sum > p_max_per_transfer then
    return jsonb_build_object('ok', false, 'reason', 'over_transfer_cap', 'amount', v_sum);
  end if;

  -- Money that left or may still leave today: processing + paid. A failed or
  -- reversed payout returned its earnings and does not count.
  select coalesce(sum("amount"), 0) into v_rider_today
    from public."RiderPayout"
   where "riderId" = p_rider_id and "status" in ('processing', 'paid') and "createdAt" >= v_day_start;
  if v_rider_today + v_sum > p_max_per_rider_day then
    return jsonb_build_object('ok', false, 'reason', 'over_rider_daily_cap', 'amount', v_sum);
  end if;

  select coalesce(sum("amount"), 0) into v_platform_today
    from public."RiderPayout"
   where "status" in ('processing', 'paid') and "createdAt" >= v_day_start;
  if v_platform_today + v_sum > p_max_platform_day then
    return jsonb_build_object('ok', false, 'reason', 'over_platform_daily_cap', 'amount', v_sum);
  end if;

  v_reference := 'feasty_rp_' || p_payout_id;

  insert into public."RiderPayout" (
    "id", "riderId", "amount", "currency", "reference", "recipientCode", "status", "earningCount"
  ) values (
    p_payout_id, p_rider_id, v_sum, 'NGN', v_reference, v_recipient."recipientCode", 'processing', v_locked
  );

  update public."RiderEarning"
     set "status" = 'processing', "payoutId" = p_payout_id, "updatedAt" = now()
   where "id" = any(p_earning_ids);

  return jsonb_build_object(
    'ok', true,
    'payoutId', p_payout_id,
    'reference', v_reference,
    'recipientCode', v_recipient."recipientCode",
    'amount', v_sum
  );
end;
$$;

revoke all on function public.ebuy_create_rider_payout(text, text, text[], numeric, numeric, numeric, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.ebuy_create_rider_payout(text, text, text[], numeric, numeric, numeric, numeric, numeric)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. Settle a payout from a Paystack outcome (webhook, reconcile, or an
--    immediate initiation answer). Idempotent: a repeated or out-of-order
--    event is a no-op or a reported anomaly, never a second state change.
--
--   outcome   from processing        from paid               from failed/reversed
--   success   -> paid (+earnings)    no-op                   ANOMALY, no change
--   failed    -> failed (release)    ANOMALY, no change      no-op
--   reversed  -> reversed (release)  -> reversed (release)   no-op
--
-- "release" = the payout's earnings go back to pending (payoutId null) so the
-- next run can pay them; p_hold_recipient additionally puts the rider's
-- recipient on indefinite hold so they are not retried into a bad account.
-- An amount that disagrees with the payout is an anomaly and changes nothing.
-- ---------------------------------------------------------------------------
create or replace function public.ebuy_settle_rider_payout(
  p_reference text,
  p_outcome text,
  p_transfer_code text,
  p_amount_kobo bigint,
  p_reason text,
  p_hold_recipient boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payout public."RiderPayout"%rowtype;
  v_previous text;
  v_released integer := 0;
begin
  if p_outcome not in ('success', 'failed', 'reversed') then
    return jsonb_build_object('matched', false, 'changed', false, 'reason', 'invalid_outcome');
  end if;

  select * into v_payout from public."RiderPayout" where "reference" = p_reference for update;
  if not found then
    return jsonb_build_object('matched', false, 'changed', false);
  end if;
  v_previous := v_payout."status";

  update public."RiderPayout"
     set "lastEvent" = p_outcome,
         "lastEventAt" = now(),
         "transferCode" = coalesce("transferCode", nullif(btrim(coalesce(p_transfer_code, '')), '')),
         "updatedAt" = now()
   where "id" = v_payout."id";

  if p_amount_kobo is not null and p_amount_kobo <> round(v_payout."amount" * 100)::bigint then
    return jsonb_build_object(
      'matched', true, 'changed', false, 'previousStatus', v_previous, 'status', v_previous,
      'anomaly', 'amount_mismatch', 'payoutId', v_payout."id", 'riderId', v_payout."riderId"
    );
  end if;

  if p_outcome = 'success' then
    if v_previous = 'paid' then
      return jsonb_build_object('matched', true, 'changed', false, 'previousStatus', v_previous, 'status', 'paid',
        'payoutId', v_payout."id", 'riderId', v_payout."riderId");
    elsif v_previous = 'processing' then
      update public."RiderPayout"
         set "status" = 'paid', "paidAt" = now(), "settledAt" = now(), "paystackStatus" = 'success', "updatedAt" = now()
       where "id" = v_payout."id";
      update public."RiderEarning"
         set "status" = 'paid', "updatedAt" = now()
       where "payoutId" = v_payout."id";
      return jsonb_build_object('matched', true, 'changed', true, 'previousStatus', v_previous, 'status', 'paid',
        'payoutId', v_payout."id", 'riderId', v_payout."riderId");
    else
      return jsonb_build_object('matched', true, 'changed', false, 'previousStatus', v_previous, 'status', v_previous,
        'anomaly', 'success_after_release', 'payoutId', v_payout."id", 'riderId', v_payout."riderId");
    end if;
  end if;

  if p_outcome = 'failed' then
    if v_previous in ('failed', 'reversed') then
      return jsonb_build_object('matched', true, 'changed', false, 'previousStatus', v_previous, 'status', v_previous,
        'payoutId', v_payout."id", 'riderId', v_payout."riderId");
    elsif v_previous = 'paid' then
      return jsonb_build_object('matched', true, 'changed', false, 'previousStatus', v_previous, 'status', v_previous,
        'anomaly', 'failed_after_paid', 'payoutId', v_payout."id", 'riderId', v_payout."riderId");
    end if;
  end if;

  if p_outcome = 'reversed' and v_previous in ('failed', 'reversed') then
    return jsonb_build_object('matched', true, 'changed', false, 'previousStatus', v_previous, 'status', v_previous,
      'payoutId', v_payout."id", 'riderId', v_payout."riderId");
  end if;

  -- failed from processing, or reversed from processing/paid: release.
  update public."RiderPayout"
     set "status" = p_outcome,
         "failureReason" = left(coalesce(nullif(btrim(coalesce(p_reason, '')), ''), p_outcome), 500),
         "paystackStatus" = p_outcome,
         "settledAt" = now(),
         "updatedAt" = now()
   where "id" = v_payout."id";

  update public."RiderEarning"
     set "status" = 'pending', "payoutId" = null, "updatedAt" = now()
   where "payoutId" = v_payout."id";
  get diagnostics v_released = row_count;

  if coalesce(p_hold_recipient, false) then
    update public."RiderPayoutRecipient"
       set "holdUntil" = 'infinity'::timestamptz,
           "holdReason" = 'transfer_' || p_outcome,
           "updatedAt" = now()
     where "riderId" = v_payout."riderId";
  end if;

  return jsonb_build_object('matched', true, 'changed', true, 'previousStatus', v_previous, 'status', p_outcome,
    'released', v_released, 'payoutId', v_payout."id", 'riderId', v_payout."riderId");
end;
$$;

revoke all on function public.ebuy_settle_rider_payout(text, text, text, bigint, text, boolean)
  from public, anon, authenticated;
grant execute on function public.ebuy_settle_rider_payout(text, text, text, bigint, text, boolean)
  to service_role;

notify pgrst, 'reload schema';
