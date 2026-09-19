/**
 * The rules behind staff invites, as pure functions.
 *
 * WHY THIS FEATURE EXISTS AT ALL, because it shapes every decision below: a
 * restaurant's owner, manager and kitchen used to share one login, so every
 * audited action resolved to one uid and a departing employee walked out with
 * working credentials. The fix is that each person holds their own account --
 * and the owner must never be able to sign in as one of them, because an
 * action logged against a staff member is only evidence if the owner could
 * not have taken it.
 *
 * That is why nothing here produces, stores, formats or accepts an invite
 * CODE on the owner's side. The code exists in exactly two places: the
 * invitee's mailbox and an HMAC in the database. `partnerInviteStaff` does not
 * return it, and no helper in this file invents a way to show it. Anything
 * that puts the code in front of the owner hands the owner the ability to
 * accept the invite themselves, which is the whole thing this feature is
 * meant to stop.
 *
 * The screens import these; nothing about an invite is worded inline. Each
 * decision here is one a reviewer gets wrong by eye -- whether an expired
 * invite is the same as a cancelled one, whether a superseded invite is worth
 * showing, whether removing a person needs their name in the sentence.
 */

/**
 * The four states the server reports. `expired` is DERIVED server-side from
 * `expiresAt` -- no sweep runs on the table, so a stored `pending` row whose
 * window has closed comes back as `expired`. The client must not recompute
 * that from the clock: the two would disagree across a device with a skewed
 * clock, and the server's answer is the one the redeem path enforces.
 */
export type StaffInviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

/** One row of `partnerListStaff`'s `invites`. No code field. There never is one. */
export type StaffInvite = {
  id: string;
  email: string;
  status: StaffInviteStatus;
  expiresAt: string | null;
  createdAt: string | null;
  acceptedAt: string | null;
};

/** One row of `partnerListStaff`'s `staff`. The caller is filtered out server-side. */
export type StaffMember = {
  uid: string;
  email: string | null;
  displayName: string | null;
  disabled: boolean;
};

/** Matches `STAFF_INVITE_CODE_LENGTH` in supabase/functions/_shared/staffInviteCodes.ts. */
export const STAFF_INVITE_CODE_LENGTH = 6;

/** The server's own ceiling (`email.length > 254` is a 400). */
const MAX_EMAIL_LENGTH = 254;

/**
 * Deliberately not RFC 5322. A full-grammar regex rejects addresses that work
 * and accepts ones that do not, and the authority here is the mailbox, not
 * this function: a typo that still parses gets caught by the code never
 * arriving. What this has to catch is the class of mistake that would let an
 * owner sit waiting for a person who was never emailed -- a missing @, a bare
 * domain, a trailing comma from a pasted list.
 */
const EMAIL_SHAPE = /^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/;

export const normaliseStaffEmail = (raw: string): string => raw.trim().toLowerCase();

export type ValidateStaffInviteEmailInput = {
  email: string;
  /** The signed-in owner's own address, when it is known. */
  ownerEmail?: string | null;
  /** Everyone who can already act for this restaurant. */
  staff?: readonly StaffMember[];
};

/**
 * The message to render under the invite field, or `null` when it may be sent.
 *
 * Every branch here is also enforced server-side. The point of repeating them
 * is not safety -- it is that the server's answer costs a round trip and
 * arrives as one sentence at the bottom of the screen, while the owner is
 * still looking at the field they mistyped.
 */
export const validateStaffInviteEmail = ({
  email,
  ownerEmail,
  staff = [],
}: ValidateStaffInviteEmailInput): string | null => {
  const candidate = normaliseStaffEmail(email);

  if (!candidate) {
    return 'Enter the work email address of the person you are inviting.';
  }

  if (candidate.length > MAX_EMAIL_LENGTH) {
    return 'That email address is too long.';
  }

  if (!EMAIL_SHAPE.test(candidate)) {
    return 'That does not look like an email address. Check it and try again.';
  }

  // Inviting yourself is a no-op that reads as a broken feature: the code
  // arrives, and then unlocks nothing, because the account it would attach is
  // already attached.
  if (ownerEmail && normaliseStaffEmail(ownerEmail) === candidate) {
    return 'That is your own address - you already have access.';
  }

  const alreadyStaff = staff.find((member) => normaliseStaffEmail(member.email ?? '') === candidate);
  if (alreadyStaff) {
    return `${staffMemberName(alreadyStaff)} already has access to this store.`;
  }

  return null;
};

