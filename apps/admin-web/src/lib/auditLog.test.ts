/**
 * Run with: node --test --experimental-strip-types apps/admin-web/src/lib/auditLog.test.ts
 *
 * Each block below pins a property that, if it broke, would break QUIETLY --
 * the view would keep rendering and the record it shows would be wrong. That
 * is the failure mode an audit trail cannot have, so: no blank actors, no
 * dropped detail fields, no filter control that erases itself, and no
 * timestamp shifted by a timezone the column does not carry.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AUDIT_TIME_NOTE,
  EMPTY_AUDIT_VOCABULARY,
  describeAuditActor,
  flattenAuditDetails,
  formatAuditDetailValue,
  formatAuditTimestamp,
  mergeAuditVocabulary,
  type AuditLogEntry,
} from './auditLog.ts';

const entry = (over: Partial<AuditLogEntry> = {}): AuditLogEntry => ({
  action: 'role_assigned',
  actorDisplayName: 'Ada Admin',
  actorEmail: 'ada@feasty.com.ng',
  actorUid: 'uid-ada',
  createdAt: '2026-09-18T20:14:03.123456',
  details: {},
  id: 'entry-1',
  targetId: 'user-1',
  targetType: 'user_role',
  ...over,
});

/* ------------------------------------------------------------------ actor */

test('an actor never renders blank, at any level of resolution', () => {
  // The four independent ways identity arrives incomplete.
  const cases = [
    entry(),
    entry({ actorDisplayName: null }),
    entry({ actorDisplayName: null, actorEmail: null }),
    entry({ actorDisplayName: null, actorEmail: null, actorUid: null }),
    // Whitespace-only is what a sanitiser that trims to '' looks like from here.
    entry({ actorDisplayName: '   ', actorEmail: '  ' }),
  ];

  for (const candidate of cases) {
    const actor = describeAuditActor(candidate);
    assert.notEqual(actor.primary.trim(), '', `blank actor for ${JSON.stringify(candidate.actorUid)}`);
  }
});

test('the raw uid is the last resort, and is marked as such', () => {
  const resolved = describeAuditActor(entry());
  assert.equal(resolved.primary, 'Ada Admin');
  assert.equal(resolved.secondary, 'ada@feasty.com.ng');
  assert.equal(resolved.unresolved, false);

  const emailOnly = describeAuditActor(entry({ actorDisplayName: null }));
  assert.equal(emailOnly.primary, 'ada@feasty.com.ng');
  assert.equal(emailOnly.unresolved, false);

  // The server's actor lookup is deliberately non-fatal, so this row is real
  // and its identity simply did not resolve. It must not look like a bug.
  const bare = describeAuditActor(entry({ actorDisplayName: null, actorEmail: null }));
  assert.equal(bare.primary, 'uid-ada');
  assert.equal(bare.unresolved, true);
  assert.match(bare.secondary ?? '', /No account matched/);
});

test('a null actorUid is the platform acting, not an unresolved lookup', () => {
  const system = describeAuditActor(entry({ actorDisplayName: null, actorEmail: null, actorUid: null }));
  assert.equal(system.primary, 'System');
  assert.equal(system.unresolved, false, 'nothing failed to resolve here; the column is simply nullable');
});

/* ------------------------------------------------------------- vocabulary */

test('filter options come from the rows, sorted and de-duplicated', () => {
  const vocabulary = mergeAuditVocabulary(EMPTY_AUDIT_VOCABULARY, [
    entry({ action: 'role_revoked', targetType: 'user_role' }),
    entry({ action: 'role_assigned', targetType: 'user_role' }),
    entry({ action: 'role_assigned', targetType: 'restaurant' }),
  ]);

  assert.deepEqual(vocabulary.actions, ['role_assigned', 'role_revoked']);
  assert.deepEqual(vocabulary.targetTypes, ['restaurant', 'user_role']);
});

