import { useState, useEffect } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Link } from 'expo-router';
import { useAuth } from '../../src/contexts/AuthContext';
import GoogleSignInButton from '../../src/components/GoogleSignInButton';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { signIn, loading, error, clearError } = useAuth();

  // Clear error when user starts typing
  useEffect(() => {
    if (error) clearError();
  }, [email, password]);

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
    <View style={styles.container}>
      <Text style={styles.title}>Login</Text>
      {error && <Text style={styles.errorText}>{error}</Text>}
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
      <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? 'Loading...' : 'Sign In'}</Text>
      </TouchableOpacity>

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>Or sign in with</Text>
        <View style={styles.dividerLine} />
      </View>

      <GoogleSignInButton />

      <Link href="/(auth)/register" style={styles.link}>
        Create an account
      </Link>
      <Link href="/(auth)/forgot-password" style={styles.link}>
        Forgot password?
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 20 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },
  errorText: { color: '#d32f2f', marginBottom: 16, textAlign: 'center', fontSize: 14 },
  input: { height: 50, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 16, marginBottom: 16 },
  button: { backgroundColor: '#f5b342', padding: 15, borderRadius: 8, alignItems: 'center', marginBottom: 16 },
  buttonText: { color: '#fff', fontWeight: 'bold' },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#ddd' },
  dividerText: { marginHorizontal: 10, color: '#666', fontSize: 14 },
  link: { marginTop: 12, color: '#5D3FD3', textAlign: 'center' },
});
