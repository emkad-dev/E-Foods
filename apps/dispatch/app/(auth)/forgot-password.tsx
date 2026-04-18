import { Link } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/contexts/AuthContext';

export default function DispatchForgotPasswordScreen() {
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
      Alert.alert('Missing information', 'Enter the email address linked to your dispatch account.');
      return;
    }

    try {
      await resetPassword(email.trim());
      Alert.alert('Check your inbox', 'We sent a password reset email if this dispatch account exists.');
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
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>E-Fooders</Text>
        <Text style={styles.title}>Reset dispatch password</Text>
        <Text style={styles.copy}>
          Enter your dispatch email and we will send you a password reset link through Firebase Auth.
        </Text>
      </View>

      <View style={styles.formCard}>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <TextInput
          style={styles.input}
          placeholder="Dispatch email"
          placeholderTextColor="#8e8e8e"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={handleEmailChange}
          editable={!loading}
        />

        <TouchableOpacity style={styles.primaryButton} onPress={handleResetPassword} disabled={loading}>
          <Text style={styles.primaryButtonText}>{loading ? 'Sending...' : 'Send reset email'}</Text>
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
    backgroundColor: '#111315',
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  hero: {
    backgroundColor: '#1a1f22',
    borderColor: '#2a2f34',
    borderRadius: 28,
    borderWidth: 1,
    padding: 24,
  },
  eyebrow: {
    color: '#d5ff3f',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  title: {
    color: '#f6f7f8',
    fontSize: 31,
    fontWeight: '800',
  },
  copy: {
    color: '#b6bcc4',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  formCard: {
    backgroundColor: '#181c1f',
    borderColor: '#2a2f34',
    borderRadius: 26,
    borderWidth: 1,
    marginTop: 16,
    padding: 20,
  },
  errorText: {
    color: '#ff7b6b',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  input: {
    backgroundColor: '#0f1214',
    borderColor: '#31363b',
    borderRadius: 16,
    borderWidth: 1,
    color: '#f6f7f8',
    fontSize: 15,
    marginTop: 8,
    minHeight: 54,
    paddingHorizontal: 16,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#d5ff3f',
    borderRadius: 18,
    marginTop: 18,
    paddingVertical: 16,
  },
  primaryButtonText: {
    color: '#13160d',
    fontSize: 15,
    fontWeight: '800',
  },
  link: {
    color: '#d5ff3f',
    marginTop: 16,
    textAlign: 'center',
  },
});
