import {
  checkExpoPushReceipts,
  deliverExpoPushMessages,
  EXPO_PUSH_ENDPOINT,
  EXPO_RECEIPTS_ENDPOINT,
  interpretTickets,
  splitByExperience,
  summarizeFailures,
  type ExpoPushMessage,
  type FetchLike,
} from './expoPush.ts';

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const assertEquals = (actual: unknown, expected: unknown, message = '') => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message} expected ${e}, got ${a}`);
};

const message = (to: string): ExpoPushMessage => ({ body: 'b', title: 't', to });
const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, status });

Deno.test('interpretTickets: ok tickets become receipt tickets, DeviceNotRegistered becomes a dead token', () => {
  const outcome = interpretTickets(
    [message('ExponentPushToken[a]'), message('ExponentPushToken[b]'), message('ExponentPushToken[c]')],
    [
      { id: 'r1', status: 'ok' },
      { details: { error: 'DeviceNotRegistered', expoPushToken: 'ExponentPushToken[b]' }, message: 'gone', status: 'error' },
      { details: { error: 'InvalidCredentials' }, message: 'no fcm', status: 'error' },
    ]
  );
  assertEquals(outcome.accepted, 1);
  assertEquals(outcome.receiptTickets, [{ id: 'r1', token: 'ExponentPushToken[a]' }]);
  assertEquals(outcome.deadTokens, ['ExponentPushToken[b]']);
  assertEquals(
    outcome.failures.map((failure) => failure.error),
    ['DeviceNotRegistered', 'InvalidCredentials']
  );
});

Deno.test('interpretTickets: a missing ticket is a failure, never silently counted as sent', () => {
  const outcome = interpretTickets([message('ExponentPushToken[a]')], []);
  assertEquals(outcome.accepted, 0);
  assertEquals(outcome.failures[0]?.error, 'MissingTicket');
});

Deno.test('splitByExperience regroups a mixed-project batch per project', () => {
  const messages = [message('T[customer1]'), message('T[partner1]'), message('T[customer2]'), message('T[orphan]')];
  const groups = splitByExperience(messages, {
    errors: [
      {
        code: 'PUSH_TOO_MANY_EXPERIENCE_IDS',
        details: { '@feasty/customer': ['T[customer1]', 'T[customer2]'], '@feasty/partner': ['T[partner1]'] },
      },
    ],
  });
  assert(groups !== null, 'expected groups');
  assertEquals(
    groups!.map((group) => group.map((entry) => entry.to)),
    [['T[customer1]', 'T[customer2]'], ['T[partner1]'], ['T[orphan]']]
  );
});

Deno.test('splitByExperience ignores unrelated errors', () => {
  assertEquals(splitByExperience([message('a')], { errors: [{ code: 'TOO_MANY_REQUESTS' }] }), null);
  assertEquals(splitByExperience([message('a')], { data: [] }), null);
});

Deno.test('deliverExpoPushMessages retries a mixed-project batch as one request per project', async () => {
  const calls: string[][] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    assertEquals(url, EXPO_PUSH_ENDPOINT);
    const batch = JSON.parse(String(init.body)) as ExpoPushMessage[];
    calls.push(batch.map((entry) => entry.to));
    if (batch.length === 2) {
      return jsonResponse(400, {
        errors: [
          { code: 'PUSH_TOO_MANY_EXPERIENCE_IDS', details: { '@x/customer': ['T[c]'], '@x/partner': ['T[p]'] } },
        ],
      });
    }
    return jsonResponse(200, { data: [{ id: `id-${batch[0].to}`, status: 'ok' }] });
  };

  const outcome = await deliverExpoPushMessages([message('T[c]'), message('T[p]')], { fetchImpl });
  assertEquals(calls, [['T[c]', 'T[p]'], ['T[c]'], ['T[p]']]);
  assertEquals(outcome.accepted, 2);
  assertEquals(outcome.receiptTickets.length, 2);
});

Deno.test('deliverExpoPushMessages throws on a non-recoverable HTTP error', async () => {
  const fetchImpl: FetchLike = async () => jsonResponse(500, { errors: [{ code: 'INTERNAL' }] });
  let threw = false;
  try {
    await deliverExpoPushMessages([message('T[a]')], { fetchImpl });
  } catch {
    threw = true;
  }
  assert(threw, 'expected a throw');
});

Deno.test('checkExpoPushReceipts collects dead tokens and credential errors', async () => {
  const fetchImpl: FetchLike = async (url, init) => {
    assertEquals(url, EXPO_RECEIPTS_ENDPOINT);
    assertEquals(JSON.parse(String(init.body)).ids, ['r1', 'r2', 'r3', 'r4']);
    return jsonResponse(200, {
      data: {
        r1: { status: 'ok' },
        r2: { details: { error: 'DeviceNotRegistered' }, status: 'error' },
        r3: { details: { error: 'InvalidCredentials' }, message: 'Unable to retrieve the FCM server key', status: 'error' },
      },
    });
  };

  const result = await checkExpoPushReceipts(
    [
      { id: 'r1', token: 'T[1]' },
      { id: 'r2', token: 'T[2]' },
      { id: 'r3', token: 'T[3]' },
      { id: 'r4', token: 'T[4]' },
    ],
    { fetchImpl }
  );
  assertEquals(result.checked, 3);
  assertEquals(result.pending, 1);
  assertEquals(result.deadTokens, ['T[2]']);
  const summary = summarizeFailures(result.failures);
  assertEquals(summary.counts, { DeviceNotRegistered: 1, InvalidCredentials: 1 });
  assert(summary.hints.some((hint) => hint.includes('FCM V1')), 'expected an FCM V1 hint');
});
