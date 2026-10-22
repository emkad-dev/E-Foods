// Pure decision logic for the single-device-session rule shared by the
// customer, dispatch, and partner AuthContexts. Kept dependency-free so it can
// be unit-tested with the node runner (see singleDeviceSession.test.ts) and
// imported identically by every app.
//
// The rule: an account may be "active" on one device at a time. On an
// interactive sign-in a device mints its own session id, writes it to
// UserAccount.activeSessionId, and stores it locally. A later reconcile that
// finds a DIFFERENT remote id means another device has taken over, and this
// device signs itself out.
//
// Two things this function deliberately does NOT treat as a takeover, because
// treating them as one is exactly the forced-re-login bug:
//   1. A missing remote id (brand-new signup, a backend that does not return
//      one, a released session). Nothing to conflict with.
//   2. First sight on this device with no local id yet (fresh install, cleared
//      storage). Adopt the remote id instead of evicting.
// The sign-in race itself (remote written before local is stored) is handled
// by the caller skipping this reconcile while its own interactive sign-in is
// in flight; this function is only ever asked to decide against SETTLED state.
//
// `enforceSingleDevice` is false for the partner app: a restaurant runs on
// several staff devices at once, so the partner path must never evict and must
// never claim a single active session id. The flag — not removal of the column
// — scopes the rule to customer and dispatch, because the account/claims RPCs
// are shared across apps.

export type SingleDeviceSessionDecision =
  | { type: 'ok' }
  | { type: 'adopt'; sessionId: string }
  | { type: 'evict' };

export type SingleDeviceSessionInput = {
  /** The session id this device has persisted locally, or null if none. */
  localSessionId: string | null;
  /** UserAccount.activeSessionId as last read from the backend, or null. */
  remoteSessionId: string | null;
  /**
   * Whether the single-device rule applies. Customer and dispatch pass true;
   * partner passes false so every partner device stays signed in.
   */
  enforceSingleDevice: boolean;
};

export const resolveSingleDeviceSessionDecision = ({
  localSessionId,
  remoteSessionId,
  enforceSingleDevice,
}: SingleDeviceSessionInput): SingleDeviceSessionDecision => {
  // Partner (multi-device): never evict, never adopt a single id.
  if (!enforceSingleDevice) {
    return { type: 'ok' };
  }

  // No remote claim recorded: nothing this device could conflict with. Covers
  // a brand-new signup and any backend that does not return activeSessionId.
  if (!remoteSessionId) {
    return { type: 'ok' };
  }

  // First sight on this device. A fresh install or cleared storage is not a
  // takeover — adopt the remote id rather than sign the user out.
  if (!localSessionId) {
    return { type: 'adopt', sessionId: remoteSessionId };
  }

  // Same device, still the active one.
  if (localSessionId === remoteSessionId) {
    return { type: 'ok' };
  }

  // Both ids present and different: another device has taken over since this
  // one recorded its own id. Evict.
  return { type: 'evict' };
};
