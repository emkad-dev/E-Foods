import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { validateResetPasswordForm } from '../../src/domain/authFormValidation';
import { clearOtpCooldown, formatAuthError, verifyPasswordResetOtp } from '../../src/services/supabase/auth';
import { supabase } from '../../src/services/supabase/config';
import SuccessBanner from '../../src/components/SuccessBanner';
import { resolveSuccessNotice } from '../../src/utils/successNotices';
import { customerTheme } from '../../src/theme/palette';

const firstParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

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
 */
export default function ResetPasswordScreen() {
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
  const notice = dismissedNotice ? null : resolveSuccessNotice(params.notice);

  // Seeded from the param when forgot-password sent the user here, and still
  // editable: someone can land on /reset-password directly (a bookmark, or a
  // hard refresh that drops the param), and the old link flow was the only
  // thing that ever supplied the identity. Rather than dead-ending that user,
  // the field is always rendered — prefilled when we know the address, blank
  // when we do not — so a missing email is an ordinary empty form field the
  // validator asks them to fill, not a broken screen. It stays editable even
  // when prefilled so a typo on the previous screen is correctable here.
  const [email, setEmail] = useState(emailParam);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleResetPassword = async () => {
    // Client-side checks write into the same `error` slot the screen already
    // renders for server failures; they used to `Alert` and return, i.e. do
    // nothing at all on the web build.
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
      router.replace({
        pathname: '/login',
        params: { notice: 'password-updated', ...(redirectTo ? { redirectTo } : null) },
      } as never);
    } catch (err: any) {
      // `setError` alone: the slot above renders it. The `Alert` that used to
      // follow was a duplicate on native and silence on web.
      setError(formatAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const clearErrorAnd = (apply: (value: string) => void) => (value: string) => {
    setError(null);
    apply(value);
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Choose a new password</Text>
      <Text style={styles.copy}>
        Enter the 6-digit code we emailed you, then set a fresh password for your account.
      </Text>

      <SuccessBanner
        title={notice?.title}
        message={notice?.message}
        onDismiss={() => setDismissedNotice(true)}
      />

      {error ? (
        <Text accessibilityLiveRegion="assertive" role="alert" style={styles.errorText}>
          {error}
        </Text>
      ) : null}

      <TextInput
        style={styles.input}
        placeholder="name@email.com"
        placeholderTextColor={customerTheme.textMuted}
        value={email}
        onChangeText={clearErrorAnd(setEmail)}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        editable={!submitting}
        accessibilityLabel="Email address"
      />

      <TextInput
        style={styles.codeInput}
        placeholder="000000"
        placeholderTextColor={customerTheme.textMuted}
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
        placeholderTextColor={customerTheme.textMuted}
        value={password}
        onChangeText={clearErrorAnd(setPassword)}
        secureTextEntry
        editable={!submitting}
        accessibilityLabel="New password"
      />
      <TextInput
        style={styles.input}
        placeholder="Confirm new password"
        placeholderTextColor={customerTheme.textMuted}
        value={confirmPassword}
        onChangeText={clearErrorAnd(setConfirmPassword)}
        secureTextEntry
        editable={!submitting}
        accessibilityLabel="Confirm new password"
      />

      <TouchableOpacity style={styles.button} onPress={handleResetPassword} disabled={submitting}>
        <Text style={styles.buttonText}>{submitting ? 'Updating...' : 'Update password'}</Text>
      </TouchableOpacity>

      <Link
        href={
          redirectTo
            ? { pathname: '/(auth)/forgot-password', params: { redirectTo } }
            : '/(auth)/forgot-password'
        }
        style={styles.link}
      >
        Send me a new code
      </Link>

      <Link href={redirectTo ? { pathname: '/login', params: { redirectTo } } : '/login'} style={styles.link}>
        Back to login
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: customerTheme.background,
    flex: 1,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
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
    borderRadius: 10,
    borderWidth: 1,
    height: 50,
    marginBottom: 14,
    paddingHorizontal: 16,
    color: customerTheme.text,
  },
  codeInput: {
    backgroundColor: customerTheme.surfaceMuted,
    borderColor: customerTheme.border,
    borderRadius: 12,
    borderWidth: 1,
    color: customerTheme.text,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: 10,
    marginBottom: 14,
    paddingVertical: 14,
    textAlign: 'center',
  },
  button: {
    alignItems: 'center',
    backgroundColor: customerTheme.accent,
    borderRadius: 10,
    paddingVertical: 15,
  },
  buttonText: {
    color: customerTheme.textOnBrand,
    fontSize: 16,
    fontWeight: '700',
  },
  link: {
    color: customerTheme.link,
    marginTop: 18,
    textAlign: 'center',
  },
});
