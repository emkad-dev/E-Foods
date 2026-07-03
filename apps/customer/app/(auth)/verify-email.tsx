import { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../src/contexts/AuthContext';
import { formatAuthError } from '../../src/services/supabase/auth';
import { supabase } from '../../src/services/supabase/config';
import { updateUserDocument } from '../../src/services/supabase/profile';
import { customerTheme } from '../../src/theme/palette';

export default function VerifyEmailScreen() {
  const { user, reloadUser, sendVerificationEmail, signOut, error, clearError } = useAuth();
  const params = useLocalSearchParams<{
    access_token?: string | string[];
    code?: string | string[];
    refresh_token?: string | string[];
  }>();
  const [checking, setChecking] = useState(false);
  const [processingLink, setProcessingLink] = useState(false);
  const [resending, setResending] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
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
          Alert.alert('Unable to verify email', formatAuthError(nextError));
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

  const handleRefreshStatus = async () => {
    setChecking(true);
    try {
      const emailVerified = await reloadUser();
      Alert.alert(
        emailVerified ? 'Success' : 'Not verified yet',
        emailVerified
          ? 'Your email has been verified!'
          : 'Please complete the verification link sent to your email.'
      );
    } catch (error: any) {
      Alert.alert('Unable to refresh status', error.message);
    } finally {
      setChecking(false);
    }
  };

  const handleResendEmail = async () => {
    setResending(true);
    try {
      await sendVerificationEmail();
      Alert.alert('Verification email sent', 'Please check your inbox for the new link.');
    } catch (error: any) {
      Alert.alert('Unable to resend email', error.message);
    } finally {
      setResending(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Verify your email</Text>
      <Text style={styles.copy}>
        {processingLink
          ? 'Confirming your email link now. Stay on this screen for a moment.'
          : `We sent a verification link to ${user?.email ?? 'your inbox'}. Confirm it, then come back here to continue.`}
      </Text>

      {error && <Text style={styles.errorText}>{error}</Text>}

      <TouchableOpacity
        style={styles.primaryButton}
        onPress={handleRefreshStatus}
        disabled={checking || processingLink}
      >
        <Text style={styles.primaryText}>
          {processingLink ? 'Confirming...' : checking ? 'Checking...' : 'I have verified my email'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={handleResendEmail}
        disabled={resending || processingLink}
      >
        <Text style={styles.secondaryText}>{resending ? 'Sending...' : 'Resend verification email'}</Text>
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
  primaryButton: {
    alignItems: 'center',
    backgroundColor: customerTheme.accent,
    borderRadius: 10,
    marginBottom: 12,
    paddingVertical: 15,
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
