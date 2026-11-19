-- Paystack refunds: legacy backfill. OPS SQL, NOT a migration.
-- The owner runs this in the Supabase SQL editor BEFORE deploying the
-- refunds code (feature/paystack-refunds).
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

-- 1. Preview: how many, and which.
select count(*) as legacy_refunds
from "CustomerOrder"
where payment->>'status' = 'refunded'
  and payment->'refundExecution' is null;

select id, status, payment->>'method' as method, payment->>'refundAmount' as refund_amount,
       payment->>'refundedAt' as refunded_at, "needsAttention"
from "CustomerOrder"
where payment->>'status' = 'refunded'
  and payment->'refundExecution' is null
order by payment->>'refundedAt' desc nulls last;

-- 2. Backfill (run after checking the preview).
begin;

update "CustomerOrder"
set payment = jsonb_set(
      payment,
      '{refundExecution}',
      '{"status":"needs_attention","requestedBy":"legacy","lastError":"Refunded before Paystack refunds existed: check Paystack, then mark refunded by hand"}'::jsonb
    )
where payment->>'status' = 'refunded'
  and payment->'refundExecution' is null;

-- Expect 0.
select count(*) as still_unmarked
from "CustomerOrder"
where payment->>'status' = 'refunded'
  and payment->'refundExecution' is null;

commit;
