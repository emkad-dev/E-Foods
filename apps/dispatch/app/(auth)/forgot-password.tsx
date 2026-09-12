import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/contexts/AuthContext';
import { validateForgotPasswordForm } from '../../src/domain/authFormValidation';
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
      await resetPassword(email.trim());
      // Navigate and carry the confirmation to the login screen as a route
      // param, the way the reset-password flow already does. The success
      // `Alert` that used to sit here was the ONLY feedback and NOTHING
      // followed it — not a navigation, not a state change — so on a web build
      // the rider would submit, watch the screen sit unchanged, and re-submit,
      // each retry burning another rate-limit slot on the reset endpoint.
      const noticeKey: DispatchSuccessNoticeKey = 'reset-link-sent';
      router.replace({ pathname: '/(auth)/login', params: { notice: noticeKey } } as never);
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
          Enter your dispatch email and we will send you a password reset link.
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
          placeholderTextColor="#8e8e8e"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={handleEmailChange}
          editable={!loading}
        />

        <TouchableOpacity style={styles.primaryButton} onPress={handleResetPassword} disabled={loading}>
          <Text style={styles.primaryButtonText}>{loading ? 'Sending...' : 'Send reset email'}</Text>
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
    borderRadius: 28,
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
    color: dispatchTheme.cream,
    fontSize: 31,
    fontWeight: '800',
  },
  copy: {
    color: '#d6dfeb',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  formCard: {
    backgroundColor: dispatchTheme.surface,
    borderColor: dispatchTheme.border,
    borderRadius: 26,
    borderWidth: 1,
    marginTop: 16,
    padding: 20,
  },
  errorText: {
    color: dispatchTheme.danger,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  input: {
    backgroundColor: dispatchTheme.cream,
    borderColor: dispatchTheme.border,
    borderRadius: 16,
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
    borderRadius: 18,
    marginTop: 18,
    paddingVertical: 16,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  link: {
    color: dispatchTheme.accentStrong,
    marginTop: 16,
    textAlign: 'center',
  },
});
