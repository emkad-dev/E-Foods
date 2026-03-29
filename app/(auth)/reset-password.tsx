import { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { confirmPasswordReset } from 'firebase/auth';
import { auth } from '../../src/services/firebase/config';
import { formatAuthError } from '../../src/services/firebase/auth';

export default function ResetPasswordScreen() {
  const params = useLocalSearchParams<{ oobCode?: string | string[] }>();
  const router = useRouter();
  const oobCode = useMemo(() => {
    if (Array.isArray(params.oobCode)) return params.oobCode[0];
    return params.oobCode;
  }, [params.oobCode]);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleResetPassword = async () => {
    if (!oobCode) {
      Alert.alert('Invalid link', 'This reset link is missing the required reset code.');
      return;
    }

    if (!password.trim() || !confirmPassword.trim()) {
      Alert.alert('Missing information', 'Please enter both passwords to continue.');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Password mismatch', 'Enter matching passwords to continue.');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Weak password', 'Password must be at least 6 characters long.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await confirmPasswordReset(auth, oobCode, password);
      Alert.alert('Password updated', 'You can now sign in with your new password.', [
        {
          text: 'Continue to login',
          onPress: () => router.replace('/(auth)/login'),
        },
      ]);
    } catch (err: any) {
      const formattedError = formatAuthError(err);
      setError(formattedError);
      Alert.alert('Unable to reset password', formattedError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Choose a new password</Text>
      <Text style={styles.copy}>Set a fresh password for your account and then sign back in.</Text>

      {error && <Text style={styles.errorText}>{error}</Text>}

      <TextInput
        style={styles.input}
        placeholder="New password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        editable={!submitting}
      />
      <TextInput
        style={styles.input}
        placeholder="Confirm new password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
        editable={!submitting}
      />

      <TouchableOpacity style={styles.button} onPress={handleResetPassword} disabled={submitting}>
        <Text style={styles.buttonText}>{submitting ? 'Updating...' : 'Update password'}</Text>
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
    marginBottom: 14,
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
