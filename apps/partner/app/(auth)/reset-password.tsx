import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { validateResetPasswordForm } from '../../src/domain/authFormValidation';
import { formatAuthError } from '../../src/services/supabase/auth';
import { supabase } from '../../src/services/supabase/config';
import type { PartnerSuccessNoticeKey } from '../../src/utils/successNotices';
import { partnerTheme } from '../../src/theme/palette';

export default function PartnerResetPasswordScreen() {
  const params = useLocalSearchParams<{
    access_token?: string | string[];
    code?: string | string[];
    redirectTo?: string | string[];
    refresh_token?: string | string[];
  }>();
  const router = useRouter();
  const redirectTo = useMemo(() => {
    if (Array.isArray(params.redirectTo)) return params.redirectTo[0];
    return params.redirectTo;
  }, [params.redirectTo]);
  const accessToken = useMemo(() => {
    if (Array.isArray(params.access_token)) return params.access_token[0];
    return params.access_token;
  }, [params.access_token]);
  const refreshToken = useMemo(() => {
    if (Array.isArray(params.refresh_token)) return params.refresh_token[0];
    return params.refresh_token;
  }, [params.refresh_token]);
  const recoveryCode = useMemo(() => {
    if (Array.isArray(params.code)) return params.code[0];
    return params.code;
  }, [params.code]);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleResetPassword = async () => {
    // Client-side validation used to go to `Alert`, an empty function on the
    // web build, so a mismatched pair or a code-less link produced no message
    // at all. This screen already owns a local `error` rendered inline below,
    // so these route into that same single surface.
    const invalid = validateResetPasswordForm({
      hasResetCredential: Boolean(accessToken || refreshToken || recoveryCode),
      password,
      confirmPassword,
    });

    if (invalid) {
      setError(invalid);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      if (recoveryCode) {
        const exchangeResult = await supabase.auth.exchangeCodeForSession(recoveryCode);
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
      } else {
        throw new Error('This reset link is missing the session tokens required to update your password.');
      }

      const updateResult = await supabase.auth.updateUser({ password });
      if (updateResult.error) {
        throw updateResult.error;
      }

      await supabase.auth.signOut().catch(() => undefined);
      // Navigate unconditionally and carry the confirmation to the login screen
      // as a route param, the way the customer reset flow does. This used to
      // hang off an `Alert.alert` button callback, which never fires on the web
      // build (`Alert` is an empty function in react-native-web) — so the
      // partner was left stranded on this form, already signed out, with the
      // recovery code spent and no confirmation that anything had happened.
      const noticeKey: PartnerSuccessNoticeKey = 'password-updated';
      router.replace({
        pathname: '/(auth)/login',
        params: { notice: noticeKey, ...(redirectTo ? { redirectTo } : null) },
      } as never);
    } catch (nextError: any) {
      // `setError` alone: it renders in the inline slot above. The `Alert` that
      // followed it said the same thing to nobody on the web build.
      setError(formatAuthError(nextError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Choose a new partner password</Text>
      <Text style={styles.copy}>Set a fresh password for your partner account, then sign in to open your dashboard.</Text>

      {error ? (
        <Text accessibilityLiveRegion="assertive" role="alert" style={styles.errorText}>
          {error}
        </Text>
      ) : null}

      <TextInput
        style={styles.input}
        placeholder="New password"
        placeholderTextColor="#8e8e8e"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        editable={!submitting}
      />
      <TextInput
        style={styles.input}
        placeholder="Confirm new password"
        placeholderTextColor="#8e8e8e"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
        editable={!submitting}
      />

      <TouchableOpacity style={styles.button} onPress={handleResetPassword} disabled={submitting}>
        <Text style={styles.buttonText}>{submitting ? 'Updating...' : 'Save new password'}</Text>
      </TouchableOpacity>

      <Link
        href={redirectTo ? { pathname: '/(auth)/login', params: { redirectTo } } : '/(auth)/login'}
        style={styles.link}
      >
        Back to sign in
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: partnerTheme.background,
    flex: 1,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: partnerTheme.text,
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 8,
  },
  copy: {
    color: partnerTheme.textMuted,
    fontSize: 16,
    marginBottom: 24,
  },
  errorText: {
    color: partnerTheme.danger,
    marginBottom: 16,
    textAlign: 'center',
    fontSize: 14,
  },
  input: {
    backgroundColor: partnerTheme.cream,
    borderColor: partnerTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    color: partnerTheme.text,
    height: 54,
    marginBottom: 14,
    paddingHorizontal: 16,
  },
  button: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accent,
    borderRadius: 18,
    paddingVertical: 16,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  link: {
    color: partnerTheme.accentStrong,
    marginTop: 18,
    textAlign: 'center',
  },
});
