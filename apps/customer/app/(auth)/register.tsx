import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useHeaderHeight } from '@react-navigation/elements';
import { useAuth } from '../../src/contexts/AuthContext';
import AuthPasswordField from '../../src/components/AuthPasswordField';
import AuthPrimaryButton from '../../src/components/AuthPrimaryButton';
import AuthScreenShell, { AuthDivider } from '../../src/components/AuthScreenShell';
import AuthTextField from '../../src/components/AuthTextField';
import GoogleSignInButton from '../../src/components/GoogleSignInButton';
import SuccessBanner from '../../src/components/SuccessBanner';
import { validateRegisterForm } from '../../src/domain/authFormValidation';
import { buildCustomerPolicyAcceptance } from '../../src/services/policyAcceptance';
import { ACCOUNT_ALREADY_REGISTERED_MESSAGE } from '../../src/services/supabase/auth';
import { customerTheme } from '../../src/theme/palette';

export default function RegisterScreen() {
  const params = useLocalSearchParams<{ redirectTo?: string | string[] }>();
  const redirectTo = typeof params.redirectTo === 'string' ? params.redirectTo : undefined;
  const headerHeight = useHeaderHeight();
  const router = useRouter();
  const [pendingNotice, setPendingNotice] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);
  const { loading, signUp, error, clearError } = useAuth();
  // Every one of the four checks below used to `Alert` and return. `Alert` is an
  // empty function on the web build, so an incomplete form, a password typo or
  // an unticked terms box made Create account do nothing visible at all. Held
  // locally because `AuthContext` exposes no setter, and rendered through the
  // SAME slot as the context's `error`, so there is one error surface.
  const [validationError, setValidationError] = useState<string | null>(null);
  const formError = validationError ?? error;
  // Compared by identity against the shared constant rather than by matching
  // prose, so re-wording the message cannot silently drop the two routes out of
  // it. `validationError` is client-side only and never carries this text, so
  // only the context's `error` can light this up.
  const showAlreadyRegisteredRoutes = formError === ACCOUNT_ALREADY_REGISTERED_MESSAGE;

  const handleNicknameChange = (value: string) => {
    if (error) clearError();
    setValidationError(null);
    setNickname(value);
  };

  const handleEmailChange = (value: string) => {
    if (error) clearError();
    setValidationError(null);
    setEmail(value);
  };

  const handlePasswordChange = (value: string) => {
    if (error) clearError();
    setValidationError(null);
    setPassword(value);
  };

  const handleConfirmPasswordChange = (value: string) => {
    if (error) clearError();
    setValidationError(null);
    setConfirmPassword(value);
  };

  const handlePhoneNumberChange = (value: string) => {
    if (error) clearError();
    setValidationError(null);
    setPhoneNumber(value);
  };

  const handleRegister = async () => {
    const invalid = validateRegisterForm({
      nickname,
      email,
      password,
      confirmPassword,
      phoneNumber,
      acceptedPolicies,
    });

    if (invalid) {
      setValidationError(invalid);
      return;
    }

    setValidationError(null);

    try {
      const { verificationEmailSent } = await signUp(email.trim(), password, {
        displayName: nickname.trim(),
        phoneNumber: phoneNumber.trim(),
        policyAcceptance: buildCustomerPolicyAcceptance('customer_signup'),
      });

      if (verificationEmailSent) {
        router.replace({
          pathname: '/login',
          params: { notice: 'account-created', ...(redirectTo ? { redirectTo } : null) },
        } as never);
        return;
      }

      setPendingNotice(
        'Your account was created, but the verification email could not be sent yet. Open the verify email screen and resend it from there.'
      );
    } catch {
      // `signUp` has already pushed the formatted message into `AuthContext`'s
      // `error`, which the slot above renders.
    }
  };

  return (
    <AuthScreenShell
      title="Create your account"
      subtitle="Confirm your email, then start ordering from nearby restaurants."
      topInset={headerHeight}
    >
      <SuccessBanner
        title="Account created"
        message={pendingNotice}
        onDismiss={() => setPendingNotice(null)}
      />

      {formError ? (
        <View style={styles.errorBlock}>
          <Text accessibilityLiveRegion="assertive" role="alert" style={styles.errorText}>
            {formError}
          </Text>
          {showAlreadyRegisteredRoutes ? (
            // Both branches of the already-registered message get a route, because
            // the client cannot tell which branch it is in: sign in if the account
            // was confirmed, enter the code if the resent confirmation just landed.
            <View style={styles.errorActions}>
              <Link
                href={redirectTo ? { pathname: '/login', params: { redirectTo } } : '/login'}
                style={styles.errorActionLink}
              >
                Sign in
              </Link>
              <Text style={styles.errorActionSeparator}>·</Text>
              <Link href="/verify-email" style={styles.errorActionLink}>
                Enter your code
              </Link>
            </View>
          ) : null}
        </View>
      ) : null}

      <AuthTextField
        placeholder="Nickname or username"
        value={nickname}
        onChangeText={handleNicknameChange}
        editable={!loading}
      />
      <Text style={styles.helperText}>This is how we will greet you in the customer app.</Text>

      <AuthTextField
        style={styles.fieldGap}
        placeholder="name@email.com"
        value={email}
        onChangeText={handleEmailChange}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        editable={!loading}
      />

      <AuthTextField
        style={styles.fieldGap}
        placeholder="Phone number"
        value={phoneNumber}
        onChangeText={handlePhoneNumberChange}
        keyboardType="phone-pad"
        editable={!loading}
      />
      <Text style={styles.helperText}>We use this for order updates and rider contact.</Text>

      <View style={styles.fieldGap}>
        <AuthPasswordField
          placeholder="Password"
          value={password}
          onChangeText={handlePasswordChange}
          editable={!loading}
          showHint
        />
      </View>
      <AuthPasswordField
        placeholder="Confirm password"
        value={confirmPassword}
        onChangeText={handleConfirmPasswordChange}
        editable={!loading}
      />

      <TouchableOpacity
        style={styles.policyRow}
        onPress={() => {
          setValidationError(null);
          setAcceptedPolicies((current) => !current);
        }}
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

      <AuthPrimaryButton
        label={loading ? 'Creating account...' : 'Sign Up with Email'}
        onPress={handleRegister}
        disabled={loading || !acceptedPolicies}
      />

      <AuthDivider label="or" />

      <GoogleSignInButton />

      <View style={styles.switchRow}>
        <Text style={styles.switchText}>Already have an account? </Text>
        <Link
          href={redirectTo ? { pathname: '/login', params: { redirectTo } } : '/login'}
          style={styles.switchLink}
        >
          Sign In
        </Link>
      </View>
    </AuthScreenShell>
  );
}

const styles = StyleSheet.create({
  errorBlock: {
    marginBottom: 14,
  },
  errorText: {
    color: customerTheme.danger,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  errorActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 8,
  },
  errorActionLink: {
    color: customerTheme.accentText,
    fontSize: 14,
    fontWeight: '800',
  },
  errorActionSeparator: {
    color: customerTheme.textMuted,
    fontSize: 14,
  },
  fieldGap: {
    marginTop: 10,
  },
  helperText: {
    color: customerTheme.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
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
  checkboxDot: {
    backgroundColor: customerTheme.textOnBrand,
    borderRadius: 999,
    height: 10,
    width: 10,
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
  switchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 14,
  },
  switchText: {
    color: customerTheme.textMuted,
    fontSize: 14,
  },
  switchLink: {
    color: customerTheme.accentText,
    fontSize: 14,
    fontWeight: '800',
  },
});
