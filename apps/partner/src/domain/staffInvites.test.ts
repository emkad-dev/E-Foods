/**
 * Run with: node --test --experimental-strip-types apps/partner/src/domain/staffInvites.test.ts
 *
 * Six claims are pinned here, and each one is a way this feature could
 * quietly stop being the thing it was built to be.
 *
 * FIRST, that the code never appears on the owner's side. The point of staff
 * invites is that an action logged against a staff member is evidence, which
 * it stops being the moment the owner could have accepted the invite
 * themselves. So no export of this module may return, format or echo an
 * invite code -- asserted mechanically over the module's whole surface,
 * because "don't add a copy button" is a rule a future change breaks by
 * accident, not on purpose.
 *
 * SECOND, that an EXPIRED invite and a REVOKED one offer different things. An
 * expiry is the clock's decision and wants a fresh code; a revoke is the
 * owner's decision and must not be offered an undo one tap from the button
 * that made it.
 *
 * THIRD, that a superseded invite never reaches the screen. Re-inviting
 * marks the previous row revoked, so the noise grows by one every time an
 * owner helps someone -- and a list nobody reads is a list that hides the
 * pending invite that matters.
 *
 * FOURTH, that removing a person names that person. The control fires from a
 * row in a list, where a correct-but-generic dialog cannot catch a mis-tap.
 *
 * FIFTH, that the INVITEE's branch is the server's answer and never the
 * client's guess. The address we first tested with was a Google account with
 * no password, and a client that defaults an unrecognised branch to
 * `password` puts that person back in front of a field they cannot fill.
 *
 * SIXTH, that the two password fields on the join screen are not the same
 * rule. One is a password being CHOSEN, where the server's eight-character
 * floor must be stated before the round trip that claims the invite; the
 * other is a password that already EXISTS, where imposing any floor at all
 * locks somebody out of their own account over a rule it predates.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as staffInvites from './staffInvites.ts';
import {
  INVITE_SENT_TITLE,
  STAFF_INVITE_CODE_LENGTH,
  STAFF_JOIN_MIN_PASSWORD_LENGTH,
  STAFF_JOIN_UNKNOWN_BRANCH_MESSAGE,
  describeStaffInvite,
  describeStaffJoinBranch,
  formatInviteExpiry,
  inviteSentMessage,
  normaliseStaffInviteCode,
  normaliseStaffJoinDisplayName,
  openStaffInvites,
  resolveStaffJoinStep,
  staffMemberName,
  staffRemovalConfirm,
  validateStaffInviteCode,
  validateStaffInviteEmail,
  validateStaffJoinEmail,
  validateStaffJoinNewPassword,
  validateStaffJoinSignInPassword,
  type StaffInvite,
  type StaffMember,
} from './staffInvites.ts';

const invite = (overrides: Partial<StaffInvite> = {}): StaffInvite => ({
  id: 'invite-1',
  email: 'chef@example.com',
  status: 'pending',
  expiresAt: null,
  createdAt: null,
  acceptedAt: null,
  ...overrides,
});

const member = (overrides: Partial<StaffMember> = {}): StaffMember => ({
  uid: 'uid-1',
  email: 'chef@example.com',
  displayName: null,
  disabled: false,
  ...overrides,
});

test('no owner-facing value can carry an invite code out of a server row', () => {
  /*
   * The regression this is really about: `partnerInviteStaff` returns no code
   * today, but a server change that started putting one on the list rows
   * would land in the UI layer as a renderable field, and the whole value of
   * the feature -- that an action logged against a staff member could not
   * have been the owner's -- goes with it.
   *
   * So: contaminate every server-shaped input with a code and sweep the
   * module's ENTIRE export surface. The exhaustive form is deliberate. A test
   * naming the three functions I happened to think of passes on the day
   * somebody adds a fourth.
   */
  const code = '482913';
  const contaminatedInvite = { ...invite({ status: 'pending' }), code, codeHash: `hash-${code}` };
  const contaminatedMember = { ...member(), code };
  const leaked: string[] = [];

  for (const [name, value] of Object.entries(staffInvites)) {
    if (typeof value !== 'function') {
      // Constants too: a copy string reading "their code is ..." would be the
      // same leak in prose.
      assert.equal(
        JSON.stringify(value ?? null).includes(code),
        false,
        `${name} must not carry an invite code`
      );
      continue;
    }

    // `normaliseStaffInviteCode` / `validateStaffInviteCode` are the deliberate
    // exception and are excluded by construction below: they run on the
    // INVITEE's screen, on a value that person typed, and have to hand it back
    // to the text input. Nothing here feeds them the code as a bare string.
    const attempts: unknown[] = [
      contaminatedInvite,
      [contaminatedInvite],
      contaminatedMember,
      { email: 'chef@example.com', ownerEmail: 'owner@example.com', staff: [contaminatedMember] },
      'chef@example.com',
      // The INVITEE's side, added with `(auth)/join`. `staffInviteResolve`
      // returns no code today; this is the shape it would arrive in if a
      // server change ever started sending one, and the sweep is the reason
      // nothing on the join screen could render it by accident.
      { branch: 'password', code, email: 'chef@example.com', restaurantName: 'Mama Put' },
    ];

    for (const argument of attempts) {
      let result: unknown;
      try {
        result = (value as (input: unknown) => unknown)(argument);
      } catch {
        continue;
      }

      if (JSON.stringify(result ?? null).includes(code)) {
        leaked.push(`${name} passed a server-supplied code through to its caller`);
      }
    }
  }

  assert.deepEqual(
    leaked,
    [],
    "The invite code belongs in the invitee's mailbox and nowhere else:\n  " + leaked.join('\n  ')
  );
});

