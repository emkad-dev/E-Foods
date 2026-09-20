import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { MIN_TAP_TARGET, radius } from '@feasty/design-system';
import { useAuth } from '../../src/contexts/AuthContext';
import { validateVerifyEmailForm } from '../../src/domain/authFormValidation';
import { useOtpCooldown } from '../../src/services/supabase/auth';
import { screenColumn } from '../../src/components/ScreenColumn';
import SuccessBanner from '../../src/components/SuccessBanner';
import { resolveSuccessNotice } from '../../src/utils/successNotices';
import { customerTheme } from '../../src/theme/palette';

const firstParam = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Email confirmation is OTP-only. The confirmation email carries a 6-digit code,
 * not a link, so this screen reads no `access_token` / `refresh_token` / `code`
 * URL params and has no `exchangeCodeForSession` / `setSession` effect. The code
 * field below is the only path to a confirmed email.
 *
 * It runs in BOTH session states, which is the thing to keep in mind when
 * editing it:
 *
 *  - SIGNED OUT, arriving from /register. Sign-up with confirmation pending
 *    returns no session, so the address comes from the route param (editable,
 *    because someone can land here directly or mistype at sign-up). Redeeming
 *    the code creates a real session, and `AuthContext`'s `onAuthStateChange`
 *    plus the route guards carry the customer on into the app from there.
 *  - SIGNED IN, arriving from the root layout's unverified-email guard. The
 *    session address wins and the email field is not rendered at all, so a
 *    signed-in customer cannot aim a code or a resend at another inbox.
 */
