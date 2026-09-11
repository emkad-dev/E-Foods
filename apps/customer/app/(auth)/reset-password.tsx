import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { validateResetPasswordForm } from '../../src/domain/authFormValidation';
import { formatAuthError } from '../../src/services/supabase/auth';
import { supabase } from '../../src/services/supabase/config';
import { customerTheme } from '../../src/theme/palette';

export default function ResetPasswordScreen() {
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
    // All four checks used to `Alert` and return, i.e. do nothing at all on the
    // web build. They now write into the same `error` slot the screen already
    // renders for server failures.
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
      router.replace({
        pathname: '/login',
        params: { notice: 'password-updated', ...(redirectTo ? { redirectTo } : null) },
      } as never);
    } catch (err: any) {
      // `setError` alone: the slot above renders it. The `Alert` that used to
      // follow was a duplicate on native and silence on web.
      setError(formatAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Choose a new password</Text>
      <Text style={styles.copy}>Set a fresh password for your account and then sign back in.</Text>

      {error ? (
        <Text accessibilityLiveRegion="assertive" role="alert" style={styles.errorText}>
          {error}
        </Text>
      ) : null}

      <TextInput
        style={styles.input}
        placeholder="New password"
        value={password}
        onChangeText={(value) => {
          setError(null);
          setPassword(value);
        }}
        secureTextEntry
        editable={!submitting}
      />
      <TextInput
        style={styles.input}
        placeholder="Confirm new password"
        value={confirmPassword}
        onChangeText={(value) => {
          setError(null);
          setConfirmPassword(value);
        }}
        secureTextEntry
        editable={!submitting}
      />

      <TouchableOpacity style={styles.button} onPress={handleResetPassword} disabled={submitting}>
        <Text style={styles.buttonText}>{submitting ? 'Updating...' : 'Update password'}</Text>
      </TouchableOpacity>

      <Link href={redirectTo ? { pathname: '/login', params: { redirectTo } } : '/login'} style={styles.link}>
        Back to login
      </Link>
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
    marginBottom: 8,
  },
  copy: {
    color: customerTheme.textMuted,
    fontSize: 16,
    marginBottom: 24,
  },
  errorText: {
    color: customerTheme.danger,
    marginBottom: 16,
    textAlign: 'center',
    fontSize: 14,
  },
  input: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 10,
    borderWidth: 1,
    height: 50,
    marginBottom: 14,
    paddingHorizontal: 16,
    color: customerTheme.text,
  },
  button: {
    alignItems: 'center',
    backgroundColor: customerTheme.accent,
    borderRadius: 10,
    paddingVertical: 15,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  link: {
    color: customerTheme.link,
    marginTop: 18,
    textAlign: 'center',
  },
});
