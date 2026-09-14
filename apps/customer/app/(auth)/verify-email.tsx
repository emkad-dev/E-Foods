import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/contexts/AuthContext';
import { validateEmailCode } from '../../src/domain/authFormValidation';
import { useOtpCooldown } from '../../src/services/supabase/auth';
import { screenColumn } from '../../src/components/ScreenColumn';
import SuccessBanner from '../../src/components/SuccessBanner';
import { customerTheme } from '../../src/theme/palette';

/**
 * Email confirmation is OTP-only. The confirmation email carries a 6-digit code,
 * not a link, so this screen reads no `access_token` / `refresh_token` / `code`
 * URL params and has no `exchangeCodeForSession` / `setSession` effect. The code
 * field below is the only path to a confirmed email.
 */
export default function VerifyEmailScreen() {
  const { user, reloadUser, sendVerificationEmail, verifyEmailCode, signOut, error, clearError } = useAuth();
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const [code, setCode] = useState('');
  const [confirmingCode, setConfirmingCode] = useState(false);
  // The local checks on this screen are client-side, so they never reach
  // `AuthContext`'s `error`. They used to report only through `Alert`, which is
  // an empty function on the web build. They are held here and rendered through
  // the SAME slot as the context's `error`, keeping one error surface.
  const [screenError, setScreenError] = useState<string | null>(null);
  const router = useRouter();
  // Every resend costs a real email, so the control is throttled. This is the
  // only one of the three verify-email screens that runs SIGNED IN, so the
  // address being throttled comes off the session rather than a typed field.
  const resendCooldown = useOtpCooldown('signup', user?.email ?? '');

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
    const invalid = validateEmailCode({ value: code });

    if (invalid) {
      setScreenError(invalid);
      return;
    }

    setScreenError(null);
    setConfirmingCode(true);
    try {
      const verified = await verifyEmailCode(trimmed);

      if (verified) {
        // The code was redeemed, so this flow is over: drop the cooldown rather
        // than hold a timer against an address that no longer needs one.
        await resendCooldown.clear();
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
    setScreenError(null);
    setResending(true);
    try {
      await sendVerificationEmail();
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
        {`We sent a 6-digit code to ${user?.email ?? 'your inbox'}. Enter it below to confirm your email.`}
      </Text>

      <SuccessBanner title={notice?.title} message={notice?.message} onDismiss={() => setNotice(null)} />

      {displayError ? (
        <Text accessibilityLiveRegion="assertive" role="alert" style={styles.errorText}>
          {displayError}
        </Text>
      ) : null}

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
        style={[styles.primaryButton, code.trim().length < 6 ? styles.buttonDisabled : null]}
        onPress={handleConfirmCode}
        disabled={confirmingCode || code.trim().length < 6}
      >
        <Text style={styles.primaryText}>{confirmingCode ? 'Confirming...' : 'Confirm email'}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.secondaryButton} onPress={handleRefreshStatus} disabled={checking}>
        <Text style={styles.secondaryText}>
          {checking ? 'Checking...' : 'Refresh confirmation status'}
        </Text>
      </TouchableOpacity>

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

      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut} disabled={signingOut}>
        <Text style={styles.signOutText}>{signingOut ? 'Signing out...' : 'Sign out'}</Text>
      </TouchableOpacity>
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
  codeInput: {
    backgroundColor: customerTheme.surfaceMuted,
    borderColor: customerTheme.border,
    borderRadius: 12,
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
    borderRadius: 10,
    marginBottom: 12,
    paddingVertical: 15,
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
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
    paddingVertical: 15,
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
});
