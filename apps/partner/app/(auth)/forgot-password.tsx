import { Link } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/contexts/AuthContext';
import { partnerTheme } from '../../src/theme/palette';

export default function PartnerForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const { clearError, error, loading, resetPassword } = useAuth();
  const [email, setEmail] = useState('');

  const handleEmailChange = (value: string) => {
    if (error) {
      clearError();
    }

    setEmail(value);
  };

  const handleResetPassword = async () => {
    if (!email.trim()) {
      Alert.alert('Missing information', 'Enter the email address linked to your partner account.');
      return;
    }

    try {
      await resetPassword(email.trim());
      Alert.alert('Check your inbox', 'We sent a password reset email if this partner account exists.');
    } catch (nextError: any) {
      Alert.alert('Reset failed', nextError.message ?? 'Unable to send reset email right now.');
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28 }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Reset partner password</Text>
      <Text style={styles.copy}>Enter your partner email and we will send you a Firebase reset link.</Text>

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

      <TouchableOpacity style={styles.button} onPress={handleResetPassword} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? 'Sending...' : 'Send reset email'}</Text>
      </TouchableOpacity>

      <Link href="/(auth)/login" style={styles.link}>
        Back to sign in
      </Link>
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
    padding: 24,
  },
  title: {
    color: partnerTheme.text,
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  copy: {
    color: partnerTheme.textMuted,
    fontSize: 16,
    marginBottom: 24,
  },
  errorText: {
    color: partnerTheme.danger,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  input: {
    backgroundColor: partnerTheme.cream,
    borderColor: partnerTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    color: partnerTheme.text,
    fontSize: 15,
    minHeight: 54,
    paddingHorizontal: 16,
  },
  button: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accent,
    borderRadius: 18,
    marginTop: 18,
    paddingVertical: 16,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  link: {
    color: partnerTheme.accentStrong,
    marginTop: 16,
    textAlign: 'center',
  },
});
