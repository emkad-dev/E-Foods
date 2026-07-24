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

  if (!user) {
    return <Redirect href="/login" />;
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
