import { usePathname, useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MIN_TAP_TARGET, radius } from '@feasty/design-system';
import { useAuth } from '../contexts/AuthContext';
import { customerTheme } from '../theme/palette';
import { resolveAuthRedirectTo } from '../utils/authPrompt';

export default function AuthHeaderActions() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const redirectTo = resolveAuthRedirectTo(pathname);

  if (user) {
    return null;
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={() => router.push({ pathname: '/login', params: { redirectTo } } as never)}
      >
        <Text style={styles.secondaryText}>Sign in</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.primaryButton}
        onPress={() => router.push({ pathname: '/register', params: { redirectTo } } as never)}
      >
        <Text style={styles.primaryText}>Sign up</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flexDirection: 'row',
    marginRight: 8,
  },
  // Sign in and Sign up in the header: 2*8 of padding around a 12pt label is
  // 38pt and 36pt. These are the two controls the whole signed-out app exists
  // to funnel someone towards.
  secondaryButton: {
    alignItems: 'center',
    borderColor: customerTheme.accent,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  secondaryText: {
    color: customerTheme.accentStrong,
    fontSize: 12,
    fontWeight: '700',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: customerTheme.brandOrange,
    borderRadius: radius.pill,
    justifyContent: 'center',
    marginLeft: 8,
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  primaryText: {
    color: customerTheme.textOnAccent,
    fontSize: 12,
    fontWeight: '700',
  },
});
