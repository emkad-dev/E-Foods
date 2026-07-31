import { resolvePartnerSubmitOutcome } from './partnerApplicationTransitions.ts';

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
};

Deno.test('a first-time applicant lands in pending', () => {
  const outcome = resolvePartnerSubmitOutcome(null);
  expectEqual(outcome.allowed, true, 'allowed');
  expectEqual(outcome.allowed ? outcome.nextStatus : null, 'pending', 'nextStatus');
});

Deno.test('an undefined or empty status is treated as first-time', () => {
  for (const raw of [undefined, '', '   ']) {
    const outcome = resolvePartnerSubmitOutcome(raw);
    expectEqual(outcome.allowed, true, `allowed for ${JSON.stringify(raw)}`);
  }
});

Deno.test('a pending applicant may resubmit and stays pending', () => {
  const outcome = resolvePartnerSubmitOutcome('pending');
  expectEqual(outcome.allowed, true, 'allowed');
  expectEqual(outcome.allowed ? outcome.nextStatus : null, 'pending', 'nextStatus');
});

Deno.test('a rejected applicant may fix and resubmit, returning to pending', () => {
  const outcome = resolvePartnerSubmitOutcome('rejected');
  expectEqual(outcome.allowed, true, 'allowed');
  expectEqual(outcome.allowed ? outcome.nextStatus : null, 'pending', 'nextStatus');
});

Deno.test('an approved applicant cannot resubmit', () => {
  const outcome = resolvePartnerSubmitOutcome('approved');
  expectEqual(outcome.allowed, false, 'allowed');
  expectEqual(outcome.allowed ? null : outcome.httpStatus, 412, 'httpStatus');
});

Deno.test('an unrecognised status is treated as pending rather than failing open', () => {
  const outcome = resolvePartnerSubmitOutcome('something-else');
  expectEqual(outcome.allowed, true, 'allowed');
  expectEqual(outcome.allowed ? outcome.nextStatus : null, 'pending', 'nextStatus');
});

Deno.test('status matching ignores case and surrounding whitespace', () => {
  expectEqual(resolvePartnerSubmitOutcome('  APPROVED ').allowed, false, 'approved is still blocked');
});
