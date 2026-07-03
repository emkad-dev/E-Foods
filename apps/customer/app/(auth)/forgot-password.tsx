import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useAuth } from '../../src/contexts/AuthContext';
import AuthLegalFooter from '../../src/components/AuthLegalFooter';
import { customerTheme } from '../../src/theme/palette';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { resetPassword, error, clearError } = useAuth();
  const router = useRouter();

  const handleEmailChange = (value: string) => {
    if (error) clearError();
    setEmail(value);
  };

  const handleResetPassword = async () => {
    if (!email.trim()) {
      Alert.alert('Email required', 'Enter the email address linked to your account.');
      return;
    }

    setSubmitting(true);
    try {
      await resetPassword(email.trim());
      Alert.alert('Reset email sent', 'Open the link in your inbox to choose a new password.', [
        {
          text: 'Back to login',
          onPress: () => router.replace('/login'),
        },
      ]);
    } catch (error: any) {
      Alert.alert('Unable to send reset email', error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Reset your password</Text>
      <Text style={styles.copy}>We will email you a secure link to finish resetting your password.</Text>

      {error && <Text style={styles.errorText}>{error}</Text>}

      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={handleEmailChange}
        autoCapitalize="none"
        keyboardType="email-address"
        editable={!submitting}
      />

      <TouchableOpacity style={styles.button} onPress={handleResetPassword} disabled={submitting}>
        <Text style={styles.buttonText}>{submitting ? 'Sending...' : 'Send reset email'}</Text>
      </TouchableOpacity>

      <Link href="/login" style={styles.link}>
        Back to login
      </Link>

      <AuthLegalFooter />
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
    marginBottom: 16,
    paddingHorizontal: 16,
    color: customerTheme.text,
  },
  button: {
    alignItems: 'center',
    backgroundColor: customerTheme.accent,
    borderRadius: 10,
    paddingVertical: 15,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  link: {
    color: customerTheme.link,
    marginTop: 18,
    textAlign: 'center',
  },
});
