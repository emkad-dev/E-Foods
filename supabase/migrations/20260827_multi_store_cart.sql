-- Task 20 [G4]: multi-store cart groups and per-order linkage.
-- Additive and idempotent. RLS posture stays service-role-only: enabled, no
-- policies, matching the other operational tables on this branch.

alter table if exists public."CustomerOrder"
  add column if not exists "orderGroupId" text;

create index if not exists "CustomerOrder_orderGroupId_idx"
  on public."CustomerOrder" ("orderGroupId");

alter table if exists public."PaymentTransaction"
  add column if not exists "orderGroupId" text;

create index if not exists "PaymentTransaction_orderGroupId_idx"
  on public."PaymentTransaction" ("orderGroupId");

create table if not exists public."OrderGroup" (
  "id" text primary key,
  "customerId" text not null,
  "primaryOrderId" text not null,
  "orderIds" jsonb not null default '[]'::jsonb,
  "restaurantIds" jsonb not null default '[]'::jsonb,
  "restaurantCount" integer not null default 1,
  "pricing" jsonb not null default '{}'::jsonb,
  "payment" jsonb not null default '{}'::jsonb,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

alter table public."OrderGroup" enable row level security;

create index if not exists "OrderGroup_customerId_idx"
  on public."OrderGroup" ("customerId");

create index if not exists "OrderGroup_primaryOrderId_idx"
  on public."OrderGroup" ("primaryOrderId");
