import {
  calculateDistanceKm,
  isDeliveryOutOfRange,
  resolveDeliveryRadiusKm,
} from './deliveryCoverage.ts';

const equals = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
};

Deno.test('a non-positive or absent radius falls back to the 12km default', () => {
  equals(resolveDeliveryRadiusKm(0), 12, 'zero');
  equals(resolveDeliveryRadiusKm(-4), 12, 'negative');
  equals(resolveDeliveryRadiusKm(null), 12, 'null');
  equals(resolveDeliveryRadiusKm(undefined), 12, 'undefined');
  equals(resolveDeliveryRadiusKm('not a number'), 12, 'garbage');
  equals(resolveDeliveryRadiusKm(5), 5, 'configured');
  equals(resolveDeliveryRadiusKm('7.5'), 7.5, 'numeric string');
});

Deno.test('distance between two Lagos points is a few kilometres', () => {
  const distance = calculateDistanceKm(
    { latitude: 6.4550, longitude: 3.3841 },
    { latitude: 6.4600, longitude: 3.3900 }
  );
  if (distance <= 0 || distance > 2) {
    throw new Error(`expected a sub-2km distance, got ${distance}`);
  }
});

Deno.test('a delivery beyond the radius is out of range', () => {
  equals(
    isDeliveryOutOfRange({
      restaurantLatitude: 6.4550,
      restaurantLongitude: 3.3841,
      deliveryLatitude: 9.0765, // Abuja
      deliveryLongitude: 7.3986,
      deliveryRadiusKm: 12,
    }),
    true,
    'far delivery'
  );
});

Deno.test('a delivery inside the radius is in range', () => {
  equals(
    isDeliveryOutOfRange({
      restaurantLatitude: 6.4550,
      restaurantLongitude: 3.3841,
      deliveryLatitude: 6.4600,
      deliveryLongitude: 3.3900,
      deliveryRadiusKm: 12,
    }),
    false,
    'near delivery'
  );
});

Deno.test('a zero radius uses the 12km fallback, matching the client', () => {
  equals(
    isDeliveryOutOfRange({
      restaurantLatitude: 6.4550,
      restaurantLongitude: 3.3841,
      deliveryLatitude: 6.5170, // ~7km away
      deliveryLongitude: 3.3841,
      deliveryRadiusKm: 0,
    }),
    false,
    'zero radius falls back'
  );
});

Deno.test('missing coordinates on either side never block the order', () => {
  equals(
    isDeliveryOutOfRange({
      restaurantLatitude: null,
      restaurantLongitude: null,
      deliveryLatitude: 6.4600,
      deliveryLongitude: 3.3900,
      deliveryRadiusKm: 12,
    }),
    false,
    'restaurant without a pin'
  );
  equals(
    isDeliveryOutOfRange({
      restaurantLatitude: 6.4550,
      restaurantLongitude: 3.3841,
      deliveryLatitude: null,
      deliveryLongitude: null,
      deliveryRadiusKm: 12,
    }),
    false,
    'delivery without coordinates'
  );
});
