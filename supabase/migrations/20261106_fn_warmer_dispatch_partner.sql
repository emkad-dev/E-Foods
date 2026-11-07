-- Add feasty-dispatch and feasty-partner to the function warmer from
-- 20261022_fn_warmer.sql. Interactive dispatch and partner sign-in now goes
-- through dispatchBootstrap / partnerBootstrap, which land on those two
-- functions; unwarmed, each pays a Nigeria-to-Frankfurt cold start on the one
-- request the rider or restaurant is waiting on.
--
-- Same mechanism and the same guards as the original: every 5 minutes pg_cron +
-- pg_net send a cheap GET to each function, and serveRpcFunction answers a
-- non-POST with HTTP 405 BEFORE authenticating and WITHOUT touching the
-- database, so the ping warms the isolate without doing real work, needing a
-- JWT, or writing anything. Only the project_url Vault secret is required.
--
-- Idempotent: cron.schedule with an existing job name REPLACES that job's
-- schedule and command, so this re-schedules fn-warmer-every-5-min with six
-- targets rather than adding a second job. Safe to apply more than once.
--
-- Budget: 6 functions x 12 pings/hour x 24h x ~31 days ~= 53.6K invocations/mo,
-- about 11% of the 500K/mo Free-tier budget (up from ~35.7K with four), and
-- still modest alongside the queue-drainer/broadcast-runner crons.
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
        values
          ('feasty-account'),
          ('feasty-orders'),
          ('app-rpc'),
          ('public-catalog'),
          ('feasty-dispatch'),
          ('feasty-partner')
      ) as warm_target(fn)
      where credentials.project_url is not null;
    $cron$
  );
exception
  when others then
    raise notice 'fn-warmer: could not schedule cron (%), skipping', sqlerrm;
end
$sched$;
