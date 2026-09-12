import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/contexts/AuthContext';
import { validateForgotPasswordForm } from '../../src/domain/authFormValidation';
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
      // `Alert` that used to sit here was the ONLY feedback and nothing
      // followed it, so on the web build the partner submitted, saw the screen
      // sit unchanged, and re-submitted — each retry burning another rate-limit
      // slot on the reset endpoint.
      const noticeKey: PartnerSuccessNoticeKey = 'reset-link-sent';
      router.replace({
        pathname: '/(auth)/login',
        params: { notice: noticeKey, ...(redirectTo ? { redirectTo } : null) },
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
      <Text style={styles.copy}>Enter your partner email and we will send a link to set a new password and return to your dashboard.</Text>

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

      <TouchableOpacity style={styles.button} onPress={handleResetPassword} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? 'Sending...' : 'Send reset link'}</Text>
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
