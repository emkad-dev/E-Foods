import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Link } from 'expo-router';
import { useAuth } from '../../src/contexts/AuthContext';
import AuthPasswordField from '../../src/components/AuthPasswordField';
import GoogleSignInButton from '../../src/components/GoogleSignInButton';
import { getGoogleSignInUnavailableMessage } from '../../src/services/googleSignIn';
import { buildCustomerPolicyAcceptance } from '../../src/services/policyAcceptance';
import { customerTheme } from '../../src/theme/palette';

export default function RegisterScreen() {
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);
  const { loading, signUp, error, clearError } = useAuth();
  const googleSignInAvailable = !getGoogleSignInUnavailableMessage();

  const handleNicknameChange = (value: string) => {
    if (error) clearError();
    setNickname(value);
  };

  const handleEmailChange = (value: string) => {
    if (error) clearError();
    setEmail(value);
  };

  const handlePasswordChange = (value: string) => {
    if (error) clearError();
    setPassword(value);
  };

  const handleConfirmPasswordChange = (value: string) => {
    if (error) clearError();
    setConfirmPassword(value);
  };

  const handleRegister = async () => {
    if (!nickname.trim() || !email.trim() || !password.trim()) {
      Alert.alert('Missing information', 'Please complete all fields before continuing.');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Password mismatch', 'Your passwords must match.');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Weak password', 'Password must be at least 6 characters long.');
      return;
    }

    if (!acceptedPolicies) {
      Alert.alert('Terms required', 'Accept the Terms and Privacy Policy before creating an account.');
      return;
    }

    try {
      const { verificationEmailSent } = await signUp(email.trim(), password, {
        displayName: nickname.trim(),
        policyAcceptance: buildCustomerPolicyAcceptance('customer_signup'),
      });

      Alert.alert(
        verificationEmailSent ? 'Check your inbox' : 'Account created',
        verificationEmailSent
          ? 'We sent you a verification email to finish setting up your account.'
          : 'Your account was created, but verification email could not be sent yet. Open the verify email screen and try resending from there.'
      );
    } catch (error: any) {
      Alert.alert('Registration failed', error.message);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoider}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.container}>
          <Text style={styles.title}>Create your account</Text>
          <Text style={styles.copy}>Sign up to start ordering from nearby restaurants.</Text>

          {error && <Text style={styles.errorText}>{error}</Text>}

          <TextInput
            style={styles.input}
            placeholder="Nickname or username"
            value={nickname}
            onChangeText={handleNicknameChange}
            editable={!loading}
          />
          <Text style={styles.helperText}>This is how we will greet you in the customer app.</Text>
          <TextInput
            style={styles.input}
            placeholder="Email"
            value={email}
            onChangeText={handleEmailChange}
            autoCapitalize="none"
            keyboardType="email-address"
            editable={!loading}
          />
          <AuthPasswordField
            placeholder="Password"
            value={password}
            onChangeText={handlePasswordChange}
            editable={!loading}
            showHint
          />
          <AuthPasswordField
            placeholder="Confirm password"
            value={confirmPassword}
            onChangeText={handleConfirmPasswordChange}
            editable={!loading}
          />

          <TouchableOpacity
            style={styles.policyRow}
            onPress={() => setAcceptedPolicies((current) => !current)}
            activeOpacity={0.82}
            disabled={loading}
          >
            <View style={[styles.checkbox, acceptedPolicies ? styles.checkboxActive : null]}>
              {acceptedPolicies ? <Text style={styles.checkmark}>✓</Text> : null}
            </View>
            <Text style={styles.policyText}>
              I agree to the <Link href="/(auth)/terms" style={styles.policyLink}>Terms</Link> and{' '}
              <Link href="/(auth)/privacy" style={styles.policyLink}>Privacy Policy</Link>.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, !acceptedPolicies ? styles.buttonDisabled : null]}
            onPress={handleRegister}
            disabled={loading || !acceptedPolicies}
          >
            <Text style={styles.buttonText}>{loading ? 'Creating account...' : 'Create account'}</Text>
          </TouchableOpacity>

          {googleSignInAvailable ? (
            <>
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>Or sign up with</Text>
                <View style={styles.dividerLine} />
              </View>

              <GoogleSignInButton />
            </>
          ) : null}

          <Link href="/(auth)/login" style={styles.link}>
            Already have an account? Sign in
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardAvoider: {
    flex: 1,
    backgroundColor: customerTheme.background,
  },
  scrollContent: {
    flexGrow: 1,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    paddingBottom: 40,
  },
  title: {
    color: customerTheme.text,
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  copy: {
    color: customerTheme.textMuted,
    fontSize: 16,
    marginBottom: 24,
  },
  errorText: {
    color: customerTheme.danger,
    marginBottom: 16,
    textAlign: 'center',
    fontSize: 14,
  },
  input: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 12,
    borderWidth: 1,
    height: 50,
    marginTop: 10,
    paddingHorizontal: 16,
    color: customerTheme.text,
  },
  helperText: {
    color: customerTheme.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
  },
  button: {
    alignItems: 'center',
    backgroundColor: customerTheme.accent,
    borderRadius: 12,
    marginTop: 8,
    paddingVertical: 15,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  checkbox: {
    alignItems: 'center',
    borderColor: customerTheme.border,
    borderRadius: 7,
    borderWidth: 1,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  checkboxActive: {
    backgroundColor: customerTheme.accent,
    borderColor: customerTheme.accent,
  },
  checkmark: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
  },
  policyLink: {
    color: customerTheme.link,
    fontWeight: '800',
  },
  policyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  policyText: {
    color: customerTheme.textMuted,
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  link: {
    color: customerTheme.link,
    marginTop: 18,
    textAlign: 'center',
  },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: customerTheme.border },
  dividerText: { marginHorizontal: 10, color: customerTheme.textMuted, fontSize: 14 },
});
