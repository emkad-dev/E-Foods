import {
  canClaimRestaurantLink,
  dedupeRestaurantRowsById,
  resolvePartnerRestaurantScope,
} from './partnerRestaurantScope.ts';

const equals = (actual: unknown, expected: unknown, label: string) => {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${label}: expected ${expectedJson}, got ${actualJson}`);
  }
};

Deno.test('admins are not owner-filtered', () => {
  equals(
    resolvePartnerRestaurantScope({ role: 'admin', uid: 'admin-1', linkedRestaurantId: 'rest-9' }),
    { ownerFilterUid: null, extraRestaurantId: null },
    'admin scope'
  );
});

Deno.test('partners are filtered to restaurants they own', () => {
  equals(
    resolvePartnerRestaurantScope({ role: 'restaurant', uid: 'user-1', linkedRestaurantId: '' }),
    { ownerFilterUid: 'user-1', extraRestaurantId: null },
    'partner scope'
  );
});

Deno.test('a partner whose linked restaurant may not be owned still gets that row', () => {
  equals(
    resolvePartnerRestaurantScope({ role: 'restaurant', uid: 'user-1', linkedRestaurantId: 'rest-3' }),
    { ownerFilterUid: 'user-1', extraRestaurantId: 'rest-3' },
    'partner scope with drifted link'
  );
});

Deno.test('admins can claim any restaurant', () => {
  equals(
    canClaimRestaurantLink({
      role: 'admin',
      uid: 'admin-1',
      linkedRestaurantId: '',
      restaurantId: 'rest-1',
      restaurantOwnerId: 'user-2',
    }),
    true,
    'admin claim'
  );
});

Deno.test('a partner can claim a restaurant they already own', () => {
  equals(
    canClaimRestaurantLink({
      role: 'restaurant',
      uid: 'user-1',
      linkedRestaurantId: '',
      restaurantId: 'rest-1',
      restaurantOwnerId: 'user-1',
    }),
    true,
    'own restaurant claim'
  );
});

Deno.test('a partner can claim an unowned restaurant their account is already linked to', () => {
  equals(
    canClaimRestaurantLink({
      role: 'restaurant',
      uid: 'user-1',
      linkedRestaurantId: 'rest-1',
      restaurantId: 'rest-1',
      restaurantOwnerId: '',
    }),
    true,
    'assigned unowned claim'
  );
});

Deno.test('a partner cannot claim an unowned restaurant they were never assigned', () => {
  equals(
    canClaimRestaurantLink({
      role: 'restaurant',
      uid: 'user-1',
      linkedRestaurantId: '',
      restaurantId: 'rest-7',
      restaurantOwnerId: '',
    }),
    false,
    'unassigned unowned claim'
  );
});

Deno.test('a partner cannot claim a restaurant owned by another partner', () => {
  equals(
    canClaimRestaurantLink({
      role: 'restaurant',
      uid: 'user-1',
      linkedRestaurantId: 'rest-7',
      restaurantId: 'rest-7',
      restaurantOwnerId: 'user-2',
    }),
    false,
    'foreign restaurant claim'
  );
});

Deno.test('duplicate rows collapse to the first occurrence', () => {
  equals(
    dedupeRestaurantRowsById([{ id: 'a' }, { id: 'b' }, { id: 'a' }]),
    [{ id: 'a' }, { id: 'b' }],
    'dedupe'
  );
});