/**
 * Keeps only digits, and only the first six of them.
 *
 * Applied on every keystroke rather than on submit. The code is read off a
 * phone screen and typed into another, so it arrives with spaces in it, and
 * pasted out of an email it arrives with a trailing newline -- a field that
 * silently refuses those looks broken in a way the person cannot diagnose,
 * and they only have five attempts before the invite is burned.
 */
export const normaliseStaffInviteCode = (raw: string): string =>
  raw.replace(/\D+/g, '').slice(0, STAFF_INVITE_CODE_LENGTH);

/** The message to render under the code field, or `null` when it may be sent. */
export const validateStaffInviteCode = (raw: string): string | null => {
  const code = normaliseStaffInviteCode(raw);

  if (!code) {
    return 'Enter the code from your invite email.';
  }

  if (code.length < STAFF_INVITE_CODE_LENGTH) {
    return `The code is ${STAFF_INVITE_CODE_LENGTH} digits. Enter all ${STAFF_INVITE_CODE_LENGTH}.`;
  }

  return null;
};

/** What to call a person when there is a name, an address, or neither. */
export const staffMemberName = (member: Pick<StaffMember, 'displayName' | 'email'>): string =>
  member.displayName?.trim() || member.email?.trim() || 'This team member';

export type StaffInviteView = {
  /**
   * WHAT THE OWNER CAN DO WITH THIS ROW, and the reason this module exists.
   *
   * `canRevoke` -- cancel a code that has not been used. Not destructive: the
   * invite has granted nothing, nobody has an account because of it, and
   * cancelling it takes nothing away from anyone. It therefore gets no
   * confirmation dialog. (Removing a PERSON does; see `staffRemovalConfirm`.)
   *
   * `canInviteAgain` -- the code is dead and the only useful move is a fresh
   * one. True for `expired` and ONLY for `expired`, which is the difference
   * between expired and revoked that the owner actually feels: a revoked
   * invite is a decision the owner already made, and offering to undo it in
   * the row they cancelled it from turns a deliberate act into a mis-tap. A
   * revoked invite is not even listed (see `openStaffInvites`), so re-inviting
   * that person means typing their address again -- which is the right amount
   * of friction for reversing a decision.
   */
  canInviteAgain: boolean;
  canRevoke: boolean;
  /** Short status word for the badge. */
  label: string;
  /** One sentence saying what this state means for the owner. */
  detail: string;
  /** Which token family the badge draws from. The screen maps these to fills. */
  tone: 'pending' | 'expired' | 'accepted' | 'revoked';
};

export const describeStaffInvite = (invite: Pick<StaffInvite, 'status'>): StaffInviteView => {
  switch (invite.status) {
    case 'pending':
      return {
        canInviteAgain: false,
        canRevoke: true,
        label: 'Waiting',
        // States the two steps that are still outstanding, because "Waiting"
        // on its own reads as "waiting for the system" rather than "waiting
        // for a person who has to do two things first".
        detail: 'They still need to create their own FEASTY partner account with this address, then enter the code we emailed them.',
        tone: 'pending',
      };
    case 'expired':
      return {
        // The code stopped working on its own. Nobody decided this, so the
        // owner gets the repair action rather than just a tombstone.
        canInviteAgain: true,
        // Still revocable, and this is not a quirk: the row is stored as
        // `pending` and only reported as `expired`, so the server accepts the
        // revoke. Clearing it is the only way to get it off the list.
        canRevoke: true,
        label: 'Expired',
        detail: 'The code ran out before it was used. Send a new one if they still need access.',
        tone: 'expired',
      };
    case 'accepted':
      return {
        canInviteAgain: false,
        canRevoke: false,
        label: 'Accepted',
        detail: 'They joined the store and now appear in your team list.',
        tone: 'accepted',
      };
    case 'revoked':
    default:
      return {
        canInviteAgain: false,
        canRevoke: false,
        label: 'Cancelled',
        detail: 'This code no longer works.',
        tone: 'revoked',
      };
  }
};

