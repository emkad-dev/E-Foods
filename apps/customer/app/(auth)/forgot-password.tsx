import { useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../src/contexts/AuthContext';
import AuthPrimaryButton from '../../src/components/AuthPrimaryButton';
import AuthScreenShell from '../../src/components/AuthScreenShell';
import AuthTextField from '../../src/components/AuthTextField';
import { customerTheme } from '../../src/theme/palette';

export default function ForgotPasswordScreen() {
  const params = useLocalSearchParams<{ redirectTo?: string | string[] }>();
  const redirectTo = typeof params.redirectTo === 'string' ? params.redirectTo : undefined;
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { resetPassword, error, clearError } = useAuth();
  const router = useRouter();

  const handleEmailChange = (value: string) => {
    if (error) clearError();
    setEmail(value);
  };

  const handleResetPassword = async () => {
    if (!email.trim()) {
      Alert.alert('Email required', 'Enter the email address linked to your account.');
      return;
    }

    setSubmitting(true);
    try {
      await resetPassword(email.trim());
      router.replace({
        pathname: '/login',
        params: { notice: 'reset-email-sent', ...(redirectTo ? { redirectTo } : null) },
      } as never);
    } catch (error: any) {
      Alert.alert('Unable to send reset email', error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthScreenShell
      title="Reset your password"
      subtitle="We will email you a secure link to finish resetting your password."
    >
      {error && <Text style={styles.errorText}>{error}</Text>}

      <AuthTextField
        placeholder="name@email.com"
        value={email}
        onChangeText={handleEmailChange}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        editable={!submitting}
      />

      <AuthPrimaryButton
        label={submitting ? 'Sending...' : 'Send reset email'}
        onPress={handleResetPassword}
        disabled={submitting}
      />

      <Link
        href={redirectTo ? { pathname: '/login', params: { redirectTo } } : '/login'}
        style={styles.link}
      >
        Back to login
      </Link>
    </AuthScreenShell>
  );
}

const styles = StyleSheet.create({
  errorText: {
    color: customerTheme.danger,
    fontSize: 14,
    marginBottom: 14,
    textAlign: 'center',
  },
  link: {
    color: customerTheme.link,
    marginTop: 16,
    textAlign: 'center',
  },
});
