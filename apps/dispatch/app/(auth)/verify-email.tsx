import { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text } from 'react-native';
import { Link, useLocalSearchParams } from 'expo-router';
import { formatAuthError } from '../../src/services/supabase/auth';
import { supabase } from '../../src/services/supabase/config';
import { updateUserDocument } from '../../src/services/supabase/profile';
import { dispatchTheme } from '../../src/theme/palette';

export default function DispatchVerifyEmailScreen() {
  const params = useLocalSearchParams<{
    access_token?: string | string[];
    code?: string | string[];
    refresh_token?: string | string[];
  }>();
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

  const [processing, setProcessing] = useState(Boolean(verificationCode || (accessToken && refreshToken)));
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const finalizeVerification = async () => {
      if (!verificationCode && !(accessToken && refreshToken)) {
        setProcessing(false);
        return;
      }

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
          data: { user },
        } = await supabase.auth.getUser();

        if (user?.id) {
          await updateUserDocument(user.id, { emailVerified: true }).catch(() => undefined);
        }

        await supabase.auth.signOut().catch(() => undefined);

        if (!cancelled) {
          setConfirmed(true);
        }
      } catch (nextError: any) {
        if (!cancelled) {
          const formattedError = formatAuthError(nextError);
          setError(formattedError);
          Alert.alert('Unable to confirm email', formattedError);
        }
      } finally {
        if (!cancelled) {
          setProcessing(false);
        }
      }
    };

    void finalizeVerification();

    return () => {
      cancelled = true;
    };
  }, [accessToken, refreshToken, verificationCode]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Confirm dispatch email</Text>
      <Text style={styles.copy}>
        {processing
          ? 'Finishing your email confirmation now. Stay on this screen for a moment.'
          : confirmed
            ? 'Your email is confirmed. Your rider account is now ready for sign-in.'
            : 'Open the verification link from your email on this device to confirm this dispatch account.'}
      </Text>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Link href="/(auth)/login" style={styles.link}>
        Back to dispatch sign in
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: dispatchTheme.background,
    flex: 1,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: dispatchTheme.text,
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 10,
  },
  copy: {
    color: dispatchTheme.textMuted,
    fontSize: 16,
    lineHeight: 24,
  },
  errorText: {
    color: dispatchTheme.danger,
    marginTop: 16,
    textAlign: 'center',
    fontSize: 14,
  },
  link: {
    color: dispatchTheme.accentStrong,
    marginTop: 24,
    textAlign: 'center',
  },
});
