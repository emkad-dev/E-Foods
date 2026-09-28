-- PaymentTransaction.settlementMode: the column the deployed code already uses.
--
-- The column arrived in the edge-function code with 64334b5 ("WIP: preserve
-- parity workspace") and no migration ever created it. Since feasty-orders
-- was deployed on 2026-09-19, every initializeCustomerPayment has returned
-- 500 with "Could not find the 'settlementMode' column of
-- 'PaymentTransaction' in the schema cache". The failure happened AFTER the
-- order row was written and the Paystack transaction was initialised, so each
-- attempt left an unpaid order behind. payment-verification/handler.ts also
-- SELECTs the column, so verification would have failed the same way.
--
-- Values are 'manual' | 'split' (resolvePaymentSettlementSummary in
-- _shared/domains/orders.ts). Nullable with no default, like its sibling
-- splitSubaccountCode: the 98 rows written before this column existed stay
-- NULL, and payment-verification already reads NULL as 'manual'.
--
-- Additive only. Reverse with:
--   ALTER TABLE public."PaymentTransaction" DROP COLUMN "settlementMode";

ALTER TABLE public."PaymentTransaction"
  ADD COLUMN IF NOT EXISTS "settlementMode" text;

-- PostgREST caches the schema; without this the running functions keep
-- reporting the column as missing until the cache refreshes on its own.
NOTIFY pgrst, 'reload schema';
