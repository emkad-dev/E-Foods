import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { validateResetPasswordForm } from '../../src/domain/authFormValidation';
import { formatAuthError } from '../../src/services/supabase/auth';
import { supabase } from '../../src/services/supabase/config';
import type { DispatchSuccessNoticeKey } from '../../src/utils/routeNotices';
import { dispatchTheme } from '../../src/theme/palette';

export default function DispatchResetPasswordScreen() {
  const params = useLocalSearchParams<{
    access_token?: string | string[];
    code?: string | string[];
    refresh_token?: string | string[];
  }>();
  const router = useRouter();
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
    // All four checks used to `Alert.alert` and return, leaving this screen's
    // own `error` slot — already rendered below for submit failures — empty.
    // They now report through it, so there is one error surface here.
    const invalid = validateResetPasswordForm({
      hasResetCredential: Boolean(recoveryCode || (accessToken && refreshToken)),
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
      // as a route param, the way the customer reset flow does. Hanging this off
      // an `Alert.alert` button callback would strand the rider on this form the
      // day dispatch gains a web build: `Alert` is an empty function in
      // react-native-web, so the callback never runs. The key is now typed
      // rather than a bare string (src/utils/routeNotices.ts), so a typo here
      // is a compile error instead of a confirmation that renders nothing.
      const noticeKey: DispatchSuccessNoticeKey = 'password-updated';
      router.replace({
        pathname: '/(auth)/login',
        params: { notice: noticeKey },
      } as never);
    } catch (nextError: any) {
      // `setError` alone: the slot below already renders it, and the `Alert`
      // that used to follow only repeated it on native and said nothing on web.
      setError(formatAuthError(nextError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Choose a new dispatch password</Text>
      <Text style={styles.copy}>Set a fresh password for your dispatch account, then sign back in.</Text>

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
        <Text style={styles.buttonText}>{submitting ? 'Updating...' : 'Update password'}</Text>
      </TouchableOpacity>

      <Link href="/(auth)/login" style={styles.link}>
        Back to sign in
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
    marginBottom: 8,
  },
  copy: {
    color: dispatchTheme.textMuted,
    fontSize: 16,
    marginBottom: 24,
  },
  errorText: {
    color: dispatchTheme.danger,
    marginBottom: 16,
    textAlign: 'center',
    fontSize: 14,
  },
  input: {
    backgroundColor: dispatchTheme.cream,
    borderColor: dispatchTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    color: dispatchTheme.text,
    height: 54,
    marginBottom: 14,
    paddingHorizontal: 16,
  },
  button: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.accent,
    borderRadius: 18,
    paddingVertical: 16,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  link: {
    color: dispatchTheme.accentStrong,
    marginTop: 18,
    textAlign: 'center',
  },
});
