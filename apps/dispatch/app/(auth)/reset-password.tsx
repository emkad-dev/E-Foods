import { useMemo, useState } from 'react';
import { radius } from '../../../../packages/design-system/src/tokens/radius';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { validateResetPasswordForm } from '../../src/domain/authFormValidation';
import { clearOtpCooldown, formatAuthError, verifyPasswordResetOtp } from '../../src/services/supabase/auth';
import { supabase } from '../../src/services/supabase/config';
import { resolveDispatchSuccessNotice, type DispatchSuccessNoticeKey } from '../../src/utils/routeNotices';
import { dispatchTheme } from '../../src/theme/palette';
import { MIN_TAP_TARGET } from '../../../../packages/design-system/src/tokens/space';
import { SCREEN_TITLE_SIZE, SCREEN_TITLE_WEIGHT } from '../../src/theme/screenChrome';

const firstParam = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Password reset is OTP-only. The recovery email carries a 6-digit code, not a
 * link, so this screen no longer reads `access_token` / `refresh_token` / `code`
 * out of the URL and never calls `exchangeCodeForSession` or `setSession`.
 *
 * Redeeming the code is a TWO-STEP operation, and both steps happen here:
 *   1. `verifyPasswordResetOtp` trades (email, code) for a real session.
 *   2. `supabase.auth.updateUser({ password })` writes the new password,
 *      authorised by that session.
 * A failure of either leaves the password unchanged, so both are inside one
 * try block and report through the single `error` slot below.
 *
 * Mirrors `apps/customer/app/(auth)/reset-password.tsx`.
 */
