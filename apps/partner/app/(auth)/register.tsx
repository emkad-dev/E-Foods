import { useState } from 'react';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PhoneInput } from '../../../../packages/auth/src/components/PhoneInput';
import AuthPasswordField from '../../src/components/AuthPasswordField';
import { useAuth } from '../../src/contexts/AuthContext';
import { validateRegisterForm } from '../../src/domain/authFormValidation';
import type { PartnerSuccessNoticeKey } from '../../src/utils/successNotices';
import { partnerTheme } from '../../src/theme/palette';

export default function PartnerRegisterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ redirectTo?: string | string[] }>();
  const { clearError, error, loading, signUp } = useAuth();
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phoneE164, setPhoneE164] = useState<string | null>(null);
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);
  const redirectTo = typeof params.redirectTo === 'string' ? params.redirectTo : undefined;
  // Held locally and rendered through the same slot as `AuthContext`'s error —
  // see the note in login.tsx.
  const [validationError, setValidationError] = useState<string | null>(null);
  const formError = validationError ?? error;

  const canSubmit = Boolean(contactName.trim() && email.trim() && password.trim() && phoneE164 && acceptedPolicies);

  const handleFieldChange = (setter: (value: string) => void) => (value: string) => {
    if (error) {
      clearError();
    }

    setValidationError(null);
    setter(value);
  };

  const handleRegister = async () => {
    const invalid = validateRegisterForm({ contactName, email, password, phoneE164, acceptedPolicies });

    if (invalid) {
      setValidationError(invalid);
      return;
    }

    setValidationError(null);

    try {
      const trimmedEmail = email.trim();
      const result = await signUp(trimmedEmail, password, {
        contactName: contactName.trim(),
        phoneNumber: phoneE164 ?? '',
      });

      // Navigate UNCONDITIONALLY and carry the confirmation as a route param.
      // The `router.replace` used to sit behind `if (!result.sessionPresent)`,
      // so in the session-present branch the only thing that happened was an
      // `Alert` — an empty function on partner.feasty.com.ng. The account was
      // created and the screen never changed, leaving the partner re-submitting
      // an email address that now already exists.
      if (result.verificationEmailSent && !result.sessionPresent) {
        // Confirmation is OTP-only, so the next step is typing the 6-digit code
        // — which happens in the app, not in the inbox. Go straight to the code
        // screen, carrying the address as its own data param so the partner
        // does not retype it (and so the resend button there has an address to
        // work with). Without this, /verify-email would be reachable only by
        // typing its URL, now that the emailed link is gone.
        const pendingNotice: PartnerSuccessNoticeKey = 'verification-email-sent';
        router.replace({
          pathname: '/(auth)/verify-email',
          params: {
            notice: pendingNotice,
            email: trimmedEmail,
            ...(redirectTo ? { redirectTo } : null),
          },
        } as never);
        return;
      }

      const noticeKey: PartnerSuccessNoticeKey = result.verificationEmailSent
        ? 'account-created'
        : 'account-created-unverified';

      router.replace({
        pathname: '/(auth)/login',
        params: { notice: noticeKey, ...(redirectTo ? { redirectTo } : null) },
      } as never);
    } catch {
      // `signUp` already set `AuthContext`'s `error`, rendered in the slot above.
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>FEASTY Partner</Text>
          <Text style={styles.title}>Create your partner login</Text>
          <Text style={styles.copy}>
            We’ll set up your login first. After you verify your email, sign in to complete your restaurant details and open the partner dashboard.
          </Text>
        </View>

        <View style={styles.card}>
          {formError ? (
            <Text accessibilityLiveRegion="assertive" role="alert" style={styles.errorText}>
              {formError}
            </Text>
          ) : null}

          <TextInput
            style={styles.input}
            placeholder="Contact name"
            placeholderTextColor="#8e8e8e"
            value={contactName}
            onChangeText={handleFieldChange(setContactName)}
            editable={!loading}
          />
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#8e8e8e"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={handleFieldChange(setEmail)}
            editable={!loading}
          />
          <AuthPasswordField
            placeholder="Password"
            value={password}
            onChangeText={handleFieldChange(setPassword)}
            editable={!loading}
            showHint
          />
          <View style={styles.phoneField}>
            <PhoneInput
              theme={partnerTheme}
              editable={!loading}
              onChange={({ e164 }) => {
                if (error) {
                  clearError();
                }
                setPhoneE164(e164);
              }}
            />
          </View>

          <TouchableOpacity
            style={[styles.policyRow, !acceptedPolicies ? styles.policyRowMuted : null]}
            onPress={() => setAcceptedPolicies((current) => !current)}
            activeOpacity={0.82}
            disabled={loading}
          >
            <View style={[styles.checkbox, acceptedPolicies ? styles.checkboxActive : null]}>
              {acceptedPolicies ? <View style={styles.checkboxDot} /> : null}
            </View>
            <Text style={styles.policyText}>
              I agree to the{' '}
              <Link href="/terms" style={styles.policyLink}>
                Terms
              </Link>{' '}
              and{' '}
              <Link href="/privacy" style={styles.policyLink}>
                Privacy Policy
              </Link>
              .
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.button, !canSubmit ? styles.buttonDisabled : null]} onPress={handleRegister} disabled={loading || !canSubmit}>
            <Text style={styles.buttonText}>{loading ? 'Creating login...' : 'Create login'}</Text>
          </TouchableOpacity>

          <Link href={redirectTo ? { pathname: '/login', params: { redirectTo } } : '/login'} style={styles.link}>
            Already have a login? Sign in
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: partnerTheme.background,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  hero: {
    backgroundColor: partnerTheme.hero,
    borderColor: partnerTheme.hero,
    borderRadius: 28,
    borderWidth: 1,
    padding: 24,
  },
  eyebrow: {
    color: partnerTheme.heroSoft,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  title: {
    color: partnerTheme.textOnHero,
    fontSize: 31,
    fontWeight: '800',
  },
  copy: {
    color: '#e7dbc7',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  card: {
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: 26,
    borderWidth: 1,
    marginTop: 16,
    padding: 20,
  },
  errorText: {
    color: partnerTheme.danger,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  input: {
    backgroundColor: partnerTheme.cream,
    borderColor: partnerTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    color: partnerTheme.text,
    fontSize: 15,
    marginTop: 14,
    minHeight: 54,
    paddingHorizontal: 16,
  },
  phoneField: {
    marginTop: 14,
  },
  policyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 18,
  },
  policyRowMuted: {
    opacity: 0.94,
  },
  checkbox: {
    alignItems: 'center',
    borderColor: partnerTheme.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 22,
    justifyContent: 'center',
    marginRight: 12,
    width: 22,
  },
  checkboxActive: {
    backgroundColor: partnerTheme.accent,
    borderColor: partnerTheme.accent,
  },
  checkboxDot: {
    backgroundColor: partnerTheme.textOnBrand,
    borderRadius: 999,
    height: 10,
    width: 10,
  },
  policyText: {
    color: partnerTheme.textMuted,
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  policyLink: {
    color: partnerTheme.accentStrong,
    fontWeight: '700',
  },
  button: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accent,
    borderRadius: 18,
    marginTop: 18,
    paddingVertical: 16,
  },
  buttonDisabled: {
    opacity: 0.72,
  },
  buttonText: {
    color: partnerTheme.textOnBrand,
    fontSize: 15,
    fontWeight: '800',
  },
  link: {
    color: partnerTheme.accentStrong,
    marginTop: 16,
    textAlign: 'center',
  },
});
