import { useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useHeaderHeight } from '@react-navigation/elements';
import { FontAwesome } from '@expo/vector-icons';
import { MIN_TAP_TARGET, radius } from '@feasty/design-system';
import { useAuth } from '../../src/contexts/AuthContext';
import AuthPasswordField from '../../src/components/AuthPasswordField';
import AuthPrimaryButton from '../../src/components/AuthPrimaryButton';
import AuthScreenShell, { AuthScreenShellHandle } from '../../src/components/AuthScreenShell';
import AuthTextField from '../../src/components/AuthTextField';
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
  // The error surface is at the top of the card and "Create account" is below
  // six inputs and a consent row. Measured at 375x812, a failed submit put the
  // message 141px above the viewport: correct, announced, and invisible.
  // Called at the two points where this screen puts a message into that slot.
  const shellRef = useRef<AuthScreenShellHandle>(null);

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
      shellRef.current?.scrollToTop();
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
      // `error`, which the slot above renders. Scrolled to for the same reason
      // the validation branch above is -- and this branch matters most of the
      // two, because the already-registered message carries the only two links
      // out of the dead end it describes.
      shellRef.current?.scrollToTop();
    }
  };

  return (
    <AuthScreenShell
      ref={shellRef}
      title="Create your account"
      subtitle="Confirm your email, then start ordering from nearby restaurants."
      topInset={headerHeight}
    >
      <SuccessBanner
        title="Account created"
        message={pendingNotice}
        onDismiss={() => setPendingNotice(null)}
      />

      {/* The one error surface on this screen. Styled as the red sibling of
          `SuccessBanner` so a failure is as legible as a success, and left
          aligned: several of these messages run to two or three lines, which a
          centred paragraph makes measurably harder to read. */}
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

      {/* Six inputs and a consent row is a wall on a phone. It is still one
          screen and one submit -- nothing is hidden behind a step -- but the
          boxes are gathered into the two things they are actually about, so the
          eye gets two short lists rather than one long one. */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About you</Text>
        <View style={styles.sectionFields}>
          <AuthTextField
            label="Nickname"
            hint="This is how we'll greet you in the app."
            placeholder="What should we call you?"
            value={nickname}
            onChangeText={handleNicknameChange}
            editable={!loading}
          />

          <AuthTextField
            label="Email address"
            hint="Use a Gmail, Yahoo or iCloud address."
            placeholder="name@email.com"
            value={email}
            onChangeText={handleEmailChange}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            editable={!loading}
          />

          {/* The hint reads the number back in the form it will be stored and
              dialled in. There is no SMS code on this number, so this line is
              the only chance the customer gets to catch a transposed digit --
              and it doubles as the explanation for why a leading 0 turns into
              +234. It only appears once the number normalises; until then the
              field keeps the plain statement of what the number is for. */}
          <AuthTextField
            label="Phone number"
            hint={
              phoneConfirmation
                ? `We'll use ${phoneConfirmation.readable} (${phoneConfirmation.e164}) for order updates and rider contact. Check it before you continue.`
                : 'We use this for order updates and rider contact.'
            }
            placeholder="0803 123 4567"
            value={phoneNumber}
            onChangeText={handlePhoneNumberChange}
            keyboardType="phone-pad"
            editable={!loading}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Your password</Text>
        <View style={styles.sectionFields}>
          <AuthPasswordField
            label="Password"
            placeholder="Create a password"
            autoComplete="new-password"
            value={password}
            onChangeText={handlePasswordChange}
            editable={!loading}
            showHint
          />
          <AuthPasswordField
            label="Confirm password"
            placeholder="Type it once more"
            autoComplete="new-password"
            value={confirmPassword}
            onChangeText={handleConfirmPasswordChange}
            editable={!loading}
          />
        </View>
      </View>

      <TouchableOpacity
        accessibilityRole="checkbox"
        accessibilityState={{ checked: acceptedPolicies, disabled: loading }}
        style={styles.policyRow}
        onPress={() => {
          setValidationError(null);
          setAcceptedPolicies((current) => !current);
        }}
        activeOpacity={0.82}
        disabled={loading}
      >
        <View style={[styles.checkbox, acceptedPolicies ? styles.checkboxActive : null]}>
          {acceptedPolicies ? (
            <FontAwesome name="check" size={13} color={customerTheme.textOnBrand} />
          ) : null}
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

      {/* Pressable even with the box unticked. Disabling it made the last
          branch of `validateRegisterForm` -- "Accept the Terms and Privacy
          Policy before creating an account." -- unreachable, and left a greyed
          control that said nothing about why. Pressing it now routes that
          message into the error surface above like every other check. */}
      <AuthPrimaryButton
        label={loading ? 'Creating account...' : 'Create account'}
        onPress={handleRegister}
        disabled={loading}
      />

      <View style={styles.switchRow}>
        <Text style={styles.switchText}>Already have an account?</Text>
        <Link
          href={redirectTo ? { pathname: '/login', params: { redirectTo } } : '/login'}
          style={styles.switchLink}
        >
          Sign in
        </Link>
      </View>
    </AuthScreenShell>
  );
}

const styles = StyleSheet.create({
  errorBlock: {
    backgroundColor: customerTheme.dangerSoft,
    borderColor: customerTheme.danger,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: 16,
    padding: 14,
  },
  errorText: {
    color: customerTheme.dangerText,
    fontSize: 14,
    lineHeight: 20,
  },
  errorActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  // Same reason as every other link on these two screens: `Text` is
  // `display: inline` under react-native-web, so padding is the only thing
  // that grows the target. 2*12 + 20 clears the 44pt floor.
  errorActionLink: {
    color: customerTheme.accentText,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
    paddingVertical: 12,
  },
  errorActionSeparator: {
    color: customerTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    color: customerTheme.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  sectionFields: {
    gap: 16,
  },
  // 2pt in `textMuted` rather than 1pt in `border`: an empty box is the only
  // thing telling you the consent is outstanding, and at #c2d0ca on the card it
  // sat at 1.55:1 -- under the 3:1 WCAG 1.4.11 asks of a graphical control.
  // #54626f is 6.09:1, and the ticked state is the accent fill at 4.99:1.
  checkbox: {
    alignItems: 'center',
    borderColor: customerTheme.textMuted,
    borderRadius: radius.sm,
    borderWidth: 2,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  checkboxActive: {
    backgroundColor: customerTheme.accent,
    borderColor: customerTheme.accent,
  },
  policyLink: {
    color: customerTheme.link,
    fontWeight: '700',
  },
  // The same 20pt consent row partner and dispatch had. I fixed those two by
  // hand and never looked at customer's, which is the exact asymmetry this
  // whole sweep keeps turning up -- and the one app of the three whose signup
  // is open to the public.
  policyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: MIN_TAP_TARGET,
  },
  policyText: {
    color: customerTheme.text,
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  switchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 4,
  },
  switchText: {
    color: customerTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  switchLink: {
    color: customerTheme.link,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
});
