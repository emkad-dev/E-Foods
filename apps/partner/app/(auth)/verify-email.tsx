import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { MIN_TAP_TARGET, radius } from '@feasty/design-system';
import { validateEmailCode, validateVerifyEmailForm } from '../../src/domain/authFormValidation';
import {
  formatAuthError,
  sendVerificationEmail,
  useOtpCooldown,
  verifyEmailOtp,
} from '../../src/services/supabase/auth';
import { supabase } from '../../src/services/supabase/config';
import { updateUserDocument } from '../../src/services/supabase/profile';
import { resolvePartnerSuccessNotice, type PartnerSuccessNoticeKey } from '../../src/utils/successNotices';
import { partnerTheme } from '../../src/theme/palette';
import { SCREEN_TITLE_SIZE, SCREEN_TITLE_WEIGHT } from '../../src/theme/screenChrome';

const firstParam = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Email confirmation is OTP-only. The confirmation email carries a 6-digit
 * code, not a link, so this screen reads no `access_token` / `refresh_token` /
 * `code` URL params and has no `exchangeCodeForSession` / `setSession` effect
 * running on mount. The code field below is the only path to a confirmed email.
 *
 * Unlike the customer app's equivalent this screen runs SIGNED OUT — partner
 * sign-up returns no session while confirmation is pending — so it cannot read
 * the address off `AuthContext`. The email field is therefore always rendered
 * and always editable, prefilled from the route param register sends it with.
 *
 * Mirrors `apps/customer/app/(auth)/verify-email.tsx`.
 */