/**
 * The invites worth putting on screen: the ones that are still an open loop.
 *
 * ACCEPTED rows are dropped because the person is already in the staff list
 * directly above, under their real name -- listing them twice invites the
 * owner to "remove" the invite thinking it removes the access, which it does
 * not.
 *
 * REVOKED rows are dropped because they are mostly not decisions at all. Every
 * re-invite supersedes the live invite for that address by marking it
 * `revoked` (see partnerInviteStaff), so one person who mistyped their address
 * once and needed two reminders leaves four cancelled rows behind. A list that
 * grows by one every time the owner helps somebody is a list the owner stops
 * reading.
 *
 * Each surviving row is REBUILT from the six fields above rather than passed
 * through. That is not tidiness: it is the one mechanical guarantee that no
 * invite code can ever reach the owner's screen. `partnerInviteStaff` does
 * not return one today, but a server change that started sending `code` on
 * the list rows would otherwise arrive in the UI layer as a field somebody
 * could render by accident. Projecting here means the owner's screen cannot
 * see a field this module does not name.
 */
export const openStaffInvites = (invites: readonly StaffInvite[]): StaffInvite[] =>
  invites
    .filter((invite) => invite.status === 'pending' || invite.status === 'expired')
    .map((invite) => ({
      acceptedAt: invite.acceptedAt ?? null,
      createdAt: invite.createdAt ?? null,
      email: invite.email,
      expiresAt: invite.expiresAt ?? null,
      id: invite.id,
      status: invite.status,
    }));

/**
 * What the owner is told the moment an invite is sent.
 *
 * NOT "invited" and nothing that implies an account now exists, because none
 * does. The owner's mental model after pressing this button decides whether
 * they wait quietly for an hour or call the person -- so the sentence names
 * the two things that have to happen next, in order, and says who does them.
 */
export const inviteSentMessage = (email: string): string =>
  `We emailed a code to ${normaliseStaffEmail(email)}. No account exists yet: they sign up in the FEASTY partner app with this exact address and their own password, then enter the code to join your store.`;

export const INVITE_SENT_TITLE = 'Invite code sent';

/**
 * How long a sent invite lasts, said the way the owner will repeat it.
 *
 * Returns `null` rather than a fallback string when the timestamp is
 * unreadable: a sentence stating a deadline is a promise, and this is the one
 * place that must not guess at one.
 */
export const formatInviteExpiry = (expiresAt: string | null | undefined, now: number = Date.now()): string | null => {
  if (!expiresAt) {
    return null;
  }

  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) {
    return null;
  }

  const remainingMs = expiry - now;
  if (remainingMs <= 0) {
    return 'Expired';
  }

  const hours = Math.floor(remainingMs / 3600000);

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `Expires in ${days} ${days === 1 ? 'day' : 'days'}`;
  }

  if (hours >= 1) {
    return `Expires in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }

  // Rounded UP, so a code with nine minutes left never reads "0 minutes" --
  // which would say "already dead" about a code that still works.
  const minutes = Math.max(1, Math.ceil(remainingMs / 60000));
  return `Expires in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
};

export type StaffRemovalConfirmCopy = {
  title: string;
  paragraphs: string[];
  confirmLabel: string;
  cancelLabel: string;
};

/**
 * The confirmation for removing a person's access -- the one destructive
 * control in this feature.
 *
 * THE NAME IS IN THE TITLE, not just in the body. Removal is fired from a row
 * in a list, and a dialog that says "Remove this team member?" cannot be
 * checked against the row the owner meant to press: a mis-tap on a neighbouring
 * row produces a dialog that is word-for-word correct and still about the
 * wrong person.
 *
 * The second paragraph exists because the obvious fear -- "am I deleting their
 * FEASTY account?" -- has a reassuring answer, and an owner who does not know
 * it hesitates over the control that protects them.
 */
export const staffRemovalConfirm = (member: Pick<StaffMember, 'displayName' | 'email'>): StaffRemovalConfirmCopy => {
  const name = staffMemberName(member);

  return {
    title: `Remove ${name}?`,
    paragraphs: [
      `${name} will immediately lose access to this store's orders, menu and settings.`,
      'Their FEASTY login is theirs and stays active - this only unlinks it from your restaurant. You can invite them again later, and they will need a new code.',
    ],
    confirmLabel: 'Remove access',
    cancelLabel: 'Keep access',
  };
};

