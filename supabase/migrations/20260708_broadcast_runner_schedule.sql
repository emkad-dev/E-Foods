-- Schedule the broadcast-runner Edge Function every minute via pg_cron + pg_net,
-- reusing the same Vault secrets as queue-drainer (project_url, queue_worker_token).
-- Exception-guarded so the migration applies cleanly even where pg_cron / pg_net /
-- supabase_vault are unavailable. The job stays dormant until both secrets exist.

do $ext$
begin
  create extension if not exists pg_cron;
  create extension if not exists pg_net;
  create extension if not exists supabase_vault;
exception
  when others then
    raise notice 'broadcast-runner: prerequisite extension unavailable (%), skipping cron schedule', sqlerrm;
end
$ext$;

do $sched$
begin
  perform cron.schedule(
    'broadcast-runner-every-minute',
    '* * * * *',
    $cron$
      with credentials as (
        select
          (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') as project_url,
          (select decrypted_secret from vault.decrypted_secrets where name = 'queue_worker_token') as queue_worker_token
      )
      select net.http_post(
        url := credentials.project_url || '/functions/v1/broadcast-runner',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-queue-worker-token', credentials.queue_worker_token
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 8000
      ) as request_id
      from credentials
      where credentials.project_url is not null
        and credentials.queue_worker_token is not null;
    $cron$
  );
exception
  when others then
    raise notice 'broadcast-runner: could not schedule cron (%), skipping', sqlerrm;
end
$sched$;
