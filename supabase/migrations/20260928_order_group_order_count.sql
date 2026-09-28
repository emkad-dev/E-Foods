-- OrderGroup.orderCount: the second column checkout writes that no migration
-- created.
--
-- The column is written by createOrderGroupWithItems and read through
-- ORDER_GROUP_COLUMNS. It arrived with 64334b5, and 20260827_multi_store_cart.sql
-- created OrderGroup without it. Once 20260928_payment_transaction_settlement_mode
-- was applied, every initializeCustomerPayment 500'd here instead:
-- "Could not find the 'orderCount' column of 'OrderGroup' in the schema cache".
--
-- Found by probing every column the edge functions read or write against
-- prod through PostgREST (select=<col>&limit=0). Of the tables the anon key
-- can see, this was the only real gap on the checkout path. The other gap was
-- DeliveryEvent.timestamp in order-placement/handler.ts, which only logs a
-- warning on failure.
--
-- Shaped like its sibling restaurantCount. Existing rows are backfilled from
-- orderIds, so a group's count matches the orders it lists.
--
-- Reverse with:
--   ALTER TABLE public."OrderGroup" DROP COLUMN "orderCount";

ALTER TABLE public."OrderGroup"
  ADD COLUMN IF NOT EXISTS "orderCount" integer NOT NULL DEFAULT 1;

UPDATE public."OrderGroup"
   SET "orderCount" = GREATEST(jsonb_array_length("orderIds"), 1)
 WHERE jsonb_typeof("orderIds") = 'array';

NOTIFY pgrst, 'reload schema';
