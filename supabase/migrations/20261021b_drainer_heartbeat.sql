-- queue-drainer liveness heartbeat + an independent watchdog.
--
-- Acceptance-deadline auto-cancel/refund, delivery-offer expiry, scheduled-
-- order release and rider-ping cleanup ALL ride on the one every-minute
-- queue-drainer invocation (20260624_queue_drainer_schedule.sql). It has
-- failed silently before (missing Vault secrets, 2026-07-13), and nothing
-- noticed: paid orders simply stopped auto-cancelling.
--
-- 1. CronHeartbeat: queue-drainer stamps `lastRunAt` after its sweeps finish.
-- 2. ebuy_check_drainer_heartbeat(): if that stamp is older than 5 minutes,
--    upsert a HIGH OperationalAlert (visible in the admin console).
-- 3. A pg_cron job runs (2) every 5 minutes inside Postgres - deliberately NOT
--    through an Edge Function, so it still fires when the functions runtime,
--    the Vault secrets or the worker token are what broke.
--    broadcast-runner performs the same check from the edge side and also
--    emails the admins (Postgres cannot send email here).
--
-- A missing heartbeat row (drainer not yet redeployed with the stamping code)
-- is "unknown", not "stale", so applying this before the deploy raises no
-- false alarm. Additive and idempotent.
-- To remove: select cron.unschedule('queue-drainer-heartbeat-watch');

create table if not exists public."CronHeartbeat" (
  name text primary key,
  "lastRunAt" timestamptz not null,
  details jsonb not null default '{}'::jsonb
);

alter table public."CronHeartbeat" enable row level security;
revoke all on table public."CronHeartbeat" from anon, authenticated;

create or replace function public.ebuy_check_drainer_heartbeat()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last timestamptz;
begin
  select "lastRunAt" into v_last from public."CronHeartbeat" where name = 'queue-drainer';

  if v_last is null or v_last >= now() - interval '5 minutes' then
    return false;
  end if;

  insert into public."OperationalAlert" (
    "dedupeKey", "alertType", severity, "subjectType", "subjectId", title, details, metadata, "createdAt", "updatedAt"
  ) values (
    'queue-drainer-heartbeat-stale',
    'queue_drainer_stale',
    'high',
    'system',
    'queue-drainer',
    'queue-drainer has stopped running',
    'No successful queue-drainer run since ' || to_char(v_last at time zone 'UTC', 'YYYY-MM-DD HH24:MI') ||
      ' UTC. Acceptance-deadline refunds, offer expiry and scheduled-order release are not happening. ' ||
      'Check the queue-drainer-every-minute cron job, the Vault secrets project_url/queue_worker_token, ' ||
      'the QUEUE_WORKER_TOKEN function secret, and the function logs.',
    jsonb_build_object('lastRunAt', v_last, 'checkedAt', now(), 'source', 'pg_cron'),
    now(),
    now()
  )
  on conflict ("dedupeKey") do update
    set details = excluded.details, metadata = excluded.metadata, severity = 'high', "updatedAt" = now();

  return true;
end;
$$;

revoke all on function public.ebuy_check_drainer_heartbeat() from public, anon, authenticated;

do $sched$
begin
  perform cron.schedule(
    'queue-drainer-heartbeat-watch',
    '*/5 * * * *',
    $cron$ select public.ebuy_check_drainer_heartbeat(); $cron$
  );
exception
  when others then
    raise notice 'queue-drainer heartbeat watch: could not schedule cron (%), skipping', sqlerrm;
end
$sched$;
