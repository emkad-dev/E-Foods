import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  OTP_COOLDOWN_SECONDS,
  otpCooldownStorageKey,
  remainingCooldownSeconds,
  type OtpPurpose,
} from './otpCooldownPolicy';

export {
  OTP_COOLDOWN_SECONDS,
  formatCooldown,
  remainingCooldownSeconds,
  type OtpPurpose,
} from './otpCooldownPolicy';

/**
 * Persistence for the emailed-OTP resend cooldown. The decision logic is in
 * `otpCooldownPolicy.ts`; this only reads and writes the timestamp.
 *
 * Persisted rather than held in component state on purpose: the cooldown has to
 * survive a reload and a navigation away, which is exactly when someone
 * hammering "resend" would otherwise reset it for free. On web this is
 * localStorage, so it is per-browser — a different browser starts fresh, which
 * is why the server-side minimum interval is the real limit and this is the
 * courtesy layer. See the note in otpCooldownPolicy.ts.
 *
 * Every call swallows its own storage error: a throttle is not worth blocking
 * sign-in over, and the failure modes are both survivable — a failed WRITE just
 * means no cooldown is shown, and a failed READ is treated as "no cooldown",
 * which lets the user through to the server's own limit rather than stranding
 * them behind a timer that cannot be read.
 */

/** Records that a code was just sent. Call ONLY after the send actually succeeded. */
export const recordOtpSent = async (purpose: OtpPurpose, email: string): Promise<void> => {
  try {
    await AsyncStorage.setItem(otpCooldownStorageKey(purpose, email), String(Date.now()));
  } catch {
    // No cooldown will show. The server still enforces its own interval.
  }
};

/** Seconds left before another code may be requested; 0 when it is allowed. */
export const getOtpCooldownRemaining = async (
  purpose: OtpPurpose,
  email: string,
  cooldownSeconds: number = OTP_COOLDOWN_SECONDS
): Promise<number> => {
  try {
    const stored = await AsyncStorage.getItem(otpCooldownStorageKey(purpose, email));
    if (!stored) {
      return 0;
    }

    const parsed = Number.parseInt(stored, 10);

    return remainingCooldownSeconds(Number.isFinite(parsed) ? parsed : null, Date.now(), cooldownSeconds);
  } catch {
    // Fail open: a storage read we cannot perform must not lock the user out.
    return 0;
  }
};

/**
 * Clears the cooldown for one (purpose, email).
 *
 * Call after the code has been redeemed successfully: the flow is finished, so
 * holding a timer against that address would only punish the user if they come
 * back — a password reset immediately followed by a second, genuine reset is a
 * normal thing to do after a mistyped new password.
 */
export const clearOtpCooldown = async (purpose: OtpPurpose, email: string): Promise<void> => {
  try {
    await AsyncStorage.removeItem(otpCooldownStorageKey(purpose, email));
  } catch {
    // Worst case the user waits out a timer for a flow they already completed.
  }
};
