import React, { useState } from 'react';
import { Alert, ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabase/config';
import {
  getGoogleSignInUnavailableMessage,
  signInWithGoogleIdToken,
  signInWithGoogleOAuth,
} from '../services/googleSignIn';

export default function GoogleSignInButton() {
  const { signInWithGoogle, loading } = useAuth();
  const [signingIn, setSigningIn] = useState(false);
  const unavailableMessage = getGoogleSignInUnavailableMessage();

  const handleGoogleSignIn = async () => {
    setSigningIn(true);

    try {
      if (Platform.OS === 'web') {
        await signInWithGoogleOAuth(supabase);
        return;
      }

      if (unavailableMessage) {
        Alert.alert('Google Sign-In unavailable', unavailableMessage);
        return;
      }

      const idToken = await signInWithGoogleIdToken();
      await signInWithGoogle(idToken);
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
    } finally {
      setSigningIn(false);
    }
  };

  const isBusy = loading || signingIn;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Continue with Google"
      onPress={handleGoogleSignIn}
      disabled={isBusy}
      style={({ pressed }) => [
        styles.button,
        pressed && !isBusy ? styles.buttonPressed : null,
        isBusy ? styles.buttonDisabled : null,
      ]}
    >
      <View style={styles.content}>
        <View style={styles.iconWrap}>
          {signingIn ? (
            <ActivityIndicator size="small" color={GOOGLE_BLUE} />
          ) : (
            <FontAwesome name="google" size={18} color={GOOGLE_BLUE} />
          )}
        </View>
        <Text style={styles.buttonText}>{signingIn ? 'Signing in...' : 'Google'}</Text>
      </View>
    </Pressable>
  );
}

const GOOGLE_BLUE = '#4285F4';

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#FFFFFF',
    borderColor: '#DADCE0',
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
    minHeight: 52,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
  },
  buttonPressed: {
    backgroundColor: '#F8FAFC',
    transform: [{ scale: 0.99 }],
  },
  buttonDisabled: {
    opacity: 0.72,
  },
  content: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 16,
  },
  iconWrap: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  buttonText: {
    color: '#1F1F1F',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
