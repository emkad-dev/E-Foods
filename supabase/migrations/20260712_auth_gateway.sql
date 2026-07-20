-- Auth gateway: rate-limit + audit infrastructure.
-- Service-role mediated only (edge function). No RLS policies => anon/authenticated see nothing.

create table if not exists public.auth_rate_limits (
  key          text primary key,
  window_start timestamptz not null default now(),
  count        integer     not null default 0,
  locked_until timestamptz
);

create table if not exists public.auth_audit_log (
  id           bigserial primary key,
  event        text        not null,          -- 'signup' | 'login' | 'logout' | 'refresh'
  subject_hash text,                          -- hashed email; never raw
  ip_hash      text,                          -- hashed client IP; never raw
  success      boolean     not null,
  reason       text,                          -- coarse reason code, never secrets
  created_at   timestamptz not null default now()
);

create index if not exists auth_audit_log_event_idx    on public.auth_audit_log (event);
create index if not exists auth_audit_log_created_idx   on public.auth_audit_log (created_at);
create index if not exists auth_rate_limits_locked_idx  on public.auth_rate_limits (locked_until);

alter table public.auth_rate_limits enable row level security;
alter table public.auth_audit_log   enable row level security;

-- Atomic fixed-window counter with lockout. Every argument is parameterized.
create or replace function public.auth_rl_hit(
  p_key text,
  p_limit int,
  p_window_secs int,
  p_lockout_secs int
) returns table(allowed boolean, retry_after int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_row public.auth_rate_limits;
begin
  insert into public.auth_rate_limits(key, window_start, count)
    values (p_key, v_now, 0)
    on conflict (key) do nothing;

  select * into v_row from public.auth_rate_limits where key = p_key for update;

  if v_row.locked_until is not null and v_row.locked_until > v_now then
    return query select false, greatest(1, ceil(extract(epoch from (v_row.locked_until - v_now)))::int);
    return;
  end if;

  if v_row.window_start + make_interval(secs => p_window_secs) <= v_now then
    v_row.window_start := v_now;
    v_row.count := 0;
    v_row.locked_until := null;
  end if;

  v_row.count := v_row.count + 1;

  if v_row.count > p_limit then
    v_row.locked_until := v_now + make_interval(secs => p_lockout_secs);
    update public.auth_rate_limits
      set window_start = v_row.window_start, count = v_row.count, locked_until = v_row.locked_until
      where key = p_key;
    return query select false, p_lockout_secs;
    return;
  end if;

  update public.auth_rate_limits
    set window_start = v_row.window_start, count = v_row.count, locked_until = null
    where key = p_key;
  return query select true, 0;
end;
$$;

revoke all on function public.auth_rl_hit(text, int, int, int) from public;
grant execute on function public.auth_rl_hit(text, int, int, int) to service_role;
