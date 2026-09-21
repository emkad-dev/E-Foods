import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { radius } from '@feasty/design-system';
import { screenColumn } from '../../src/components/ScreenColumn';
import { resolveOAuthCallback, resolveOAuthDestination } from '../../src/domain/oauthCallback';
import { supabase } from '../../src/services/supabase/config';
import { customerTheme } from '../../src/theme/palette';

/**
 * Where an OAuth sign-in comes back to.
 *
 * WHAT WAS WRONG. `signInWithGoogleOAuth` sent Supabase a `redirectTo` of
 * /verify-email and nothing in the app ever read what came back. The flow is
 * PKCE (`response_type=code`), so Supabase returns `?code=…` to be exchanged
 * for a session -- but the client is built with `detectSessionInUrl: false`
 * and the repo contained no `exchangeCodeForSession` call at all. Customer
 * Google sign-in had therefore never once completed: the code sat unread in
 * the URL and the visitor arrived signed out, on a screen asking them to
 * confirm an email Google had already confirmed.
 *
 * WHY NOT JUST FLIP THE FLAG. Because `detectSessionInUrl: true` is what
 * wedged /reset-password, /verify-email and /payment/callback on the web
 * build -- the client's URL handling raced the app's deep-link effect into a
 * loop. One explicit exchange on one path nothing else routes through keeps
 * that fix intact.
 *
 * WHY IT FAILS LOUDLY. Every failure here used to be silent: the previous
 * behaviour was a bounce to the marketing site, which is indistinguishable
 * from a mis-click, and which is how this went unnoticed. Nothing on this
 * screen redirects on failure -- it states what happened and offers a way
 * back, so the next person to hit it can report something specific.
 *
 * WEB ONLY in practice: GoogleSignInButton takes the browser OAuth path when
 * `Platform.OS === 'web'` and the native ID-token path otherwise, so no
 * native deep-link branch is needed for this route.
 */
export default function OAuthCallbackScreen() {
  // Spelled out rather than reusing `OAuthCallbackParams`: that type admits
  // `null` (it is the resolver's input contract, and callers may hold nulls),
  // which does not satisfy expo-router's params constraint.
  const params = useLocalSearchParams<{
    code?: string | string[];
    error?: string | string[];
    error_code?: string | string[];
    error_description?: string | string[];
    redirectTo?: string | string[];
  }>();
  const [failure, setFailure] = useState<string | null>(null);
  // The exchange is single-use: a code can only be redeemed once, and React
  // runs effects twice under StrictMode. A second attempt would fail against
  // an already-redeemed code and overwrite a successful sign-in with an error.
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (attemptedRef.current) {
      return;
    }
    attemptedRef.current = true;

    const outcome = resolveOAuthCallback(params);

    if (outcome.kind === 'declined') {
      setFailure(outcome.message);
      return;
    }

    if (outcome.kind === 'empty') {
      setFailure('This page is where Google sends you back after signing in, and it was opened without a sign-in to finish.');
      return;
    }

    void (async () => {
      try {
        const { error } = await supabase.auth.exchangeCodeForSession(outcome.code);

        if (error) {
          throw error;
        }
      } catch (nextError) {
        // Named for the operator as much as the customer: an exchange that
        // fails after a successful Google consent is almost always a project
        // configuration problem, not something the visitor did.
        setFailure(
          nextError instanceof Error
            ? `Google signed you in, but this app could not finish the handover: ${nextError.message}`
            : 'Google signed you in, but this app could not finish the handover.'
        );
        return;
      }

      // The session now exists, so AuthContext's own listener has the account.
      // Navigate to where they were headed and let the route guards correct it
      // from there -- a Google account with no phone number belongs on
      // /complete-profile, and that decision lives in one place, not here.
      router.replace(resolveOAuthDestination(params.redirectTo) as never);
    })();
  }, [params]);

  if (failure) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={[styles.container, screenColumn.reading]}>
        <View style={styles.card}>
          <Text style={styles.title}>Could not finish signing in</Text>
          <Text accessibilityLiveRegion="assertive" role="alert" style={styles.message}>
            {failure}
          </Text>
          <Link href="/login" style={styles.action}>
            Back to sign in
          </Link>
          <Link href="/home" style={styles.actionMuted}>
            Keep browsing instead
          </Link>
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={styles.loading}>
      <ActivityIndicator color={customerTheme.accent} size="large" />
      <Text accessibilityLiveRegion="polite" style={styles.loadingText}>
        Finishing your sign-in...
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: customerTheme.background,
    flex: 1,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  loading: {
    alignItems: 'center',
    backgroundColor: customerTheme.background,
    flex: 1,
    gap: 14,
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    color: customerTheme.textMuted,
    fontSize: 15,
  },
  card: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: 22,
  },
  title: {
    color: customerTheme.text,
    fontSize: 22,
    fontWeight: '800',
  },
  message: {
    color: customerTheme.dangerText,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
  },
  // `Link` renders as `Text`, which react-native-web lays out as
  // `display: inline` -- `minHeight` is ignored on it, so the tap target is
  // bought with padding.
  action: {
    color: customerTheme.accentText,
    fontSize: 15,
    fontWeight: '800',
    marginTop: 18,
    paddingVertical: 12,
  },
  actionMuted: {
    color: customerTheme.link,
    fontSize: 15,
    fontWeight: '600',
    paddingVertical: 12,
  },
});
