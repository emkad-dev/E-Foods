import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../src/contexts/AuthContext';
import { validateEmailCode } from '../../src/domain/authFormValidation';
import { formatAuthError } from '../../src/services/supabase/auth';
import { supabase } from '../../src/services/supabase/config';
import { updateUserDocument } from '../../src/services/supabase/profile';
import SuccessBanner from '../../src/components/SuccessBanner';
import { customerTheme } from '../../src/theme/palette';

export default function VerifyEmailScreen() {
  const { user, reloadUser, sendVerificationEmail, verifyEmailCode, signOut, error, clearError } = useAuth();
  const params = useLocalSearchParams<{
    access_token?: string | string[];
    code?: string | string[];
    refresh_token?: string | string[];
  }>();
  const [checking, setChecking] = useState(false);
  const [processingLink, setProcessingLink] = useState(false);
  const [resending, setResending] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const [code, setCode] = useState('');
  const [confirmingCode, setConfirmingCode] = useState(false);
  // Three failures on this screen never reached `AuthContext`'s `error`: the
  // link exchange below talks to `supabase.auth` directly, and the two local
  // checks are client-side. All three reported only through `Alert`, which is
  // an empty function on the web build — so a broken or expired verification
  // link produced a completely blank screen. They are held here and rendered
  // through the SAME slot as the context's `error`, keeping one error surface.
  const [screenError, setScreenError] = useState<string | null>(null);
  const router = useRouter();
  const accessToken = useMemo(() => {
    if (Array.isArray(params.access_token)) return params.access_token[0];
    return params.access_token;
  }, [params.access_token]);
  const refreshToken = useMemo(() => {
    if (Array.isArray(params.refresh_token)) return params.refresh_token[0];
    return params.refresh_token;
  }, [params.refresh_token]);
  const verificationCode = useMemo(() => {
    if (Array.isArray(params.code)) return params.code[0];
    return params.code;
  }, [params.code]);

  useEffect(() => {
    clearError();
  }, [clearError]);

  useEffect(() => {
    let cancelled = false;

    const completeEmailVerification = async () => {
      if (!verificationCode && !(accessToken && refreshToken)) {
        return;
      }

      setProcessingLink(true);

      try {
        if (verificationCode) {
          const exchangeResult = await supabase.auth.exchangeCodeForSession(verificationCode);
          if (exchangeResult.error) {
            throw exchangeResult.error;
          }
        } else if (accessToken && refreshToken) {
          const sessionResult = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionResult.error) {
            throw sessionResult.error;
          }
        }

        const {
          data: { user: authUser },
        } = await supabase.auth.getUser();

        if (authUser?.id) {
          await updateUserDocument(authUser.id, { emailVerified: true }).catch(() => undefined);
        }

        await reloadUser().catch(() => undefined);
      } catch (nextError: any) {
        if (!cancelled) {
          setScreenError(formatAuthError(nextError));
        }
      } finally {
        if (!cancelled) {
          setProcessingLink(false);
        }
      }
    };

    void completeEmailVerification();

    return () => {
      cancelled = true;
    };
  }, [accessToken, refreshToken, reloadUser, verificationCode]);

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
        setScreenError(
          'Not verified yet. Open the verification link we sent, then come back here after confirming it.'
        );
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
      setNotice({ title: 'Verification link sent', message: 'Please check your inbox for the new link.' });
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
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Confirm your email</Text>
      <Text style={styles.copy}>
        {processingLink
          ? 'Confirming your email link now. Stay on this screen for a moment.'
          : `We sent a 6-digit code to ${user?.email ?? 'your inbox'}. Enter it below to confirm your email.`}
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
        editable={!confirmingCode && !processingLink}
        accessibilityLabel="6-digit confirmation code"
      />

      <TouchableOpacity
        style={[styles.primaryButton, code.trim().length < 6 ? styles.buttonDisabled : null]}
        onPress={handleConfirmCode}
        disabled={confirmingCode || processingLink || code.trim().length < 6}
      >
        <Text style={styles.primaryText}>{confirmingCode ? 'Confirming...' : 'Confirm email'}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={handleRefreshStatus}
        disabled={checking || processingLink}
      >
        <Text style={styles.secondaryText}>
          {processingLink ? 'Confirming...' : checking ? 'Checking...' : 'I used the link instead'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={handleResendEmail}
        disabled={resending || processingLink}
      >
        <Text style={styles.secondaryText}>{resending ? 'Sending...' : 'Send a new code'}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.signOutButton}
        onPress={handleSignOut}
        disabled={signingOut || processingLink}
      >
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
    color: customerTheme.danger,
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
    color: '#fff',
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