test('an invite row reaches the screen rebuilt, not passed through', () => {
  const contaminated = { ...invite({ status: 'pending' }), code: '482913' } as StaffInvite;

  // Field-for-field, and nothing else: the projection in openStaffInvites is
  // what makes the sweep above a guarantee rather than a snapshot of today's
  // server response.
  assert.deepEqual(Object.keys(openStaffInvites([contaminated])[0] ?? {}).sort(), [
    'acceptedAt',
    'createdAt',
    'email',
    'expiresAt',
    'id',
    'status',
  ]);

  // And the wording is a function of the STATUS alone, so no extra field on
  // the row can reach the badge or the sentence beside it.
  assert.deepEqual(
    describeStaffInvite(contaminated),
    describeStaffInvite({ status: 'pending' } as StaffInvite)
  );
});

test('an expired invite offers a new code; a cancelled one offers nothing', () => {
  const expired = describeStaffInvite(invite({ status: 'expired' }));
  const revoked = describeStaffInvite(invite({ status: 'revoked' }));

  // The clock made this decision, so the owner is handed the repair.
  assert.equal(expired.canInviteAgain, true);
  // ...and it can still be cleared off the list, because the row is stored as
  // `pending` and the server accepts the revoke.
  assert.equal(expired.canRevoke, true);

  // The OWNER made this decision. Re-offering it from the row it was made in
  // turns a deliberate act into a mis-tap.
  assert.equal(revoked.canInviteAgain, false);
  assert.equal(revoked.canRevoke, false);

  // The two must never read the same, whatever else changes.
  assert.notEqual(expired.label, revoked.label);
  assert.notEqual(expired.detail, revoked.detail);
});

test('a pending invite can be cancelled but is not offered a duplicate code', () => {
  const pending = describeStaffInvite(invite({ status: 'pending' }));

  assert.equal(pending.canRevoke, true);
  // Sending a second code silently kills the first (partnerInviteStaff
  // supersedes the live invite), so a one-tap resend beside a working code
  // manufactures the exact support call it looks like it prevents: the person
  // types the code they already have and is told it is invalid.
  assert.equal(pending.canInviteAgain, false);
});

test('an accepted invite is never presented as an access control', () => {
  const accepted = describeStaffInvite(invite({ status: 'accepted' }));

  // The person is in the staff list under their real name. A "revoke" here
  // would look like it removed their access, and would not.
  assert.equal(accepted.canRevoke, false);
  assert.equal(accepted.canInviteAgain, false);
});