export default function VerifyEmailScreen() {
  const params = useLocalSearchParams<{ email?: string | string[]; notice?: string | string[] }>();
  const { user, reloadUser, sendVerificationEmail, verifyEmailCode, signOut, error, clearError } = useAuth();
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [dismissedRouteNotice, setDismissedRouteNotice] = useState(false);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const [code, setCode] = useState('');
  const [confirmingCode, setConfirmingCode] = useState(false);
  // The local checks on this screen are client-side, so they never reach
  // `AuthContext`'s `error`. They used to report only through `Alert`, which is
  // an empty function on the web build. They are held here and rendered through
  // the SAME slot as the context's `error`, keeping one error surface.
  const [screenError, setScreenError] = useState<string | null>(null);
  const router = useRouter();

  const sessionEmail = user?.email ?? '';
  const [typedEmail, setTypedEmail] = useState(() => firstParam(params.email) ?? '');
  // The session address wins whenever there is one; the typed/routed address is
  // only what a signed-out visitor has.
  const activeEmail = sessionEmail || typedEmail.trim();

  // The route notice (from /register) is the arrival message; anything the
  // screen itself produces supersedes it, so one banner is rendered, not two.
  const routeNotice = useMemo(
    () => (dismissedRouteNotice ? null : resolveSuccessNotice(params.notice)),
    [dismissedRouteNotice, params.notice]
  );
  const shownNotice = notice ?? routeNotice;

  // Every resend costs a real email, so the control is throttled against the
  // address it would actually be sent to -- which means retyping a different
  // address is not held behind the previous one's timer.
  const resendCooldown = useOtpCooldown('signup', activeEmail);

  useEffect(() => {
    clearError();
  }, [clearError]);

  useEffect(() => {
    if (user?.emailVerified) {
      router.replace('/home' as never);
    }
  }, [router, user?.emailVerified]);

  const handleConfirmCode = async () => {
    const trimmed = code.trim();
    const invalid = validateVerifyEmailForm({ email: activeEmail, code });

    if (invalid) {
      setScreenError(invalid);
      return;
    }

    setScreenError(null);
    setConfirmingCode(true);
    try {
      const verified = await verifyEmailCode(trimmed, activeEmail);

      if (verified) {
        // The code was redeemed, so this flow is over: drop the cooldown rather
        // than hold a timer against an address that no longer needs one.
        await resendCooldown.clear();
        setDismissedRouteNotice(true);
        setNotice({
          title: 'Email confirmed',
          message: 'Your email has been confirmed. You can continue to the customer app.',
        });
        setCode('');
      }
    } catch {
      // `verifyEmailCode` set `AuthContext`'s `error` before throwing; the slot
      // below renders it.
    } finally {
      setConfirmingCode(false);
    }
  };

  const handleRefreshStatus = async () => {
    setScreenError(null);
    setChecking(true);
    try {
      const emailVerified = await reloadUser();
      if (emailVerified) {
        setNotice({
          title: 'Email confirmed',
          message: 'Your email has been confirmed. You can continue to the customer app.',
        });
      } else {
        setScreenError('Not confirmed yet. Enter the 6-digit code from your email above.');
      }
    } catch {
      // `reloadUser` set `AuthContext`'s `error` before throwing.
    } finally {
      setChecking(false);
    }
  };

  const handleResendEmail = async () => {
    if (!activeEmail) {
      setScreenError('Enter the email address you signed up with, then ask for a new code.');
      return;
    }

    setScreenError(null);
    setResending(true);
    try {
      await sendVerificationEmail(activeEmail);
      // Only now — a send that threw cost no email, so the user must be able to
      // try again immediately.
      await resendCooldown.markSent();
      setNotice({ title: 'New code sent', message: 'Check your inbox for a fresh 6-digit code.' });
    } catch {
      // `sendVerificationEmail` set `AuthContext`'s `error` before throwing.
    } finally {
      setResending(false);
    }
  };

  const displayError = screenError ?? error;
  const codeIncomplete = code.trim().length < 6;

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } catch {
      // `signOut` set `AuthContext`'s `error` before throwing.
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.container, screenColumn.reading]}>
      <Text style={styles.title}>Confirm your email</Text>
      <Text style={styles.copy}>
        {`We sent a 6-digit code to ${activeEmail || 'your inbox'}. Enter it below to confirm your email.`}
      </Text>

      <SuccessBanner
        title={shownNotice?.title}
        message={shownNotice?.message}
        onDismiss={() => {
          setNotice(null);
          setDismissedRouteNotice(true);
        }}
      />

      {displayError ? (
        <Text accessibilityLiveRegion="assertive" role="alert" style={styles.errorText}>
          {displayError}
        </Text>
      ) : null}

      {/* Rendered only with nobody signed in: with a session the address is
          the session's, and an editable field would invite typing someone
          else's. */}
      {sessionEmail ? null : (
        <TextInput
          style={styles.emailInput}
          placeholder="name@email.com"
          placeholderTextColor={customerTheme.textMuted}
          value={typedEmail}
          onChangeText={(value) => {
            setScreenError(null);
            setTypedEmail(value);
          }}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          editable={!confirmingCode}
          accessibilityLabel="Email address"
        />
      )}

      <TextInput
        style={styles.codeInput}
        placeholder="000000"
        placeholderTextColor={customerTheme.textMuted}
        value={code}
        onChangeText={(value) => {
          setScreenError(null);
          setCode(value.replace(/\D/g, '').slice(0, 6));
        }}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={6}
        editable={!confirmingCode}
        accessibilityLabel="6-digit confirmation code"
      />

      <TouchableOpacity
        style={[styles.primaryButton, codeIncomplete ? styles.buttonDisabled : null]}
        onPress={handleConfirmCode}
        disabled={confirmingCode || codeIncomplete}
      >
        <Text style={styles.primaryText}>{confirmingCode ? 'Confirming...' : 'Confirm email'}</Text>
      </TouchableOpacity>

      {/* Both of these read the session: `reloadUser` refreshes it and sign-out
          ends it. Signed out there is nothing to refresh and nothing to leave,
          so they are replaced by the way back to sign-in. */}
      {sessionEmail ? (
        <TouchableOpacity style={styles.secondaryButton} onPress={handleRefreshStatus} disabled={checking}>
          <Text style={styles.secondaryText}>
            {checking ? 'Checking...' : 'Refresh confirmation status'}
          </Text>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity
        style={[styles.secondaryButton, resendCooldown.isCoolingDown ? styles.buttonDisabled : null]}
        onPress={handleResendEmail}
        // `isChecking` too: the stored timestamp is read asynchronously, and
        // until it comes back this control must not be pressable, or a reload
        // leaves a brief window where a send goes out mid-cooldown.
        disabled={resending || resendCooldown.isCoolingDown || resendCooldown.isChecking}
      >
        <Text style={styles.secondaryText}>
          {resending
            ? 'Sending...'
            : resendCooldown.isCoolingDown
              ? `Send a new code in ${resendCooldown.label}`
              : 'Send a new code'}
        </Text>
      </TouchableOpacity>

      {sessionEmail ? (
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut} disabled={signingOut}>
          <Text style={styles.signOutText}>{signingOut ? 'Signing out...' : 'Sign out'}</Text>
        </TouchableOpacity>
      ) : (
        <Link href="/login" style={styles.backLink}>
          Back to sign in
        </Link>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: customerTheme.background,
    flex: 1,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: customerTheme.text,
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 12,
  },
  copy: {
    color: customerTheme.textMuted,
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 28,
  },
  errorText: {
    color: customerTheme.dangerText,
    marginBottom: 16,
    textAlign: 'center',
    fontSize: 14,
  },
  emailInput: {
    backgroundColor: customerTheme.surfaceMuted,
    borderColor: customerTheme.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: customerTheme.text,
    fontSize: 16,
    marginBottom: 12,
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  codeInput: {
    backgroundColor: customerTheme.surfaceMuted,
    borderColor: customerTheme.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: customerTheme.text,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: 10,
    marginBottom: 14,
    paddingVertical: 14,
    textAlign: 'center',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: customerTheme.accent,
    borderRadius: radius.md,
    marginBottom: 12,
    paddingVertical: 16,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  primaryText: {
    color: customerTheme.textOnBrand,
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.accent,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: 12,
    paddingVertical: 16,
  },
  secondaryText: {
    color: customerTheme.accentStrong,
    fontSize: 16,
    fontWeight: '600',
  },
  signOutButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  signOutText: {
    color: customerTheme.link,
    fontSize: 15,
    fontWeight: '600',
  },
  // A `Link` renders as `Text`, which react-native-web lays out as
  // `display: inline` -- `minHeight` on it is ignored, so the tap target is
  // bought with padding instead.
  backLink: {
    color: customerTheme.link,
    fontSize: 15,
    fontWeight: '600',
    paddingVertical: 12,
    textAlign: 'center',
  },
});
