/**
 * Run with: node --test --experimental-strip-types apps/partner/src/state/staffJoinHandoff.test.ts
 *
 * Two claims about the one piece of state that survives a navigation during
 * the staff-join flow.
 *
 * FIRST, AND THE REASON THIS FILE EXISTS: this module cannot carry a
 * credential, because none of its setters accepts one. The invite code must
 * live only in the mounted screen's own state -- not in a URL (the web build
 * would put it in the address bar and the browser history), not in storage,
 * and not here. "Don't put the code in the handoff" is a rule a future change
 * breaks by accident while adding a genuinely convenient parameter, so it is
 * asserted over the module's export surface instead of written down in a
 * comment. Its sibling is the export sweep in
 * src/domain/staffInvites.test.ts.
 *
 * SECOND, that releasing is unconditional and idempotent. The join screen
 * releases the hold in a `finally`, on unmount, and again when the person
 * leaves the success card -- deliberately more than once, because a hold that
 * outlives its screen parks a signed-in partner in the auth group with no way
 * out. That belt-and-braces is only safe if the extra calls are free.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as handoff from './staffJoinHandoff.ts';

test('the handoff cannot carry the invite code, because nothing here takes an argument', () => {
  const accepting: string[] = [];

  // Swept over the whole export surface rather than a list of the three
  // setters that exist today, for the same reason the domain module's sweep
  // is exhaustive: a test naming the functions I happened to think of passes
  // on the day somebody adds a fourth.
  for (const [name, value] of Object.entries(handoff)) {
    if (typeof value === 'function') {
      // Arity zero is the mechanical form of "this is a flag, not a bag".
      if (value.length !== 0) {
        accepting.push(name);
      }
      continue;
    }

    // And no exported constant is holding anything code-shaped either.
    assert.equal(
      /\d{6}/.test(JSON.stringify(value ?? null)),
      false,
      `${name} must not hold anything code-shaped`
    );
  }

  assert.deepEqual(
    accepting,
    [],
    'A staff-join handoff export grew a parameter. The invite code belongs in the screen that is mounted and ' +
      'nowhere else -- if something needs passing along, that is the thing to reconsider:\n  ' +
      accepting.join('\n  ')
  );
});

test('releasing is idempotent, so the screen can do it three times over', () => {
  handoff.releaseStaffJoin();
  handoff.releaseStaffJoin();

  handoff.holdAuthGroupForStaffJoin();
  handoff.awaitGoogleStaffJoin();

  // The last call wins, and none of them throws on a repeat -- which is what
  // lets the join screen release in a `finally` AND in an unmount cleanup
  // without the second one being a bug.
  handoff.releaseStaffJoin();
  handoff.releaseStaffJoin();
});
