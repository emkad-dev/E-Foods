// upsertPartnerRestaurantProfile is the partner self-service path that can leave a
// restaurant published (the "Visible to customers" switch on Store details), so it
// must refuse the same publishes adminSetRestaurantPublished refuses: no usable
// location, no publish. It is judged on the row the upsert LEAVES, so clearing the
// coordinates of a located, published store is refused while an unrelated edit on a
// store that was published before this rule (and has no coordinates) still saves.
//
// Calls the REAL handler out of partnerDomain.handlers; see
// adminSetRestaurantPublished.test.ts for why the env vars are set before a dynamic
// import and why this file lives in the --no-check deno invocation.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { partnerDomain } = await import('./partner.ts');
const { serviceClient } = await import('../client.ts');

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const handler = partnerDomain.handlers.upsertPartnerRestaurantProfile;
if (typeof handler !== 'function') {
  throw new Error('partnerDomain.handlers.upsertPartnerRestaurantProfile is not registered.');
}

const fakeRequest = () => new Request('https://example.test/rpc', { method: 'POST' });

const OWNER_UID = 'owner-uid';
const RESTAURANT_ID = 'restaurant-1';

const PARTNER_CONTEXT = {
  email: 'owner@example.test',
  role: 'restaurant',
  token: 'fake-token',
  uid: OWNER_UID,
  userProfile: { uid: OWNER_UID, email: 'owner@example.test', role: 'restaurant', accountDisabled: false },
};

const LAGOS = { latitude: 6.5244, longitude: 3.3792 };

type StoredRestaurant = {
  id: string;
  ownerId: string;
  isPublished: boolean;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
};

type MockState = {
  restaurant: StoredRestaurant | null;
  upserts: Array<Record<string, unknown>>;
};

/** A chain that answers every query with "nothing there" and no error. */
const emptyQuery = () => {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'delete', 'update', 'insert', 'upsert']) {
    builder[method] = () => builder;
  }
  builder.maybeSingle = async () => ({ data: null, error: null });
  builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: null, error: null });
  return builder;
};

const installMocks = (restaurant: StoredRestaurant | null): MockState => {
  const state: MockState = { restaurant, upserts: [] };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    if (table === 'UserAccount') {
      const builder = emptyQuery();
      builder.maybeSingle = async () => ({
        data: { uid: OWNER_UID, restaurantId: restaurant?.id ?? null },
        error: null,
      });
      return builder;
    }

    if (table === 'RestaurantRecord') {
      const builder = emptyQuery();
      builder.maybeSingle = async () => ({ data: state.restaurant, error: null });
      builder.upsert = async (payload: Record<string, unknown>) => {
        state.upserts.push(payload);
        return { error: null };
      };
      return builder;
    }

    return emptyQuery();
  };

  globalThis.fetch = (async () => new Response('{}', { status: 200 })) as typeof fetch;

  return state;
};

const saveData = (overrides: Record<string, unknown>) => ({
  restaurantId: RESTAURANT_ID,
  name: 'Ada Kitchen',
  address: '1 Allen Avenue, Ikeja',
  openingTime: '08:00',
  closingTime: '22:00',
  supportsDelivery: false,
  supportsPickup: true,
  isOpen: true,
  ...overrides,
});

const save = (overrides: Record<string, unknown>) =>
  handler({ context: PARTNER_CONTEXT, data: saveData(overrides), request: fakeRequest() });

const expectRejected = async (overrides: Record<string, unknown>, label: string, state: MockState) => {
  let thrown: unknown = null;
  try {
    await save(overrides);
  } catch (error) {
    thrown = error;
  }

  expectEqual((thrown as { status?: number })?.status, 412, `${label}: status`);
  expectEqual(
    /location/i.test((thrown as { message?: string })?.message ?? ''),
    true,
    `${label}: the message tells the owner to set the location`
  );
  expectEqual(state.upserts.length, 0, `${label}: nothing written`);
};

