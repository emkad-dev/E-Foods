import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuth } from '../src/contexts/AuthContext';
import { customerTheme } from '../src/theme/palette';

export default function NotFoundScreen() {
  const { loading, policyAccepted, user } = useAuth();

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={customerTheme.brandGreen} size="large" />
      </View>
    );
  }

  // A signed-out visitor who hits a dead URL is browsing, not authenticating:
  // a typo, a stale share link, or a slug that no longer exists. Sending them
  // to /login was the last of the removed login wall -- it turned every 404 on
  // app.feasty.com.ng into a sign-in demand. They go to the feed, exactly as
  // the root route already sends them (see app/index.tsx).
  if (!user) {
    return <Redirect href="/home" />;
  }

  if (!user.emailVerified) {
    return <Redirect href="/verify-email" />;
  }

  if (user.role === 'customer' && !user.phoneNumber) {
    return <Redirect href="/complete-profile" />;
  }

  if (!policyAccepted) {
    return <Redirect href="/accept-policy" />;
  }

  return <Redirect href="/home" />;
}

const styles = StyleSheet.create({
  loading: {
    alignItems: 'center',
    backgroundColor: customerTheme.background,
    flex: 1,
    justifyContent: 'center',
  },
});
