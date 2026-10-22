-- Keep the hot domain Edge Functions warm so a Nigeria-to-Frankfurt sign-in
-- does not pay a cold start. Every 5 minutes, pg_cron + pg_net send a cheap
-- GET to each function. serveRpcFunction (and public-catalog) answer a non-POST
-- with HTTP 405 BEFORE authenticating and WITHOUT touching the database, so the
-- ping warms the isolate without doing real work, needing a JWT, or writing
-- anything. Only the project_url Vault secret is required (no worker token).
--
-- Budget: 4 functions x 12 pings/hour x 24h x ~31 days ~= 35.7K invocations/mo,
-- a small slice of the 500K/mo Free-tier budget, and well clear of it alongside
-- the queue-drainer/broadcast-runner crons.
--
-- Additive and exception-guarded: it applies cleanly even where pg_cron/pg_net/
-- supabase_vault are unavailable, and stays dormant until project_url exists
-- (the cron body's WHERE clause then matches no rows and sends nothing).

do $ext$
begin
  create extension if not exists pg_cron;
  create extension if not exists pg_net;
  create extension if not exists supabase_vault;
exception
  when others then
    raise notice 'fn-warmer: prerequisite extension unavailable (%), skipping cron schedule', sqlerrm;
end
$ext$;

do $sched$
begin
  perform cron.schedule(
    'fn-warmer-every-5-min',
    '*/5 * * * *',
    $cron$
      with credentials as (
        select
          (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') as project_url
      )
      select net.http_get(
        url := credentials.project_url || '/functions/v1/' || warm_target.fn,
        timeout_milliseconds := 4000
      ) as request_id
      from credentials
      cross join (
        values ('feasty-account'), ('feasty-orders'), ('app-rpc'), ('public-catalog')
      ) as warm_target(fn)
      where credentials.project_url is not null;
    $cron$
  );
exception
  when others then
    raise notice 'fn-warmer: could not schedule cron (%), skipping', sqlerrm;
end
$sched$;