test('only open invites reach the screen', () => {
  const rows = [
    invite({ id: 'a', status: 'pending' }),
    invite({ id: 'b', status: 'accepted' }),
    invite({ id: 'c', status: 'revoked' }),
    invite({ id: 'd', status: 'expired' }),
    // Four cancelled rows is what one person who mistyped their address once
    // and needed two reminders actually leaves behind.
    invite({ id: 'e', status: 'revoked' }),
    invite({ id: 'f', status: 'revoked' }),
  ];

  assert.deepEqual(
    openStaffInvites(rows).map((row) => row.id),
    ['a', 'd']
  );
  // Order is preserved: the server sorts newest first and the screen relies
  // on that rather than re-sorting.
  assert.deepEqual(openStaffInvites([]).length, 0);
});

test('the invite email field catches the mistakes that leave an owner waiting', () => {
  assert.match(validateStaffInviteEmail({ email: '   ' }) ?? '', /email address/i);
  assert.match(validateStaffInviteEmail({ email: 'chef' }) ?? '', /email address/i);
  assert.match(validateStaffInviteEmail({ email: 'chef@example' }) ?? '', /email address/i);
  assert.match(validateStaffInviteEmail({ email: 'chef@ example.com' }) ?? '', /email address/i);
  // A pasted list: the second address would be silently dropped by the
  // server's `includes('@')` check and only the mangled first one invited.
  assert.match(validateStaffInviteEmail({ email: 'a@x.com,b@x.com' }) ?? '', /email address/i);
  assert.match(
    validateStaffInviteEmail({ email: `${'a'.repeat(250)}@example.com` }) ?? '',
    /too long/i
  );

  assert.equal(validateStaffInviteEmail({ email: 'chef@example.com' }), null);
  // Case and whitespace are the owner's, not the server's problem.
  assert.equal(validateStaffInviteEmail({ email: '  Chef@Example.COM ' }), null);
});

test('an owner cannot invite themselves, or someone who already has access', () => {
  assert.match(
    validateStaffInviteEmail({ email: 'OWNER@example.com', ownerEmail: 'owner@example.com' }) ?? '',
    /your own address/i
  );

  const existing = member({ displayName: 'Ada Kitchen', email: 'ada@example.com' });
  const message = validateStaffInviteEmail({ email: ' ADA@example.com ', staff: [existing] }) ?? '';

  // Named, so the owner can tell which of their people it already is.
  assert.match(message, /Ada Kitchen/);
  assert.match(message, /already has access/i);
});

test('the code field takes what a person actually types', () => {
  // Read off one screen and typed into another, or pasted out of an email.
  assert.equal(normaliseStaffInviteCode('482 913'), '482913');
  assert.equal(normaliseStaffInviteCode('  482913\n'), '482913');
  assert.equal(normaliseStaffInviteCode('code: 482913'), '482913');
  // Never longer than the field accepts -- a seventh digit would be sent and
  // burn one of only five attempts.
  assert.equal(normaliseStaffInviteCode('4829137').length, STAFF_INVITE_CODE_LENGTH);

  assert.match(validateStaffInviteCode('') ?? '', /invite email/i);
  assert.match(validateStaffInviteCode('4829') ?? '', /6 digits/);
  assert.equal(validateStaffInviteCode('482 913'), null);
});

test('the owner is told an account does NOT yet exist', () => {
  const message = inviteSentMessage('  Chef@Example.com ');

  assert.match(message, /chef@example\.com/);
  // The failure this sentence prevents: an owner who believes an account was
  // created sits waiting for a person who was never told to sign up.
  assert.match(message, /no account exists yet/i);
  assert.match(message, /sign up/i);
  assert.match(message, /their own password/i);
  assert.equal(INVITE_SENT_TITLE.toLowerCase().includes('created'), false);
});

