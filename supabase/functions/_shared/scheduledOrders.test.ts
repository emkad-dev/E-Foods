// Unit tests for the pure scheduled-order slot validation and prep-time config
// (Task 18 / G2). scheduledOrders.ts is dependency-free (no client.ts import),
// so this runs in the FIRST, type-checked `deno test` invocation.
//
// The slot logic is exercised in restaurant-local time (WAT / UTC+1): each case
// derives the target instant's local day-of-week and local minute and builds a
// RestaurantHours window around it, so the assertions do not depend on when the
// test happens to run.
//
// MUTATION POINT (slot-in-hours): forcing `withinHours` to a constant `true` in
// validateScheduledSlot reddens ONLY "rejects a slot outside opening hours".
// MUTATION POINT (config bounds): dropping the clamp in parseScheduledOrderConfig
// reddens the prep-time bounds cases.

import {
  DEFAULT_SCHEDULED_ORDER_CONFIG,
  parseScheduledOrderConfig,
  SCHEDULE_HORIZON_MS,
  validateScheduledSlot,
  WAT_OFFSET_MS,
  type RestaurantHoursRow,
} from './scheduledOrders.ts';

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const localParts = (ms: number) => {
  const shifted = new Date(ms + WAT_OFFSET_MS);
  return { day: shifted.getUTCDay(), minute: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
};

const hhmm = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** Seven rows, all open 00:00–23:59, except `override` for one day. */
const buildHours = (override?: RestaurantHoursRow): RestaurantHoursRow[] => {
  const rows: RestaurantHoursRow[] = [];
  for (let day = 0; day < 7; day += 1) {
    if (override && override.dayOfWeek === day) {
      rows.push(override);
    } else {
      rows.push({ dayOfWeek: day, isClosed: false, opensAt: '00:00', closesAt: '23:59' });
    }
  }
  return rows;
};

const NOW = Date.now();

Deno.test('validateScheduledSlot: a slot inside opening hours is accepted', () => {
  const ts = NOW + 2 * 24 * 60 * 60 * 1000; // 2 days ahead, within horizon
  const { day, minute } = localParts(ts);
  const opens = Math.max(0, minute - 120);
  const closes = Math.min(1439, minute + 120);
  const hours = buildHours({ dayOfWeek: day, isClosed: false, opensAt: hhmm(opens), closesAt: hhmm(closes) });

  const result = validateScheduledSlot({ scheduledFor: new Date(ts).toISOString(), hours, now: NOW });
  expectEqual(result.ok, true, 'slot inside hours should be ok');
  if (result.ok) {
    expectEqual(result.scheduledForIso, new Date(ts).toISOString(), 'normalized ISO echoes the instant');
  }
});

Deno.test('validateScheduledSlot: rejects a slot outside opening hours (412 → outside_hours)', () => {
  const ts = NOW + 2 * 24 * 60 * 60 * 1000;
  const { day, minute } = localParts(ts);
  // Build a NON-overnight window that excludes `minute`.
  const window =
    minute >= 120
      ? { opensAt: '00:00', closesAt: hhmm(minute - 60) } // minute is after close
      : { opensAt: hhmm(minute + 60), closesAt: '23:59' }; // minute is before open
  const hours = buildHours({ dayOfWeek: day, isClosed: false, ...window });

  const result = validateScheduledSlot({ scheduledFor: new Date(ts).toISOString(), hours, now: NOW });
  expectEqual(result.ok, false, 'slot outside hours should be rejected');
  if (!result.ok) {
    expectEqual(result.reason, 'outside_hours', 'reason is outside_hours');
  }
});

Deno.test('validateScheduledSlot: rejects a slot on a closed day', () => {
  const ts = NOW + 2 * 24 * 60 * 60 * 1000;
  const { day } = localParts(ts);
  const hours = buildHours({ dayOfWeek: day, isClosed: true, opensAt: '00:00', closesAt: '23:59' });

  const result = validateScheduledSlot({ scheduledFor: new Date(ts).toISOString(), hours, now: NOW });
  expectEqual(result.ok, false, 'closed day should be rejected');
  if (!result.ok) {
    expectEqual(result.reason, 'closed_day', 'reason is closed_day');
  }
});

Deno.test('validateScheduledSlot: rejects a slot in the past', () => {
  const result = validateScheduledSlot({
    scheduledFor: new Date(NOW - 60 * 60 * 1000).toISOString(),
    hours: buildHours(),
    now: NOW,
  });
  expectEqual(result.ok, false, 'a past slot should be rejected');
  if (!result.ok) {
    expectEqual(result.reason, 'past', 'reason is past');
  }
});

Deno.test('validateScheduledSlot: rejects a slot beyond the 7-day horizon', () => {
  const result = validateScheduledSlot({
    scheduledFor: new Date(NOW + SCHEDULE_HORIZON_MS + 60 * 60 * 1000).toISOString(),
    hours: buildHours(),
    now: NOW,
  });
  expectEqual(result.ok, false, 'a slot beyond horizon should be rejected');
  if (!result.ok) {
    expectEqual(result.reason, 'beyond_horizon', 'reason is beyond_horizon');
  }
});

Deno.test('validateScheduledSlot: a non-string / unparseable slot is invalid', () => {
  expectEqual(validateScheduledSlot({ scheduledFor: null, hours: buildHours(), now: NOW }).ok, false, 'null slot');
  expectEqual(
    validateScheduledSlot({ scheduledFor: 'not-a-date', hours: buildHours(), now: NOW }).ok,
    false,
    'garbage slot',
  );
});

Deno.test('validateScheduledSlot: supports an overnight window (closesAt < opensAt)', () => {
  const ts = NOW + 2 * 24 * 60 * 60 * 1000;
  const { day, minute } = localParts(ts);
  // An overnight window guaranteed to include `minute`: open from minute-1 (or
  // late evening) wrapping through midnight to minute+1.
  const opens = (minute + 1439) % 1440; // minute - 1 (wrapped)
  const closes = (minute + 1) % 1440;
  const hours = buildHours({ dayOfWeek: day, isClosed: false, opensAt: hhmm(opens), closesAt: hhmm(closes) });

  // Only meaningful when the constructed window is genuinely overnight.
  if (closes < opens) {
    const result = validateScheduledSlot({ scheduledFor: new Date(ts).toISOString(), hours, now: NOW });
    expectEqual(result.ok, true, 'a slot inside an overnight window is accepted');
  }
});

Deno.test('parseScheduledOrderConfig: clamps prep time into [5, 180] and defaults sanely', () => {
  expectEqual(parseScheduledOrderConfig({ prepTimeMinutes: 45 }).prepTimeMinutes, 45, 'honours a valid value');
  expectEqual(parseScheduledOrderConfig({ prepTimeMinutes: 0 }).prepTimeMinutes, 5, 'zero clamps up to 5');
  expectEqual(parseScheduledOrderConfig({ prepTimeMinutes: -10 }).prepTimeMinutes, 5, 'negative clamps up to 5');
  expectEqual(parseScheduledOrderConfig({ prepTimeMinutes: 1000 }).prepTimeMinutes, 180, 'oversized clamps to 180');
  expectEqual(parseScheduledOrderConfig({ prepTimeMinutes: '60' }).prepTimeMinutes, 60, 'numeric string parses');
  expectEqual(
    parseScheduledOrderConfig({}).prepTimeMinutes,
    DEFAULT_SCHEDULED_ORDER_CONFIG.prepTimeMinutes,
    'missing value falls back to the default',
  );
  expectEqual(
    parseScheduledOrderConfig(null).prepTimeMinutes,
    DEFAULT_SCHEDULED_ORDER_CONFIG.prepTimeMinutes,
    'null falls back to the default',
  );
});
