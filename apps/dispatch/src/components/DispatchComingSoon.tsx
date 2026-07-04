import { StyleSheet, Text, View } from 'react-native';
import { dispatchTheme } from '../theme/palette';

// Standalone rider dispatch is shelved for the MVP — restaurants self-provision
// their own delivery for now. Flip DISPATCH_ENABLED in app/_layout.tsx to bring
// the full rider experience back online without restoring any deleted code.
export default function DispatchComingSoon() {
  return (
    <View style={styles.container}>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>FEASTY DISPATCH</Text>
      </View>
      <Text style={styles.title}>Coming soon</Text>
      <Text style={styles.body}>
        Rider dispatch isn&apos;t live yet. Restaurants are handling their own deliveries while we build
        out the FEASTY rider network. We&apos;ll let you know the moment it opens.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.background,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  badge: {
    backgroundColor: dispatchTheme.accentSoft,
    borderRadius: 999,
    marginBottom: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  badgeText: {
    color: dispatchTheme.accentStrong,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  title: {
    color: dispatchTheme.text,
    fontSize: 30,
    fontWeight: '900',
    marginBottom: 12,
  },
  body: {
    color: dispatchTheme.textMuted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
});