test('an expiry is either stated exactly or not stated at all', () => {
  const now = Date.parse('2026-09-19T12:00:00.000Z');

  assert.equal(formatInviteExpiry('2026-09-22T12:00:00.000Z', now), 'Expires in 3 days');
  assert.equal(formatInviteExpiry('2026-09-20T11:00:00.000Z', now), 'Expires in 23 hours');
  assert.equal(formatInviteExpiry('2026-09-19T13:00:00.000Z', now), 'Expires in 1 hour');
  // Rounded up: nine minutes left must not read as a dead code.
  assert.equal(formatInviteExpiry('2026-09-19T12:09:00.000Z', now), 'Expires in 9 minutes');
  assert.equal(formatInviteExpiry('2026-09-19T12:00:10.000Z', now), 'Expires in 1 minute');
  assert.equal(formatInviteExpiry('2026-09-19T11:59:00.000Z', now), 'Expired');

  // A deadline is a promise. Given nothing readable, make none.
  assert.equal(formatInviteExpiry(null, now), null);
  assert.equal(formatInviteExpiry(undefined, now), null);
  assert.equal(formatInviteExpiry('not a date', now), null);
});

test('removing a person names that person', () => {
  const named = staffRemovalConfirm(member({ displayName: 'Ada Kitchen', email: 'ada@example.com' }));
  // In the TITLE, not only the body: fired from a list row, a generic title
  // is word-for-word correct about the wrong person after a mis-tap.
  assert.match(named.title, /Ada Kitchen/);
  assert.match(named.paragraphs[0] ?? '', /Ada Kitchen/);
  // The fear this answers: "am I deleting their FEASTY account?"
  assert.match(named.paragraphs.join(' '), /login is theirs/i);
  assert.equal(named.confirmLabel.toLowerCase().includes('remove'), true);

  // Falls back through name -> address -> a phrase, never to an empty title.
  assert.match(staffRemovalConfirm(member({ email: 'ada@example.com' })).title, /ada@example\.com/);
  assert.match(staffRemovalConfirm(member({ email: null })).title, /Remove This team member/);
  assert.equal(staffMemberName(member({ displayName: '   ', email: 'a@b.com' })), 'a@b.com');
});

/* -------------------------------------------------------------------------- *
 * THE INVITEE'S SIDE: `(auth)/join`
 * -------------------------------------------------------------------------- */

test('the branch is the server’s answer, and an unknown one is never guessed at', () => {
  assert.equal(resolveStaffJoinStep('password'), 'password');
  assert.equal(resolveStaffJoinStep('google'), 'google');
  assert.equal(resolveStaffJoinStep('create'), 'create');

  /*
   * Every plausible default is a lie told to somebody's face. `password` asks
   * a Google account for a password it does not have -- which is the exact
   * defect this flow was rebuilt to fix -- and `create` offers to make a
   * second account for an address that already has one, which the server will
   * then refuse with a 409 that reads like a dead end. So: null, and the
   * screen says "update the app".
   */
  assert.equal(resolveStaffJoinStep('magic-link'), null);
  assert.equal(resolveStaffJoinStep('PASSWORD'), null);
  assert.equal(resolveStaffJoinStep(''), null);
  assert.equal(resolveStaffJoinStep(undefined), null);
  assert.equal(resolveStaffJoinStep(null), null);
  assert.equal(resolveStaffJoinStep({ branch: 'password' }), null);

  assert.equal(describeStaffJoinBranch({ branch: 'magic-link' }), null);
  assert.match(STAFF_JOIN_UNKNOWN_BRANCH_MESSAGE, /update the app/i);
});

test('every branch names the restaurant before a password is typed', () => {
  const password = describeStaffJoinBranch({ branch: 'password', restaurantName: 'Mama Put' });
  const google = describeStaffJoinBranch({ branch: 'google', restaurantName: 'Mama Put' });
  const create = describeStaffJoinBranch({ branch: 'create', restaurantName: 'Mama Put' });

  for (const copy of [password, google, create]) {
    assert.notEqual(copy, null);
    // The last moment this person can tell they are joining the place they
    // meant to, and on two of the three branches the next thing they do is
    // type a password.
    assert.match(copy!.title, /Mama Put/);
    assert.equal(copy!.action.trim().length > 0, true);
  }

  // A Google account has no FEASTY password. Naming one in the heading is the
  // original defect, in smaller print.
  assert.equal(/password/i.test(google!.title), false);
  assert.match(google!.body.join(' '), /Google/);
  // And signing in is not joining. Saying so is the whole difference between
  // a handoff and a dead end.
  assert.match(google!.body.join(' '), /does not join you/i);

  // Finishing a signup with no confirmation email looks like a step that
  // failed silently unless the screen says it was skipped on purpose.
  assert.match(create!.body.join(' '), /will not email you a confirmation code/i);
  assert.match(create!.body.join(' '), /already proves it is yours/i);

  // The password branch's unasked question is "am I making a second account?".
  assert.match(password!.body.join(' '), /same login/i);

  // No usable name: a neutral phrase, never a gap and never "undefined".
  assert.match(describeStaffJoinBranch({ branch: 'create', restaurantName: '   ' })!.title, /this restaurant/);
  assert.match(describeStaffJoinBranch({ branch: 'create', restaurantName: null })!.title, /this restaurant/);
});

