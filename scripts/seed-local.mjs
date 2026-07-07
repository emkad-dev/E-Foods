#!/usr/bin/env node
// Seed the LOCAL Supabase stack for the load/stress test.
// Creates: 1 auth user + UserAccount(customer) + UserRole(customer) + 1 published
// RestaurantRecord with a one-item menu. Mints a customer JWT and writes an env
// file the load harness / ramp driver consume.
//
// Requires env: SUPABASE_URL, SERVICE_ROLE_KEY, ANON_KEY

const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
const serviceKey = process.env.SERVICE_ROLE_KEY;
const anonKey = process.env.ANON_KEY;
if (!url || !serviceKey || !anonKey) {
  throw new Error('SUPABASE_URL, SERVICE_ROLE_KEY, ANON_KEY are required.');
}

const EMAIL = 'loadtest+customer@example.com';
const PASSWORD = 'LoadTest!12345';
const RESTAURANT_ID = 'loadtest-resto';
const MENU_ITEM_ID = 'loadtest-item-1';
const nowIso = () => new Date().toISOString();

const req = async (path, { method = 'GET', headers = {}, body, key = serviceKey } = {}) => {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { ok: res.ok, status: res.status, body: parsed };
};

// 1. Auth user (idempotent: ignore "already registered")
let uid;
{
  const create = await req('/auth/v1/admin/users', {
    method: 'POST',
    body: { email: EMAIL, password: PASSWORD, email_confirm: true },
  });
  if (create.ok && create.body?.id) {
    uid = create.body.id;
    console.log(`auth user created: ${uid}`);
  } else {
    // Look up existing
    const list = await req(`/auth/v1/admin/users?page=1&per_page=200`);
    const found = (list.body?.users || list.body || []).find((u) => u.email === EMAIL);
    if (!found) throw new Error(`Could not create or find auth user: ${JSON.stringify(create.body)}`);
    uid = found.id;
    console.log(`auth user exists: ${uid}`);
  }
}

// 2. UserAccount (customer)
{
  const r = await req('/rest/v1/UserAccount', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: {
      uid,
      email: EMAIL,
      displayName: 'Load Tester',
      emailVerified: true,
      roleDisplay: 'customer',
      accountDisabled: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  });
  if (!r.ok) throw new Error(`UserAccount insert failed (${r.status}): ${JSON.stringify(r.body)}`);
  console.log('UserAccount upserted');
}

// 3. UserRole (customer) — guarantees the user surfaces in the user_profiles view
{
  const r = await req('/rest/v1/UserRole', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: {
      id: `loadtest-role-${uid.slice(0, 8)}`,
      userId: uid,
      role: 'customer',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  });
  if (!r.ok) throw new Error(`UserRole insert failed (${r.status}): ${JSON.stringify(r.body)}`);
  console.log('UserRole upserted');
}

// 4. RestaurantRecord — published, open, pickup, min order 0, one available item
{
  const menu = [
    {
      id: 'loadtest-cat-1',
      name: 'Mains',
      items: [{ id: MENU_ITEM_ID, name: 'Jollof Rice', price: 10, isAvailable: true }],
    },
  ];
  const r = await req('/rest/v1/RestaurantRecord', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: {
      id: RESTAURANT_ID,
      name: 'Load Test Kitchen',
      cuisine: 'Test',
      address: '1 Load Test Ave',
      menu,
      deliveryFee: 0,
      minOrder: 0,
      supportsDelivery: true,
      supportsPickup: true,
      isOpen: true,
      isPublished: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  });
  if (!r.ok) throw new Error(`RestaurantRecord insert failed (${r.status}): ${JSON.stringify(r.body)}`);
  console.log('RestaurantRecord upserted');
}

// 5. Mint a customer JWT via password grant
let accessToken;
{
  const r = await req('/auth/v1/token?grant_type=password', {
    method: 'POST',
    key: anonKey,
    body: { email: EMAIL, password: PASSWORD },
  });
  if (!r.ok || !r.body?.access_token) throw new Error(`Password grant failed (${r.status}): ${JSON.stringify(r.body)}`);
  accessToken = r.body.access_token;
  console.log('minted customer JWT');
}

// 6. Emit env for the harness / ramp
const placeOrderDraft = {
  restaurantId: RESTAURANT_ID,
  fulfillmentType: 'pickup',
  paymentMethod: 'cash',
  items: [{ id: MENU_ITEM_ID, quantity: 1 }],
};

const envLines = [
  `APP_RPC_URL=${url}/functions/v1/app-rpc`,
  `PUBLIC_CATALOG_URL=${url}/functions/v1/public-catalog`,
  `ANON_KEY=${anonKey}`,
  `AUTH_TOKEN=${accessToken}`,
  `RESTAURANT_ID=${RESTAURANT_ID}`,
  `PLACE_ORDER_DRAFT_JSON=${JSON.stringify(placeOrderDraft)}`,
  `CONFIRM_LOAD_TEST_MUTATIONS=yes`,
];

const fs = await import('node:fs');
const outPath = new URL('./.loadtest.env', import.meta.url);
fs.writeFileSync(outPath, envLines.join('\n') + '\n');
console.log(`\nWrote ${envLines.length} vars to scripts/.loadtest.env`);
console.log(`RESTAURANT_ID=${RESTAURANT_ID}  MENU_ITEM_ID=${MENU_ITEM_ID}  uid=${uid}`);
