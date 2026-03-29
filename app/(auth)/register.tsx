import { useState, useEffect } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Link } from 'expo-router';
import { useAuth } from '../../src/contexts/AuthContext';
import GoogleSignInButton from '../../src/components/GoogleSignInButton';

export default function RegisterScreen() {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const { loading, signUp, error, clearError } = useAuth();

  // Clear error when user starts typing
  useEffect(() => {
    if (error) clearError();
  }, [displayName, email, password, confirmPassword]);

  const handleRegister = async () => {
    if (!displayName.trim() || !email.trim() || !password.trim()) {
      Alert.alert('Missing information', 'Please complete all fields before continuing.');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Password mismatch', 'Your passwords must match.');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Weak password', 'Password must be at least 6 characters long.');
      return;
    }

    try {
      const { verificationEmailSent } = await signUp(email.trim(), password, {
        displayName: displayName.trim(),
      });

      Alert.alert(
        verificationEmailSent ? 'Check your inbox' : 'Account created',
        verificationEmailSent
          ? 'We sent you a verification email to finish setting up your account.'
          : 'Your account was created, but verification email could not be sent yet. Open the verify email screen and try resending from there.'
      );
    } catch (error: any) {
      Alert.alert('Registration failed', error.message);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoider}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.container}>
          <Text style={styles.title}>Create your account</Text>
          <Text style={styles.copy}>Sign up to start ordering from nearby restaurants.</Text>

          {error && <Text style={styles.errorText}>{error}</Text>}

          <TextInput
            style={styles.input}
            placeholder="Full name"
            value={displayName}
            onChangeText={setDisplayName}
            editable={!loading}
          />
          <TextInput
            style={styles.input}
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            editable={!loading}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            editable={!loading}
          />
          <TextInput
            style={styles.input}
            placeholder="Confirm password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            editable={!loading}
          />

          <TouchableOpacity style={styles.button} onPress={handleRegister} disabled={loading}>
            <Text style={styles.buttonText}>{loading ? 'Creating account...' : 'Create account'}</Text>
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>Or sign up with</Text>
            <View style={styles.dividerLine} />
          </View>

          <GoogleSignInButton />

          <Link href="/(auth)/login" style={styles.link}>
            Already have an account? Sign in
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardAvoider: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollContent: {
    flexGrow: 1,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    paddingBottom: 40,
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
    marginTop: 8,
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
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#ddd' },
  dividerText: { marginHorizontal: 10, color: '#666', fontSize: 14 },
});
