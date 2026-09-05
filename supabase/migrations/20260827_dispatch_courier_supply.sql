-- Dispatch courier supply: onboarding KYC, shift slots, earnings ledger, and payouts.
--
-- Access model: these tables are service-role only. All reads and writes go
-- through Edge Functions using the service_role key, which BYPASSES RLS.
-- RLS is enabled with NO policies so nothing is reachable through the Data API
-- or Realtime.

-- =====================================================================
-- DispatchApplicationRecord additive courier columns
-- =====================================================================
ALTER TABLE public."DispatchApplicationRecord"
  ADD COLUMN IF NOT EXISTS "vehicleMake" TEXT,
  ADD COLUMN IF NOT EXISTS "vehicleModel" TEXT,
  ADD COLUMN IF NOT EXISTS "vehiclePlateNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "licenseNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "licenceFrontPath" TEXT,
  ADD COLUMN IF NOT EXISTS "licenceBackPath" TEXT,
  ADD COLUMN IF NOT EXISTS "verificationStatus" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "verifiedByUid" TEXT,
  ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewNotes" TEXT;

-- =====================================================================
-- DispatchRiderRecord additive courier columns
-- =====================================================================
ALTER TABLE public."DispatchRiderRecord"
  ADD COLUMN IF NOT EXISTS "vehicleMake" TEXT,
  ADD COLUMN IF NOT EXISTS "vehicleModel" TEXT,
  ADD COLUMN IF NOT EXISTS "vehiclePlateNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "licenseNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "verificationStatus" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "verifiedByUid" TEXT,
  ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP(3);

-- =====================================================================
-- CourierShiftSlot
-- =====================================================================
CREATE TABLE IF NOT EXISTS public."CourierShiftSlot" (
  "id"             TEXT PRIMARY KEY,
  "courierId"      TEXT NOT NULL,
  "startsAt"       TIMESTAMP(3) NOT NULL,
  "endsAt"         TIMESTAMP(3) NOT NULL,
  "forecastDemand" INTEGER NOT NULL DEFAULT 0,
  "status"         TEXT NOT NULL DEFAULT 'planned',
  "notes"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CourierShiftSlot_courierId_fkey"
    FOREIGN KEY ("courierId") REFERENCES public."UserAccount" ("uid")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CourierShiftSlot_window_check"
    CHECK ("endsAt" > "startsAt")
);

CREATE INDEX IF NOT EXISTS "CourierShiftSlot_courierId_startsAt_idx"
  ON public."CourierShiftSlot" ("courierId", "startsAt" DESC);

ALTER TABLE public."CourierShiftSlot" ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- CourierEarning
-- =====================================================================
CREATE TABLE IF NOT EXISTS public."CourierEarning" (
  "id"             TEXT PRIMARY KEY,
  "courierId"      TEXT NOT NULL,
  "orderId"        TEXT NOT NULL UNIQUE,
  "amount"         NUMERIC(12, 2) NOT NULL DEFAULT 0,
  "currency"       TEXT NOT NULL DEFAULT 'NGN',
  "deliveredAt"    TIMESTAMP(3) NOT NULL,
  "restaurantId"   TEXT,
  "restaurantName" TEXT,
  "payoutId"       TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "CourierEarning_courierId_deliveredAt_idx"
  ON public."CourierEarning" ("courierId", "deliveredAt" DESC);

ALTER TABLE public."CourierEarning" ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- CourierPayout
-- =====================================================================
CREATE TABLE IF NOT EXISTS public."CourierPayout" (
  "id"             TEXT PRIMARY KEY,
  "courierId"      TEXT NOT NULL,
  "periodStartsAt" TIMESTAMP(3) NOT NULL,
  "periodEndsAt"   TIMESTAMP(3) NOT NULL,
  "currency"       TEXT NOT NULL DEFAULT 'NGN',
  "ledgerTotal"    NUMERIC(12, 2) NOT NULL DEFAULT 0,
  "status"         TEXT NOT NULL DEFAULT 'pending',
  "paidAt"         TIMESTAMP(3),
  "reference"      TEXT,
  "reviewNotes"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CourierPayout_courierId_fkey"
    FOREIGN KEY ("courierId") REFERENCES public."UserAccount" ("uid")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CourierPayout_window_check"
    CHECK ("periodEndsAt" > "periodStartsAt")
);

CREATE INDEX IF NOT EXISTS "CourierPayout_courierId_periodStartsAt_idx"
  ON public."CourierPayout" ("courierId", "periodStartsAt" DESC);
CREATE INDEX IF NOT EXISTS "CourierPayout_status_idx"
  ON public."CourierPayout" ("status");

ALTER TABLE public."CourierPayout" ENABLE ROW LEVEL SECURITY;

do $$
begin
  alter publication supabase_realtime add table public."CourierShiftSlot";
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public."CourierEarning";
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public."CourierPayout";
exception
  when duplicate_object then null;
end $$;

-- =====================================================================
-- Courier earning accrual on delivery
-- =====================================================================
create or replace function public.ebuy_record_courier_earning_on_delivery()
returns trigger
language plpgsql
as $$
declare
  v_courier_id text;
  v_amount numeric(12, 2);
  v_currency text;
  v_delivered_at timestamptz;
begin
  if new."status" <> 'delivered' or old."status" = 'delivered' then
    return new;
  end if;

  select da."courierId"
    into v_courier_id
    from public."DeliveryAssignment" da
   where da."orderId" = new."id"
   limit 1;

  if v_courier_id is null or btrim(v_courier_id) = '' then
    return new;
  end if;

  v_amount := coalesce(
    nullif(new."pricing"->>'dispatchFee', '')::numeric,
    nullif(new."pricing"->>'deliveryFee', '')::numeric,
    0
  );
  v_currency := coalesce(new."pricing"->>'currency', 'NGN');
  v_delivered_at := coalesce(
    nullif(new."timeline"->>'deliveredAt', '')::timestamptz,
    new."updatedAt",
    new."createdAt",
    now()
  );

  insert into public."CourierEarning" (
    "id",
    "courierId",
    "orderId",
    "amount",
    "currency",
    "deliveredAt",
    "restaurantId",
    "restaurantName",
    "createdAt",
    "updatedAt"
  ) values (
    'earning_' || new."id",
    v_courier_id,
    new."id",
    round(v_amount::numeric, 2),
    v_currency,
    v_delivered_at,
    new."restaurantId",
    new."restaurantName",
    coalesce(new."updatedAt", now()),
    coalesce(new."updatedAt", now())
  )
  on conflict ("orderId") do update set
    "courierId" = excluded."courierId",
    "amount" = excluded."amount",
    "currency" = excluded."currency",
    "deliveredAt" = excluded."deliveredAt",
    "restaurantId" = excluded."restaurantId",
    "restaurantName" = excluded."restaurantName",
    "updatedAt" = excluded."updatedAt";

  return new;
end;
$$;

drop trigger if exists "CourierEarning_on_delivery" on public."CustomerOrder";
create trigger "CourierEarning_on_delivery"
after update of "status" on public."CustomerOrder"
for each row
execute function public.ebuy_record_courier_earning_on_delivery();