test('branch copy is rebuilt from two named fields, not passed through', () => {
  const code = '482913';
  const contaminated = { branch: 'password', code, email: 'chef@example.com', restaurantName: 'Mama Put' };

  // Identical to the copy built from only the two fields this function is
  // allowed to read. That equality is the guarantee: no field a future
  // `staffInviteResolve` might grow -- an invite code above all -- can reach
  // the screen through here, because nothing here reads a field it does not
  // name.
  assert.deepEqual(
    describeStaffJoinBranch(contaminated),
    describeStaffJoinBranch({ branch: 'password', restaurantName: 'Mama Put' })
  );
  assert.equal(JSON.stringify(describeStaffJoinBranch(contaminated)).includes(code), false);
});

test('the invitee is asked for their address in words addressed to them', () => {
  // Deliberately not `validateStaffInviteEmail`: that one also refuses the
  // owner's own address and anyone already on staff, which are facts only the
  // owner's screen has -- and "you already have access" is nonsense said to a
  // stranger who is not signed in.
  assert.match(validateStaffJoinEmail('') ?? '', /invite was sent to/i);
  assert.match(validateStaffJoinEmail('   ') ?? '', /invite was sent to/i);
  assert.match(validateStaffJoinEmail('chef') ?? '', /email address/i);
  assert.match(validateStaffJoinEmail('chef@example') ?? '', /email address/i);
  // A pasted pair. Caught here because the alternative is spending one of
  // only five attempts on a typo.
  assert.match(validateStaffJoinEmail('a@x.com,b@x.com') ?? '', /email address/i);
  assert.match(validateStaffJoinEmail(`${'a'.repeat(250)}@example.com`) ?? '', /too long/i);

  assert.equal(validateStaffJoinEmail('  Chef@Example.COM '), null);
});

test('the two password fields are deliberately not the same rule', () => {
  // CHOOSING one. The server's floor is eight, and finding that out after the
  // round trip is not free: `staffInviteCreateAccount` claims the invite
  // before it creates the account.
  assert.equal(STAFF_JOIN_MIN_PASSWORD_LENGTH, 8);
  assert.match(validateStaffJoinNewPassword('') ?? '', /choose a password/i);
  assert.match(validateStaffJoinNewPassword('short12') ?? '', /8/);
  assert.equal(validateStaffJoinNewPassword('eightch8'), null);
  // Spaces are characters. Trimming here would create the account with a
  // password the person cannot reproduce in any other sign-in field.
  assert.equal(validateStaffJoinNewPassword('  a  b  '), null);

  // TYPING one they already have. No length rule at all, on purpose: the
  // account may predate every rule we have now, and refusing a password
  // Supabase would accept locks somebody out of their own account over
  // nothing this screen can help them with.
  assert.equal(validateStaffJoinSignInPassword('short'), null);
  assert.equal(validateStaffJoinSignInPassword(' '), null);
  assert.match(validateStaffJoinSignInPassword('') ?? '', /enter the password/i);
});

test('an optional display name is omitted rather than sent empty', () => {
  // `''` and "absent" mean the same thing to the server's sanitizer, but
  // sending the empty string still writes an empty display name over the
  // fallback, which is the address.
  assert.equal(normaliseStaffJoinDisplayName(''), undefined);
  assert.equal(normaliseStaffJoinDisplayName('   '), undefined);
  assert.equal(normaliseStaffJoinDisplayName('  Ada Kitchen  '), 'Ada Kitchen');
});
