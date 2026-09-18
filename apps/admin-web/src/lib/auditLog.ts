/**
 * Pure logic behind the admin audit trail view (pages/AuditLogPage.tsx).
 *
 * WHY IT IS ITS OWN MODULE: everything here is a claim the console makes about
 * a record it did not produce and cannot re-derive -- who acted, when, and what
 * was written down. Each claim below is one an audit trail gets to make exactly
 * once, so each is pinned by a test rather than living in JSX where it can only
 * be checked by looking at it.
 */

import { humanizeStatus } from './format.ts';

/** One row of `adminGetAuditLog`'s `entries`. */
export type AuditLogEntry = {
  action: string;
  actorDisplayName: string | null;
  actorEmail: string | null;
  actorUid: string | null;
  createdAt: string;
  details: Record<string, unknown>;
  id: string;
  targetId: string | null;
  targetType: string;
};

/* ------------------------------------------------------------------ actor */

export type AuditActor = {
  /** The line shown where an actor belongs. NEVER empty -- see below. */
  primary: string;
  /** Supporting identity, or null when `primary` already said everything. */
  secondary: string | null;
  /**
   * True when the server's `UserAccount` lookup returned nothing for this uid,
   * so the row is identified by uid alone. The view marks these: a raw uid
   * looks like a rendering bug unless the screen says it is the whole record.
   */
  unresolved: boolean;
};

/**
 * Resolve an actor to something readable, degrading rather than blanking.
 *
 * Three things can be missing independently. The display name is optional on
 * UserAccount; the batched lookup in `adminGetAuditLog` is explicitly
 * non-fatal, so BOTH name and email can be null for a uid that exists; and
 * `actorUid` itself is nullable, because some entries are written by the
 * platform rather than by a person (a cron sweep, a webhook). A blank cell in
 * the actor column of an audit log is indistinguishable from "nobody did
 * this", which is never what the record means -- so every branch here returns
 * words.
 */
export const describeAuditActor = (entry: Pick<AuditLogEntry, 'actorDisplayName' | 'actorEmail' | 'actorUid'>): AuditActor => {
  const name = entry.actorDisplayName?.trim() || null;
  const email = entry.actorEmail?.trim() || null;
  const uid = entry.actorUid?.trim() || null;

  if (!uid) {
    // Not an error and not an unresolved lookup: the column is nullable
    // because the platform itself writes entries. Saying so beats an em dash.
    return { primary: 'System', secondary: 'No admin account recorded for this entry.', unresolved: false };
  }

  if (name) {
    return { primary: name, secondary: email ?? uid, unresolved: false };
  }

  if (email) {
    return { primary: email, secondary: uid, unresolved: false };
  }

  return { primary: uid, secondary: 'No account matched this uid.', unresolved: true };
};

/* --------------------------------------------------------------- vocabulary */

/**
 * The filter options, which are DERIVED and therefore always partial.
 *
 * A hard-coded list of actions goes stale the moment someone adds a privileged
 * mutation, and it goes stale silently -- the new action keeps being written
 * and simply never appears in the filter. So the options come from the rows.
 *
 * But rows only ever describe the page in hand, and that creates a trap that
 * is worse than the staleness it fixes: derive the options from the CURRENT
 * response and the moment the operator filters to `role_revoked`, every row is
 * a `role_revoked`, the option list collapses to that one value, and there is
 * no way back except reloading. Paging has the same shape -- page two's
 * vocabulary is not page one's.
 *
 * Hence a union that only ever grows, carried across every response this
 * session has seen. It is honest about what it is: a list of values observed
 * so far, not an enumeration of what exists, and the view says so.
 */
export type AuditVocabulary = {
  actions: string[];
  actors: Array<{ label: string; uid: string }>;
  targetTypes: string[];
};

export const EMPTY_AUDIT_VOCABULARY: AuditVocabulary = { actions: [], actors: [], targetTypes: [] };

