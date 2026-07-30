import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Link, useLocalSearchParams } from 'expo-router';
import {
  Button,
  Input,
  Text,
  border,
  brand,
  space,
  status,
  surface,
  typeScale,
} from '@feasty/design-system';
import { useAuth } from '../../src/contexts/AuthContext';
import AuthPasswordField from '../../src/components/AuthPasswordField';
import AuthLegalFooter from '../../src/components/AuthLegalFooter';
import GoogleSignInButton from '../../src/components/GoogleSignInButton';

export default function LoginScreen() {
  const params = useLocalSearchParams<{ redirectTo?: string | string[] }>();
  const redirectTo = typeof params.redirectTo === 'string' ? params.redirectTo : undefined;
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
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text variant="title1" align="center" style={styles.title}>
        Login
      </Text>

      {error ? (
        <Text variant="body" align="center" style={styles.errorText}>
          {error}
        </Text>
      ) : null}

      <Input
        placeholder="Email"
        accessibilityLabel="Email"
        value={email}
        onChangeText={handleEmailChange}
        autoCapitalize="none"
        keyboardType="email-address"
        editable={!loading}
        containerStyle={styles.field}
      />

      <AuthPasswordField
        placeholder="Password"
        value={password}
        onChangeText={handlePasswordChange}
        editable={!loading}
        showHint
      />

      <Button
        label="Sign In"
        size="lg"
        fullWidth
        loading={loading}
        onPress={handleLogin}
        style={styles.submit}
      />

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text variant="callout" tone="secondary" style={styles.dividerText}>
          Or sign in with
        </Text>
        <View style={styles.dividerLine} />
      </View>

      <GoogleSignInButton />

      <Link
        href={redirectTo ? { pathname: '/register', params: { redirectTo } } : '/register'}
        style={styles.link}
      >
        Create an account
      </Link>
      <Link
        href={
          redirectTo
            ? { pathname: '/(auth)/forgot-password', params: { redirectTo } }
            : '/(auth)/forgot-password'
        }
        style={styles.link}
      >
        Forgot password?
      </Link>

      <AuthLegalFooter />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: surface.canvas,
    flex: 1,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: space.xl,
  },
  title: {
    marginBottom: space.xl,
  },
  errorText: {
    color: status.danger,
    marginBottom: space.lg,
  },
  field: {
    // The previous version left no gap here, so the email and password fields sat flush.
    marginBottom: space.md,
  },
  submit: {
    marginTop: space.lg,
    marginBottom: space.lg,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: space.xl,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth * 2,
    backgroundColor: border.subtle,
  },
  dividerText: {
    marginHorizontal: space.md,
  },
  link: {
    ...typeScale.body,
    marginTop: space.md,
    color: brand.primaryStrong,
    textAlign: 'center',
  },
});
