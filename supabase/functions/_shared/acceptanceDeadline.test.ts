// The PlatformSettings acceptance-deadline parser (acceptanceDeadline.ts).
// Pure, no DB, no env - runs in the first (type-checked) `deno test`
// invocation, mirroring dispatchTracking.test.ts. A mistyped/zero/negative
// deadline must fall back to the default whole, so a bad admin value can never
// make every fresh order instantly overdue (escalated then refunded on the
// next minute).

import {
  DEFAULT_ACCEPTANCE_DEADLINE,
  MAX_ACCEPTANCE_DEADLINE_MINUTES,
  MIN_ACCEPTANCE_DEADLINE_MINUTES,
  parseAcceptanceDeadline,
} from './acceptanceDeadline.ts';

const assertEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

Deno.test('parseAcceptanceDeadline: a valid deadline is accepted as-is', () => {
  assertEqual(parseAcceptanceDeadline({ acceptanceDeadlineMinutes: 8 }).acceptanceDeadlineMinutes, 8, 'accepts 8');
  assertEqual(
    parseAcceptanceDeadline({ acceptanceDeadlineMinutes: MIN_ACCEPTANCE_DEADLINE_MINUTES }).acceptanceDeadlineMinutes,
    MIN_ACCEPTANCE_DEADLINE_MINUTES,
    'accepts the lower bound',
  );
  assertEqual(
    parseAcceptanceDeadline({ acceptanceDeadlineMinutes: MAX_ACCEPTANCE_DEADLINE_MINUTES }).acceptanceDeadlineMinutes,
    MAX_ACCEPTANCE_DEADLINE_MINUTES,
    'accepts the upper bound',
  );
});

Deno.test('parseAcceptanceDeadline: a mistyped or out-of-range deadline falls back to the default whole', () => {
  const fallback = DEFAULT_ACCEPTANCE_DEADLINE.acceptanceDeadlineMinutes;

  assertEqual(
    parseAcceptanceDeadline({ acceptanceDeadlineMinutes: 0 }).acceptanceDeadlineMinutes,
    fallback,
    'a zero deadline falls back (would make every order instantly overdue)',
  );
  assertEqual(
    parseAcceptanceDeadline({ acceptanceDeadlineMinutes: -5 }).acceptanceDeadlineMinutes,
    fallback,
    'a negative deadline falls back',
  );
  assertEqual(
    parseAcceptanceDeadline({ acceptanceDeadlineMinutes: MAX_ACCEPTANCE_DEADLINE_MINUTES + 1 }).acceptanceDeadlineMinutes,
    fallback,
    'an absurd deadline falls back',
  );
  assertEqual(
    parseAcceptanceDeadline({ acceptanceDeadlineMinutes: Number.POSITIVE_INFINITY }).acceptanceDeadlineMinutes,
    fallback,
    'a non-finite deadline falls back',
  );
  assertEqual(
    parseAcceptanceDeadline({ acceptanceDeadlineMinutes: '8' }).acceptanceDeadlineMinutes,
    fallback,
    'a string deadline falls back',
  );
  assertEqual(
    parseAcceptanceDeadline({ acceptanceDeadlineMinutes: null }).acceptanceDeadlineMinutes,
    fallback,
    'null does NOT coerce to 0 - it falls back',
  );
  assertEqual(parseAcceptanceDeadline(null).acceptanceDeadlineMinutes, fallback, 'a missing config object falls back');
  assertEqual(parseAcceptanceDeadline('nope').acceptanceDeadlineMinutes, fallback, 'a non-object falls back');
});
