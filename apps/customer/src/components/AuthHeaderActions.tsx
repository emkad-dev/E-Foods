import { usePathname, useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
  secondaryButton: {
    borderColor: customerTheme.accent,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  secondaryText: {
    color: customerTheme.accentStrong,
    fontSize: 12,
    fontWeight: '700',
  },
  primaryButton: {
    backgroundColor: customerTheme.brandOrange,
    borderRadius: 999,
    marginLeft: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  primaryText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
});
