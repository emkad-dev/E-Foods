-- Provision the queue tables (if they were never created) and add the
-- `available_at` column used for exponential backoff (see _shared/queue.ts
-- incrementRetry / claimPendingQueueJobs), plus the selection + visibility-timeout
-- reclaim indexes. Fully idempotent: safe whether the tables already exist or not.
--
-- A null `available_at` means "available immediately" (the default for freshly
-- enqueued jobs and for jobs reclaimed by the visibility timeout).

create table if not exists public.queue_order_placement (
  id text primary key,
  payload jsonb not null,
  status text not null default 'pending',
  retry_count integer not null default 0,
  result jsonb,
  error text,
  available_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.queue_payment_verification (
  id text primary key,
  payload jsonb not null,
  status text not null default 'pending',
  retry_count integer not null default 0,
  result jsonb,
  error text,
  available_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.queue_notifications (
  id text primary key,
  payload jsonb not null,
  status text not null default 'pending',
  retry_count integer not null default 0,
  result jsonb,
  error text,
  available_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Queue tables are internal: they are read and written only through the service
-- role (which bypasses RLS). Enable RLS with no policies so the anon/authenticated
-- roles can never reach them through the Data API.
alter table public.queue_order_placement enable row level security;
alter table public.queue_payment_verification enable row level security;
alter table public.queue_notifications enable row level security;

-- Backoff column for any pre-existing queue tables (no-op when created above).
alter table if exists public.queue_order_placement add column if not exists available_at timestamptz;
alter table if exists public.queue_payment_verification add column if not exists available_at timestamptz;
alter table if exists public.queue_notifications add column if not exists available_at timestamptz;

-- Composite indexes to keep job selection (status + backoff window) and the
-- visibility-timeout reclaim (status + updated_at) cheap.
create index if not exists queue_order_placement_status_available_idx
  on public.queue_order_placement (status, available_at);
create index if not exists queue_order_placement_status_updated_idx
  on public.queue_order_placement (status, updated_at);

create index if not exists queue_payment_verification_status_available_idx
  on public.queue_payment_verification (status, available_at);
create index if not exists queue_payment_verification_status_updated_idx
  on public.queue_payment_verification (status, updated_at);

create index if not exists queue_notifications_status_available_idx
  on public.queue_notifications (status, available_at);
create index if not exists queue_notifications_status_updated_idx
  on public.queue_notifications (status, updated_at);
