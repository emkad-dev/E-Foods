-- Fire queue-drainer immediately when a job is enqueued, instead of waiting up
-- to a minute for the pg_cron tick from 20260624_queue_drainer_schedule.sql.
-- That cron schedule stays in place as the backstop.
--
-- Safe against pile-up: queue-drainer wraps its work in runWithBackpressure
-- with maxConcurrent 1 (queue-drainer/index.ts:273), so an overlapping call
-- returns 429 and does nothing.
--
-- Credentials come from the same Vault secrets the cron job already uses. If
-- either is missing the function returns early and no request is sent — the
-- trigger becomes a no-op rather than an error, so enqueueing never fails
-- because of this.
--
-- STATEMENT-level, not row-level: a bulk insert of ten jobs should cause one
-- drain, not ten.

create or replace function public.ebuy_notify_queue_drainer()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_project_url text;
  v_worker_token text;
begin
  select decrypted_secret into v_project_url
  from vault.decrypted_secrets where name = 'project_url';

  select decrypted_secret into v_worker_token
  from vault.decrypted_secrets where name = 'queue_worker_token';

  if v_project_url is null or v_worker_token is null then
    return null;
  end if;

  perform net.http_post(
    url := v_project_url || '/functions/v1/queue-drainer',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-queue-worker-token', v_worker_token
    ),
    body := jsonb_build_object(
      'batchSize', 10,
      'concurrency', 4,
      'queue', tg_argv[0]
    ),
    timeout_milliseconds := 5000
  );

  return null;
exception
  when others then
    -- Never let a dispatch failure roll back the enqueue. This runs on the
    -- money path (order placement, payment verification); the cron backstop
    -- picks the job up on its next tick.
    raise notice 'queue drainer notify failed: %', sqlerrm;
    return null;
end;
$$;

revoke all on function public.ebuy_notify_queue_drainer() from public, anon, authenticated;

do $trg$
begin
  drop trigger if exists queue_notify_drainer on public.queue_order_placement;
  create trigger queue_notify_drainer
    after insert on public.queue_order_placement
    for each statement
    execute function public.ebuy_notify_queue_drainer('order-placement');

  drop trigger if exists queue_notify_drainer on public.queue_payment_verification;
  create trigger queue_notify_drainer
    after insert on public.queue_payment_verification
    for each statement
    execute function public.ebuy_notify_queue_drainer('payment-verification');

  drop trigger if exists queue_notify_drainer on public.queue_notifications;
  create trigger queue_notify_drainer
    after insert on public.queue_notifications
    for each statement
    execute function public.ebuy_notify_queue_drainer('notifications');
exception
  when others then
    raise notice 'queue drainer trigger install skipped: %', sqlerrm;
end
$trg$;
