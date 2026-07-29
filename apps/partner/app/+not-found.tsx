import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuth } from '../src/contexts/AuthContext';
import { partnerTheme } from '../src/theme/palette';

export default function NotFoundScreen() {
  const { loading, user } = useAuth();

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={partnerTheme.accent} size="large" />
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/(auth)/login" />;
  }

  if (user.role !== 'restaurant') {
    return <Redirect href="/(partner)/complete-restaurant-details" />;
  }

  return <Redirect href="/(partner)" />;
}

const styles = StyleSheet.create({
  loading: {
    alignItems: 'center',
    backgroundColor: partnerTheme.background,
    flex: 1,
    justifyContent: 'center',
  },
});
