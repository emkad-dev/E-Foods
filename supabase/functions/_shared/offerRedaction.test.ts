import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { redactOfferSnapshot } from './offerRedaction.ts';

Deno.test('redaction strips address/phone/customerId, coarsens coords, reduces payment', () => {
  const out = redactOfferSnapshot({
    id: 'o1', restaurantName: 'Mama Put', restaurantLocation: { latitude: 6.5, longitude: 3.3 },
    deliveryAddress: '15 Secret Lane', deliveryLocation: { latitude: 6.512345, longitude: 3.378912 },
    customerId: 'cust-9', customerPhone: '+2348001234567',
    payment: { method: 'card', status: 'paid', reference: 'ref_x' },
    itemCount: 3, pricing: { total: 4300 },
  } as never) as Record<string, never>;
  assert(!('deliveryAddress' in out), 'address must be gone');
  assert(!('customerId' in out), 'customerId must be gone');
  assert(!('customerPhone' in out), 'phone must be gone');
  assertEquals((out.deliveryLocation as { latitude: number }).latitude, 6.512);
  assertEquals((out.deliveryLocation as { longitude: number }).longitude, 3.379);
  assertEquals(out.payment as unknown, { status: 'paid' });  // method/reference gone
  assertEquals(out.restaurantName as unknown, 'Mama Put');   // kept
  assertEquals((out.pricing as { total: number }).total, 4300); // kept
});

Deno.test('redaction tolerates missing optional fields', () => {
  const out = redactOfferSnapshot({ id: 'o2', restaurantName: 'X' } as never);
  assertEquals((out as { id: string }).id, 'o2');
});

Deno.test('redaction does not mutate its input', () => {
  const input = { id: 'o3', deliveryAddress: 'A', payment: { method: 'cash', status: 'pending' } };
  redactOfferSnapshot(input);
  assertEquals(input.deliveryAddress, 'A');
  assertEquals(input.payment.method, 'cash');
});
