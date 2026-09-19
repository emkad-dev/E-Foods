import { useSyncExternalStore } from 'react';

/**
 * One flag, shared between the code-first join screen and the `(auth)` layout
 * that would otherwise throw it away mid-flow.
 *
 * THE PROBLEM THIS SOLVES. `(auth)/_layout.tsx` redirects any signed-in user
 * out of the auth group, which is correct for every other screen in it: a
 * partner who is already signed in has no business looking at a login form.
 * But the join screen signs the person in ITSELF and then has work left to do
 * -- redeem the code, or show the one sentence naming the restaurant they now
 * work for. Without this flag the layout unmounts the screen the instant
 * `signIn` resolves, and the person is dropped into the applicant wizard they
 * were never applying to, mid-join, with the redeem call orphaned.
 *
 * WHAT IS DELIBERATELY NOT IN HERE: the invite code, the email, the password,
 * or anything else the person typed. This module holds one enum and nothing
 * else. The code lives in the screen's own component state for as long as that
 * screen is mounted and nowhere else -- not in a URL (the web build would put
 * it in the address bar and the browser history), not in storage, not here. A
 * flag cannot leak a credential; a store shaped like a handoff bag eventually
 * does.
 *
 * WHY A MODULE-LEVEL STORE RATHER THAN A CONTEXT. A context needs a provider
 * above both the layout and the screen, which means editing the root layout,
 * and this is one boolean's worth of coordination. `useSyncExternalStore`
 * gives the layout a reactive read without a provider, and the state is
 * intentionally per-process: it does not survive a reload, which is the
 * correct failure mode (see `awaitGoogleStaffJoin`).
 */
export type StaffJoinHandoff =
  /** Nothing in flight. The auth group behaves exactly as it always has. */
  | 'idle'
  /**
   * The join screen is finishing in place and must not be torn down, even
   * though a session now exists. Cleared by the screen in a `finally`, on
   * unmount, and when the person leaves the success card.
   */
  | 'holding'
  /**
   * The person went to sign in with Google and still has a code to redeem.
   * When they come back signed in, the auth layout sends them to
   * `/(partner)/join-restaurant` instead of the applicant wizard.
   */
  | 'awaiting-google';

let current: StaffJoinHandoff = 'idle';
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) {
    listener();
  }
};

const set = (next: StaffJoinHandoff) => {
  if (current === next) {
    return;
  }

  current = next;
  emit();
};

/** Keep the join screen alive across its own `signIn`. */
export const holdAuthGroupForStaffJoin = () => set('holding');

/**
 * Remember that a redemption is still owed, while the person goes and signs in
 * with Google.
 *
 * ON NATIVE this survives, because the OAuth flow runs in an in-app browser
 * and this JS context stays alive: they come back signed in and land straight
 * on the join screen. ON WEB the Google flow is a full-page redirect, so this
 * module is reinitialised and the flag is gone.
 *
 * THAT LOSS IS ACCEPTED RATHER THAN PAPERED OVER. Persisting it would mean
 * writing "this person is mid-join" to storage, where a flag nobody ever
 * clears would later hijack an unrelated sign-in and send a normal partner to
 * a code-entry screen. The degraded path is not a dead end: the person lands
 * in the applicant wizard, whose "I was invited" link still goes to the join
 * screen, and the branch copy tells them before they leave that they will need
 * the code once more.
 */
export const awaitGoogleStaffJoin = () => set('awaiting-google');

/** Back to normal. Safe to call when nothing is in flight. */
export const releaseStaffJoin = () => set('idle');

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => current;

export const useStaffJoinHandoff = (): StaffJoinHandoff =>
  // Third argument is the server snapshot. The partner web build is a static
  // single-page export with no SSR pass, but omitting it is the kind of thing
  // that only explodes once the build config changes.
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
