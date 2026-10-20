/**
 * Run with: node --test --experimental-strip-types packages/domain/src/notifications.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  NOTIFICATION_ROUTE_KEYS,
  resolveEasProjectId,
  resolveNotificationHref,
} from './notifications.ts';

test('every route key the server can send is one the apps understand', () => {
  // The server copy lives in a Deno module that node cannot import, so the
  // union is read from source. A key the server sends but the apps do not
  // know falls through to the legacy-path branch and usually routes nowhere.
  const serverSource = readFileSync(
    fileURLToPath(new URL('../../../supabase/functions/_shared/notifications.ts', import.meta.url)),
    'utf8'
  );
  const union = serverSource.match(/type NotificationRouteKey =([\s\S]*?);/);
  assert.ok(union, 'server NotificationRouteKey union not found');
  const serverKeys = [...union[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]).sort();
  assert.deepEqual(serverKeys, [...NOTIFICATION_ROUTE_KEYS].sort());
});

test('order pushes open the right screen in each app', () => {
  assert.equal(
    resolveNotificationHref('customer', { app: 'customer', orderId: 'o1', routeKey: 'customer_order_detail' }),
    '/orders/o1'
  );
  assert.equal(
    resolveNotificationHref('partner', { app: 'partner', orderId: 'o1', routeKey: 'partner_order_detail' }),
    '/order/o1'
  );
  assert.equal(
    resolveNotificationHref('dispatch', { app: 'dispatch', orderId: 'o1', routeKey: 'dispatch_delivery_offer' }),
    '/offer/o1'
  );
  assert.equal(
    resolveNotificationHref('dispatch', { app: 'dispatch', orderId: 'o1', routeKey: 'dispatch_delivery_detail' }),
    '/delivery/o1'
  );
});

test('a support reply opens the support thread, not Profile', () => {
  assert.equal(resolveNotificationHref('customer', { app: 'customer', routeKey: 'customer_support' }), '/support');
});

test('a push addressed to another app is ignored', () => {
  assert.equal(
    resolveNotificationHref('partner', { app: 'customer', orderId: 'o1', routeKey: 'customer_order_detail' }),
    null
  );
});

test('resolveEasProjectId rejects the legacy Google Analytics id and picks the EAS UUID', () => {
  assert.equal(
    resolveEasProjectId(undefined, 'G-VM017RKW5Q', 'dcd9458a-36cb-4f88-bd22-b53a99e1332b'),
    'dcd9458a-36cb-4f88-bd22-b53a99e1332b'
  );
  assert.equal(resolveEasProjectId('G-VM017RKW5Q', '', null), null);
});
