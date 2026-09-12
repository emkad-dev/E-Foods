import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/contexts/AuthContext';
import { validateForgotPasswordForm } from '../../src/domain/authFormValidation';
import { useOtpCooldown } from '../../src/services/supabase/auth';
import type { PartnerSuccessNoticeKey } from '../../src/utils/successNotices';
import { partnerTheme } from '../../src/theme/palette';

export default function PartnerForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ redirectTo?: string | string[] }>();
  const router = useRouter();
  const { clearError, error, loading, resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const redirectTo = typeof params.redirectTo === 'string' ? params.redirectTo : undefined;
  // Held locally and rendered through the same slot as `AuthContext`'s error —
  // see the note in login.tsx.
  const [validationError, setValidationError] = useState<string | null>(null);
  const formError = validationError ?? error;
  // Each send costs a real email, so it is throttled. Keyed on the address in
  // the field above, so a different address is not held behind the previous
  // one's timer, and read from storage on mount so a reload -- the obvious way
  // to try to dodge a countdown -- keeps it.
  const sendCooldown = useOtpCooldown('recovery', email);

  const handleEmailChange = (value: string) => {
    if (error) {
      clearError();
    }

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

    try {
      const trimmedEmail = email.trim();
      await resetPassword(trimmedEmail);
      // Recorded only here: a `resetPassword` that threw sent no email, so the
      // user must be able to try again at once.
      await sendCooldown.markSent();
      // Reset is OTP-only now, so the next step happens in the app rather than
      // in the inbox: go straight to the code form instead of back to sign-in.
      // `notice` is the keyed route-param mechanism (see utils/successNotices);
      // the address is data, not a notice key, so it rides as its own param —
      // that is what saves the partner retyping it on the next screen.
      const noticeKey: PartnerSuccessNoticeKey = 'reset-code-sent';
      router.replace({
        pathname: '/(auth)/reset-password',
        params: {
          notice: noticeKey,
          email: trimmedEmail,
          ...(redirectTo ? { redirectTo } : null),
        },
      } as never);
    } catch {
      // `resetPassword` already set `AuthContext`'s `error`, rendered above.
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28 }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Reset your partner password</Text>
      <Text style={styles.copy}>
        Enter your partner email and we will send you a 6-digit code to set a new password with.
      </Text>

      {formError ? (
        <Text accessibilityLiveRegion="assertive" role="alert" style={styles.errorText}>
          {formError}
        </Text>
      ) : null}

      <TextInput
        style={styles.input}
        placeholder="Partner email"
        placeholderTextColor="#8e8e8e"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={handleEmailChange}
        editable={!loading}
      />

      <TouchableOpacity
        style={[styles.button, sendCooldown.isCoolingDown ? styles.buttonDisabled : null]}
        onPress={handleResetPassword}
        // `isChecking` too: the stored timestamp is read asynchronously, and
        // until it comes back this control must not be pressable, or a reload
        // leaves a brief window where a send goes out mid-cooldown.
        disabled={loading || sendCooldown.isCoolingDown || sendCooldown.isChecking}
      >
        <Text style={styles.buttonText}>
          {loading
            ? 'Sending...'
            : sendCooldown.isCoolingDown
              ? `Send reset code in ${sendCooldown.label}`
              : 'Send reset code'}
        </Text>
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
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: partnerTheme.text,
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  copy: {
    color: partnerTheme.textMuted,
    fontSize: 16,
    marginBottom: 24,
  },
  errorText: {
    color: partnerTheme.danger,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  input: {
    backgroundColor: partnerTheme.cream,
    borderColor: partnerTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    color: partnerTheme.text,
    fontSize: 15,
    minHeight: 54,
    paddingHorizontal: 16,
  },
  button: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accent,
    borderRadius: 18,
    marginTop: 18,
    paddingVertical: 16,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  link: {
    color: partnerTheme.accentStrong,
    marginTop: 16,
    textAlign: 'center',
  },
});