export default function PartnerVerifyEmailScreen() {
  const params = useLocalSearchParams<{
    email?: string | string[];
    notice?: string | string[];
    redirectTo?: string | string[];
  }>();
  const router = useRouter();
  const redirectTo = useMemo(() => firstParam(params.redirectTo), [params.redirectTo]);
  const emailParam = useMemo(() => firstParam(params.email) ?? '', [params.email]);

  const [dismissedNotice, setDismissedNotice] = useState(false);
  const notice = dismissedNotice ? null : resolvePartnerSuccessNotice(params.notice);

  const [email, setEmail] = useState(emailParam);
  const [code, setCode] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Every resend costs a real email, so the control is throttled. This screen
  // runs signed out, so the address being throttled is whatever is in the email
  // field above -- retyping a different one is therefore not held behind the
  // previous address's timer. Read from storage on mount, which is what makes a
  // reload keep the countdown instead of clearing it.
  const resendCooldown = useOtpCooldown('signup', email);

  const handleConfirmCode = async () => {
    const invalid = validateVerifyEmailForm({ email, code });

    if (invalid) {
      setError(invalid);
      return;
    }

    setError(null);
    setInfo(null);
    setConfirming(true);

    try {
      await verifyEmailOtp(supabase, email.trim(), code);

      // Redeemed: this flow is over, so the resend timer for that address goes
      // with it.
      await resendCooldown.clear();

      // Confirming the code leaves a real session behind, which is what lets
      // this write land; the profile row mirrors the auth flag for the screens
      // that read it.
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user?.id) {
        await updateUserDocument(user.id, { emailVerified: true }).catch(() => undefined);
      }

      // That session outlives the confirmation and this flow ends at sign-in.
      await supabase.auth.signOut().catch(() => undefined);

      const noticeKey: PartnerSuccessNoticeKey = 'email-confirmed';
      router.replace({
        pathname: '/(auth)/login',
        params: { notice: noticeKey, ...(redirectTo ? { redirectTo } : null) },
      } as never);
    } catch (nextError: any) {
      // `setError` alone: the slot below renders it.
      setError(formatAuthError(nextError));
    } finally {
      setConfirming(false);
    }
  };

  const handleResend = async () => {
    if (!email.trim()) {
      setError('Enter the email address you signed up with, then ask for a new code.');
      return;
    }

    setError(null);
    setInfo(null);
    setResending(true);

    try {
      await sendVerificationEmail(supabase, email.trim());
      // Only after a send that actually happened: one that threw cost no email,
      // so the user must be able to try again immediately.
      await resendCooldown.markSent();
      setInfo('A new 6-digit code is on its way. Check your inbox.');
    } catch (nextError: any) {
      setError(formatAuthError(nextError));
    } finally {
      setResending(false);
    }
  };

  const clearFeedbackAnd = (apply: (value: string) => void) => (value: string) => {
    setError(null);
    setInfo(null);
    apply(value);
  };

  const codeIncomplete = Boolean(validateEmailCode({ value: code }));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Confirm your email</Text>
      <Text style={styles.copy}>
        Enter the 6-digit code we emailed you to confirm this partner account, then sign in to open your dashboard.
      </Text>

      {notice && !error && !info ? (
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

      {/* Not pressable -- nothing dismisses it -- so it keeps its own bottom
          spacing instead of borrowing the box above's. */}
      {info && !error ? (
        <Text accessibilityLiveRegion="polite" role="alert" style={[styles.noticeText, styles.noticeStandalone]}>
          {info}
        </Text>
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
        onChangeText={clearFeedbackAnd(setEmail)}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        editable={!confirming && !resending}
        accessibilityLabel="Partner email address"
      />

      <TextInput
        style={styles.codeInput}
        placeholder="000000"
        placeholderTextColor={partnerTheme.textSoft}
        value={code}
        onChangeText={clearFeedbackAnd((value) => setCode(value.replace(/\D/g, '').slice(0, 6)))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={6}
        editable={!confirming}
        accessibilityLabel="6-digit confirmation code"
      />

      <TouchableOpacity
        style={[styles.button, codeIncomplete ? styles.buttonDisabled : null]}
        onPress={handleConfirmCode}
        disabled={confirming || codeIncomplete}
      >
        <Text style={styles.buttonText}>{confirming ? 'Confirming...' : 'Confirm email'}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.secondaryButton, resendCooldown.isCoolingDown ? styles.buttonDisabled : null]}
        onPress={handleResend}
        // `isChecking` too: the stored timestamp is read asynchronously, and
        // until it comes back this control must not be pressable, or a reload
        // leaves a brief window where a send goes out mid-cooldown.
        disabled={resending || resendCooldown.isCoolingDown || resendCooldown.isChecking}
      >
        <Text style={styles.secondaryText}>
          {resending
            ? 'Sending...'
            : resendCooldown.isCoolingDown
              ? `Send a new code in ${resendCooldown.label}`
              : 'Send a new code'}
        </Text>
      </TouchableOpacity>

      {/* `asChild` so this is a real box rather than a run of inline text. A
          bare <Link> renders as Text, which react-native-web gives
          `display: inline`, and CSS ignores min-height on an inline box -- so
          the obvious fix does nothing. This was the 14pt default line box:
          20pt, directly under a 54pt button. */}
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
    marginBottom: 10,
  },
  copy: {
    color: partnerTheme.textMuted,
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 24,
  },
  // Bottom spacing moved onto whichever box wraps the message, because the
  // dismissible one now sits in a Pressable and the resend confirmation does
  // not. On the Pressable it halved to 8: centring a 20pt line in 44pt already
  // leaves about 12pt below it. Only `justifyContent` there -- `alignItems:
  // 'center'` would shrink-wrap and centre what is a left-aligned paragraph.
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
  noticeStandalone: {
    marginBottom: 16,
  },
  errorText: {
    color: partnerTheme.dangerText,
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
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
    marginBottom: 12,
    paddingVertical: 16,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    color: partnerTheme.textOnBrand,
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.background,
    borderColor: partnerTheme.accent,
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingVertical: 16,
  },
  secondaryText: {
    color: partnerTheme.accentStrong,
    fontSize: 15,
    fontWeight: '700',
  },
  // The spacing moved off the label and onto the box, and shrank from 24 to 8
  // rather than to 4: the 44pt box contributes about 12pt of air above the
  // label, so 8 holds roughly the deliberate gap this screen had after its two
  // stacked buttons, where the other screens only had one.
  linkPressable: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    minHeight: MIN_TAP_TARGET,
  },
  link: {
    color: partnerTheme.accentStrong,
    textAlign: 'center',
  },
});
