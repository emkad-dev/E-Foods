/// <reference path="./edge-runtime.d.ts" />
/**
 * Generating and checking staff invite codes.
 *
 * Kept apart from the handlers so the two decisions that matter -- how the code
 * is generated and how it is compared -- are in one small file that can be read
 * end to end.
 */

/**
 * Six digits, to match every other code this product sends. Email confirmation
 * is already a 6-digit code, and asking someone to type a different shape for
 * this one alone buys length at the cost of the pattern people have learned.
 *
 * Six digits is a million combinations: plenty against a person, nothing
 * against a script. The protection is therefore NOT the length -- it is the
 * per-invite attempt cap in the redeem handler plus the short expiry. Treat the
 * code as a one-time token with a counter, never as a secret with entropy.
 */
export const STAFF_INVITE_CODE_LENGTH = 6;

/** Long enough to find the email, short enough that a stale code stops working. */
export const STAFF_INVITE_TTL_HOURS = 72;

/**
 * How many wrong guesses an invite tolerates before it is dead.
 *
 * This is the real guard, so it is deliberately tight. A person mistyping a
 * code they are reading off a screen does not need ten attempts, and a script
 * grinding a million combinations needs only that the limit be absent.
 */
export const STAFF_INVITE_MAX_ATTEMPTS = 5;

/**
 * `Math.random()` is not a CSPRNG and must never produce a credential. This
 * draws from crypto and rejects the tail of the range rather than taking a
 * modulus of it -- `% 1000000` over a uint32 makes the low codes measurably
 * more likely, which is the kind of bias that is invisible until someone looks
 * for it.
 */
export const generateStaffInviteCode = (): string => {
  const ceiling = 10 ** STAFF_INVITE_CODE_LENGTH;
  const limit = Math.floor(0xffffffff / ceiling) * ceiling;
  const buffer = new Uint32Array(1);

  let value = 0;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);

  return String(value % ceiling).padStart(STAFF_INVITE_CODE_LENGTH, '0');
};

/**
 * The same HMAC posture auth-gateway/hash.ts takes, and the same fail-loud
 * guard, for the same reason: a plain SHA-256 of a six-digit code is a table
 * of one million entries anyone can precompute once and reuse forever.
 *
 * REQUIRES `AUTH_HASH_SALT` to be readable by whichever Edge Function serves
 * these actions. It is an existing project secret, but if it is missing this
 * throws rather than falling back to an unsalted digest -- an invite that
 * cannot be sent is a bad afternoon, and a table of trivially reversible invite
 * hashes is a bad quarter.
 *
 * The invite id is mixed in so two invites that happen to draw the same code do
 * not share a hash, which would otherwise leak that fact to anyone reading the
 * table.
 */
export const hashStaffInviteCode = async (inviteId: string, code: string): Promise<string> => {
  const salt = Deno.env.get('AUTH_HASH_SALT') ?? '';

  if (salt.length < 16) {
    throw new Error('AUTH_HASH_SALT must be set to at least 16 characters to issue staff invites.');
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${inviteId}:${code}`)
  );

  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

/**
 * Length-independent, byte-by-byte comparison.
 *
 * Both operands here are hex digests of a fixed length, so a timing attack is
 * already unrealistic -- but the cost of doing this correctly is four lines,
 * and `===` on a credential comparison is the kind of thing that gets copied
 * into a place where it does matter.
 */
export const staffInviteCodeMatches = (expectedHash: string, actualHash: string): boolean => {
  // An empty hash is a missing value, never a match. Without this, two empty
  // strings compare equal -- same length, no differing bytes -- so a row whose
  // codeHash failed to write would be redeemable by anything that also
  // produced nothing. An HMAC never returns empty, so this is not reachable
  // today; it is closed because a credential comparator that says yes to
  // absence is the kind of code that gets copied somewhere it matters.
  if (!expectedHash || !actualHash) {
    return false;
  }

  if (expectedHash.length !== actualHash.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < expectedHash.length; index += 1) {
    difference |= expectedHash.charCodeAt(index) ^ actualHash.charCodeAt(index);
  }

  return difference === 0;
};

/** True when the invite is past its window, whatever its stored status says. */
export const isStaffInviteExpired = (expiresAt: string | null | undefined, now: Date): boolean => {
  if (!expiresAt) {
    return true;
  }

  const expiry = new Date(expiresAt).getTime();
  return !Number.isFinite(expiry) || expiry <= now.getTime();
};