const stored = (overrides: Partial<StoredRestaurant> = {}): StoredRestaurant => ({
  id: RESTAURANT_ID,
  ownerId: OWNER_UID,
  isPublished: false,
  latitude: null,
  longitude: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

Deno.test('partner save: publishing an unpublished store with no coordinates answers 412', async () => {
  const state = installMocks(stored());
  await expectRejected({ isPublished: true, latitude: null, longitude: null }, 'publish without coordinates', state);
});

Deno.test('partner save: publishing with 0,0 answers 412', async () => {
  const state = installMocks(stored());
  await expectRejected({ isPublished: true, latitude: 0, longitude: 0 }, 'publish at 0,0', state);
});

Deno.test('partner save: publishing with out-of-range coordinates answers 412', async () => {
  const state = installMocks(stored());
  await expectRejected({ isPublished: true, latitude: 123, longitude: 3.4 }, 'publish out of range', state);
});

Deno.test('partner save: a brand-new restaurant cannot be created already published without coordinates', async () => {
  const state = installMocks(null);
  await expectRejected({ restaurantId: undefined, isPublished: true }, 'new published store', state);
});

Deno.test('partner save: publishing with coordinates in the same save is allowed', async () => {
  const state = installMocks(stored());

  const response = await save({ isPublished: true, ...LAGOS });

  expectEqual(response.status, 200, 'status');
  expectEqual(state.upserts.length, 1, 'one upsert');
  expectEqual(state.upserts[0]?.isPublished, true, 'published');
  expectEqual(state.upserts[0]?.latitude, LAGOS.latitude, 'latitude kept');
});

Deno.test('partner save: saving a hidden store without coordinates still works', async () => {
  const state = installMocks(stored());

  const response = await save({ isPublished: false, latitude: null, longitude: null });

  expectEqual(response.status, 200, 'status');
  expectEqual(state.upserts[0]?.isPublished, false, 'stays hidden');
});

Deno.test('partner save: clearing the coordinates of a published, located store answers 412', async () => {
  const state = installMocks(stored({ isPublished: true, ...LAGOS }));
  await expectRejected({ isPublished: true, latitude: null, longitude: null }, 'clear coordinates', state);
});

Deno.test('partner save: an omitted isPublished keeps the saved flag, so clearing coordinates is still caught', async () => {
  const state = installMocks(stored({ isPublished: true, ...LAGOS }));
  await expectRejected({ latitude: null, longitude: null }, 'clear coordinates, flag omitted', state);
});

Deno.test('partner save: other details on a published, located store save normally', async () => {
  const state = installMocks(stored({ isPublished: true, ...LAGOS }));

  const response = await save({ name: 'Ada Kitchen 2', isPublished: true, ...LAGOS });

  expectEqual(response.status, 200, 'status');
  expectEqual(state.upserts[0]?.name, 'Ada Kitchen 2', 'new name saved');
});

Deno.test('partner save: unrelated changes on a store published BEFORE this rule, with no coordinates, still save', async () => {
  const state = installMocks(stored({ isPublished: true }));

  const response = await save({ name: 'Legacy Kitchen', isPublished: true, latitude: null, longitude: null });

  expectEqual(response.status, 200, 'status');
  expectEqual(state.upserts.length, 1, 'saved');
  expectEqual(state.upserts[0]?.isPublished, true, 'not hidden by code');
});

Deno.test('partner save: hiding a published store is never blocked', async () => {
  const state = installMocks(stored({ isPublished: true, ...LAGOS }));

  const response = await save({ isPublished: false, latitude: null, longitude: null });

  expectEqual(response.status, 200, 'status');
  expectEqual(state.upserts[0]?.isPublished, false, 'hidden');
});

Deno.test('partner save: an older app writing 0,0 onto a published store with no pin is refused', async () => {
  const state = installMocks(stored({ isPublished: true }));
  await expectRejected({ isPublished: true, latitude: 0, longitude: 0 }, 'new 0,0 on published', state);
});

Deno.test('partner save: an older app writing an out-of-range pin onto a located published store is refused', async () => {
  const state = installMocks(stored({ isPublished: true, ...LAGOS }));
  await expectRejected({ isPublished: true, latitude: 123, longitude: 3.4 }, 'new out-of-range on published', state);
});

Deno.test('partner save: a published store already at 0,0 still saves unrelated changes unchanged', async () => {
  const state = installMocks(stored({ isPublished: true, latitude: 0, longitude: 0 }));

  const response = await save({ name: 'Zero Kitchen', isPublished: true, latitude: 0, longitude: 0 });

  expectEqual(response.status, 200, 'status');
  expectEqual(state.upserts.length, 1, 'saved');
});

const expectOutsideNigeria = async (overrides: Record<string, unknown>, label: string, state: MockState) => {
  let thrown: unknown = null;
  try {
    await save(overrides);
  } catch (error) {
    thrown = error;
  }

  expectEqual((thrown as { status?: number })?.status, 412, `${label}: status`);
  expectEqual(
    (thrown as { message?: string })?.message,
    'Your pin is outside Nigeria. Check the latitude and longitude, or use your current location.',
    `${label}: the owner is told the pin is outside Nigeria`
  );
  expectEqual(state.upserts.length, 0, `${label}: nothing written`);
};

// Lagos is 6.52 N, 3.38 E; the swapped pair is the typo this rule exists for.
const SWAPPED_LAGOS = { latitude: 3.38, longitude: 6.52 };

Deno.test('partner save: publishing with a swapped Lagos pair answers 412 outside Nigeria', async () => {
  const state = installMocks(stored());
  await expectOutsideNigeria({ isPublished: true, ...SWAPPED_LAGOS }, 'publish swapped pair', state);
});

Deno.test('partner save: publishing a pin in another country answers 412 outside Nigeria', async () => {
  const state = installMocks(stored());
  await expectOutsideNigeria({ isPublished: true, latitude: 51.5, longitude: -0.12 }, 'publish London', state);
});

Deno.test('partner save: moving a live, located store to an outside-Nigeria pin is refused', async () => {
  const state = installMocks(stored({ isPublished: true, ...LAGOS }));
  await expectOutsideNigeria({ isPublished: true, ...SWAPPED_LAGOS }, 'move live pin out of Nigeria', state);
});

Deno.test('partner save: a pin on the edge of the Nigeria box is accepted', async () => {
  const state = installMocks(stored());

  const response = await save({ isPublished: true, latitude: 4.0, longitude: 15.0 });

  expectEqual(response.status, 200, 'status');
  expectEqual(state.upserts.length, 1, 'saved');
});

Deno.test('partner save: a live store whose existing pin is outside Nigeria still saves unrelated changes unchanged', async () => {
  const state = installMocks(stored({ isPublished: true, ...SWAPPED_LAGOS }));

  const response = await save({ name: 'Old Pin Kitchen', isPublished: true, ...SWAPPED_LAGOS });

  expectEqual(response.status, 200, 'status');
  expectEqual(state.upserts.length, 1, 'saved');
});

Deno.test('partner save: a hidden store may hold an outside-Nigeria pin', async () => {
  const state = installMocks(stored());

  const response = await save({ isPublished: false, ...SWAPPED_LAGOS });

  expectEqual(response.status, 200, 'status');
  expectEqual(state.upserts.length, 1, 'saved');
});
