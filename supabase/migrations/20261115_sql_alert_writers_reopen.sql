-- Two alert writers live in SQL rather than in _shared/operationalAlerts.ts:
-- ebuy_rider_pay_alert (20261020_rider_payouts.sql) and
-- ebuy_check_drainer_heartbeat (20261021b_drainer_heartbeat.sql). Since
-- 20261114_operational_alert_resolved.sql an admin can mark an alert resolved,
-- and the console hides resolved alerts by default. These two upserted on
-- dedupeKey without touching the resolved columns, so a problem that came back
-- after being resolved updated a hidden row and nobody saw it. Like the JS
-- writers, a re-raise now re-opens the row: resolved columns cleared and
-- createdAt moved to now, so it shows as a fresh alert. An alert that is still
-- open keeps its original createdAt.
--
-- Bodies are otherwise identical to the live definitions (checked against
-- production on 2026-11-15).

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
    "createdAt" = case when public."OperationalAlert"."resolvedAt" is null
                       then public."OperationalAlert"."createdAt" else now() end,
    "resolvedAt" = null,
    "resolvedBy" = null,
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
    set details = excluded.details,
        metadata = excluded.metadata,
        severity = 'high',
        "createdAt" = case when public."OperationalAlert"."resolvedAt" is null
                           then public."OperationalAlert"."createdAt" else now() end,
        "resolvedAt" = null,
        "resolvedBy" = null,
        "updatedAt" = now();

  return true;
end;
$$;

revoke all on function public.ebuy_check_drainer_heartbeat() from public, anon, authenticated;
