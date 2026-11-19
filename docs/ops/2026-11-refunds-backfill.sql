-- Paystack refunds: legacy backfill. OPS SQL, NOT a migration.
-- The owner runs this ONCE in the Supabase SQL editor, right AFTER deploying
-- the refunds code (feature/paystack-refunds), with the cut-off below set to
-- the deploy time. Only refunds recorded BEFORE the cut-off are marked, so a
-- refund recorded by the new code after the deploy is never touched.
--
-- >>> Replace every 2026-11-20T00:00:00Z below with the deploy time (UTC). <<<
--
-- Why: every order refunded before this feature has payment.status
-- 'refunded' and no payment.refundExecution. To the new code that reads as
-- "recorded, never sent", so the admin page would offer "Refund via Paystack"
-- on refunds the owner may already have paid by hand. This marks each of them
-- needs_attention with requestedBy 'legacy': such a record is never sent
-- through Paystack, and an admin closes it with "I refunded this by hand"
-- after checking Paystack.
--
-- Safe to run twice: the WHERE skips rows that already have an execution.
-- Until it runs, a pre-deploy refund still offers "Refund via Paystack"; the
-- send checks Paystack for an existing refund first and refuses if it finds one.

-- 1. Preview: how many, and which.
select count(*) as legacy_refunds
from "CustomerOrder"
where payment->>'status' = 'refunded'
  and payment->'refundExecution' is null
  and (payment->>'refundedAt') is not null
  and (payment->>'refundedAt')::timestamptz < '2026-11-20T00:00:00Z';

select id, status, payment->>'method' as method, payment->>'refundAmount' as refund_amount,
       payment->>'refundedAt' as refunded_at, "needsAttention"
from "CustomerOrder"
where payment->>'status' = 'refunded'
  and payment->'refundExecution' is null
  and (payment->>'refundedAt') is not null
  and (payment->>'refundedAt')::timestamptz < '2026-11-20T00:00:00Z'
order by payment->>'refundedAt' desc;

-- Refunded with no refundedAt are NOT marked by this script (none expected):
-- review any listed here by hand.
select id, status, payment->>'refundAmount' as refund_amount
from "CustomerOrder"
where payment->>'status' = 'refunded'
  and payment->'refundExecution' is null
  and (payment->>'refundedAt') is null;

-- 2. Backfill (run after checking the preview).
begin;

update "CustomerOrder"
set payment = jsonb_set(
      payment,
      '{refundExecution}',
      '{"status":"needs_attention","requestedBy":"legacy","lastError":"Refunded before Paystack refunds existed: check Paystack, then mark refunded by hand"}'::jsonb
    )
where payment->>'status' = 'refunded'
  and payment->'refundExecution' is null
  and (payment->>'refundedAt') is not null
  and (payment->>'refundedAt')::timestamptz < '2026-11-20T00:00:00Z';

-- Expect 0.
select count(*) as still_unmarked
from "CustomerOrder"
where payment->>'status' = 'refunded'
  and payment->'refundExecution' is null
  and (payment->>'refundedAt') is not null
  and (payment->>'refundedAt')::timestamptz < '2026-11-20T00:00:00Z';

commit;
