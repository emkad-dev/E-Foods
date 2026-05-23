import { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { formatAuthError } from '../../src/services/supabase/auth';
import { supabase } from '../../src/services/supabase/config';
import { adminTheme } from '../../src/theme/palette';

export default function AdminVerifyEmailScreen() {
  const params = useLocalSearchParams<{
    access_token?: string | string[];
    code?: string | string[];
    refresh_token?: string | string[];
  }>();
  const router = useRouter();
  const [processingLink, setProcessingLink] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    let cancelled = false;

    const completeVerification = async () => {
      if (!verificationCode && !(accessToken && refreshToken)) {
        return;
      }

      setProcessingLink(true);
      setError(null);

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

        if (!cancelled) {
          setConfirmed(true);
        }
      } catch (nextError: any) {
        if (!cancelled) {
          const formattedError = formatAuthError(nextError);
          setError(formattedError);
          Alert.alert('Unable to verify email', formattedError);
        }
      } finally {
        if (!cancelled) {
          setProcessingLink(false);
        }
      }
    };

    void completeVerification();

    return () => {
      cancelled = true;
    };
  }, [accessToken, refreshToken, verificationCode]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Verify your admin email</Text>
      <Text style={styles.copy}>
        {processingLink
          ? 'Confirming your email link now. Stay on this screen for a moment.'
          : confirmed
            ? 'Your email has been confirmed. You can continue to sign in with your admin account.'
            : 'Open the verification email on this device, then come back here to continue.'}
      </Text>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <TouchableOpacity
        style={styles.primaryButton}
        onPress={() => router.replace('/(auth)/login')}
        disabled={processingLink}
      >
        <Text style={styles.primaryButtonText}>
          {processingLink ? 'Confirming...' : confirmed ? 'Continue to sign in' : 'Back to sign in'}
        </Text>
      </TouchableOpacity>

      <Link href="/(auth)/login" style={styles.link}>
        Return to login
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: adminTheme.background,
    flex: 1,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: adminTheme.text,
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 8,
  },
  copy: {
    color: adminTheme.textMuted,
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 24,
  },
  errorText: {
    color: adminTheme.danger,
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: adminTheme.accent,
    borderRadius: 14,
    paddingVertical: 15,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  link: {
    color: adminTheme.accentStrong,
    marginTop: 18,
    textAlign: 'center',
  },
});
