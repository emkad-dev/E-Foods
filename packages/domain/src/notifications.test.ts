/**
 * Run with: node --test --experimental-strip-types packages/domain/src/notifications.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  ACCEPTANCE_REMINDER_NOTIFICATION_TYPE,
  ANDROID_NOTIFICATION_CHANNELS,
  NOTIFICATION_ROUTE_KEYS,
  NOTIFICATION_SOUNDS,
  buildPushMessages,
  isPartnerUrgentPush,
  PUSH_SOUND_CHANNELS_FLAG,
  resolveBroadcastPushApp,
  resolveLegacyPushChannel,
  resolvePushChannel,
  resolvePushChannelForDevice,
  resolveEasProjectId,
  resolveNotificationHref,
} from './notifications.ts';
import * as notificationsModule from './notifications.ts';

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

// ---------------------------------------------------------------------------
// Channels and sounds
// ---------------------------------------------------------------------------

const CHIME_UPDATES = { channelId: ANDROID_NOTIFICATION_CHANNELS.orderUpdates, sound: NOTIFICATION_SOUNDS.chime };
const MARIMBA_NEWS = { channelId: ANDROID_NOTIFICATION_CHANNELS.offersAndNews, sound: NOTIFICATION_SOUNDS.marimba };
const URGENT_NEW_ORDER = { channelId: ANDROID_NOTIFICATION_CHANNELS.newOrders, sound: NOTIFICATION_SOUNDS.urgent };
const URGENT_OFFER = { channelId: ANDROID_NOTIFICATION_CHANNELS.deliveryOffers, sound: NOTIFICATION_SOUNDS.urgent };
const PLATFORM_DEFAULT = { channelId: undefined, sound: 'default' };

// Every push the server sends to an app, as (app, type, status) -> expected
// channel and sound. The source scan below fails when a new type appears
// without a row here, so a new push cannot silently pick the wrong sound.
const SERVER_PUSHES: Array<{ app: string; type: string; status?: string; expected: object; note: string }> = [
  // Customer: order progress and payment -> chime.
  { app: 'customer', type: 'order_update', status: 'accepted', expected: CHIME_UPDATES, note: 'accepted' },
  { app: 'customer', type: 'order_update', status: 'ready_for_pickup', expected: CHIME_UPDATES, note: 'ready' },
  { app: 'customer', type: 'order_update', status: 'out_for_delivery', expected: CHIME_UPDATES, note: 'on the way' },
  { app: 'customer', type: 'order_update', status: 'delivered', expected: CHIME_UPDATES, note: 'delivered' },
  { app: 'customer', type: 'order_update', status: 'cancelled', expected: CHIME_UPDATES, note: 'cancelled' },
  { app: 'customer', type: 'order_update', expected: CHIME_UPDATES, note: 'unpaid order timed out' },
  { app: 'customer', type: 'order_confirmation_reminder', status: 'delivered', expected: CHIME_UPDATES, note: 'confirm prompt' },
  { app: 'customer', type: 'payment_confirmed', expected: CHIME_UPDATES, note: 'payment confirmed' },
  { app: 'customer', type: 'payment_failed', expected: CHIME_UPDATES, note: 'payment failed' },
  { app: 'customer', type: 'staff_access', expected: CHIME_UPDATES, note: 'access changed' },
  // Customer: messages and news -> marimba.
  { app: 'customer', type: 'support_reply', expected: MARIMBA_NEWS, note: 'support message' },
  { app: 'customer', type: 'broadcast', expected: MARIMBA_NEWS, note: 'broadcast' },
  { app: 'customer', type: 'promo', expected: MARIMBA_NEWS, note: 'promo' },
  // Partner: new orders and the reminder -> urgent.
  { app: 'partner', type: 'payment_confirmed', expected: URGENT_NEW_ORDER, note: 'paid order received' },
  { app: 'partner', type: ACCEPTANCE_REMINDER_NOTIFICATION_TYPE, status: 'placed', expected: URGENT_NEW_ORDER, note: 'reminder' },
  { app: 'partner', type: 'order_update', status: 'placed', expected: URGENT_NEW_ORDER, note: 'new / scheduled order released' },
  // Partner: everything else -> chime.
  { app: 'partner', type: 'order_update', status: 'cancelled', expected: CHIME_UPDATES, note: 'cancelled' },
  { app: 'partner', type: 'order_update', status: 'delivered', expected: CHIME_UPDATES, note: 'customer confirmed' },
  { app: 'partner', type: 'order_update', status: 'picked_up', expected: CHIME_UPDATES, note: 'rider picked up' },
  { app: 'partner', type: 'order_update', expected: CHIME_UPDATES, note: 'unpaid order expired' },
  { app: 'partner', type: 'application_reviewed', status: 'approved', expected: CHIME_UPDATES, note: 'application' },
  { app: 'partner', type: 'staff_access', expected: CHIME_UPDATES, note: 'access changed' },
  { app: 'partner', type: 'queue_notification', expected: CHIME_UPDATES, note: 'queued notice' },
  // Dispatch: offers -> urgent; everything else -> chime.
  { app: 'dispatch', type: 'dispatch_offer', expected: URGENT_OFFER, note: 'delivery offer' },
  { app: 'dispatch', type: 'dispatch_assignment', expected: CHIME_UPDATES, note: 'assigned' },
  { app: 'dispatch', type: 'order_update', status: 'ready_for_pickup', expected: CHIME_UPDATES, note: 'order ready' },
  { app: 'dispatch', type: 'order_update', status: 'cancelled', expected: CHIME_UPDATES, note: 'delivery cancelled' },
  { app: 'dispatch', type: 'application_reviewed', status: 'approved', expected: CHIME_UPDATES, note: 'application' },
  { app: 'dispatch', type: 'staff_access', expected: CHIME_UPDATES, note: 'access changed' },
  // Admin pushes (no FEASTY channel exists in any app for them) keep the platform default.
  { app: 'admin', type: 'rider_sos', expected: PLATFORM_DEFAULT, note: 'SOS goes to admins' },
  { app: 'admin', type: 'acceptance_deadline_escalated', expected: PLATFORM_DEFAULT, note: 'escalation' },
];

test('every server push gets the sound the owner picked for it', () => {
  for (const push of SERVER_PUSHES) {
    assert.deepEqual(
      resolvePushChannel({ app: push.app, status: push.status, type: push.type }),
      push.expected,
      `${push.app} ${push.type} ${push.status ?? ''} (${push.note})`
    );
  }
});

test('a device without the sounded channels gets exactly what every push carried before', () => {
  // Before this change the only channel the server ever named was the rider
  // offer's `offers`; everything else went with no channel and sound 'default'.
  for (const push of SERVER_PUSHES) {
    const expected =
      push.app === 'dispatch' && push.type === 'dispatch_offer'
        ? { channelId: 'offers', sound: 'default' }
        : PLATFORM_DEFAULT;
    assert.deepEqual(
      resolveLegacyPushChannel({ app: push.app, type: push.type }),
      expected,
      `${push.app} ${push.type} (${push.note})`
    );
    assert.deepEqual(resolvePushChannelForDevice({ app: push.app, status: push.status, type: push.type }, false), expected);
  }
});

test('one push to an old and a new device gives each the channel it can play', () => {
  const data = { app: 'partner', orderId: 'o1', routeKey: 'partner_order_detail', type: 'payment_confirmed', version: '1' };
  const messages = buildPushMessages(
    ['ExponentPushToken[old]', 'ExponentPushToken[new]'],
    { body: 'Order o1 has been paid', data, title: 'Paid Order Received' },
    (token) => token === 'ExponentPushToken[new]'
  );

  // Serialised as Expo receives it: an undefined channelId is dropped, which is
  // byte-for-byte the message an old build was sent before.
  assert.deepEqual(JSON.parse(JSON.stringify(messages[0])), {
    body: 'Order o1 has been paid',
    data,
    sound: 'default',
    title: 'Paid Order Received',
    to: 'ExponentPushToken[old]',
  });
  assert.deepEqual(messages[1], {
    body: 'Order o1 has been paid',
    channelId: 'new_orders',
    data,
    sound: 'feasty_urgent.wav',
    title: 'Paid Order Received',
    to: 'ExponentPushToken[new]',
  });
});

test('an old rider device keeps getting offers on the legacy offers channel', () => {
  const [oldDevice, newDevice] = buildPushMessages(
    ['T[old]', 'T[new]'],
    { body: 'b', data: { app: 'dispatch', type: 'dispatch_offer' }, title: 't' },
    (token) => token === 'T[new]'
  );
  assert.equal(oldDevice.channelId, 'offers');
  assert.equal(oldDevice.sound, 'default');
  assert.equal(newDevice.channelId, 'delivery_offers');
  assert.equal(newDevice.sound, 'feasty_urgent.wav');
});

test('the gate flag key is stable (operators set it by name)', () => {
  assert.equal(PUSH_SOUND_CHANNELS_FLAG, 'push_sound_channels');
});

test('isPartnerUrgentPush marks new orders and the reminder only', () => {
  assert.equal(isPartnerUrgentPush({ type: 'payment_confirmed' }), true);
  assert.equal(isPartnerUrgentPush({ type: ACCEPTANCE_REMINDER_NOTIFICATION_TYPE, status: 'placed' }), true);
  assert.equal(isPartnerUrgentPush({ type: 'order_update', status: 'placed' }), true);
  assert.equal(isPartnerUrgentPush({ type: 'order_update', status: 'cancelled' }), false);
  assert.equal(isPartnerUrgentPush({ type: 'order_update' }), false);
  assert.equal(isPartnerUrgentPush({}), false);
});

test('a push with no app, or an unknown type, falls back safely', () => {
  assert.deepEqual(resolvePushChannel({}), PLATFORM_DEFAULT);
  assert.deepEqual(resolvePushChannel({ app: 'customer' }), CHIME_UPDATES);
  assert.deepEqual(resolvePushChannel({ app: 'partner', type: 'something_new' }), CHIME_UPDATES);
  assert.deepEqual(resolvePushChannel({ app: 'dispatch', type: '' }), CHIME_UPDATES);
});

const FUNCTIONS_DIR = fileURLToPath(new URL('../../../supabase/functions/', import.meta.url));

const listServerSources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = `${dir}${name}`;
    if (statSync(path).isDirectory()) return listServerSources(`${path}/`);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : [];
  });

// Push type constants: every exported `*_NOTIFICATION_TYPE` of this module,
// plus any `const NAME = '...'` a server file declares, so a push whose type is
// a constant (`type: DISPATCH_OFFER_NOTIFICATION_TYPE`) is checked like a
// literal one instead of slipping past the scan.
const DOMAIN_TYPE_CONSTANTS: Record<string, string> = Object.fromEntries(
  Object.entries(notificationsModule).filter(
    (entry): entry is [string, string] => entry[0].endsWith('_NOTIFICATION_TYPE') && typeof entry[1] === 'string'
  )
);

const serverStringConstants = (sources: string[]) => {
  const constants: Record<string, string> = { ...DOMAIN_TYPE_CONSTANTS };
  for (const source of sources) {
    for (const match of source.matchAll(/const ([A-Z][A-Z0-9_]*) = '([a-z_]+)'/g)) {
      constants[match[1]] = match[2];
    }
  }
  return constants;
};

test('every push type the server sends to an app has a mapping row', () => {
  const known = new Set(SERVER_PUSHES.map((push) => `${push.app}:${push.type}`));
  const files = listServerSources(FUNCTIONS_DIR);
  const sources = files.map((file) => readFileSync(file, 'utf8'));
  const constants = serverStringConstants(sources);
  const missing: string[] = [];
  let constantTyped = 0;
  files.forEach((file, index) => {
    for (const match of sources[index].matchAll(/buildNotificationData\(\{([\s\S]*?)\}\)/g)) {
      const block = match[1];
      const app = block.match(/app: '([a-z]+)'/)?.[1];
      // Computed apps (role-derived staff_access) are covered per app above;
      // admin pushes all take the platform default whatever their type.
      if (!app || app === 'admin') continue;
      const literal = block.match(/type: '([a-z_]+)'/)?.[1];
      const constantName = block.match(/type: ([A-Z][A-Z0-9_]*)\b/)?.[1];
      if (constantName) constantTyped += 1;
      const type = literal ?? (constantName ? constants[constantName] : undefined);
      const where = file.slice(FUNCTIONS_DIR.length);
      if (!type) {
        missing.push(`${app}: unresolvable type ${constantName ?? '(none)'} in ${where}`);
      } else if (!known.has(`${app}:${type}`)) {
        missing.push(`${app}:${type} in ${where}`);
      }
    }
  });
  assert.deepEqual(missing, []);
  // The offer and the reminder are sent with constant types today; if the scan
  // stopped seeing them it would be checking nothing for them.
  assert.ok(constantTyped >= 2, `constant-typed pushes scanned: ${constantTyped}`);
});

test('every exported push type constant has a mapping row', () => {
  const tabled = new Set(SERVER_PUSHES.map((push) => push.type));
  const constants = Object.entries(DOMAIN_TYPE_CONSTANTS);
  assert.ok(constants.length >= 3, 'the offer, reminder and broadcast constants are exported');
  for (const [name, value] of constants) {
    assert.ok(tabled.has(value), `${name} (${value}) has no row in SERVER_PUSHES`);
  }
});

test('only an all-customer broadcast audience names the customer channel', () => {
  assert.equal(resolveBroadcastPushApp({ roles: ['customer'] }), 'customer');
  assert.equal(resolveBroadcastPushApp({ roles: [], activity: { orderedWithinDays: 7 } }), 'customer');
  assert.equal(resolveBroadcastPushApp({ restaurantId: 'r1' }), 'customer');
  assert.equal(resolveBroadcastPushApp({ roles: ['customer', 'restaurant'] }), null);
  assert.equal(resolveBroadcastPushApp({ roles: ['dispatch'] }), null);
  assert.equal(resolveBroadcastPushApp({}), null);
});

// Each app must create every channel the server can address to it, with the
// sound the mapping promises, and must ship that sound file both where the
// expo-notifications plugin reads it and where the committed android project
// (built as-is, without prebuild) reads it.
const APP_EXPECTATIONS = {
  customer: {
    channels: { orderUpdates: 'chime', offersAndNews: 'marimba' },
    legacy: ['default'],
  },
  partner: {
    channels: { newOrders: 'urgent', orderUpdates: 'chime' },
    legacy: ['default'],
  },
  dispatch: {
    channels: { deliveryOffers: 'urgent', orderUpdates: 'chime' },
    legacy: ['default', 'dispatchOffers'],
  },
} as const;

const appFile = (app: string, path: string) => fileURLToPath(new URL(`../../../apps/${app}/${path}`, import.meta.url));

const channelBlock = (source: string, key: string) => {
  const start = source.indexOf(`setNotificationChannelAsync(ANDROID_NOTIFICATION_CHANNELS.${key},`);
  return start === -1 ? null : source.slice(start, source.indexOf('});', start));
};

for (const [app, expected] of Object.entries(APP_EXPECTATIONS)) {
  test(`${app} registers its channels with the mapped sounds and ships the sound files`, () => {
    const hook = readFileSync(appFile(app, 'src/hooks/usePushNotifications.ts'), 'utf8');

    for (const [key, sound] of Object.entries(expected.channels)) {
      const block = channelBlock(hook, key);
      assert.ok(block, `${app} does not create channel ${key}`);
      assert.match(block, new RegExp(`sound: NOTIFICATION_SOUNDS\\.${sound}\\b`), `${app} ${key} sound`);
    }
    for (const key of expected.legacy) {
      assert.ok(channelBlock(hook, key), `${app} stopped creating legacy channel ${key}`);
    }

    // The mapping never addresses this app on a channel it does not create.
    const created = new Set<string>(
      Object.keys(expected.channels).map(
        (key) => ANDROID_NOTIFICATION_CHANNELS[key as keyof typeof ANDROID_NOTIFICATION_CHANNELS]
      )
    );
    for (const push of SERVER_PUSHES.filter((row) => row.app === app)) {
      const { channelId } = resolvePushChannel({ app, status: push.status, type: push.type });
      assert.ok(channelId && created.has(channelId), `${app} ${push.type} -> ${channelId}`);
    }

    const config = JSON.parse(readFileSync(appFile(app, 'app.json'), 'utf8'));
    const notificationsPlugin = config.expo.plugins.find(
      (plugin: unknown) => Array.isArray(plugin) && plugin[0] === 'expo-notifications'
    );
    assert.ok(notificationsPlugin, `${app} lost the expo-notifications plugin`);
    assert.ok(notificationsPlugin[1].icon, `${app} expo-notifications icon kept`);
    const files = [...new Set(Object.values(expected.channels))].map((sound) => NOTIFICATION_SOUNDS[sound]);
    assert.deepEqual(
      [...notificationsPlugin[1].sounds].sort(),
      files.map((file) => `./assets/sounds/${file}`).sort(),
      `${app} plugin sounds list exactly the sounds it uses`
    );
    for (const file of files) {
      assert.ok(existsSync(appFile(app, `assets/sounds/${file}`)), `${app} assets/sounds/${file}`);
      assert.ok(existsSync(appFile(app, `android/app/src/main/res/raw/${file}`)), `${app} res/raw/${file}`);
    }

    // Release builds shrink resources, and the sounds are found only by a
    // runtime name, so res/raw/keep.xml must keep them; the config plugin
    // writes the same file on any prebuild.
    const keepXml = readFileSync(appFile(app, 'android/app/src/main/res/raw/keep.xml'), 'utf8');
    assert.match(keepXml, /xmlns:tools="http:\/\/schemas\.android\.com\/tools"/, `${app} keep.xml tools namespace`);
    assert.match(keepXml, /tools:keep="@raw\/feasty_\*"/, `${app} keep.xml keeps every feasty_ sound`);
    assert.ok(
      config.expo.plugins.includes('../../scripts/expo/withKeepNotificationSounds.js'),
      `${app} app.json runs the keep.xml plugin on prebuild`
    );
    const require = createRequire(import.meta.url);
    const { KEEP_XML } = require('../../../scripts/expo/withKeepNotificationSounds.js') as { KEEP_XML: string };
    // Line endings normalised: git may check the file out with CRLF on Windows.
    assert.equal(
      keepXml.replace(/\r\n/g, '\n'),
      KEEP_XML,
      `${app} committed keep.xml matches what prebuild would write`
    );
  });
}
