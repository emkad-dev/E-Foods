import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/contexts/AuthContext';

export default function VerifyEmailScreen() {
  const { user, reloadUser, sendVerificationEmail, signOut, error, clearError } = useAuth();
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const router = useRouter();

  useEffect(() => {
    clearError();
  }, [clearError]);

  useEffect(() => {
    if (user?.emailVerified) {
      router.replace('/(customer)/home');
    }
  }, [router, user?.emailVerified]);

  const handleRefreshStatus = async () => {
    setChecking(true);
    try {
      const emailVerified = await reloadUser();
      Alert.alert(
        emailVerified ? 'Success' : 'Not verified yet',
        emailVerified
          ? 'Your email has been verified!'
          : 'Please complete the verification link sent to your email.'
      );
    } catch (error: any) {
      Alert.alert('Unable to refresh status', error.message);
    } finally {
      setChecking(false);
    }
  };

  const handleResendEmail = async () => {
    setResending(true);
    try {
      await sendVerificationEmail();
      Alert.alert('Verification email sent', 'Please check your inbox for the new link.');
    } catch (error: any) {
      Alert.alert('Unable to resend email', error.message);
    } finally {
      setResending(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Verify your email</Text>
      <Text style={styles.copy}>
        We sent a verification link to {user?.email}. Confirm it, then come back here to continue.
      </Text>

      {error && <Text style={styles.errorText}>{error}</Text>}

      <TouchableOpacity style={styles.primaryButton} onPress={handleRefreshStatus} disabled={checking}>
        <Text style={styles.primaryText}>{checking ? 'Checking...' : 'I have verified my email'}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.secondaryButton} onPress={handleResendEmail} disabled={resending}>
        <Text style={styles.secondaryText}>{resending ? 'Sending...' : 'Resend verification email'}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut} disabled={signingOut}>
        <Text style={styles.signOutText}>{signingOut ? 'Signing out...' : 'Sign out'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#fff',
    flex: 1,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: '#111',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 12,
  },
  copy: {
    color: '#666',
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 28,
  },
  errorText: {
    color: '#d32f2f',
    marginBottom: 16,
    textAlign: 'center',
    fontSize: 14,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#f5b342',
    borderRadius: 10,
    marginBottom: 12,
    paddingVertical: 15,
  },
  primaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: '#f5b342',
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
    paddingVertical: 15,
  },
  secondaryText: {
    color: '#9a6400',
    fontSize: 16,
    fontWeight: '600',
  },
  signOutButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  signOutText: {
    color: '#5D3FD3',
    fontSize: 15,
    fontWeight: '600',
  },
});
