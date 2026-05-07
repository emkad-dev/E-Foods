import { Link } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/contexts/AuthContext';
import { adminTheme } from '../../src/theme/palette';

export default function AdminForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const { clearError, error, loading, resetPassword } = useAuth();
  const [email, setEmail] = useState('');

  const handleEmailChange = (value: string) => {
    if (error) {
      clearError();
    }

    setEmail(value);
  };

  const handleReset = async () => {
    if (!email.trim()) {
      Alert.alert('Email required', 'Enter your admin email first.');
      return;
    }

    try {
      await resetPassword(email.trim());
      Alert.alert('Reset sent', 'A password reset link has been sent if the account exists.');
    } catch (nextError: any) {
      Alert.alert('Reset failed', nextError.message ?? 'Unable to send the reset email right now.');
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28, paddingTop: insets.top + 28 }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.card}>
        <Text style={styles.title}>Reset admin password</Text>
        <Text style={styles.copy}>
          Enter the email for your company admin account and we’ll send a secure reset link.
        </Text>

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

        <TouchableOpacity style={styles.primaryButton} onPress={handleReset} disabled={loading}>
          <Text style={styles.primaryButtonText}>{loading ? 'Sending...' : 'Send reset link'}</Text>
        </TouchableOpacity>

        <Link href="/(auth)/login" style={styles.link}>
          Back to sign in
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
  card: {
    backgroundColor: adminTheme.surface,
    borderColor: adminTheme.border,
    borderRadius: 28,
    borderWidth: 1,
    padding: 22,
  },
  title: {
    color: adminTheme.text,
    fontSize: 28,
    fontWeight: '800',
  },
  copy: {
    color: adminTheme.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  errorText: {
    color: adminTheme.danger,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 14,
  },
  input: {
    backgroundColor: adminTheme.cream,
    borderColor: adminTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    color: adminTheme.text,
    fontSize: 15,
    marginTop: 16,
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
});
