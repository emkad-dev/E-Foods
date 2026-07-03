import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../src/contexts/AuthContext';
import { customerTheme } from '../src/theme/palette';

export default function Index() {
  const { loading, policyLoading, policyAccepted, user } = useAuth();

  if (loading || policyLoading) {
    return (
      <View
        style={{
          alignItems: 'center',
          backgroundColor: customerTheme.launchBackground,
          flex: 1,
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator color={customerTheme.brandGreen} size="large" />
      </View>
    );
  }

  let target = '/login';

  if (user) {
    if (!user.emailVerified) {
      target = '/verify-email';
    } else if (user.role === 'customer' && !user.phoneNumber) {
      target = '/complete-profile';
    } else if (!policyAccepted) {
      target = '/accept-policy';
    } else {
      target = '/home';
    }
  }

  return <Redirect href={target as never} />;
}
