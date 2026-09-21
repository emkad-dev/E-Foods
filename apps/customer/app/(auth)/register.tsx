import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useHeaderHeight } from '@react-navigation/elements';
import { MIN_TAP_TARGET, radius } from '@feasty/design-system';
import { useAuth } from '../../src/contexts/AuthContext';
import AuthPasswordField from '../../src/components/AuthPasswordField';
import AuthPrimaryButton from '../../src/components/AuthPrimaryButton';
import AuthScreenShell, { AuthDivider } from '../../src/components/AuthScreenShell';
import AuthTextField from '../../src/components/AuthTextField';
import GoogleSignInButton from '../../src/components/GoogleSignInButton';
import SuccessBanner from '../../src/components/SuccessBanner';
import {
  describePhoneForConfirmation,
  normalizeProfilePhoneNumber,
  validateRegisterForm,
} from '../../src/domain/authFormValidation';
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
  // `null` until the number is one we can actually store, which is what keeps
  // the readback below from quoting a half-typed number back at someone
  // mid-keystroke.
  const phoneConfirmation = describePhoneForConfirmation(phoneNumber);

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
    const trimmedEmail = email.trim();
    // The dialable form, never the typed spacing -- the same rule the profile
    // editor follows, so "0803 123 4567" and "+234 803 123 4567" do not become
    // two different numbers for the same person. `validateRegisterForm` above
    // has already rejected anything that will not normalise; the fallback only
    // keeps this from silently sending an empty string if that ever changes.
    const phoneE164 = normalizeProfilePhoneNumber(phoneNumber) ?? phoneNumber.trim();

    try {
      const { verificationEmailSent } = await signUp(trimmedEmail, password, {
        displayName: nickname.trim(),
        phoneNumber: phoneE164,
        policyAcceptance: buildCustomerPolicyAcceptance('customer_signup'),
      });

      if (verificationEmailSent) {
        // Straight to the code screen, not to /login. Confirmation is OTP-only,
        // so the next thing that happens is typing the 6-digit code -- and it
        // happens in the app. Sending the new customer to sign-in instead put
        // them in front of a form that CANNOT let them in while the address is
        // unconfirmed, with the code screen reachable only by typing its URL.
        // The address rides along as its own param so it is not retyped and so
        // the resend button there has something to send to.
        router.replace({
          pathname: '/(auth)/verify-email',
          params: {
            notice: 'account-created',
            email: trimmedEmail,
            ...(redirectTo ? { redirectTo } : null),
          },
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
              <Link
                href={{ pathname: '/(auth)/verify-email', params: { email: email.trim() } }}
                style={styles.errorActionLink}
              >
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
      {/* Reads the number back in the form it will be stored and dialled in.
          There is no SMS code on this number, so this line is the only chance
          the customer gets to catch a transposed digit -- and it doubles as
          the explanation for why a leading 0 turns into +234. */}
      {phoneConfirmation ? (
        <Text style={styles.helperText}>
          {`We'll use ${phoneConfirmation.readable} (${phoneConfirmation.e164}) for order updates and rider contact. Check it before you continue.`}
        </Text>
      ) : (
        <Text style={styles.helperText}>We use this for order updates and rider contact.</Text>
      )}

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

      <GoogleSignInButton redirectTo={redirectTo} />

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
    color: customerTheme.dangerText,
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
    borderRadius: radius.sm,
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
    borderRadius: radius.pill,
    height: 10,
    width: 10,
  },
  policyLink: {
    color: customerTheme.link,
    fontWeight: '800',
  },
  // The same 20pt consent row partner and dispatch had. I fixed those two by
  // hand and never looked at customer's, which is the exact asymmetry this
  // whole sweep keeps turning up -- and the one app of the three whose signup
  // is open to the public.
  policyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    minHeight: MIN_TAP_TARGET,
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
