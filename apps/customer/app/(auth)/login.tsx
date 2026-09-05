import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Link, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../src/contexts/AuthContext';
import AuthPasswordField from '../../src/components/AuthPasswordField';
import AuthPrimaryButton from '../../src/components/AuthPrimaryButton';
import AuthScreenShell, { AuthDivider } from '../../src/components/AuthScreenShell';
import AuthTextField from '../../src/components/AuthTextField';
import GoogleSignInButton from '../../src/components/GoogleSignInButton';
import SuccessBanner from '../../src/components/SuccessBanner';
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

  const handleEmailChange = (value: string) => {
    if (error) clearError();
    setEmail(value);
  };

  const handlePasswordChange = (value: string) => {
    if (error) clearError();
    setPassword(value);
  };

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing information', 'Please enter both email and password');
      return;
    }

    try {
      await signIn(email.trim(), password);
    } catch (error: any) {
      Alert.alert('Login Failed', error.message);
    }
  };

  return (
    <AuthScreenShell title="Welcome back" subtitle="Sign in to keep ordering from nearby restaurants.">
      <SuccessBanner
        title={notice?.title}
        message={notice?.message}
        onDismiss={() => setDismissedNotice(true)}
      />

      {error && <Text style={styles.errorText}>{error}</Text>}

      <AuthTextField
        placeholder="name@email.com"
        value={email}
        onChangeText={handleEmailChange}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        editable={!loading}
      />
      <View style={styles.fieldGap}>
        <AuthPasswordField
          placeholder="Password"
          value={password}
          onChangeText={handlePasswordChange}
          editable={!loading}
          showHint
        />
      </View>

      <AuthPrimaryButton
        label={loading ? 'Signing in...' : 'Continue with Email'}
        onPress={handleLogin}
        disabled={loading}
      />

      <AuthDivider label="or" />

      <GoogleSignInButton />

      <View style={styles.switchRow}>
        <Text style={styles.switchText}>Don&apos;t have an account? </Text>
        <Link
          href={redirectTo ? { pathname: '/register', params: { redirectTo } } : '/register'}
          style={styles.switchLink}
        >
          Sign Up
        </Link>
      </View>

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
    </AuthScreenShell>
  );
}

const styles = StyleSheet.create({
  errorText: {
    color: customerTheme.danger,
    fontSize: 14,
    marginBottom: 14,
    textAlign: 'center',
  },
  fieldGap: {
    marginTop: 10,
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
    color: customerTheme.brandOrange,
    fontSize: 14,
    fontWeight: '800',
  },
  forgotLink: {
    color: customerTheme.link,
    marginTop: 12,
    textAlign: 'center',
  },
});
