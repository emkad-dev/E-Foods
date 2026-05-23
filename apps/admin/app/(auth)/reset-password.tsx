import { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { formatAuthError } from '../../src/services/supabase/auth';
import { supabase } from '../../src/services/supabase/config';
import { adminTheme } from '../../src/theme/palette';

export default function AdminResetPasswordScreen() {
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
    if (!accessToken && !refreshToken && !recoveryCode) {
      Alert.alert('Invalid link', 'This reset link is missing the required recovery code.');
      return;
    }

    if (!password.trim() || !confirmPassword.trim()) {
      Alert.alert('Missing information', 'Please enter both password fields to continue.');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Password mismatch', 'Enter matching passwords to continue.');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Weak password', 'Password must be at least 6 characters long.');
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
      Alert.alert('Password updated', 'You can now sign in with your new password.', [
        {
          text: 'Continue to login',
          onPress: () => router.replace('/(auth)/login'),
        },
      ]);
    } catch (nextError: any) {
      const formattedError = formatAuthError(nextError);
      setError(formattedError);
      Alert.alert('Unable to reset password', formattedError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Choose a new admin password</Text>
      <Text style={styles.copy}>Set a fresh password for your admin account, then sign back in.</Text>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <TextInput
        style={styles.input}
        placeholder="New password"
        placeholderTextColor={adminTheme.textMuted}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        editable={!submitting}
      />
      <TextInput
        style={styles.input}
        placeholder="Confirm new password"
        placeholderTextColor={adminTheme.textMuted}
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
    marginBottom: 24,
  },
  errorText: {
    color: adminTheme.danger,
    marginBottom: 16,
    textAlign: 'center',
    fontSize: 14,
  },
  input: {
    backgroundColor: adminTheme.surface,
    borderColor: adminTheme.border,
    borderRadius: 12,
    borderWidth: 1,
    color: adminTheme.text,
    height: 52,
    marginBottom: 14,
    paddingHorizontal: 16,
  },
  button: {
    alignItems: 'center',
    backgroundColor: adminTheme.accent,
    borderRadius: 14,
    paddingVertical: 15,
  },
  buttonText: {
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
