/**
 * Google Sign-In Button Component
 * 
 * Usage:
 * import GoogleSignInButton from '../components/GoogleSignInButton';
 * 
 * In your component:
 * <GoogleSignInButton />
 */

import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import {
  getGoogleSignInUnavailableMessage,
  signInWithGoogleIdToken,
} from '../services/googleSignIn';

export default function GoogleSignInButton() {
  const { signInWithGoogle, loading } = useAuth();
  const [signingIn, setSigningIn] = useState(false);
  const unavailableMessage = getGoogleSignInUnavailableMessage();

  const handleGoogleSignIn = async () => {
    if (unavailableMessage) {
      Alert.alert('Google Sign-In unavailable', unavailableMessage);
      return;
    }

    setSigningIn(true);
    try {
      const idToken = await signInWithGoogleIdToken();

      const idToken = await signInWithGoogleIdToken();
      await signInWithGoogle(idToken);
      
      // Redirect to home page after successful sign-in
      router.replace('/(customer)/home');
    } catch (error: any) {
      console.error('Google Sign-In Error:', error);
      if (error.code === 'PLAYGROUND_REDIRECT_URI_MISMATCH') {
        Alert.alert(
          'Configuration Error',
          'Please ensure your redirect URI is configured correctly in the Google Cloud Console.'
        );
      } else if (error.code !== 'CANCELED') {
        Alert.alert('Google Sign-In Failed', error.message || 'An error occurred');
      }
      setSigningIn(false);
    }
  };

  return (
    <TouchableOpacity
      style={[styles.button, unavailableMessage ? styles.buttonUnavailable : null]}
      onPress={handleGoogleSignIn}
      disabled={loading || signingIn}
    >
      <Text style={styles.buttonText}>
        {signingIn || loading
          ? 'Signing in...'
          : unavailableMessage
            ? 'Google Sign-In setup required'
            : 'Sign in with Google'}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#F3F3F3',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DADADA',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonUnavailable: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#1F2937',
    fontSize: 16,
    fontWeight: '600',
  },
});
