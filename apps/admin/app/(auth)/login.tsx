import { Link } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/contexts/AuthContext';
import { adminTheme } from '../../src/theme/palette';

export default function AdminLoginScreen() {
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
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28, paddingTop: insets.top + 28 }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>E-Foods Admin</Text>
        <Text style={styles.title}>Company control center</Text>
        <Text style={styles.copy}>
          Use your internal admin account to review restaurants, monitor platform access, and keep operations clean.
        </Text>
      </View>

      <View style={styles.formCard}>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <TextInput
          style={styles.input}
          placeholder="Admin email"
          placeholderTextColor={adminTheme.textMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={handleEmailChange}
          editable={!loading}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={adminTheme.textMuted}
          secureTextEntry
          value={password}
          onChangeText={handlePasswordChange}
          editable={!loading}
        />

        <TouchableOpacity style={styles.primaryButton} onPress={handleLogin} disabled={loading}>
          <Text style={styles.primaryButtonText}>{loading ? 'Signing in...' : 'Enter admin app'}</Text>
        </TouchableOpacity>

        <Link href="/(auth)/register" style={styles.link}>
          Need admin access?
        </Link>
        <Link href={'/(auth)/bootstrap' as never} style={styles.linkSecondary}>
          Bootstrap first admin
        </Link>
        <Link href="/(auth)/forgot-password" style={styles.linkTertiary}>
          Forgot password?
        </Link>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: adminTheme.background,
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  hero: {
    backgroundColor: adminTheme.hero,
    borderColor: adminTheme.accentStrong,
    borderRadius: 28,
    borderWidth: 1,
    padding: 24,
  },
  eyebrow: {
    color: adminTheme.accentSoft,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  title: {
    color: '#ffffff',
    fontSize: 31,
    fontWeight: '800',
  },
  copy: {
    color: '#d7e3f3',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  formCard: {
    backgroundColor: adminTheme.surface,
    borderColor: adminTheme.border,
    borderRadius: 26,
    borderWidth: 1,
    marginTop: 16,
    padding: 20,
  },
  errorText: {
    color: adminTheme.danger,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  input: {
    backgroundColor: adminTheme.cream,
    borderColor: adminTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    color: adminTheme.text,
    fontSize: 15,
    marginTop: 14,
    minHeight: 54,
    paddingHorizontal: 16,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: adminTheme.accent,
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
    color: adminTheme.accentStrong,
    marginTop: 16,
    textAlign: 'center',
  },
  linkSecondary: {
    color: adminTheme.accentStrong,
    marginTop: 12,
    textAlign: 'center',
  },
  linkTertiary: {
    color: adminTheme.textMuted,
    marginTop: 12,
    textAlign: 'center',
  },
});