/* ========================================================================== *
 * THE INVITEE'S SIDE, BEFORE THEY HAVE AN ACCOUNT
 *
 * Everything above is the owner's screen. Everything below is the screen a
 * person reaches from the LOGIN page, holding a code and possibly nothing
 * else -- no partner account, sometimes no password anywhere.
 *
 * WHY THIS EXISTS AS A SEPARATE ENTRY POINT. The first version made an invitee
 * register (email OTP), land in the restaurant-onboarding wizard -- KYC, payout
 * account, admin approval, none of which applies to them -- and find a
 * secondary link at the bottom. Two proofs of the same mailbox to join one
 * store. Worse, it assumed everyone has a password: the first real address we
 * invited was a Google account with no password at all, and the partner app
 * had no Google sign-in, so that person could not get in by ANY route.
 *
 * So the code comes first and the SERVER decides the route. `staffInviteResolve`
 * takes the email and the code and answers `password`, `google` or `create`.
 * The screen cannot work the branch out for itself and must not try: without a
 * valid, live, unexhausted invite for that exact address the endpoint returns
 * one undifferentiated 400, which is what stops it being an account-existence
 * oracle for an unauthenticated caller.
 * ========================================================================== */

/**
 * The route the server picked for this address.
 *
 * `password` - an account with an email/password identity. Sign in, then redeem.
 * `google`   - an account whose only identity is an OAuth provider. There is no
 *              password to ask for, and asking is the defect this replaced.
 * `create`   - no account at all. The code already proved the mailbox, so this
 *              one can finish without a second email round trip.
 */
export type StaffJoinBranch = 'password' | 'google' | 'create';

/**
 * What the screen is currently showing. `identify` is step one for everybody;
 * the middle three are the branches; `joined` is the one screen that names the
 * restaurant the person now works for.
 */
export type StaffJoinStep = 'identify' | StaffJoinBranch | 'joined';

/**
 * Branch -> step, and `null` for anything this build does not recognise.
 *
 * Deliberately NOT defaulting to a branch. A server that grows a fourth route
 * is telling an old client something it cannot act on, and every plausible
 * default is a lie told to the person's face: guessing `password` asks a
 * Google user for a password they do not have, and guessing `create` offers to
 * make a second account for an address that already has one. The screen shows
 * "update the app" instead, which is the only honest answer.
 *
 * Takes `unknown` on purpose -- the value is off the wire, so a type
 * annotation here would be a claim about the server, not a fact about the value.
 */
export const resolveStaffJoinStep = (branch: unknown): StaffJoinBranch | null =>
  branch === 'password' || branch === 'google' || branch === 'create' ? branch : null;

export const STAFF_JOIN_UNKNOWN_BRANCH_MESSAGE =
  'This version of the app cannot finish joining a restaurant. Update the app, or ask the restaurant to help you sign in.';

/**
 * The address the code was sent to, validated on the INVITEE's screen.
 *
 * Separate from `validateStaffInviteEmail` above, and not a thin wrapper over
 * it: that one also refuses the owner's own address and anyone already on
 * staff, which are facts only the owner's screen knows. Repeating its wording
 * here ("you already have access") would be nonsense said to a stranger.
 *
 * The shape check is the same regex for the same reason: the authority is the
 * mailbox, not this function. What it has to catch is the mistake that would
 * otherwise burn one of five attempts -- a pasted address with a trailing
 * comma, a missing @, a bare domain.
 */
export const validateStaffJoinEmail = (raw: string): string | null => {
  const candidate = normaliseStaffEmail(raw);

  if (!candidate) {
    return 'Enter the email address your invite was sent to.';
  }

  if (candidate.length > MAX_EMAIL_LENGTH) {
    return 'That email address is too long.';
  }

  if (!EMAIL_SHAPE.test(candidate)) {
    return 'That does not look like an email address. Check it and try again.';
  }

  return null;
};

/**
 * Matches the server's floor in `staffInviteCreateAccount`
 * (`password.length < 8` is a 400).
 *
 * Stated here so the person finds out while their hands are still on the
 * keyboard, rather than after a round trip that -- because the invite is
 * claimed before the account is created -- is not a free thing to fail.
 */
