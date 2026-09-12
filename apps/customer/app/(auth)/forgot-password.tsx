import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../src/contexts/AuthContext';
import { validateForgotPasswordForm } from '../../src/domain/authFormValidation';
import { useOtpCooldown } from '../../src/services/supabase/auth';
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
  // Keyed on the address in the field above, so typing a different one is not
  // held behind the previous address's timer. Read from storage on mount, which
  // is what makes a reload -- the obvious way to dodge a countdown -- keep it.
  const sendCooldown = useOtpCooldown('recovery', email);

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
      const trimmedEmail = email.trim();
      await resetPassword(trimmedEmail);
      // Recorded only here: a `resetPassword` that threw sent no email, and the
      // user must be able to try again at once.
      await sendCooldown.markSent();
      // Reset is OTP-only now, so the next step happens in the app rather than
      // in the inbox: go straight to the code form instead of back to login.
      // `notice` is the keyed route-param mechanism (see utils/successNotices);
      // the address is data, not a notice key, so it rides as its own param —
      // that is what saves the user retyping it on the next screen.
      router.replace({
        pathname: '/reset-password',
        params: {
          notice: 'reset-email-sent',
          email: trimmedEmail,
          ...(redirectTo ? { redirectTo } : null),
        },
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
      subtitle="We will email you a 6-digit code to finish resetting your password."
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
        label={
          submitting
            ? 'Sending...'
            : sendCooldown.isCoolingDown
              ? `Send reset email in ${sendCooldown.label}`
              : 'Send reset email'
        }
        onPress={handleResetPassword}
        // `isChecking` too: the stored timestamp is read asynchronously, and
        // until it comes back this control must not be pressable, or a reload
        // leaves a brief window where a send goes out mid-cooldown.
        disabled={submitting || sendCooldown.isCoolingDown || sendCooldown.isChecking}
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
