-- Promo analytics (Phase 2 ①): impression/click events + paid-order attribution.

-- Impression/click events. Written service-side only (via app-rpc promoTrack).
create table if not exists public."promo_events" (
  "id"        text primary key default (gen_random_uuid())::text,
  "promoId"   text not null,
  "type"      text not null, -- 'impression' | 'click'
  "createdAt" timestamptz not null default now()
);
create index if not exists "promo_events_promoId_type_idx"
  on public."promo_events" ("promoId", "type");
alter table public."promo_events" enable row level security;
-- No policies: anon/authenticated get zero access; writes are service-role only.

-- Attribution: stamped at checkout-init; only counted once the order is paid.
alter table public."CustomerOrder" add column if not exists "attributedPromoId" text;
create index if not exists "CustomerOrder_attributedPromoId_idx"
  on public."CustomerOrder" ("attributedPromoId");

-- Per-promo aggregates for the admin. Paid = a PaymentTransaction with status 'paid'.
create or replace function public.ebuy_promo_stats()
returns table (
  "promoId"           text,
  "impressions"       bigint,
  "clicks"            bigint,
  "attributedOrders"  bigint,
  "attributedRevenue" double precision
)
language sql
stable
security definer
set search_path = public
as $$
  with ev as (
    select "promoId",
           count(*) filter (where "type" = 'impression') as impressions,
           count(*) filter (where "type" = 'click')      as clicks
    from public."promo_events"
    group by "promoId"
  ),
  attr as (
    select o."attributedPromoId" as promo_id,
           count(distinct o.id)   as orders,
           coalesce(sum(pt."amount"), 0) as revenue
    from public."CustomerOrder" o
    join public."PaymentTransaction" pt
      on pt."orderId" = o."id" and pt."status" = 'paid'
    where o."attributedPromoId" is not null
    group by o."attributedPromoId"
  )
  select p."id",
         coalesce(ev.impressions, 0),
         coalesce(ev.clicks, 0),
         coalesce(attr.orders, 0),
         coalesce(attr.revenue, 0)::double precision
  from public."Promo" p
  left join ev   on ev."promoId" = p."id"
  left join attr on attr.promo_id = p."id";
$$;

grant execute on function public.ebuy_promo_stats() to service_role;
