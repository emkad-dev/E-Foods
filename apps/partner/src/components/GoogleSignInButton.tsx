import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { radius, useNotice } from '@feasty/design-system';
import { useAuth } from '../contexts/AuthContext';
import { partnerTheme } from '../theme/palette';
import { supabase } from '../services/supabase/config';
import {
  canUseGoogleSignIn,
  getNativeGoogleSignInUnavailableMessage,
  signInWithGoogleIdToken,
  startGoogleWebSignIn,
} from '../services/googleSignIn';

/**
 * "Continue with Google" for the partner console.
 *
 * Ported from `apps/customer/src/components/GoogleSignInButton.tsx`, with
 * three deliberate changes:
 *
 *  1. NO `Alert`. The customer version still reaches for it on two
 *     native-only branches; on partner that temptation is removed entirely,
 *     because partner's primary surface IS the web build and `Alert` is an
 *     empty function there. Everything reports through `useNotice`.
 *  2. It owns the RETURN leg of the web redirect as well as the outbound one
 *     (see the effect below). The customer app has no equivalent, and without
 *     it the browser comes back from Google with a valid token that nothing
 *     reads.
 *  3. It renders nothing when Google sign-in cannot work — see
 *     `canUseGoogleSignIn`.
 */
export default function GoogleSignInButton() {
  const { completeGoogleWebSignIn, loading, signInWithGoogleIdToken: adoptIdToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const { notice, showNotice } = useNotice({ placement: 'inline' });
  // The return leg is a one-shot: `completeGoogleWebRedirect` strips the
  // credential off the URL as it consumes it. React 18 mounts effects twice in
  // development, so without this guard the second pass would run against an
  // already-cleaned URL — harmless, but it would also fire a second session
  // adoption if the timing went badly.
  const redirectHandledRef = useRef(false);

  useEffect(() => {
    if (redirectHandledRef.current) {
      return;
    }

    redirectHandledRef.current = true;

    void (async () => {
      try {
        // Resolves false, having done nothing, on an ordinary visit to the
        // login screen. Only a Google return does any work.
        await completeGoogleWebSignIn();
      } catch (error: any) {
        showNotice({
          tone: 'error',
          title: 'Google sign-in did not finish',
          message:
            error?.message || 'We could not complete the sign-in. Try again, or use your email and password.',
        });
      }
    })();
  }, [completeGoogleWebSignIn, showNotice]);

  if (!canUseGoogleSignIn()) {
    return null;
  }

  const isBusy = loading || busy;

  const handlePress = async () => {
    setBusy(true);

    try {
      if (Platform.OS === 'web') {
        // Navigates away on success; nothing after this line runs.
        await startGoogleWebSignIn(supabase);
        return;
      }

      const unavailableMessage = getNativeGoogleSignInUnavailableMessage();

      if (unavailableMessage) {
        throw new Error(unavailableMessage);
      }

      const idToken = await signInWithGoogleIdToken();
      await adoptIdToken(idToken);
    } catch (error: any) {
      // A user who backs out of the Google account chooser has not hit a
      // problem, and telling them they have is noise.
      if (error?.code === 'CANCELED' || error?.code === '-5') {
        return;
      }

      console.error('Partner Google sign-in failed:', error);
      showNotice({
        tone: 'error',
        title: 'Google sign-in failed',
        message: error?.message || 'Something went wrong. Try again, or sign in with your email.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.shell}>
      <View style={styles.divider}>
        <View style={styles.dividerRule} />
        <Text style={styles.dividerLabel}>or</Text>
        <View style={styles.dividerRule} />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Continue with Google"
        accessibilityState={{ disabled: isBusy }}
        disabled={isBusy}
        onPress={handlePress}
        style={({ pressed }) => [
          styles.button,
          pressed && !isBusy ? styles.buttonPressed : null,
          isBusy ? styles.buttonDisabled : null,
        ]}
      >
        <View style={styles.iconWrap}>
          {busy ? (
            <ActivityIndicator size="small" color={GOOGLE_BLUE} />
          ) : (
            <FontAwesome name="google" size={18} color={GOOGLE_BLUE} />
          )}
        </View>
        <Text style={styles.buttonText}>{busy ? 'Opening Google...' : 'Continue with Google'}</Text>
      </Pressable>

      <Text style={styles.hint}>
        Invited by a restaurant? If your email is a Google account, sign in here.
      </Text>

      {notice}
    </View>
  );
}

/**
 * The ONE hard-coded colour in this app's UI, and the exemption is deliberate:
 * Google's Sign-In branding guidelines fix the mark's colour, so it cannot be
 * a `partnerTheme` token that a future palette change would quietly repaint.
 * It is used only for the glyph and its loading spinner — the button's own
 * surface, border and label are all tokens. Same value and same reasoning as
 * the customer app's button.
 */
const GOOGLE_BLUE = '#4285F4';

const styles = StyleSheet.create({
  shell: {
    width: '100%',
  },
  divider: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },
  dividerRule: {
    backgroundColor: partnerTheme.border,
    flex: 1,
    height: 1,
  },
  dividerLabel: {
    color: partnerTheme.textSoft,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  button: {
    alignItems: 'center',
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
    marginTop: 14,
    minHeight: 52,
    paddingHorizontal: 16,
  },
  buttonPressed: {
    backgroundColor: partnerTheme.cream,
  },
  buttonDisabled: {
    opacity: 0.72,
  },
  iconWrap: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  buttonText: {
    color: partnerTheme.text,
    fontSize: 15,
    fontWeight: '800',
  },
  hint: {
    color: partnerTheme.textSoft,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
    textAlign: 'center',
  },
});
