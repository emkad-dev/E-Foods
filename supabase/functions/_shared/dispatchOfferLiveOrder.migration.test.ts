// An admin force-cancel (or any close) of a platform delivery can land while a
// rider still holds a pending DeliveryOffer for it. Accepting that offer must
// not put a rider on a dead order. The guarantee lives in SQL, not in the
// handler, so this pins it in the migrations that define it:
//
//   ebuy_accept_dispatch_offer (20260816) locks the order and claims through
//   ebuy_claim_dispatch_assignment; a refused claim marks the offer superseded
//   and returns 'claim_refused' (the handler's 409), incrementing nothing.
//   ebuy_claim_dispatch_assignment (latest definition, 20260815) re-reads the
//   order status under ebuy_lock_order_status and refuses anything that is not
//   accepted / preparing / ready_for_pickup - cancelled, rejected, delivered and
//   failed_delivery included.
//
// The live-path handler behaviour (409, no claim, no load) is covered by
// domains/dispatchOfferResponse.test.ts ("accepting an order that went terminal
// mid-offer creates no claim"); this file stops the SQL drifting from it.

import { assertEquals } from 'jsr:@std/assert';

const read = (name: string) => Deno.readTextFile(new URL(`../../migrations/${name}`, import.meta.url));

/** The body of the LAST `create or replace function public.<name>(` in a file. */
const lastFunctionBody = (sql: string, name: string): string => {
  const marker = `create or replace function public.${name}(`;
  const start = sql.lastIndexOf(marker);
  if (start < 0) {
    throw new Error(`${name} is not defined in this migration`);
  }
  const bodyStart = sql.indexOf('as $$', start);
  const bodyEnd = sql.indexOf('$$;', bodyStart);
  return sql.slice(bodyStart, bodyEnd);
};

Deno.test('accepting an offer goes through the status-guarded claim and refuses when the claim is refused', async () => {
  const body = lastFunctionBody(await read('20260816_dispatch_delivery_offers.sql'), 'ebuy_accept_dispatch_offer');
  assertEquals(body.includes('perform public.ebuy_lock_order_status(v_order_id);'), true, 'the order row is locked first');
  assertEquals(
    body.includes('from public.ebuy_claim_dispatch_assignment(v_order_id, p_courier_id, p_courier_name, p_courier_id);'),
    true,
    'acceptance claims through the one guarded claim'
  );
  assertEquals(body.includes("'claim_refused'::text"), true, 'a refused claim is reported, not accepted');
});

Deno.test('the claim re-reads the order status under the lock and refuses every non-live status', async () => {
  const body = lastFunctionBody(await read('20260815_dispatch_reassignment_cas.sql'), 'ebuy_claim_dispatch_assignment');
  assertEquals(body.includes('v_status := public.ebuy_lock_order_status(p_order_id);'), true);
  assertEquals(
    body.includes("if v_status is null or v_status not in ('accepted', 'preparing', 'ready_for_pickup') then"),
    true,
    'cancelled, rejected, delivered and failed_delivery are all refused'
  );
});
