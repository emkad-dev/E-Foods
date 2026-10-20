-- Per-app Expo push tokens.
--
-- UserAccount.expoPushToken is ONE column shared by three apps (customer,
-- partner, dispatch), each of which is a separate Expo project with its own
-- token. Whichever app registered last overwrote the others, so a restaurant
-- owner or rider who also uses the customer app had their kitchen/offer pushes
-- routed into the customer app (where the `offers` channel does not exist, so
-- Android drops them) or lost them entirely.
--
-- PushDevice keeps one token per (user, app). The token itself is unique: an
-- Expo token identifies one app install on one device, so when someone else
-- signs in on that phone the row moves to them instead of both accounts
-- receiving each other's pushes.
--
-- Purely additive. Edge functions read this table when it exists and fall back
-- to the legacy column when it does not (or holds no row for the user), and
-- clients keep writing the legacy column, so applying this migration is never
-- a prerequisite for a deploy and nothing regresses before it lands.

create table if not exists public."PushDevice" (
  id uuid primary key default gen_random_uuid(),
  "userId" text not null,
  app text not null check (app in ('customer', 'partner', 'dispatch', 'admin')),
  token text not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint "PushDevice_userId_app_key" unique ("userId", app),
  constraint "PushDevice_token_key" unique (token)
);

create index if not exists "PushDevice_userId_idx" on public."PushDevice" ("userId");

-- Service-role only: RLS on with no policies, and no table grants to clients.
-- Clients register through the two security-definer functions below, which
-- act only on auth.uid().
alter table public."PushDevice" enable row level security;
revoke all on table public."PushDevice" from anon, authenticated;

create or replace function public.ebuy_register_push_device(p_app text, p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_app not in ('customer', 'partner', 'dispatch') then
    raise exception 'unsupported app';
  end if;
  if p_token is null or p_token !~ '^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$' then
    raise exception 'invalid push token';
  end if;

  -- The device changed hands: detach the token from whoever held it before.
  delete from public."PushDevice" where token = p_token and "userId" <> v_uid;

  insert into public."PushDevice" ("userId", app, token, "updatedAt")
    values (v_uid, p_app, p_token, now())
    on conflict ("userId", app) do update
      set token = excluded.token, "updatedAt" = now();

  -- Same for the legacy column, which older builds and the fallback read path
  -- still use. Isolated so a guard-trigger refusal on some other account (e.g.
  -- one pending deletion) can never fail this caller's registration.
  begin
    update public."UserAccount"
      set "expoPushToken" = null, "pushTokenUpdatedAt" = now()
      where "expoPushToken" = p_token and uid <> v_uid and "deletionRequestedAt" is null;
  exception when others then
    raise notice 'legacy push token cleanup skipped: %', sqlerrm;
  end;
end;
$$;

create or replace function public.ebuy_unregister_push_device(p_app text, p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  delete from public."PushDevice"
    where "userId" = v_uid and app = p_app and (p_token is null or token = p_token);
end;
$$;

revoke all on function public.ebuy_register_push_device(text, text) from public, anon;
revoke all on function public.ebuy_unregister_push_device(text, text) from public, anon;
grant execute on function public.ebuy_register_push_device(text, text) to authenticated;
grant execute on function public.ebuy_unregister_push_device(text, text) to authenticated;
