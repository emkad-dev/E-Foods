/**
 * Run with: deno test -A --no-lock --config supabase/deno.json supabase/functions/_shared/staffInviteCodes.test.ts
 *
 * These are credential mechanics, so the tests are about the properties that
 * make the credential safe rather than about the happy path.
 */
import {
  STAFF_INVITE_CODE_LENGTH,
  STAFF_INVITE_MAX_ATTEMPTS,
  generateStaffInviteCode,
  hashStaffInviteCode,
  isStaffInviteExpired,
  resolveStaffJoinBranch,
  staffInviteCodeMatches,
} from './staffInviteCodes.ts';

const assert = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
};

Deno.test('a generated code is always the declared length and all digits', () => {
  // Leading zeros are the trap: String(42).padStart(6,'0') is required, and a
  // code rendered as "42" would be rejected by a UI expecting six boxes.
  for (let run = 0; run < 500; run += 1) {
    const code = generateStaffInviteCode();
    assertEqual(code.length, STAFF_INVITE_CODE_LENGTH, 'code length');
    assert(/^[0-9]+$/.test(code), `code should be all digits, got ${code}`);
  }
});

Deno.test('generated codes are not obviously biased toward the low range', () => {
  // A `% 1000000` over a uint32 without rejection sampling skews toward low
  // values. This will not catch a subtle bias, but it does catch the blunt
  // version, and it documents that rejection sampling is deliberate.
  const buckets = new Array(10).fill(0);

  for (let run = 0; run < 4000; run += 1) {
    buckets[Number(generateStaffInviteCode()[0])] += 1;
  }

  for (const [digit, count] of buckets.entries()) {
    assert(count > 150, `leading digit ${digit} appeared only ${count} times in 4000 — suspiciously rare`);
  }
});

Deno.test('generated codes do not repeat across a run', () => {
  const seen = new Set<string>();
  for (let run = 0; run < 1000; run += 1) {
    seen.add(generateStaffInviteCode());
  }
  // 1000 draws from a million: a handful of collisions is expected, a pile is
  // a broken generator (e.g. a fixed seed).
  assert(seen.size > 980, `only ${seen.size} unique codes in 1000 draws`);
});

Deno.test('the same code hashes differently under different invite ids', async () => {
  Deno.env.set('AUTH_HASH_SALT', 'test-salt-at-least-16-chars');

  const left = await hashStaffInviteCode('invite-a', '123456');
  const right = await hashStaffInviteCode('invite-b', '123456');

  assert(left !== right, 'mixing the invite id in must stop two invites sharing a hash');
});

Deno.test('hashing is stable for the same invite and code', async () => {
  Deno.env.set('AUTH_HASH_SALT', 'test-salt-at-least-16-chars');

  const first = await hashStaffInviteCode('invite-a', '123456');
  const second = await hashStaffInviteCode('invite-a', '123456');

  assertEqual(first, second, 'hash stability');
});

Deno.test('a missing or short salt throws rather than producing a weak hash', async () => {
  const original = Deno.env.get('AUTH_HASH_SALT');

  for (const bad of ['', 'short']) {
    Deno.env.set('AUTH_HASH_SALT', bad);
    let threw = false;
    try {
      await hashStaffInviteCode('invite-a', '123456');
    } catch {
      threw = true;
    }
    assert(threw, `a salt of "${bad}" must throw, not fall back to an unsalted digest`);
  }

  if (original) {
    Deno.env.set('AUTH_HASH_SALT', original);
  }
});

Deno.test('comparison accepts an exact match and rejects everything else', () => {
  assert(staffInviteCodeMatches('abc123', 'abc123'), 'identical hashes must match');
  assert(!staffInviteCodeMatches('abc123', 'abc124'), 'a one-character difference must not match');
  assert(!staffInviteCodeMatches('abc123', 'abc12'), 'a length difference must not match');
  assert(!staffInviteCodeMatches('', ''), 'two empty hashes are not a match — that is a missing value');
});

Deno.test('expiry treats a missing or unparseable timestamp as expired', () => {
  const now = new Date('2026-09-19T12:00:00Z');

  // Fail closed: an invite whose expiry cannot be read is not an invite that
  // lasts forever.
  assert(isStaffInviteExpired(null, now), 'null expiry must read as expired');
  assert(isStaffInviteExpired(undefined, now), 'undefined expiry must read as expired');
  assert(isStaffInviteExpired('not a date', now), 'an unparseable expiry must read as expired');
});

Deno.test('expiry is exclusive at the boundary', () => {
  const now = new Date('2026-09-19T12:00:00Z');

  assert(isStaffInviteExpired('2026-09-19T12:00:00Z', now), 'the expiry instant itself is expired');
  assert(isStaffInviteExpired('2026-09-19T11:59:59Z', now), 'a past expiry is expired');
  assert(!isStaffInviteExpired('2026-09-19T12:00:01Z', now), 'a future expiry is live');
});

Deno.test('the attempt cap is tight enough to matter', () => {
  // Six digits is a million combinations; the cap is what makes that
  // irrelevant. If someone raises this to a large number the guard is gone,
  // so the number is pinned rather than left to judgement.
  assert(
    STAFF_INVITE_MAX_ATTEMPTS <= 10,
    `an attempt cap of ${STAFF_INVITE_MAX_ATTEMPTS} is too loose to protect a 6-digit code`
  );
  assert(STAFF_INVITE_MAX_ATTEMPTS >= 3, 'a person reading a code off a screen deserves a retry');
});

// --- resolveStaffJoinBranch -------------------------------------------------
// These exist because the inline version of this decision shipped wrong and
// was caught by a real person on a real invite. The regression is the first
// test below.

Deno.test('REGRESSION: a password account is never sent down the no-password branch', () => {
  // What actually happened: identities came back empty because the paged admin
  // listing does not carry the field, and the branch resolved to 'google'.
  // bladeshadow554@gmail.com has an email identity and a password, and was
  // shown "this address signs in with Google" -- the one route it did not have.
  assertEqual(resolveStaffJoinBranch(true, ['email']), 'password', 'email identity');
});

Deno.test('an unknown identity list fails toward password, not noPassword', () => {
  // null means "could not establish". The two mistakes are not symmetrical: a
  // Google user offered a password field can still fall back to the Google
  // button, while a password user offered only Google is stuck.
  assertEqual(resolveStaffJoinBranch(true, null), 'password', 'unknown identities');
});

Deno.test('an account with both identities gets the branch that works either way', () => {
  assertEqual(resolveStaffJoinBranch(true, ['google', 'email']), 'password', 'both');
});

Deno.test('noPassword is claimed only when an email identity is known to be absent', () => {
  assertEqual(resolveStaffJoinBranch(true, ['google']), 'noPassword', 'oauth only');
});

Deno.test('no account at all means create, whatever the identities say', () => {
  assertEqual(resolveStaffJoinBranch(false, null), 'create', 'no account, unknown');
  assertEqual(resolveStaffJoinBranch(false, []), 'create', 'no account, empty');
});

Deno.test('an empty identity list is not the same as an unknown one', () => {
  // [] means the account genuinely has no providers, which is not a password
  // account -- so it must NOT take the null shortcut.
  assertEqual(resolveStaffJoinBranch(true, []), 'noPassword', 'genuinely no identities');
});
