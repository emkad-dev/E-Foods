import { useState, useEffect } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Link } from 'expo-router';
import { useAuth } from '../../src/contexts/AuthContext';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { resetPassword, error, clearError } = useAuth();

  // Clear error when user starts typing
  useEffect(() => {
    if (error) clearError();
  }, [email]);

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
          onPress: () => setEmail(''),
        },
      ]);
    } catch (error: any) {
      Alert.alert('Unable to send reset email', error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Reset your password</Text>
      <Text style={styles.copy}>We will email you a secure link to finish resetting your password.</Text>

      {error && <Text style={styles.errorText}>{error}</Text>}

      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        editable={!submitting}
      />

      <TouchableOpacity style={styles.button} onPress={handleResetPassword} disabled={submitting}>
        <Text style={styles.buttonText}>{submitting ? 'Sending...' : 'Send reset email'}</Text>
      </TouchableOpacity>

      <Link href="/(auth)/login" style={styles.link}>
        Back to login
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: '#111',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  copy: {
    color: '#666',
    fontSize: 16,
    marginBottom: 24,
  },
  errorText: {
    color: '#d32f2f',
    marginBottom: 16,
    textAlign: 'center',
    fontSize: 14,
  },
  input: {
    borderColor: '#ddd',
    borderRadius: 10,
    borderWidth: 1,
    height: 50,
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#f5b342',
    borderRadius: 10,
    paddingVertical: 15,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  link: {
    color: '#5D3FD3',
    marginTop: 18,
    textAlign: 'center',
  },
});