/**
 * Fold a freshly-arrived page into the vocabulary. Pure and monotonic: the
 * result is a superset of `previous`, which is the property that keeps a
 * filtered view from erasing the control that filtered it.
 */
export const mergeAuditVocabulary = (previous: AuditVocabulary, entries: readonly AuditLogEntry[]): AuditVocabulary => {
  const actions = new Set(previous.actions);
  const targetTypes = new Set(previous.targetTypes);
  const actors = new Map(previous.actors.map((actor) => [actor.uid, actor.label]));

  for (const entry of entries) {
    if (entry.action) {
      actions.add(entry.action);
    }
    if (entry.targetType) {
      targetTypes.add(entry.targetType);
    }

    const uid = entry.actorUid?.trim();
    if (uid) {
      const existing = actors.get(uid);
      const resolved = describeAuditActor(entry);
      // Prefer a resolved name/email over a uid label if a later page carries
      // one: the actor lookup is non-fatal server-side, so the same uid can
      // arrive resolved on one page and bare on another.
      if (existing === undefined || (existing === uid && !resolved.unresolved)) {
        actors.set(uid, resolved.primary);
      }
    }
  }

  return {
    actions: [...actions].sort(),
    actors: [...actors].sort((left, right) => left[1].localeCompare(right[1])).map(([uid, label]) => ({ label, uid })),
    targetTypes: [...targetTypes].sort(),
  };
};

/** Display label for a raw action/targetType. The filter VALUE stays raw. */
export const auditOptionLabel = (value: string) => humanizeStatus(value);

/* ------------------------------------------------------------------ details */

/**
 * One leaf of an entry's `details`, addressed by its full path.
 *
 * `details` is `jsonb` written by ~20 different call sites and it has no
 * schema -- each action puts in whatever it thought was worth recording. So
 * this renders SHAPE-BLINDLY: it walks whatever arrived down to scalars and
 * shows every one of them, rather than picking known keys out of it. A viewer
 * that knows the shape of `role_assigned` and quietly drops the two extra keys
 * some later action added is exactly how an audit trail starts lying.
 */
export type AuditDetailField = {
  /** Full address of the leaf, e.g. `payout.bankCode` or `documents[1].url`. */
  path: string;
  /** The leaf rendered as text. Never empty -- see `formatAuditDetailValue`. */
  value: string;
};

/**
 * Render a scalar, making absence visible instead of blank.
 *
 * An empty string, a null and a missing key are three different records and
 * all three render as nothing if you just interpolate them. They get glyphs.
 */
export const formatAuditDetailValue = (value: unknown): string => {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'string') {
    return value === '' ? '"" (empty string)' : value;
  }
  if (typeof value === 'number') {
    // NaN/Infinity cannot survive JSON, but a hand-built object in a test or a
    // future non-JSON caller can produce them, and String() renders them fine.
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  // Not reachable from JSON. Named rather than coerced, because "[object
  // Object]" in an audit trail is a field that has been hidden badly.
  return `(${typeof value})`;
};

/**
 * Flatten `details` into an ordered list of leaves, losing nothing.
 *
 * ON ORDERING: alphabetical by path. The temptation is to preserve insertion
 * order as more faithful to the writer, but `details` is stored as `jsonb`,
 * which normalises key order on write -- the author's order was discarded
 * before this code ever saw the row, so there is no original to preserve and
 * a stable sort is what makes two entries of the same action comparable by eye.
 */
