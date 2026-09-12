/**
 * How long a user must wait before asking for another emailed OTP, and the
 * arithmetic for "how much of that is left". No React, no react-native, no
 * storage — the persistence half lives in `otpCooldown.ts` beside this, same
 * split as `externalLinkPolicy.ts` next to `externalLink.ts`.
 *
 * WHY A COOLDOWN: every confirmation email is now a 6-digit code, so the
 * "resend" button is the only way to get a new one and users press it. Each
 * press costs a real email, and an unthrottled one is both a deliverability
 * risk (a provider that sees a burst to one address starts filing FEASTY as
 * spam) and a way to use the project as a mailer against a third party's inbox.
 *
 * THIS IS THE UX HALF, NOT THE ENFORCEMENT. A client timer is trivially
 * bypassed — clear storage, or call the API directly. The authority is
 * Supabase's own minimum-interval-between-emails setting, which is configured
 * in the dashboard and must be raised to match COOLDOWN_SECONDS; its default is
 * 60s. Keep the two in step: a client window SHORTER than the server's shows a
 * ready button that then fails, which reads as a broken app.
 */

/** Matches the server-side minimum interval. Change both together. */
export const OTP_COOLDOWN_SECONDS = 300;

/** What the code was sent for. Keyed separately so one does not gate the other. */
export type OtpPurpose = 'signup' | 'recovery';

/**
 * Seconds still to wait, or 0 when a new code may be requested.
 *
 * `lastSentAtMs` null/absent means "never sent" — no cooldown.
 *
 * Deliberately tolerant of a clock that is not monotonic. Device time can move
 * backwards (manual change, NTP correction, timezone-fiddling to skip a timer),
 * which leaves a stored timestamp in the future. Rather than trust the
 * subtraction and lock the user out for hours, a future timestamp is treated as
 * "sent just now" and clamped to the full window: still throttled, never
 * stranded. An elapsed time larger than the window simply yields 0.
 */
export const remainingCooldownSeconds = (
  lastSentAtMs: number | null | undefined,
  nowMs: number,
  cooldownSeconds: number = OTP_COOLDOWN_SECONDS
): number => {
  if (typeof lastSentAtMs !== 'number' || !Number.isFinite(lastSentAtMs)) {
    return 0;
  }

  if (!Number.isFinite(nowMs) || cooldownSeconds <= 0) {
    return 0;
  }

  const elapsedSeconds = (nowMs - lastSentAtMs) / 1000;

  // Clock moved backwards: clamp to the full window instead of a negative
  // elapsed producing a cooldown longer than the policy.
  if (elapsedSeconds < 0) {
    return cooldownSeconds;
  }

  const remaining = Math.ceil(cooldownSeconds - elapsedSeconds);

  return remaining > 0 ? remaining : 0;
};

/**
 * The countdown label. Under a minute reads as seconds, because "0:47" invites
 * a second look where "47s" does not; at or above a minute reads as m:ss.
 */
export const formatCooldown = (remainingSeconds: number): string => {
  const safe = Math.max(0, Math.ceil(remainingSeconds));

  if (safe < 60) {
    return `${safe}s`;
  }

  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

/**
 * Storage key for one (purpose, email) pair.
 *
 * Keyed by email so signing in as someone else does not inherit a stranger's
 * cooldown, and lowercased/trimmed so the same address typed differently is the
 * same key — otherwise changing the capitalisation would reset the timer.
 */
export const otpCooldownStorageKey = (purpose: OtpPurpose, email: string): string =>
  `@feasty/otp-cooldown/${purpose}/${email.trim().toLowerCase()}`;
