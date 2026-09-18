import { useState } from 'react';
import { radius } from '../../../../packages/design-system/src/tokens/radius';
import { Link, useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PhoneInput } from '../../../../packages/auth/src/components/PhoneInput';
import AuthPasswordField from '../../src/components/AuthPasswordField';
import { useAuth } from '../../src/contexts/AuthContext';
import { validateRegisterForm } from '../../src/domain/authFormValidation';
import { ACCOUNT_ALREADY_REGISTERED_MESSAGE } from '../../src/services/supabase/auth';
import type { DispatchSuccessNoticeKey } from '../../src/utils/routeNotices';
import { dispatchTheme } from '../../src/theme/palette';
import { MIN_TAP_TARGET } from '../../../../packages/design-system/src/tokens/space';
import { SCREEN_TITLE_SIZE, SCREEN_TITLE_WEIGHT } from '../../src/theme/screenChrome';

export default function DispatchRegisterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { clearError, error, loading, signUp } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phoneE164, setPhoneE164] = useState<string | null>(null);
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);
  // Held locally and rendered through the same slot as `AuthContext`'s error —
  // see the note in login.tsx.
  const [validationError, setValidationError] = useState<string | null>(null);
  const formError = validationError ?? error;
  // Compared by identity against the shared constant rather than by matching
  // prose, so re-wording the message cannot silently drop the two routes out of
  // it. `validationError` is client-side only and never carries this text, so
  // only the context's `error` can light this up.
  const showAlreadyRegisteredRoutes = formError === ACCOUNT_ALREADY_REGISTERED_MESSAGE;

  const canSubmit = Boolean(displayName.trim() && email.trim() && password.trim() && phoneE164 && acceptedPolicies);

  const handleFieldChange = (setter: (value: string) => void) => (value: string) => {
    if (error) {
      clearError();
    }

    setValidationError(null);
    setter(value);
  };

  const handleRegister = async () => {
    const invalid = validateRegisterForm({ displayName, email, password, phoneE164, acceptedPolicies });

    if (invalid) {
      setValidationError(invalid);
      return;
    }

    setValidationError(null);

    try {
      const trimmedEmail = email.trim();
      const result = await signUp(trimmedEmail, password, {
        displayName: displayName.trim(),
        phoneNumber: phoneE164 ?? '',
      });

      // Both branches already navigated, so the confirmation travels with them
      // as a route param and the destination renders it. Hanging it off an
      // `Alert` was doubly wrong: under react-native-web the call is an empty
      // function, and even on native the `router.replace` on the next line
      // fires immediately, so the dialog lands on top of the screen the rider
      // has already been moved to.
      const noticeKey: DispatchSuccessNoticeKey = result.sessionPresent
        ? 'login-ready'
        : result.verificationEmailSent
          ? 'verification-email-sent'
          : 'verification-email-failed';

      // `signUp` puts "Verify your email, then sign in..." into `AuthContext`'s
      // `error` on the no-session path — a SUCCESS message stored in the error
      // channel, which the destination would otherwise render in red directly
      // above the green confirmation saying the same thing. Clearing it here
      // leaves one statement of what happened.
      clearError();

      if (result.sessionPresent) {
        router.replace({
          pathname: '/(dispatch)/complete-rider-details',
          params: { notice: noticeKey },
        } as never);
        return;
      }

      if (result.verificationEmailSent) {
        // Confirmation is OTP-only, so the next step is typing the 6-digit code
        // — which happens in the app, not in the inbox. Go straight to the code
        // screen, carrying the address as its own data param so the rider does
        // not retype it (and so the resend button there has an address to work
        // with). Without this, /verify-email would be reachable only by typing
        // its URL, now that the emailed link is gone.
        router.replace({
          pathname: '/(auth)/verify-email',
          params: { notice: noticeKey, email: trimmedEmail },
        } as never);
        return;
      }

      router.replace({ pathname: '/(auth)/login', params: { notice: noticeKey } } as never);
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
          <Text style={styles.eyebrow}>FEASTY Dispatch</Text>
          <Text style={styles.title}>Create your rider login</Text>
          <Text style={styles.copy}>
            We’ll set up your login first. After you confirm your email, complete your dispatch area and vehicle
            details from the rider setup screen.
          </Text>
        </View>

        <View style={styles.card}>
          {formError ? (
            <View style={styles.errorBlock}>
              <Text accessibilityLiveRegion="assertive" role="alert" style={styles.errorText}>
                {formError}
              </Text>
              {showAlreadyRegisteredRoutes ? (
                // Both branches of the already-registered message get a route, because
                // the client cannot tell which branch it is in: sign in if the account
                // was confirmed, enter the code if the resent confirmation just landed.
                // The address rides along so the code screen — which runs signed out —
                // does not make the rider retype it.
                //
                // These two are a row of siblings, not words inside the
                // message above, so each can become a box without touching a
                // sentence. Both were the 14pt line box: 20pt, on the only
                // route out of an account that already exists.
                <View style={styles.errorActions}>
                  <Link href="/(auth)/login" asChild>
                    <Pressable style={styles.errorActionPressable}>
                      <Text style={styles.errorActionLink}>Sign in</Text>
                    </Pressable>
                  </Link>
                  <Text style={styles.errorActionSeparator}>·</Text>
                  <Link
                    href={{ pathname: '/(auth)/verify-email', params: { email: email.trim() } }}
                    asChild
                  >
                    <Pressable style={styles.errorActionPressable}>
                      <Text style={styles.errorActionLink}>Enter your code</Text>
                    </Pressable>
                  </Link>
                </View>
              ) : null}
            </View>
          ) : null}

          <TextInput
            style={styles.input}
            placeholder="Full name"
            placeholderTextColor={dispatchTheme.textSoft}
            value={displayName}
            onChangeText={handleFieldChange(setDisplayName)}
            editable={!loading}
          />
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={dispatchTheme.textSoft}
            keyboardType="email-address"
            autoCapitalize="none"
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
              theme={dispatchTheme}
              editable={!loading}
              onChange={({ e164 }) => {
                if (error) {
                  clearError();
                }
                setValidationError(null);
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
              <Link href="./terms" style={styles.policyLink}>
                Terms
              </Link>{' '}
              and{' '}
              <Link href="./privacy" style={styles.policyLink}>
                Privacy Policy
              </Link>
              .
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, !canSubmit ? styles.buttonDisabled : null]}
            onPress={handleRegister}
            disabled={loading || !canSubmit}
          >
            <Text style={styles.buttonText}>{loading ? 'Creating login...' : 'Create login'}</Text>
          </TouchableOpacity>

          {/* `asChild` so the link is a real box rather than a run of inline
              text: a bare <Link> renders as Text, which react-native-web gives
              `display: inline`, and CSS ignores min-height on an inline box.
              This was the 14pt default line box: 20pt. */}
          <Link href="/(auth)/login" asChild>
            <Pressable style={styles.linkPressable}>
              <Text style={styles.link}>Already have a login? Sign in</Text>
            </Pressable>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: dispatchTheme.background,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    justifyContent: 'center',
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
    fontSize: SCREEN_TITLE_SIZE,
    fontWeight: SCREEN_TITLE_WEIGHT,
  },
  copy: {
    color: dispatchTheme.textOnInverseMuted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  card: {
    backgroundColor: dispatchTheme.surface,
    borderColor: dispatchTheme.border,
    borderRadius: radius['2xl'],
    borderWidth: 1,
    marginTop: 16,
    padding: 20,
  },
  errorBlock: {
    marginBottom: 10,
  },
  errorText: {
    color: dispatchTheme.dangerText,
    fontSize: 14,
    lineHeight: 20,
  },
  // The 8pt gap under the message moved into the boxes: each one now holds
  // 12pt of air above its label, so keeping the margin as well would have
  // pushed the two routes further from the error that offers them.
  errorActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  // `minWidth` as well as `minHeight`, unlike the full-width links elsewhere
  // on these screens: these two sit side by side and size to their labels, and
  // "Sign in" is about 45pt of text -- a target that is only accidentally wide
  // enough, and would stop being so the moment the wording got shorter.
  errorActionPressable: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    minWidth: MIN_TAP_TARGET,
  },
  errorActionLink: {
    color: dispatchTheme.accentStrong,
    fontSize: 14,
    fontWeight: '700',
  },
  errorActionSeparator: {
    color: dispatchTheme.textMuted,
    fontSize: 14,
  },
  input: {
    backgroundColor: dispatchTheme.cream,
    borderColor: dispatchTheme.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    color: dispatchTheme.text,
    fontSize: 15,
    marginTop: 14,
    minHeight: 54,
    paddingHorizontal: 16,
  },
  phoneField: {
    marginTop: 14,
  },
  // The one control on this screen carrying no padding of its own, so its
  // height was only ever whatever the tallest child came out at: the 22pt
  // checkbox while the sentence fits a line, 40pt (2 x the copy's lineHeight
  // 20) once it wraps. Neither reaches the floor, and this is the row that
  // gates the whole form -- nothing can be submitted until it is pressed. The
  // floor goes on the row rather than on either child because `alignItems`
  // already centres both, so the checkbox and the copy do not move.
  policyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 18,
    minHeight: MIN_TAP_TARGET,
  },
  policyRowMuted: {
    opacity: 0.94,
  },
  checkbox: {
    alignItems: 'center',
    borderColor: dispatchTheme.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 22,
    justifyContent: 'center',
    marginRight: 12,
    width: 22,
  },
  checkboxActive: {
    backgroundColor: dispatchTheme.accent,
    borderColor: dispatchTheme.accent,
  },
  checkboxDot: {
    backgroundColor: dispatchTheme.textOnBrand,
    borderRadius: radius.pill,
    height: 10,
    width: 10,
  },
  policyText: {
    color: dispatchTheme.textMuted,
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  policyLink: {
    color: dispatchTheme.accentStrong,
    fontWeight: '700',
  },
  button: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.accent,
    borderRadius: radius.xl,
    marginTop: 18,
    paddingVertical: 16,
  },
  buttonDisabled: {
    opacity: 0.72,
  },
  buttonText: {
    color: dispatchTheme.textOnBrand,
    fontSize: 15,
    fontWeight: '800',
  },
  // The 16pt margin moved off the label and onto the box, and shrank: a 44pt
  // box already carries 12pt of air above a 20pt label, so keeping 16 on top
  // would have pushed the only route back to sign-in down the screen.
  linkPressable: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    minHeight: MIN_TAP_TARGET,
  },
  link: {
    color: dispatchTheme.accentStrong,
    textAlign: 'center',
  },
});
