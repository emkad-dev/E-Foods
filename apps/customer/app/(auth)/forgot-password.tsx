import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../src/contexts/AuthContext';
import { validateForgotPasswordForm } from '../../src/domain/authFormValidation';
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
  // Held locally and rendered through the same slot as `AuthContext`'s error —
  // see the note in login.tsx.
  const [validationError, setValidationError] = useState<string | null>(null);
  const formError = validationError ?? error;

  const handleEmailChange = (value: string) => {
    if (error) clearError();
    setValidationError(null);
    setEmail(value);
  };

  const handleResetPassword = async () => {
    const invalid = validateForgotPasswordForm({ email });

    if (invalid) {
      setValidationError(invalid);
      return;
    }

    setValidationError(null);
    setSubmitting(true);
    try {
      await resetPassword(email.trim());
      router.replace({
        pathname: '/login',
        params: { notice: 'reset-email-sent', ...(redirectTo ? { redirectTo } : null) },
      } as never);
    } catch {
      // `resetPassword` already set `AuthContext`'s `error`, rendered above.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthScreenShell
      title="Reset your password"
      subtitle="We will email you a secure link to finish resetting your password."
    >
      {formError ? (
        <Text accessibilityLiveRegion="assertive" role="alert" style={styles.errorText}>
          {formError}
        </Text>
      ) : null}

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
