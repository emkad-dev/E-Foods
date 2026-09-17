import { Link, useRouter } from 'expo-router';
import { radius } from '../../../../packages/design-system/src/tokens/radius';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/contexts/AuthContext';
import { validateForgotPasswordForm } from '../../src/domain/authFormValidation';
import { useOtpCooldown } from '../../src/services/supabase/auth';
import type { DispatchSuccessNoticeKey } from '../../src/utils/routeNotices';
import { dispatchTheme } from '../../src/theme/palette';

export default function DispatchForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { clearError, error, loading, resetPassword } = useAuth();
  const [email, setEmail] = useState('');
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
      // `notice` is the keyed route-param mechanism (see utils/routeNotices);
      // the address is data, not a notice key, so it rides as its own param —
      // that is what saves the rider retyping it on the next screen.
      const noticeKey: DispatchSuccessNoticeKey = 'reset-code-sent';
      router.replace({
        pathname: '/(auth)/reset-password',
        params: { notice: noticeKey, email: trimmedEmail },
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
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>FEASTY Dispatch</Text>
        <Text style={styles.title}>Reset dispatch password</Text>
        <Text style={styles.copy}>
          Enter your dispatch email and we will send you a 6-digit code to set a new password with.
        </Text>
      </View>

      <View style={styles.formCard}>
        {formError ? (
          <Text accessibilityLiveRegion="assertive" role="alert" style={styles.errorText}>
            {formError}
          </Text>
        ) : null}

        <TextInput
          style={styles.input}
          placeholder="Dispatch email"
          placeholderTextColor={dispatchTheme.textSoft}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={handleEmailChange}
          editable={!loading}
        />

        <TouchableOpacity
          style={[styles.primaryButton, sendCooldown.isCoolingDown ? styles.buttonDisabled : null]}
          onPress={handleResetPassword}
          // `isChecking` too: the stored timestamp is read asynchronously, and
          // until it comes back this control must not be pressable, or a reload
          // leaves a brief window where a send goes out mid-cooldown.
          disabled={loading || sendCooldown.isCoolingDown || sendCooldown.isChecking}
        >
          <Text style={styles.primaryButtonText}>
            {loading
              ? 'Sending...'
              : sendCooldown.isCoolingDown
                ? `Send reset code in ${sendCooldown.label}`
                : 'Send reset code'}
          </Text>
        </TouchableOpacity>

        <Link href="/(auth)/login" style={styles.link}>
          Back to sign in
        </Link>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: dispatchTheme.background,
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  hero: {
    backgroundColor: dispatchTheme.hero,
    borderColor: dispatchTheme.heroSecondary,
    borderRadius: radius['2xl'],
    borderWidth: 1,
    padding: 24,
  },
  eyebrow: {
    color: dispatchTheme.accentSoft,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  title: {
    color: dispatchTheme.textOnInverse,
    fontSize: 31,
    fontWeight: '800',
  },
  copy: {
    color: dispatchTheme.textOnInverseMuted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  formCard: {
    backgroundColor: dispatchTheme.surface,
    borderColor: dispatchTheme.border,
    borderRadius: radius['2xl'],
    borderWidth: 1,
    marginTop: 16,
    padding: 20,
  },
  errorText: {
    color: dispatchTheme.dangerText,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  input: {
    backgroundColor: dispatchTheme.cream,
    borderColor: dispatchTheme.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    color: dispatchTheme.text,
    fontSize: 15,
    marginTop: 8,
    minHeight: 54,
    paddingHorizontal: 16,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.accent,
    borderRadius: radius.xl,
    marginTop: 18,
    paddingVertical: 16,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  primaryButtonText: {
    color: dispatchTheme.textOnBrand,
    fontSize: 15,
    fontWeight: '800',
  },
  link: {
    color: dispatchTheme.accentStrong,
    marginTop: 16,
    textAlign: 'center',
  },
});