export const flattenAuditDetails = (details: unknown): AuditDetailField[] => {
  const fields: AuditDetailField[] = [];

  // JSON cannot carry a cycle, so this guard is for values that did not come
  // off the wire. It costs one Set and removes a way for this view to hang the
  // console rather than render an ugly row.
  const ancestors = new Set<object>();

  const walk = (value: unknown, path: string) => {
    if (value !== null && typeof value === 'object') {
      if (ancestors.has(value)) {
        fields.push({ path, value: '(circular reference)' });
        return;
      }

      if (Array.isArray(value)) {
        if (value.length === 0) {
          fields.push({ path, value: '[] (empty list)' });
          return;
        }
        ancestors.add(value);
        value.forEach((item, index) => walk(item, `${path}[${index}]`));
        ancestors.delete(value);
        return;
      }

      const keys = Object.keys(value as Record<string, unknown>);
      if (keys.length === 0) {
        fields.push({ path, value: '{} (empty object)' });
        return;
      }
      ancestors.add(value);
      for (const key of keys.sort()) {
        walk((value as Record<string, unknown>)[key], path === '' ? key : `${path}.${key}`);
      }
      ancestors.delete(value);
      return;
    }

    fields.push({ path, value: formatAuditDetailValue(value) });
  };

  if (details === null || details === undefined) {
    return [];
  }

  if (typeof details !== 'object' || Array.isArray(details)) {
    // The handler coerces `details` to `{}`, so a scalar or array here means
    // the shape changed under us. Show it rather than drop it.
    walk(details, 'details');
    return fields;
  }

  if (Object.keys(details as Record<string, unknown>).length === 0) {
    return [];
  }

  walk(details, '');
  return fields;
};

/* --------------------------------------------------------------- timestamps */

/**
 * `AdminAuditLog.createdAt` is `timestamp WITHOUT time zone`, defaulted to
 * `current_timestamp` and never written by the application
 * (supabase/functions/_shared/auditLog.ts inserts no `createdAt`). So the
 * value is the DATABASE SERVER's clock, and the column records no offset.
 *
 * WHY THIS IS NOT `formatDateTime`. The obvious implementation --
 * `new Date(raw).toLocaleString()` -- is wrong twice over. ECMAScript parses a
 * date-time with no offset as LOCAL time, so the same string means a different
 * instant in Lagos than in London while printing the same digits; and
 * `toLocaleString` then presents those digits as the viewer's wall clock,
 * which is a timezone claim the column cannot support. On an audit trail the
 * difference between "when it happened" and "when it happened, probably, if
 * the server shares your clock" is the whole value of the record.
 *
 * So: no Date arithmetic at all. The stored digits are reformatted and shown
 * as what they are, and the view labels the column accordingly.
 */
export type AuditTimestamp = {
  /** Reformatted stored digits, e.g. `18 Sep 2026, 20:14:03`. Never shifted. */
  label: string;
  /**
   * True if the raw value carried `Z` or `±hh:mm`. Always false for this
   * column today; if it ever turns true the column type changed underneath the
   * view, and the view surfaces the raw string rather than quietly dropping an
   * offset it is not rendering.
   */
  carriesOffset: boolean;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

export const formatAuditTimestamp = (raw: unknown): AuditTimestamp => {
  if (typeof raw !== 'string') {
    return { label: 'No timestamp recorded', carriesOffset: false };
  }

  const match = TIMESTAMP_PATTERN.exec(raw.trim());

  if (!match) {
    // Unparseable, so show it verbatim. Guessing is how a timestamp becomes
    // fiction, and an audit row is still worth reading without one.
    return { label: raw.trim() || 'No timestamp recorded', carriesOffset: false };
  }

  const [, year, month, day, hour, minute, second] = match;
  const monthName = MONTHS[Number(month) - 1] ?? month!;

  return {
    label: `${day} ${monthName} ${year}, ${hour}:${minute}:${second ?? '00'}`,
    carriesOffset: /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw.trim()),
  };
};

/**
 * The sentence the view prints above the log. It is deliberately about the
 * clock rather than about a zone: naming one (`UTC`, `WAT`) would assert
 * something the stored value does not carry, however likely it is to be true.
 */
export const AUDIT_TIME_NOTE =
  'Times are the database server clock exactly as recorded. This column stores no UTC offset, so nothing is converted to your local time.';
