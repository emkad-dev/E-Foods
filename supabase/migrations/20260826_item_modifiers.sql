-- Item modifiers: selected add-ons live on the order item snapshot so the
-- server can reprice and audit the exact customer choice without trusting the
-- client to resend menu state later.

alter table public."OrderItem"
  add column if not exists "optionDelta" double precision,
  add column if not exists "selectedOptions" jsonb not null default '[]'::jsonb;
