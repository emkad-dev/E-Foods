import React, { useState } from 'react';
import { Alert, ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { elevation, radius, useNotice } from '@feasty/design-system';
import { FontAwesome } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabase/config';
import {
  getGoogleSignInUnavailableMessage,
  signInWithGoogleIdToken,
  signInWithGoogleOAuth,
} from '../services/googleSignIn';

/**
 * `redirectTo` is where the visitor was headed before they were asked to sign
 * in. On web it rides through the OAuth round trip as a query param on our
 * own callback URL and is re-validated on return; without it a customer sent
 * to sign in from their cart came back to the home feed and had to find their
 * way again.
 */
export default function GoogleSignInButton({ redirectTo }: { redirectTo?: string }) {
  const { signInWithGoogle, loading } = useAuth();
  const [signingIn, setSigningIn] = useState(false);
  const unavailableMessage = getGoogleSignInUnavailableMessage();
  // Inline: this button is part of a short auth form, so a notice rendered
  // directly under it is exactly where the user is already looking.
  //
  // Web reaches the catch below through `signInWithGoogleOAuth`, and reported
  // the failure only through `Alert` — an empty function on the web build — so
  // a failed Google sign-in on app.feasty.com.ng was pure silence. The two
  // native-only branches (`unavailableMessage` and the Play redirect-URI
  // mismatch) keep `Alert`: they are unreachable on web, where
  // `Platform.OS === 'web'` returns before either can run.
  const { notice, showNotice } = useNotice();

  const handleGoogleSignIn = async () => {
    setSigningIn(true);

    try {
      if (Platform.OS === 'web') {
        await signInWithGoogleOAuth(supabase, redirectTo);
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
        showNotice({
          tone: 'error',
          title: 'Google sign-in failed',
          message: error.message || 'Something went wrong. Try again, or sign in with your email.',
        });
      }
    } finally {
      setSigningIn(false);
    }
  };

  const isBusy = loading || signingIn;

  return (
    <View style={styles.shell}>
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
      {notice}
    </View>
  );
}

const GOOGLE_BLUE = '#4285F4';

const styles = StyleSheet.create({
  shell: {
    width: '100%',
  },
  button: {
    ...elevation.sm,
    // Google's own colours below are fixed by the Sign-In branding guidelines and
    // deliberately stay literal; only the shadow is ours to standardise.
    backgroundColor: '#FFFFFF',
    borderColor: '#DADCE0',
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: 12,
    minHeight: 52,
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
