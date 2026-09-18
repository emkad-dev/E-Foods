import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { MIN_TAP_TARGET, radius } from '@feasty/design-system';
import { validateResetPasswordForm } from '../../src/domain/authFormValidation';
import { clearOtpCooldown, formatAuthError, verifyPasswordResetOtp } from '../../src/services/supabase/auth';
import { supabase } from '../../src/services/supabase/config';
import { resolvePartnerSuccessNotice, type PartnerSuccessNoticeKey } from '../../src/utils/successNotices';
import { partnerTheme } from '../../src/theme/palette';
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
export default function PartnerResetPasswordScreen() {
  const params = useLocalSearchParams<{
    email?: string | string[];
    notice?: string | string[];
    redirectTo?: string | string[];
  }>();
  const router = useRouter();
  const redirectTo = useMemo(() => firstParam(params.redirectTo), [params.redirectTo]);
  // The address is DATA, not a notice key, so it rides as its own param.
  const emailParam = useMemo(() => firstParam(params.email) ?? '', [params.email]);

  const [dismissedNotice, setDismissedNotice] = useState(false);
  const notice = dismissedNotice ? null : resolvePartnerSuccessNotice(params.notice);

  // Seeded from the param when forgot-password sent the partner here, and still
  // editable: someone can land on /reset-password directly (a bookmark, or a
  // hard refresh that drops the param), and the old link flow was the only
  // thing that ever supplied the identity. Rather than dead-ending that user,
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
    // Client-side validation used to go to `Alert`, an empty function on the
    // web build. This screen already owns a local `error` rendered inline
    // below, so these route into that same single surface.
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
      const noticeKey: PartnerSuccessNoticeKey = 'password-updated';
      router.replace({
        pathname: '/(auth)/login',
        params: { notice: noticeKey, ...(redirectTo ? { redirectTo } : null) },
      } as never);
    } catch (nextError: any) {
      // `setError` alone: it renders in the inline slot above.
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
      <Text style={styles.title}>Choose a new partner password</Text>
      <Text style={styles.copy}>
        Enter the 6-digit code we emailed you, then set a fresh password for your partner account.
      </Text>

      {notice && !error ? (
        // The dismiss used to hang off the <Text> itself, and Text is inline on
        // react-native-web: on the desktop build, where this message fits on
        // one line, the whole affordance was a 20pt strip. The Pressable
        // carries the target; the Text keeps the live region.
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
        placeholder="Partner email"
        placeholderTextColor={partnerTheme.textSoft}
        value={email}
        onChangeText={clearErrorAnd(setEmail)}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        editable={!submitting}
        accessibilityLabel="Partner email address"
      />

      <TextInput
        style={styles.codeInput}
        placeholder="000000"
        placeholderTextColor={partnerTheme.textSoft}
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
        placeholderTextColor={partnerTheme.textSoft}
        value={password}
        onChangeText={clearErrorAnd(setPassword)}
        secureTextEntry
        editable={!submitting}
        accessibilityLabel="New password"
      />
      <TextInput
        style={styles.input}
        placeholder="Confirm new password"
        placeholderTextColor={partnerTheme.textSoft}
        value={confirmPassword}
        onChangeText={clearErrorAnd(setConfirmPassword)}
        secureTextEntry
        editable={!submitting}
        accessibilityLabel="Confirm new password"
      />

      <TouchableOpacity style={styles.button} onPress={handleResetPassword} disabled={submitting}>
        <Text style={styles.buttonText}>{submitting ? 'Updating...' : 'Save new password'}</Text>
      </TouchableOpacity>

      {/* `asChild` so each of these is a real box rather than a run of inline
          text. A bare <Link> renders as Text, which react-native-web gives
          `display: inline`, and CSS ignores min-height on an inline box. Both
          were the 14pt default line box -- 20pt -- stacked 18pt apart, which
          is the case where padding alone makes things worse: it extends each
          hit region without pushing the line boxes apart, so the two overlap
          and the wrong one takes the tap. */}
      <Link
        href={
          redirectTo ? { pathname: '/(auth)/forgot-password', params: { redirectTo } } : '/(auth)/forgot-password'
        }
        asChild
      >
        <Pressable style={styles.linkPressable}>
          <Text style={styles.link}>Send me a new code</Text>
        </Pressable>
      </Link>

      <Link
        href={redirectTo ? { pathname: '/(auth)/login', params: { redirectTo } } : '/(auth)/login'}
        asChild
      >
        <Pressable style={styles.linkPressable}>
          <Text style={styles.link}>Back to sign in</Text>
        </Pressable>
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: partnerTheme.background,
    flex: 1,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: partnerTheme.text,
    fontSize: SCREEN_TITLE_SIZE,
    fontWeight: SCREEN_TITLE_WEIGHT,
    marginBottom: 8,
  },
  copy: {
    color: partnerTheme.textMuted,
    fontSize: 16,
    marginBottom: 24,
  },
  // Bottom spacing moved onto the box and halved, because the box centres a
  // 20pt line in 44pt and so already leaves about 12pt below the text. Only
  // `justifyContent` here: `alignItems: 'center'` would shrink-wrap the
  // message and centre it, and this one is a left-aligned paragraph.
  noticePressable: {
    justifyContent: 'center',
    marginBottom: 8,
    minHeight: MIN_TAP_TARGET,
  },
  noticeText: {
    color: partnerTheme.accentStrong,
    fontSize: 14,
    lineHeight: 20,
  },
  errorText: {
    color: partnerTheme.dangerText,
    marginBottom: 16,
    textAlign: 'center',
    fontSize: 14,
  },
  input: {
    backgroundColor: partnerTheme.cream,
    borderColor: partnerTheme.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    color: partnerTheme.text,
    height: 54,
    marginBottom: 14,
    paddingHorizontal: 16,
  },
  codeInput: {
    backgroundColor: partnerTheme.cream,
    borderColor: partnerTheme.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    color: partnerTheme.text,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 10,
    marginBottom: 14,
    paddingVertical: 14,
    textAlign: 'center',
  },
  button: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accent,
    borderRadius: radius.xl,
    paddingVertical: 16,
  },
  buttonText: {
    color: partnerTheme.textOnBrand,
    fontSize: 15,
    fontWeight: '800',
  },
  // The spacing moved off the labels and onto the boxes that now hold them,
  // and shrank from 18 to 4: each box centres its label in 44pt, so it already
  // carries about 12pt of air on either side.
  linkPressable: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    minHeight: MIN_TAP_TARGET,
  },
  link: {
    color: partnerTheme.accentStrong,
    textAlign: 'center',
  },
});
