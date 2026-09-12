import { useCallback, useEffect, useRef, useState } from 'react';

import {
  clearOtpCooldown,
  getOtpCooldownRemaining,
  recordOtpSent,
} from './otpCooldown';
import {
  OTP_COOLDOWN_SECONDS,
  formatCooldown,
  remainingCooldownSeconds,
  type OtpPurpose,
} from './otpCooldownPolicy';

/**
 * The screen half of the emailed-OTP resend cooldown: reads the persisted
 * timestamp on mount, counts it down once a second, and hands the screen a
 * ready-made label. The arithmetic lives in `otpCooldownPolicy.ts` and the
 * storage in `otpCooldown.ts`; this owns only the React lifecycle, which is the
 * part that was going to be copied into six screens otherwise.
 *
 * Two lifecycle details it exists to get right in one place:
 *
 * 1. THE MOUNT READ. Without it a reload — or navigating away and back — shows
 *    an enabled button while the cooldown is still outstanding, which is the
 *    exact hole persisting the timestamp was meant to close.
 * 2. THE INTERVAL. It is cleared on unmount AND the moment the countdown
 *    reaches zero, rather than left ticking against an unmounted screen.
 *
 * The tick does not decrement a counter. It re-derives the remaining time from
 * an anchor timestamp through `remainingCooldownSeconds`, so a throttled
 * background tab (where `setInterval` fires well under once a second) resumes
 * showing the truth instead of a timer that fell behind — and so this file adds
 * no arithmetic of its own beside the tested policy.
 */

export type UseOtpCooldownResult = {
  /** Seconds left; 0 when a new code may be requested. */
  remainingSeconds: number;
  /**
   * The stored timestamp for the current address has not been read back yet.
   *
   * The read is asynchronous, so without this there is a paint where the
   * control is enabled and then flips to disabled -- the exact window someone
   * hammering resend after a reload would land in. Screens disable the control
   * while this is true, so it is never pressable before the answer is known.
   */
  isChecking: boolean;
  /** `remainingSeconds > 0`. Disable the send control while this is true. */
  isCoolingDown: boolean;
  /** "45s" / "4:32" — empty while not cooling down. */
  label: string;
  /** Record a send and start the countdown. Call ONLY after the send succeeded. */
  markSent: () => Promise<void>;
  /** Drop the cooldown. Call after the code has been redeemed. */
  clear: () => Promise<void>;
};

export const useOtpCooldown = (purpose: OtpPurpose, email: string): UseOtpCooldownResult => {
  // Normalised here so a retyped capitalisation is the same cooldown and so the
  // mount effect does not re-run on every keystroke that only changes case or
  // surrounding space. `otpCooldownStorageKey` normalises again; harmless.
  const normalizedEmail = email.trim().toLowerCase();

  const [remainingSeconds, setRemainingSeconds] = useState(0);
  // The address the stored timestamp has actually been read for. Anything else
  // means the answer for what is in the field right now is still outstanding.
  const [checkedEmail, setCheckedEmail] = useState<string | null>(null);
  // "Sent at" in local-clock terms, reconstructed from whatever remaining time
  // we last learned, so every tick can go back through the policy.
  const sentAtRef = useRef<number | null>(null);

  const applyRemaining = useCallback((seconds: number) => {
    if (seconds > 0) {
      sentAtRef.current = Date.now() - (OTP_COOLDOWN_SECONDS - seconds) * 1000;
      setRemainingSeconds(seconds);
      return;
    }

    sentAtRef.current = null;
    setRemainingSeconds(0);
  }, []);

  // Mount, and whenever the address being throttled changes.
  useEffect(() => {
    let cancelled = false;

    if (!normalizedEmail) {
      applyRemaining(0);
      return () => {
        cancelled = true;
      };
    }

    void getOtpCooldownRemaining(purpose, normalizedEmail).then((seconds) => {
      if (!cancelled) {
        applyRemaining(seconds);
        setCheckedEmail(normalizedEmail);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [applyRemaining, normalizedEmail, purpose]);

  const isCoolingDown = remainingSeconds > 0;

  useEffect(() => {
    if (!isCoolingDown) {
      return undefined;
    }

    const intervalId = setInterval(() => {
      setRemainingSeconds(remainingCooldownSeconds(sentAtRef.current, Date.now()));
    }, 1000);

    // Runs on unmount and, because `isCoolingDown` flips false at zero, the
    // moment the countdown finishes.
    return () => clearInterval(intervalId);
  }, [isCoolingDown]);

  const markSent = useCallback(async () => {
    if (!normalizedEmail) {
      return;
    }

    await recordOtpSent(purpose, normalizedEmail);
    applyRemaining(OTP_COOLDOWN_SECONDS);
    setCheckedEmail(normalizedEmail);
  }, [applyRemaining, normalizedEmail, purpose]);

  const clear = useCallback(async () => {
    if (!normalizedEmail) {
      return;
    }

    await clearOtpCooldown(purpose, normalizedEmail);
    applyRemaining(0);
    setCheckedEmail(normalizedEmail);
  }, [applyRemaining, normalizedEmail, purpose]);

  return {
    remainingSeconds,
    isChecking: normalizedEmail !== '' && checkedEmail !== normalizedEmail,
    isCoolingDown,
    label: isCoolingDown ? formatCooldown(remainingSeconds) : '',
    markSent,
    clear,
  };
};
