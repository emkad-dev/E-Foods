-- Schedule the rider-payouts Edge Function via pg_cron + pg_net, reusing the
-- Vault secrets queue-drainer and broadcast-runner already use (project_url,
-- queue_worker_token). Apply AFTER `rider-payouts` is deployed.
--
-- Daily at 09:00 UTC (10:00 Lagos): one batch per rider per day keeps Paystack
-- transfer fees down and gives an operator a working-hours window to react to
-- alerts. The function itself is a no-op while the rider_auto_payouts
-- FeatureFlag is off (the seeded default), so applying this early moves no
-- money.
--
-- Exception-guarded like 20260708_broadcast_runner_schedule.sql so it applies
-- cleanly where pg_cron / pg_net / supabase_vault are unavailable.
-- To remove:  select cron.unschedule('rider-payouts-daily');

do $ext$
begin
  create extension if not exists pg_cron;
  create extension if not exists pg_net;
  create extension if not exists supabase_vault;
exception
  when others then
    raise notice 'rider-payouts: prerequisite extension unavailable (%), skipping cron schedule', sqlerrm;
end
$ext$;

do $sched$
begin
  perform cron.schedule(
    'rider-payouts-daily',
    '0 9 * * *',
    $cron$
      with credentials as (
        select
          (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') as project_url,
          (select decrypted_secret from vault.decrypted_secrets where name = 'queue_worker_token') as queue_worker_token
      )
      select net.http_post(
        url := credentials.project_url || '/functions/v1/rider-payouts',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-queue-worker-token', credentials.queue_worker_token
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      ) as request_id
      from credentials
      where credentials.project_url is not null
        and credentials.queue_worker_token is not null;
    $cron$
  );
exception
  when others then
    raise notice 'rider-payouts: could not schedule cron (%), skipping', sqlerrm;
end
$sched$;