export const STAFF_JOIN_MIN_PASSWORD_LENGTH = 8;

/** The password an invitee is CHOOSING, on the `create` branch. */
export const validateStaffJoinNewPassword = (raw: string): string | null => {
  if (!raw) {
    return 'Choose a password for your new account.';
  }

  // Not trimmed. A leading or trailing space is a legitimate character in a
  // password, and silently dropping one here would create the account with a
  // password the person cannot reproduce anywhere else.
  if (raw.length < STAFF_JOIN_MIN_PASSWORD_LENGTH) {
    return `Use at least ${STAFF_JOIN_MIN_PASSWORD_LENGTH} characters.`;
  }

  return null;
};

/**
 * The password an invitee ALREADY HAS, on the `password` branch.
 *
 * No length rule, and that is the whole point of it being a separate function.
 * The account predates this screen and may predate any rule we have now;
 * rejecting a seven-character password that Supabase will happily accept locks
 * someone out of their own account with a message they cannot act on.
 */
export const validateStaffJoinSignInPassword = (raw: string): string | null =>
  raw ? null : 'Enter the password for this account.';

/**
 * Optional, and normalised to `undefined` rather than `''`.
 *
 * `staffInviteCreateAccount` runs it through `sanitizeOptionalText`, so an
 * empty string and a missing field mean the same thing server-side -- but
 * sending `''` would still write an empty display name where the fallback
 * (the address on the account) reads better.
 */
export const normaliseStaffJoinDisplayName = (raw: string): string | undefined => raw.trim() || undefined;

export type StaffJoinBranchCopy = {
  /** Heading for the second step. */
  title: string;
  /** Sentences under it, in order. */
  body: string[];
  /** Label for the control that finishes the branch. */
  action: string;
};

export type DescribeStaffJoinBranchInput = {
  branch: unknown;
  restaurantName?: string | null;
};

/**
 * What the second step says, once the server has picked a branch.
 *
 * REBUILT FROM TWO NAMED FIELDS, never spread from the response. Same
 * mechanical guarantee as `openStaffInvites`: `staffInviteResolve` returns no
 * code today, and a server that started sending one back could not reach this
 * copy even by accident, because nothing here reads a field it does not name.
 *
 * The restaurant is named in every branch. It is the last moment before the
 * person types a password, and the only way they can tell they are joining the
 * place they meant to.
 */
export const describeStaffJoinBranch = ({
  branch,
  restaurantName,
}: DescribeStaffJoinBranchInput): StaffJoinBranchCopy | null => {
  const place = (typeof restaurantName === 'string' && restaurantName.trim()) || 'this restaurant';

  switch (resolveStaffJoinStep(branch)) {
    case 'password':
      return {
        title: `Sign in to join ${place}`,
        body: [
          `Your code is good. This address already has a FEASTY account, so enter its password and we will add ${place} to it.`,
          // Said because the alternative reading -- "am I about to make a
          // second account?" -- is the one that makes people abandon here.
          'You keep the same login. Nothing about your account changes except the restaurant you can work for.',
        ],
        action: 'Sign in and join',
      };
    case 'google':
      return {
        title: `Sign in with Google to join ${place}`,
        body: [
          'Your code is good. This address signs in with Google, so there is no FEASTY password to type.',
          // The one instruction that has to survive the person leaving this
          // screen: Google sign-in is on the sign-in page, and coming back
          // signed in is not yet the same as having joined.
          'Use the Google option on the sign-in screen. When you come back, enter this code once more to finish - signing in on its own does not join you to the store.',
        ],
        action: 'Go to Google sign-in',
      };
    case 'create':
      return {
        title: `Create your account for ${place}`,
        body: [
          `Your code is good, and there is no FEASTY account for this address yet. Choose a password and we will set one up with access to ${place}.`,
          // NOT a missing step. Without saying so, a signup that finishes with
          // no confirmation email looks like it forgot one, and the person
          // sits waiting for mail that is never coming.
          'We will not email you a confirmation code. The invite code you just entered was delivered to this mailbox, which already proves it is yours.',
        ],
        action: 'Create account and join',
      };
    default:
      return null;
  }
};
