import { assert, assertEquals, assertMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { generateDeliveryCode, isValidDeliveryCodeFormat, DELIVERY_CODE_MAX_ATTEMPTS } from './deliveryCode.ts';
Deno.test('generateDeliveryCode is always 4 digits', () => {
  for (let i = 0; i < 2000; i++) assertMatch(generateDeliveryCode(), /^\d{4}$/);
});
Deno.test('generateDeliveryCode can produce leading zeros over many draws', () => {
  let sawLeadingZero = false;
  for (let i = 0; i < 20000 && !sawLeadingZero; i++) if (generateDeliveryCode()[0] === '0') sawLeadingZero = true;
  assert(sawLeadingZero);
});
Deno.test('isValidDeliveryCodeFormat', () => {
  assert(isValidDeliveryCodeFormat('0007'));
  assert(!isValidDeliveryCodeFormat('12'));
  assert(!isValidDeliveryCodeFormat('12a4'));
  assert(!isValidDeliveryCodeFormat('12345'));
  assert(!isValidDeliveryCodeFormat(''));
  assert(!isValidDeliveryCodeFormat(1234));
});
Deno.test('max attempts constant', () => { assertEquals(DELIVERY_CODE_MAX_ATTEMPTS, 5); });
