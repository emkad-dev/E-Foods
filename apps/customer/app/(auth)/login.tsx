import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Link } from 'expo-router';
import { useAuth } from '../../src/contexts/AuthContext';
import GoogleSignInButton from '../../src/components/GoogleSignInButton';
import { getGoogleSignInUnavailableMessage } from '../../src/services/googleSignIn';
import { customerTheme } from '../../src/theme/palette';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { signIn, loading, error, clearError } = useAuth();
  const googleSignInAvailable = !getGoogleSignInUnavailableMessage();

  const handleEmailChange = (value: string) => {
    if (error) clearError();
    setEmail(value);
  };

  const handlePasswordChange = (value: string) => {
    if (error) clearError();
    setPassword(value);
  };

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
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Login</Text>
      {error && <Text style={styles.errorText}>{error}</Text>}
      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={handleEmailChange}
        autoCapitalize="none"
        keyboardType="email-address"
        editable={!loading}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={handlePasswordChange}
        secureTextEntry
        editable={!loading}
      />
      <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? 'Loading...' : 'Sign In'}</Text>
      </TouchableOpacity>

      {googleSignInAvailable ? (
        <>
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>Or sign in with</Text>
            <View style={styles.dividerLine} />
          </View>

          <GoogleSignInButton />
        </>
      ) : null}

      <Link href="/(auth)/register" style={styles.link}>
        Create an account
      </Link>
      <Link href="/(auth)/forgot-password" style={styles.link}>
        Forgot password?
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: customerTheme.background, flex: 1 },
  container: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  title: { color: customerTheme.text, fontSize: 24, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },
  errorText: { color: customerTheme.danger, marginBottom: 16, textAlign: 'center', fontSize: 14 },
  input: {
    height: 50,
    borderWidth: 1,
    borderColor: customerTheme.border,
    backgroundColor: customerTheme.surface,
    color: customerTheme.text,
    borderRadius: 10,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  button: { backgroundColor: customerTheme.accent, padding: 15, borderRadius: 10, alignItems: 'center', marginBottom: 16 },
  buttonText: { color: '#fff', fontWeight: 'bold' },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: customerTheme.border },
  dividerText: { marginHorizontal: 10, color: customerTheme.textMuted, fontSize: 14 },
  link: { marginTop: 12, color: customerTheme.link, textAlign: 'center' },
});
