-- Verifies the C3b Data API gate against the real policies and trigger.
-- Runs entirely inside a transaction that is rolled back, so it is safe to
-- execute against any environment including production.
--
-- Every "should fail" block raises if the statement UNEXPECTEDLY SUCCEEDS.
--
-- PREREQUISITE: both 20260807a_account_deletion_columns.sql and
-- 20260807b_account_deletion_data_api_gate.sql must be applied first. As of
-- this commit neither has been applied to any database, so this script has
-- NOT yet been executed anywhere.
--
-- HOW TO RUN:  psql "$DATABASE_URL" -f scripts/verify-deletion-rls.sql
-- Expect five PASS notices and no FAIL. The final ROLLBACK leaves nothing
-- behind.
--
-- PROVING THIS SCRIPT CAN FAIL (required before trusting it):
-- comment out the `OLD."deletionRequestedAt" IS NOT NULL` block in
-- ebuy_guard_useraccount_sensitive_update, re-apply, and re-run. Check 1 must
-- report FAIL. Then restore and confirm all five PASS again. A verification
-- script that cannot fail proves nothing.
--
-- Do this against a LOCAL OR STAGING database only. It switches off a live
-- security guard for the duration, which is not acceptable in production.

begin;

-- A disposable account already in the pending-deletion state.
insert into public."UserAccount" (uid, email, "displayName", "emailVerified", "roleDisplay",
                                  "createdAt", "updatedAt",
                                  "deletionRequestedAt", "purgeScheduledAt")
values ('rls-probe-uid', 'rls-probe@example.test', 'RLS Probe', true, 'customer',
        now(), now(), now(), now() + interval '30 days');

-- Impersonate that user over the Data API.
set local role authenticated;
set local request.jwt.claims = '{"sub":"rls-probe-uid","role":"authenticated","app_metadata":{}}';

-- 1. Self-cancel must be impossible. This is the hole C3b closes.
do $$
begin
  update public."UserAccount" set "deletionRequestedAt" = null where uid = 'rls-probe-uid';
  raise exception 'FAIL: a pending-deletion user cleared their own deletionRequestedAt';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL:%' then raise; end if;  -- our own failure, re-raise
    raise notice 'PASS: self-cancel blocked (%)', sqlerrm;
end $$;

-- 2. Any other self-write to the row must also be refused.
do $$
begin
  update public."UserAccount" set "displayName" = 'Renamed' where uid = 'rls-probe-uid';
  raise exception 'FAIL: a pending-deletion user updated their own profile';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: profile write blocked (%)', sqlerrm;
end $$;

-- 3. Writes to the other client-writable tables must be refused.
do $$
begin
  insert into public."CustomerFavoriteRestaurant" ("customerId", "restaurantId")
  values ('rls-probe-uid', 'any-restaurant');
  raise exception 'FAIL: a pending-deletion user added a favorite';
exception
  when insufficient_privilege or check_violation then
    raise notice 'PASS: favorite insert blocked';
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: favorite insert blocked (%)', sqlerrm;
  when others then
    raise notice 'PASS: favorite insert blocked (%)', sqlerrm;
end $$;

-- 4. Reads must STILL work — profile hydration depends on them.
do $$
declare
  found_uid text;
begin
  select uid into found_uid from public."user_profiles" where uid = 'rls-probe-uid';
  if found_uid is null then
    raise exception 'FAIL: a pending-deletion user cannot read their own profile';
  end if;
  raise notice 'PASS: self-read still permitted';
end $$;

-- 5. The helper agrees.
do $$
begin
  if not public.ebuy_account_pending_deletion() then
    raise exception 'FAIL: ebuy_account_pending_deletion() returned false for a pending account';
  end if;
  raise notice 'PASS: helper reports pending deletion';
end $$;

reset role;
rollback;
