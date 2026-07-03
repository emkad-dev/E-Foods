-- Schedule the queue-drainer Edge Function to run every minute via pg_cron +
-- pg_net, reading its worker credentials from Supabase Vault.
--
-- This is wrapped in exception-guarded DO blocks so the migration applies cleanly
-- even on a project where pg_cron / pg_net / supabase_vault are not available — in
-- that case it simply skips scheduling instead of failing the whole push.
--
-- The scheduled job stays DORMANT until both vault secrets exist:
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<queue-worker-token>', 'queue_worker_token');
-- Without them the cron body's WHERE clause matches no rows, so no request is sent.

do $ext$
begin
  create extension if not exists pg_cron;
  create extension if not exists pg_net;
  create extension if not exists supabase_vault;
exception
  when others then
    raise notice 'queue-drainer: prerequisite extension unavailable (%), skipping cron schedule', sqlerrm;
end
$ext$;

do $sched$
begin
  perform cron.schedule(
    'queue-drainer-every-minute',
    '* * * * *',
    $cron$
      with credentials as (
        select
          (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') as project_url,
          (select decrypted_secret from vault.decrypted_secrets where name = 'queue_worker_token') as queue_worker_token
      )
      select net.http_post(
        url := credentials.project_url || '/functions/v1/queue-drainer',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-queue-worker-token', credentials.queue_worker_token
        ),
        body := jsonb_build_object(
          'batchSize', 10,
          'concurrency', 4,
          'queue', 'all'
        ),
        timeout_milliseconds := 5000
      ) as request_id
      from credentials
      where credentials.project_url is not null
        and credentials.queue_worker_token is not null;
    $cron$
  );
exception
  when others then
    raise notice 'queue-drainer: could not schedule cron (%), skipping', sqlerrm;
end
$sched$;
