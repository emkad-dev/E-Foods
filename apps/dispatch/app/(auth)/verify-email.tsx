import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { validateEmailCode, validateVerifyEmailForm } from '../../src/domain/authFormValidation';
import { formatAuthError, sendVerificationEmail, verifyEmailOtp } from '../../src/services/supabase/auth';
import { supabase } from '../../src/services/supabase/config';
import { updateUserDocument } from '../../src/services/supabase/profile';
import { resolveDispatchSuccessNotice, type DispatchSuccessNoticeKey } from '../../src/utils/routeNotices';
import { dispatchTheme } from '../../src/theme/palette';

const firstParam = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Email confirmation is OTP-only. The confirmation email carries a 6-digit
 * code, not a link, so this screen reads no `access_token` / `refresh_token` /
 * `code` URL params and has no `exchangeCodeForSession` / `setSession` effect
 * running on mount. The code field below is the only path to a confirmed email.
 *
 * Unlike the customer app's equivalent this screen runs SIGNED OUT - dispatch
 * sign-up returns no session while confirmation is pending - so it cannot read
 * the address off `AuthContext`. The email field is therefore always rendered
 * and always editable, prefilled from the route param register sends it with.
 *
 * Mirrors `apps/customer/app/(auth)/verify-email.tsx`.
 */
export default function DispatchVerifyEmailScreen() {
  const params = useLocalSearchParams<{
    email?: string | string[];
    notice?: string | string[];
  }>();
  const router = useRouter();
  const emailParam = useMemo(() => firstParam(params.email) ?? '', [params.email]);

  const [dismissedNotice, setDismissedNotice] = useState(false);
  const notice = dismissedNotice ? null : resolveDispatchSuccessNotice(params.notice);

  const [email, setEmail] = useState(emailParam);
  const [code, setCode] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

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

      const noticeKey: DispatchSuccessNoticeKey = 'email-confirmed';
      router.replace({ pathname: '/(auth)/login', params: { notice: noticeKey } } as never);
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
        Enter the 6-digit code we emailed you to confirm this rider account, then sign in to finish your rider setup.
      </Text>

      {notice && !error && !info ? (
        <Text
          accessibilityLiveRegion="polite"
          role="alert"
          style={styles.noticeText}
          onPress={() => setDismissedNotice(true)}
        >
          {notice}
        </Text>
      ) : null}

      {info && !error ? (
        <Text accessibilityLiveRegion="polite" role="alert" style={styles.noticeText}>
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
        placeholder="Dispatch email"
        placeholderTextColor="#8e8e8e"
        value={email}
        onChangeText={clearFeedbackAnd(setEmail)}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        editable={!confirming && !resending}
        accessibilityLabel="Dispatch email address"
      />

      <TextInput
        style={styles.codeInput}
        placeholder="000000"
        placeholderTextColor="#8e8e8e"
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

      <TouchableOpacity style={styles.secondaryButton} onPress={handleResend} disabled={resending}>
        <Text style={styles.secondaryText}>{resending ? 'Sending...' : 'Send a new code'}</Text>
      </TouchableOpacity>

      <Link href="/(auth)/login" style={styles.link}>
        Back to sign in
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
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 10,
  },
  copy: {
    color: dispatchTheme.textMuted,
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 24,
  },
  noticeText: {
    color: dispatchTheme.accentStrong,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  errorText: {
    color: dispatchTheme.danger,
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
  },
  input: {
    backgroundColor: dispatchTheme.cream,
    borderColor: dispatchTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    color: dispatchTheme.text,
    height: 54,
    marginBottom: 14,
    paddingHorizontal: 16,
  },
  codeInput: {
    backgroundColor: dispatchTheme.cream,
    borderColor: dispatchTheme.border,
    borderRadius: 16,
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
    borderRadius: 18,
    marginBottom: 12,
    paddingVertical: 16,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.surface,
    borderColor: dispatchTheme.accent,
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 16,
  },
  secondaryText: {
    color: dispatchTheme.accentStrong,
    fontSize: 15,
    fontWeight: '700',
  },
  link: {
    color: dispatchTheme.accentStrong,
    marginTop: 24,
    textAlign: 'center',
  },
});
