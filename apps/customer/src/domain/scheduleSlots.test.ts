/**
 * Run with: node --test --experimental-strip-types apps/customer/src/domain/scheduleSlots.test.ts
 *
 * These pin the client mirror to the server's validateScheduledSlot
 * (supabase/functions/_shared/scheduledOrders.ts). Task 30 [H6]'s requirement is
 * that the picker never OFFERS a slot the server would reject, so every rejection
 * reason the server has - past, beyond_horizon, closed_day, outside_hours - gets
 * a case here proving no slot is generated for it.
 *
 * All times are constructed as explicit UTC instants and asserted in WAT (UTC+1,
 * no DST), so nothing depends on the machine's timezone.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SCHEDULE_HORIZON_MS,
  SLOT_LEAD_MINUTES,
  buildScheduleSlots,
  isSlotOfferable,
  type RestaurantHours,
} from './scheduleSlots.ts';

/** 2026-09-08T09:00:00Z is a Tuesday; 10:00 WAT. */
const NOW = Date.parse('2026-09-08T09:00:00.000Z');
const TUESDAY = 2;

/** Open 08:00-22:00 WAT every day. */
const alwaysOpen = (): RestaurantHours[] =>
  [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    closesAt: '22:00',
    dayOfWeek,
    isClosed: false,
    opensAt: '08:00',
  }));

const allSlots = (days: ReturnType<typeof buildScheduleSlots>) => days.flatMap((day) => day.slots);

test('a slot before now is never offerable', () => {
  assert.equal(
    isSlotOfferable({ hours: alwaysOpen(), now: NOW, slotMs: NOW - 60_000 }),
    false,
    'a past instant is rejected exactly as the server rejects it with reason "past"'
  );
  assert.equal(isSlotOfferable({ hours: alwaysOpen(), now: NOW, slotMs: NOW }), false, 'and "now" is not future');
});

test('a slot beyond the 7-day horizon is never offerable', () => {
  assert.equal(
    isSlotOfferable({ hours: alwaysOpen(), now: NOW, slotMs: NOW + SCHEDULE_HORIZON_MS + 60_000 }),
    false,
    'matches the server\'s "beyond_horizon" rejection'
  );
});

test('a closed day is never offered', () => {
  // Shut only Tuesday, the day `NOW` falls on.
  const hours = alwaysOpen().map((row) =>
    row.dayOfWeek === TUESDAY ? { ...row, isClosed: true } : row
  );

  const tuesdaySlots = allSlots(buildScheduleSlots({ hours, now: NOW })).filter((slot) =>
    slot.iso.startsWith('2026-09-08')
  );
  assert.equal(tuesdaySlots.length, 0, 'no slot is generated on an isClosed day');

  // Other days still produce slots, so the filter is selective, not total.
  assert.ok(allSlots(buildScheduleSlots({ hours, now: NOW })).length > 0, 'the rest of the week is still offered');
});

test('a day whose hours are missing or malformed is treated as closed, as the server does', () => {
  const blank = alwaysOpen().map((row) =>
    row.dayOfWeek === TUESDAY ? { ...row, closesAt: null, opensAt: null } : row
  );
  assert.equal(
    isSlotOfferable({ hours: blank, now: NOW, slotMs: Date.parse('2026-09-08T14:00:00.000Z') }),
    false,
    'null hours are closed, not open-all-day'
  );

  const garbage = alwaysOpen().map((row) =>
    row.dayOfWeek === TUESDAY ? { ...row, opensAt: '25:00' } : row
  );
  assert.equal(
    isSlotOfferable({ hours: garbage, now: NOW, slotMs: Date.parse('2026-09-08T14:00:00.000Z') }),
    false,
    'an unparseable HH:MM is closed too'
  );
});

test('slots outside the open window are not offered, and slots inside it are', () => {
  const hours = alwaysOpen();

  // 07:00 WAT (06:00Z) is before the 08:00 open.
  assert.equal(
    isSlotOfferable({ hours, now: NOW, slotMs: Date.parse('2026-09-09T06:00:00.000Z') }),
    false,
    'before opensAt is rejected, matching "outside_hours"'
  );
  // 23:00 WAT (22:00Z) is after the 22:00 close.
  assert.equal(
    isSlotOfferable({ hours, now: NOW, slotMs: Date.parse('2026-09-09T22:00:00.000Z') }),
    false,
    'after closesAt is rejected'
  );
  // 13:00 WAT (12:00Z) is comfortably inside.
  assert.equal(
    isSlotOfferable({ hours, now: NOW, slotMs: Date.parse('2026-09-09T12:00:00.000Z') }),
    true,
    'inside the window is accepted'
  );
});

test('an overnight window is handled the way the server handles it', () => {
  // 18:00-02:00 WAT every day.
  const hours: RestaurantHours[] = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    closesAt: '02:00',
    dayOfWeek,
    isClosed: false,
    opensAt: '18:00',
  }));

  // 20:00 WAT (19:00Z) - after opensAt.
  assert.equal(
    isSlotOfferable({ hours, now: NOW, slotMs: Date.parse('2026-09-09T19:00:00.000Z') }),
    true,
    'the evening half of an overnight window is open'
  );
  // 01:00 WAT (00:00Z) - before closesAt, on the far side of midnight.
  assert.equal(
    isSlotOfferable({ hours, now: NOW, slotMs: Date.parse('2026-09-10T00:00:00.000Z') }),
    true,
    'the after-midnight half is open too'
  );
  // 12:00 WAT (11:00Z) - the closed middle of the day.
  assert.equal(
    isSlotOfferable({ hours, now: NOW, slotMs: Date.parse('2026-09-09T11:00:00.000Z') }),
    false,
    'the gap between closesAt and opensAt is closed'
  );
});

test('every generated slot passes the same predicate, and none is sooner than the lead time', () => {
  const hours = alwaysOpen();
  const days = buildScheduleSlots({ hours, now: NOW });
  const slots = allSlots(days);

  assert.ok(slots.length > 0, 'an always-open restaurant yields slots');

  const earliest = NOW + SLOT_LEAD_MINUTES * 60 * 1000;
  for (const slot of slots) {
    const slotMs = Date.parse(slot.iso);
    assert.equal(
      isSlotOfferable({ hours, now: NOW, slotMs }),
      true,
      `generated slot ${slot.iso} must satisfy the predicate it was filtered by`
    );
    assert.ok(
      slotMs >= earliest,
      `generated slot ${slot.iso} must respect the ${SLOT_LEAD_MINUTES}m lead so the release sweep cannot fire it immediately`
    );
    assert.ok(slotMs <= NOW + SCHEDULE_HORIZON_MS, 'and must stay inside the horizon');
  }
});

test('slots land on clean interval boundaries in restaurant-local time', () => {
  const slots = allSlots(buildScheduleSlots({ hours: alwaysOpen(), now: NOW }));
  for (const slot of slots) {
    assert.ok(
      /^\d{2}:(00|30)$/.test(slot.timeLabel),
      `${slot.timeLabel} should sit on a :00/:30 boundary, not the minute checkout happened to open`
    );
  }
});

test('a restaurant with no hours rows offers nothing rather than guessing', () => {
  assert.deepEqual(
    buildScheduleSlots({ hours: [], now: NOW }),
    [],
    'no hours means scheduling is simply unavailable - never an unrestricted picker'
  );
});