test('the vocabulary only ever grows, so filtering cannot erase the filter', () => {
  // The trap this exists to avoid: derive options from the current response
  // and selecting `role_revoked` leaves a page of nothing but `role_revoked`,
  // collapsing the dropdown to the one value and stranding the operator.
  const page1 = mergeAuditVocabulary(EMPTY_AUDIT_VOCABULARY, [
    entry({ action: 'role_assigned' }),
    entry({ action: 'role_revoked' }),
    entry({ action: 'restaurant_unpublished', targetType: 'restaurant' }),
  ]);

  const filtered = mergeAuditVocabulary(page1, [entry({ action: 'role_revoked' })]);

  assert.deepEqual(filtered.actions, ['restaurant_unpublished', 'role_assigned', 'role_revoked']);
  assert.deepEqual(filtered.targetTypes, ['restaurant', 'user_role']);

  // And an empty page (a filter that matched nothing) takes nothing away.
  assert.deepEqual(mergeAuditVocabulary(filtered, []).actions, filtered.actions);
});

test('a new action nobody hard-coded shows up in the options by itself', () => {
  const vocabulary = mergeAuditVocabulary(EMPTY_AUDIT_VOCABULARY, [entry({ action: 'some_action_added_next_year' })]);
  assert.ok(vocabulary.actions.includes('some_action_added_next_year'));
});

test('an actor resolved on a later page upgrades its own uid-only label', () => {
  // Same uid, arriving bare first (the lookup failed for that request) and
  // resolved second. The readable label must win, and there must still be one
  // entry for the uid rather than two.
  const bareFirst = mergeAuditVocabulary(EMPTY_AUDIT_VOCABULARY, [
    entry({ actorDisplayName: null, actorEmail: null }),
  ]);
  assert.deepEqual(bareFirst.actors, [{ label: 'uid-ada', uid: 'uid-ada' }]);

  const resolvedLater = mergeAuditVocabulary(bareFirst, [entry()]);
  assert.deepEqual(resolvedLater.actors, [{ label: 'Ada Admin', uid: 'uid-ada' }]);

  // ...and it does not regress when a later page is bare again.
  assert.deepEqual(
    mergeAuditVocabulary(resolvedLater, [entry({ actorDisplayName: null, actorEmail: null })]).actors,
    [{ label: 'Ada Admin', uid: 'uid-ada' }]
  );
});

test('an entry with no actorUid contributes no actor option', () => {
  const vocabulary = mergeAuditVocabulary(EMPTY_AUDIT_VOCABULARY, [entry({ actorUid: null })]);
  assert.deepEqual(vocabulary.actors, []);
});

/* ---------------------------------------------------------------- details */

test('every leaf of a nested details object survives the flattening', () => {
  const details = {
    decision: 'approve',
    payout: { bankCode: '058', accountName: 'Mama Put Ltd', verified: true },
    documents: [{ kind: 'front', url: 'https://x/1' }, { kind: 'back', url: 'https://x/2' }],
    previousRole: null,
  };

  const paths = flattenAuditDetails(details).map((field) => field.path);

  assert.deepEqual(paths, [
    'decision',
    'documents[0].kind',
    'documents[0].url',
    'documents[1].kind',
    'documents[1].url',
    'payout.accountName',
    'payout.bankCode',
    'payout.verified',
    'previousRole',
  ]);
});

test('nothing is dropped: the leaf count matches the object, for any shape', () => {
  // An independent count, computed a different way from the implementation, so
  // this fails if the walker ever skips a branch.
  const countLeaves = (value: unknown): number => {
    if (value === null || typeof value !== 'object') return 1;
    const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
    return children.length === 0 ? 1 : children.reduce((sum: number, child) => sum + countLeaves(child), 0);
  };

  const shapes: Record<string, unknown>[] = [
    { a: 1 },
    { a: { b: { c: { d: 'deep' } } } },
    { list: [1, 2, 3], nested: [[1], [2, [3]]] },
    { emptyObject: {}, emptyList: [], emptyString: '', zero: 0, no: false, nothing: null },
    { mixed: [{ x: 1 }, 'two', null, { y: { z: [] } }] },
  ];

  for (const shape of shapes) {
    assert.equal(
      flattenAuditDetails(shape).length,
      countLeaves(shape),
      `leaf count mismatch for ${JSON.stringify(shape)}`
    );
  }
});

test('absent, empty and falsy values are shown rather than rendered as nothing', () => {
  const fields = flattenAuditDetails({ emptyList: [], emptyObject: {}, emptyString: '', no: false, nothing: null, zero: 0 });
  const byPath = Object.fromEntries(fields.map((field) => [field.path, field.value]));

  assert.equal(byPath.zero, '0');
  assert.equal(byPath.no, 'false');
  assert.equal(byPath.nothing, 'null');
  assert.match(byPath.emptyString!, /empty string/);
  assert.match(byPath.emptyObject!, /empty object/);
  assert.match(byPath.emptyList!, /empty list/);

  for (const field of fields) {
    assert.notEqual(field.value.trim(), '', `${field.path} rendered as nothing`);
  }
});

