import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  CUSTOMER_CONFIRM_REMINDER_OFFSETS_MS,
  CUSTOMER_CONFIRM_WINDOW_MS,
  getReminderDecision,
  isAwaitingCustomerConfirmation,
  isLagosQuietHours,
} from './customerConfirmation.ts';

const MIN = 60_000;

// Builds a scenario from a Lagos wall-clock completion time (UTC+1, no DST).
const scenario = (lagosCompletion: string) => {
  const completion = Date.parse(`2026-11-04T${lagosCompletion}:00.000+01:00`);
  return {
    dueAt: new Date(completion + CUSTOMER_CONFIRM_WINDOW_MS).toISOString(),
    at: (minutesAfterCompletion: number) => new Date(completion + minutesAfterCompletion * MIN),
  };
};

Deno.test('constants: 3 hour window, reminders at 30/90/150 minutes', () => {
  assertEquals(CUSTOMER_CONFIRM_WINDOW_MS, 3 * 60 * MIN);
  assertEquals([...CUSTOMER_CONFIRM_REMINDER_OFFSETS_MS], [30 * MIN, 90 * MIN, 150 * MIN]);
});

Deno.test('isLagosQuietHours: 22:00 to 07:00 Africa/Lagos, boundaries exact', () => {
  assertEquals(isLagosQuietHours(new Date('2026-11-04T20:59:59.999Z')), false); // 21:59 Lagos
  assertEquals(isLagosQuietHours(new Date('2026-11-04T21:00:00.000Z')), true); // 22:00 Lagos
  assertEquals(isLagosQuietHours(new Date('2026-11-04T23:00:00.000Z')), true); // midnight Lagos
  assertEquals(isLagosQuietHours(new Date('2026-11-05T02:00:00.000Z')), true); // 03:00 Lagos
  assertEquals(isLagosQuietHours(new Date('2026-11-05T05:59:59.999Z')), true); // 06:59 Lagos
  assertEquals(isLagosQuietHours(new Date('2026-11-05T06:00:00.000Z')), false); // 07:00 Lagos
  assertEquals(isLagosQuietHours(new Date('2026-11-04T11:00:00.000Z')), false); // midday
});

Deno.test('getReminderDecision: stages 1, 2, 3 fall due at 30, 90, 150 minutes', () => {
  const { dueAt, at } = scenario('10:00');
  assertEquals(getReminderDecision({ dueAt, remindersSent: 0, now: at(29) }), null);
  assertEquals(getReminderDecision({ dueAt, remindersSent: 0, now: at(30) }), 1);
  assertEquals(getReminderDecision({ dueAt, remindersSent: 1, now: at(89) }), null);
  assertEquals(getReminderDecision({ dueAt, remindersSent: 1, now: at(90) }), 2);
  assertEquals(getReminderDecision({ dueAt, remindersSent: 2, now: at(149) }), null);
  assertEquals(getReminderDecision({ dueAt, remindersSent: 2, now: at(150) }), 3);
});

Deno.test('getReminderDecision: a stage already sent is never repeated; only three exist', () => {
  const { dueAt, at } = scenario('10:00');
  assertEquals(getReminderDecision({ dueAt, remindersSent: 1, now: at(45) }), null);
  assertEquals(getReminderDecision({ dueAt, remindersSent: 3, now: at(170) }), null);
});

Deno.test('getReminderDecision: only the latest due stage is returned', () => {
  const { dueAt, at } = scenario('10:00');
  assertEquals(getReminderDecision({ dueAt, remindersSent: 0, now: at(100) }), 2);
  assertEquals(getReminderDecision({ dueAt, remindersSent: 0, now: at(160) }), 3);
});

Deno.test('getReminderDecision: null at and after dueAt', () => {
  const { dueAt, at } = scenario('10:00');
  assertEquals(getReminderDecision({ dueAt, remindersSent: 0, now: at(179) }), 3);
  assertEquals(getReminderDecision({ dueAt, remindersSent: 0, now: at(180) }), null);
  assertEquals(getReminderDecision({ dueAt, remindersSent: 2, now: at(200) }), null);
});

Deno.test('getReminderDecision: a stage falling due in quiet hours is not sent then', () => {
  // Completed 19:30 Lagos: stage 3 falls due at 22:00 (quiet), the order closes 22:30.
  const { dueAt, at } = scenario('19:30');
  assertEquals(getReminderDecision({ dueAt, remindersSent: 0, now: at(30) }), 1);
  assertEquals(getReminderDecision({ dueAt, remindersSent: 2, now: at(150) }), null);
  assertEquals(getReminderDecision({ dueAt, remindersSent: 2, now: at(179) }), null);
});

Deno.test('getReminderDecision: after 07:00 the first sweep sends ONE reminder, the latest due stage', () => {
  // Completed 04:30 Lagos: stages fall due 05:00 and 06:00 (quiet) and 07:00.
  const early = scenario('04:30');
  assertEquals(getReminderDecision({ dueAt: early.dueAt, remindersSent: 0, now: early.at(30) }), null);
  assertEquals(getReminderDecision({ dueAt: early.dueAt, remindersSent: 0, now: early.at(89) }), null);
  // 07:00 sharp: stages 1 and 2 are overdue, stage 3 is due; only 3 comes back, which the caller
  // stores as remindersSent so 1 and 2 are consumed.
  assertEquals(getReminderDecision({ dueAt: early.dueAt, remindersSent: 0, now: early.at(150) }), 3);

  // Completed 05:30 Lagos: stage 1 at 06:00 is held back, then 07:00 sends stage 2 (not 1 and 2).
  const mid = scenario('05:30');
  assertEquals(getReminderDecision({ dueAt: mid.dueAt, remindersSent: 0, now: mid.at(30) }), null);
  assertEquals(getReminderDecision({ dueAt: mid.dueAt, remindersSent: 0, now: mid.at(90) }), 2);
  assertEquals(getReminderDecision({ dueAt: mid.dueAt, remindersSent: 2, now: mid.at(150) }), 3);
});

Deno.test('getReminderDecision: tolerates a Date dueAt and refuses a missing or invalid one', () => {
  const { dueAt, at } = scenario('10:00');
  assertEquals(getReminderDecision({ dueAt: new Date(dueAt), remindersSent: 0, now: at(30) }), 1);
  assertEquals(getReminderDecision({ dueAt: null, remindersSent: 0, now: at(30) }), null);
  assertEquals(getReminderDecision({ dueAt: 'not-a-date', remindersSent: 0, now: at(30) }), null);
});

Deno.test('isAwaitingCustomerConfirmation: delivered, in the flow, not yet confirmed', () => {
  const base = { status: 'delivered', customerConfirmDueAt: '2026-11-04T12:00:00Z', customerConfirmedAt: null };
  assert(isAwaitingCustomerConfirmation(base));
  // A reported order still awaits: the timer stops but the customer may confirm afterwards.
  assert(isAwaitingCustomerConfirmation({ ...base, customerIssueReportedAt: '2026-11-04T10:00:00Z' }));
  assert(!isAwaitingCustomerConfirmation({ ...base, customerConfirmedAt: '2026-11-04T10:00:00Z' }));
  assert(!isAwaitingCustomerConfirmation({ ...base, customerConfirmDueAt: null }));
  assert(!isAwaitingCustomerConfirmation({ ...base, customerConfirmDueAt: undefined }));
  assert(!isAwaitingCustomerConfirmation({ ...base, status: 'on_the_way' }));
  assert(!isAwaitingCustomerConfirmation({ status: 'delivered' }));
});
