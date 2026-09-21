import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Link, useLocalSearchParams } from 'expo-router';
import { radius } from '@feasty/design-system';
import { useAuth } from '../../src/contexts/AuthContext';
import AuthPasswordField from '../../src/components/AuthPasswordField';
import AuthPrimaryButton from '../../src/components/AuthPrimaryButton';
import AuthScreenShell, { AuthScreenShellHandle } from '../../src/components/AuthScreenShell';
import AuthTextField from '../../src/components/AuthTextField';
import SuccessBanner from '../../src/components/SuccessBanner';
import { validateLoginForm } from '../../src/domain/authFormValidation';
import { resolveSuccessNotice } from '../../src/utils/successNotices';
import { customerTheme } from '../../src/theme/palette';

export default function LoginScreen() {
  const params = useLocalSearchParams<{ redirectTo?: string | string[]; notice?: string | string[] }>();
  const redirectTo = typeof params.redirectTo === 'string' ? params.redirectTo : undefined;
  const [dismissedNotice, setDismissedNotice] = useState(false);
  const notice = dismissedNotice ? null : resolveSuccessNotice(params.notice);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { signIn, loading, error, clearError } = useAuth();
  // Client-side validation used to go to `Alert`, which is an empty function on
  // the web build, so an empty submit looked like a dead button. It is held
  // locally because `AuthContext` exposes no setter, and rendered through the
  // SAME slot as the context's `error` below, so the screen keeps exactly one
  // error surface.
  const [validationError, setValidationError] = useState<string | null>(null);
  const formError = validationError ?? error;
  // The error surface is at the top of the card and the button is below the
  // form. Called at the two points where this screen puts a message into that
  // slot, so the message is on screen rather than merely rendered.
  const shellRef = useRef<AuthScreenShellHandle>(null);

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

  const handleLogin = async () => {
    const invalid = validateLoginForm({ email, password });

    if (invalid) {
      setValidationError(invalid);
      shellRef.current?.scrollToTop();
      return;
    }

    setValidationError(null);

    try {
      await signIn(email.trim(), password);
    } catch {
      // `signIn` has already pushed the formatted message into `AuthContext`'s
      // `error`, which the slot above renders; the dead `Alert` that used to
      // sit here added nothing on native and nothing at all on web. Scrolled to
      // for the same reason the validation branch above is: a rejected sign-in
      // is only useful if the reason is somewhere the person can see it.
      shellRef.current?.scrollToTop();
    }
  };

  return (
    <AuthScreenShell
      ref={shellRef}
      title="Welcome back"
      subtitle="Sign in to keep ordering from nearby restaurants."
    >
      <SuccessBanner
        title={notice?.title}
        message={notice?.message}
        onDismiss={() => setDismissedNotice(true)}
      />

      {/* The one error surface on this screen: client-side validation and
          `AuthContext`'s own message both arrive here. Styled as the red sibling
          of `SuccessBanner` so a failure is as legible as a success, and left
          aligned because a centred paragraph is harder to read than one that
          starts where the eye already is. */}
      {formError ? (
        <View style={styles.errorBlock}>
          <Text accessibilityLiveRegion="assertive" role="alert" style={styles.errorText}>
            {formError}
          </Text>
        </View>
      ) : null}

      <View style={styles.form}>
        <AuthTextField
          label="Email address"
          placeholder="name@email.com"
          value={email}
          onChangeText={handleEmailChange}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          editable={!loading}
        />
        <AuthPasswordField
          label="Password"
          placeholder="Enter your password"
          autoComplete="current-password"
          value={password}
          onChangeText={handlePasswordChange}
          editable={!loading}
        />
      </View>

      {/* Sits with the password box it is about rather than below the button,
          which is where it ended up when the Google button was the thing
          separating them. */}
      <View style={styles.forgotRow}>
        <Link
          href={
            redirectTo
              ? { pathname: '/(auth)/forgot-password', params: { redirectTo } }
              : '/(auth)/forgot-password'
          }
          style={styles.forgotLink}
        >
          Forgot password?
        </Link>
      </View>

      <AuthPrimaryButton
        label={loading ? 'Signing in...' : 'Sign in'}
        onPress={handleLogin}
        disabled={loading}
      />

      <View style={styles.switchRow}>
        <Text style={styles.switchText}>Don&apos;t have an account?</Text>
        <Link
          href={redirectTo ? { pathname: '/register', params: { redirectTo } } : '/register'}
          style={styles.switchLink}
        >
          Sign up
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
  form: {
    gap: 16,
  },
  forgotRow: {
    alignItems: 'flex-end',
  },
  // `Text` is `display: inline` under react-native-web, so `minHeight` on a
  // link is ignored and `hitSlop` is inert there. Padding is what actually
  // grows the box: 2*12 + 20 clears the 44pt floor on both targets.
  forgotLink: {
    color: customerTheme.link,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
    paddingVertical: 12,
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
