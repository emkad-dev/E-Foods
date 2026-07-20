import { useState } from 'react';
import { Link, useRouter } from 'expo-router';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PhoneInput } from '../../../../packages/auth/src/components/PhoneInput';
import AuthPasswordField from '../../src/components/AuthPasswordField';
import { useAuth } from '../../src/contexts/AuthContext';
import { buildPartnerPolicyAcceptance } from '../../src/services/policyAcceptance';
import { partnerTheme } from '../../src/theme/palette';

export default function PartnerRegisterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { clearError, error, loading, signUp } = useAuth();
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phoneE164, setPhoneE164] = useState<string | null>(null);
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);

  const canSubmit = Boolean(contactName.trim() && email.trim() && password.trim() && phoneE164 && acceptedPolicies);

  const handleFieldChange = (setter: (value: string) => void) => (value: string) => {
    if (error) {
      clearError();
    }

    setter(value);
  };

  const handleRegister = async () => {
    if (!contactName.trim() || !email.trim() || !password.trim() || !phoneE164) {
      Alert.alert('Missing details', 'Complete the contact name, email, password, and phone number before continuing.');
      return;
    }

    if (!acceptedPolicies) {
      Alert.alert('Terms required', 'Accept the Terms and Privacy Policy before creating your login.');
      return;
    }

    try {
      const result = await signUp(email.trim(), password, {
        contactName: contactName.trim(),
        address: '',
        cuisine: 'Nigerian',
        deliveryTime: undefined,
        description: undefined,
        latitude: null,
        logoImage: null,
        longitude: null,
        phoneNumber: phoneE164 ?? '',
        policyAcceptance: buildPartnerPolicyAcceptance('partner_signup'),
        restaurantName: '',
      });

      Alert.alert(
        result.sessionPresent ? 'Account created' : 'Check your inbox',
        result.verificationEmailSent
          ? result.sessionPresent
            ? 'Your login is ready. Sign in to complete your restaurant profile.'
            : 'We sent a verification email. Confirm it, then sign in to finish setting up your restaurant.'
          : 'Your account was created, but the verification email could not be confirmed from the app.'
      );

      if (!result.sessionPresent) {
        router.replace('/(auth)/login');
      }
    } catch (nextError: any) {
      Alert.alert('Sign up failed', nextError.message ?? 'Unable to create your login right now.');
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
            We’ll set up your login first. After you verify your email, you can finish the restaurant profile from the dashboard.
          </Text>
        </View>

        <View style={styles.card}>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}

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

          <Link href="/login" style={styles.link}>
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
    color: '#fffdf8',
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
    backgroundColor: '#fff',
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