export default function DispatchResetPasswordScreen() {
  const params = useLocalSearchParams<{
    email?: string | string[];
    notice?: string | string[];
  }>();
  const router = useRouter();
  // The address is DATA, not a notice key, so it rides as its own param.
  const emailParam = useMemo(() => firstParam(params.email) ?? '', [params.email]);

  const [dismissedNotice, setDismissedNotice] = useState(false);
  const notice = dismissedNotice ? null : resolveDispatchSuccessNotice(params.notice);

  // Seeded from the param when forgot-password sent the rider here, and still
  // editable: someone can land on /reset-password directly (a bookmark, or a
  // hard refresh that drops the param), and the old link flow was the only
  // thing that ever supplied the identity. Rather than dead-ending that rider,
  // the field is always rendered - prefilled when we know the address, blank
  // when we do not - so a missing email is an ordinary empty form field the
  // validator asks them to fill, not a broken screen. It stays editable even
  // when prefilled so a typo on the previous screen is correctable here.
  const [email, setEmail] = useState(emailParam);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleResetPassword = async () => {
    // Every check used to `Alert.alert` and return, leaving this screen's own
    // `error` slot - already rendered below for submit failures - empty. They
    // report through it, so there is one error surface here.
    const invalid = validateResetPasswordForm({
      email,
      code,
      password,
      confirmPassword,
    });

    if (invalid) {
      setError(invalid);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // Step 1: the code buys a session.
      await verifyPasswordResetOtp(supabase, email.trim(), code);
      // Step 2: that session authorises the password write.
      const updateResult = await supabase.auth.updateUser({ password });
      if (updateResult.error) {
        throw updateResult.error;
      }

      // The code has been redeemed and the password is written, so this flow is
      // finished: drop the cooldown rather than hold a timer against someone who
      // may legitimately need a second reset straight away (a mistyped new
      // password is the ordinary case).
      await clearOtpCooldown('recovery', email.trim());

      // The recovery session outlives the update, and this flow ends at login.
      await supabase.auth.signOut().catch(() => undefined);
      const noticeKey: DispatchSuccessNoticeKey = 'password-updated';
      router.replace({
        pathname: '/(auth)/login',
        params: { notice: noticeKey },
      } as never);
    } catch (nextError: any) {
      // `setError` alone: the slot below already renders it.
      setError(formatAuthError(nextError));
    } finally {
      setSubmitting(false);
    }
  };

  const clearErrorAnd = (apply: (value: string) => void) => (value: string) => {
    setError(null);
    apply(value);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Choose a new dispatch password</Text>
      <Text style={styles.copy}>
        Enter the 6-digit code we emailed you, then set a fresh password for your dispatch account.
      </Text>

      {notice && !error ? (
        // Dismissing used to be an `onPress` hung on the paragraph itself: a
        // 14pt/20pt line box, so a 20pt target when the notice fits one line
        // and 40pt when it wraps -- under the floor either way. The press and
        // the geometry moved to a box around it; the wording is untouched,
        // and so is the live-region announcement, which stays on the Text.
        <Pressable style={styles.noticePressable} onPress={() => setDismissedNotice(true)}>
          <Text accessibilityLiveRegion="polite" role="alert" style={styles.noticeText}>
            {notice}
          </Text>
        </Pressable>
      ) : null}

      {error ? (
        <Text accessibilityLiveRegion="assertive" role="alert" style={styles.errorText}>
          {error}
        </Text>
      ) : null}

      <TextInput
        style={styles.input}
        placeholder="Dispatch email"
        placeholderTextColor={dispatchTheme.textSoft}
        value={email}
        onChangeText={clearErrorAnd(setEmail)}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        editable={!submitting}
        accessibilityLabel="Dispatch email address"
      />

      <TextInput
        style={styles.codeInput}
        placeholder="000000"
        placeholderTextColor={dispatchTheme.textSoft}
        value={code}
        onChangeText={clearErrorAnd((value) => setCode(value.replace(/\D/g, '').slice(0, 6)))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={6}
        editable={!submitting}
        accessibilityLabel="6-digit reset code"
      />

      <TextInput
        style={styles.input}
        placeholder="New password"
        placeholderTextColor={dispatchTheme.textSoft}
        value={password}
        onChangeText={clearErrorAnd(setPassword)}
        secureTextEntry
        editable={!submitting}
        accessibilityLabel="New password"
      />
      <TextInput
        style={styles.input}
        placeholder="Confirm new password"
        placeholderTextColor={dispatchTheme.textSoft}
        value={confirmPassword}
        onChangeText={clearErrorAnd(setConfirmPassword)}
        secureTextEntry
        editable={!submitting}
        accessibilityLabel="Confirm new password"
      />

      <TouchableOpacity style={styles.button} onPress={handleResetPassword} disabled={submitting}>
        <Text style={styles.buttonText}>{submitting ? 'Updating...' : 'Update password'}</Text>
      </TouchableOpacity>

      {/* `asChild` so each link is a real box instead of a run of inline
          text. A bare <Link> renders as Text, which react-native-web gives
          `display: inline`: CSS ignores min-height on an inline box, and
          padding on one stretches the hit region without pushing the line
          boxes apart -- so two links 18pt apart would have ended up with
          overlapping targets and the wrong one taking the tap. Each was the
          14pt default line box: 20pt. */}
      <Link href="/(auth)/forgot-password" asChild>
        <Pressable style={styles.linkPressable}>
          <Text style={styles.link}>Send me a new code</Text>
        </Pressable>
      </Link>

      <Link href="/(auth)/login" asChild>
        <Pressable style={styles.linkPressable}>
          <Text style={styles.link}>Back to sign in</Text>
        </Pressable>
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: dispatchTheme.background,
    flex: 1,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: dispatchTheme.text,
    fontSize: SCREEN_TITLE_SIZE,
    fontWeight: SCREEN_TITLE_WEIGHT,
    marginBottom: 8,
  },
  copy: {
    color: dispatchTheme.textMuted,
    fontSize: 16,
    marginBottom: 24,
  },
  // Geometry only -- the notice's own colour and 16pt gap stay on the Text,
  // so the paragraph reads exactly as it did and only the press area grew.
  noticePressable: {
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
  },
  noticeText: {
    color: dispatchTheme.accentStrong,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  errorText: {
    color: dispatchTheme.dangerText,
    marginBottom: 16,
    textAlign: 'center',
    fontSize: 14,
  },
  input: {
    backgroundColor: dispatchTheme.cream,
    borderColor: dispatchTheme.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    color: dispatchTheme.text,
    height: 54,
    marginBottom: 14,
    paddingHorizontal: 16,
  },
  codeInput: {
    backgroundColor: dispatchTheme.cream,
    borderColor: dispatchTheme.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    color: dispatchTheme.text,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 10,
    marginBottom: 14,
    paddingVertical: 14,
    textAlign: 'center',
  },
  button: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.accent,
    borderRadius: radius.xl,
    paddingVertical: 16,
  },
  buttonText: {
    color: dispatchTheme.textOnBrand,
    fontSize: 15,
    fontWeight: '800',
  },
  // The 18pt margin moved off the labels and onto the boxes, and shrank: each
  // 44pt box already holds 12pt of air above and below its 20pt label, so
  // keeping 18 as well would have pushed both links a thumb's width apart.
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