test('an entry with no details flattens to no fields, not to a fake one', () => {
  assert.deepEqual(flattenAuditDetails({}), []);
  assert.deepEqual(flattenAuditDetails(null), []);
  assert.deepEqual(flattenAuditDetails(undefined), []);
});

test('a details value that is not an object is shown, not discarded', () => {
  // The handler coerces to `{}`, so this means the wire shape changed. Showing
  // it is the point: an audit view that silently drops what it did not expect
  // is the defect this whole module is written against.
  assert.deepEqual(flattenAuditDetails('a bare string'), [{ path: 'details', value: 'a bare string' }]);
  assert.deepEqual(flattenAuditDetails([1, 2]), [
    { path: 'details[0]', value: '1' },
    { path: 'details[1]', value: '2' },
  ]);
});

test('a cyclic object renders instead of hanging the console', () => {
  const cyclic: Record<string, unknown> = { name: 'loop' };
  cyclic.self = cyclic;

  const fields = flattenAuditDetails(cyclic);
  assert.ok(fields.some((field) => field.value.includes('circular')));
});

test('formatAuditDetailValue never returns an empty string', () => {
  for (const value of ['', 'x', 0, 1, -1, NaN, Infinity, true, false, null, undefined, Symbol('s')]) {
    assert.notEqual(formatAuditDetailValue(value).trim(), '');
  }
});

/* ------------------------------------------------------------- timestamps */

test('the stored digits are rendered, never shifted into another zone', () => {
  // The defect being prevented: `new Date('2026-09-18T20:14:03')` is parsed as
  // LOCAL time, so any implementation that round-trips through Date is
  // reporting an instant the column never recorded. 20:14:03 in, 20:14:03 out,
  // on every machine that runs this test.
  assert.equal(formatAuditTimestamp('2026-09-18T20:14:03.123456').label, '18 Sep 2026, 20:14:03');
  assert.equal(formatAuditTimestamp('2026-01-02T00:00:00').label, '02 Jan 2026, 00:00:00');
  assert.equal(formatAuditTimestamp('2026-12-31 23:59:59').label, '31 Dec 2026, 23:59:59');
  assert.equal(formatAuditTimestamp('2026-09-18T20:14').label, '18 Sep 2026, 20:14:00');
});

test('a value that does carry an offset is flagged, and still not shifted', () => {
  // Only reachable if the column type changes. The digits stay put either way;
  // the flag is what lets the view admit there is an offset it is not applying.
  const withZ = formatAuditTimestamp('2026-09-18T20:14:03Z');
  assert.equal(withZ.label, '18 Sep 2026, 20:14:03');
  assert.equal(withZ.carriesOffset, true);

  const withHours = formatAuditTimestamp('2026-09-18T20:14:03+01:00');
  assert.equal(withHours.label, '18 Sep 2026, 20:14:03');
  assert.equal(withHours.carriesOffset, true);

  assert.equal(formatAuditTimestamp('2026-09-18T20:14:03.123456').carriesOffset, false);
});

test('an unusable timestamp says so instead of inventing one', () => {
  assert.equal(formatAuditTimestamp(null).label, 'No timestamp recorded');
  assert.equal(formatAuditTimestamp(undefined).label, 'No timestamp recorded');
  assert.equal(formatAuditTimestamp('').label, 'No timestamp recorded');
  assert.equal(formatAuditTimestamp(1758225243000).label, 'No timestamp recorded');
  // Not parseable, but it is what the record holds, so it is what is shown.
  assert.equal(formatAuditTimestamp('sometime last tuesday').label, 'sometime last tuesday');
});

test('the timezone note claims a clock, never a named zone', () => {
  // Naming UTC or WAT would assert an offset the column does not store.
  assert.doesNotMatch(AUDIT_TIME_NOTE, /\b(UTC\+|WAT|GMT|local time zone)\b/);
  assert.match(AUDIT_TIME_NOTE, /no UTC offset/i);
});
