import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// dispatchRiders.ts statically imports client.ts, which throws at module scope
// without these set, so they must be set BEFORE the (dynamic) import below.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { buildFleetRiderResponse } = await import('./dispatchRiders.ts');

Deno.test('fleet projection omits PII and coarsens location', () => {
  const r = buildFleetRiderResponse({
    id: 'rider-1', displayName: 'Ada', status: 'Available', zone: 'Yaba',
    vehicleType: 'Bike', activeLoad: 2, latitude: 6.512345, longitude: 3.378912,
    licenseNumber: 'LIC-999', vehiclePlateNumber: 'ABC-123', verifiedByUid: 'admin-1',
    verifiedAt: '2026-01-01', phoneNumber: '+234800', currentAddress: '1 Road',
    verificationStatus: 'approved', acceptanceRate: 0.9,
  } as never);
  assertEquals(r.id, 'rider-1');
  assertEquals(r.activeLoad, 2);
  assertEquals(r.latitude, 6.512); // 3-decimal coarsening
  assertEquals(r.longitude, 3.379);
  assert(!('licenseNumber' in r), 'licenseNumber must be absent');
  assert(!('vehiclePlateNumber' in r), 'plate must be absent');
  assert(!('verifiedByUid' in r), 'verifiedByUid must be absent');
  assert(!('verifiedAt' in r), 'verifiedAt must be absent');
  assert(!('phoneNumber' in r), 'phone must be absent');
  assert(!('currentAddress' in r), 'address must be absent');
  assert(!('verificationStatus' in r), 'verificationStatus must be absent');
});

Deno.test('fleet projection keeps null location null', () => {
  const r = buildFleetRiderResponse({
    id: 'r2', displayName: 'B', status: 'Available', zone: 'Z', vehicleType: 'Bike',
    activeLoad: 0, latitude: null, longitude: null,
  } as never);
  assertEquals(r.latitude, null);
  assertEquals(r.longitude, null);
});
