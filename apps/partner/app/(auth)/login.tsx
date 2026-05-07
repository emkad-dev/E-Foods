import { Link } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/contexts/AuthContext';
import { partnerTheme } from '../../src/theme/palette';

export default function PartnerLoginScreen() {
  const insets = useSafeAreaInsets();
  const { clearError, error, loading, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleEmailChange = (value: string) => {
    if (error) {
      clearError();
    }

    setEmail(value);
  };

  const handlePasswordChange = (value: string) => {
    if (error) {
      clearError();
    }

    setPassword(value);
  };

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing information', 'Enter both email and password to continue.');
      return;
    }

    try {
      await signIn(email.trim(), password);
    } catch (nextError: any) {
      Alert.alert('Sign in failed', nextError.message ?? 'Unable to sign in right now.');
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28 }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>E-Foods Partner</Text>
        <Text style={styles.title}>Restaurant sign in</Text>
        <Text style={styles.copy}>
          Use your restaurant operations account to manage orders, menu updates, and store performance.
        </Text>
      </View>

      <View style={styles.formCard}>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <TextInput
          style={styles.input}
          placeholder="Partner email"
          placeholderTextColor="#8e8e8e"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={handleEmailChange}
          editable={!loading}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#8e8e8e"
          secureTextEntry
          value={password}
          onChangeText={handlePasswordChange}
          editable={!loading}
        />

        <TouchableOpacity style={styles.primaryButton} onPress={handleLogin} disabled={loading}>
          <Text style={styles.primaryButtonText}>{loading ? 'Signing in...' : 'Enter partner app'}</Text>
        </TouchableOpacity>

        <Link href="/(auth)/register" style={styles.link}>
          Need a partner account? Sign up
        </Link>
        <Link href="/(auth)/forgot-password" style={styles.linkSecondary}>
          Forgot password?
        </Link>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: partnerTheme.background,
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  hero: {
    backgroundColor: partnerTheme.hero,
    borderColor: partnerTheme.hero,
    borderRadius: 28,
    borderWidth: 1,
    padding: 24,
  },
  eyebrow: {
    color: partnerTheme.heroSoft,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  title: {
    color: '#fffdf8',
    fontSize: 31,
    fontWeight: '800',
  },
  copy: {
    color: '#e7dbc7',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  formCard: {
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: 26,
    borderWidth: 1,
    marginTop: 16,
    padding: 20,
  },
  errorText: {
    color: partnerTheme.danger,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  input: {
    backgroundColor: partnerTheme.cream,
    borderColor: partnerTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    color: partnerTheme.text,
    fontSize: 15,
    marginTop: 14,
    minHeight: 54,
    paddingHorizontal: 16,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accent,
    borderRadius: 18,
    marginTop: 18,
    paddingVertical: 16,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  link: {
    color: partnerTheme.accentStrong,
    marginTop: 16,
    textAlign: 'center',
  },
  linkSecondary: {
    color: partnerTheme.textMuted,
    marginTop: 12,
    textAlign: 'center',
  },
});
