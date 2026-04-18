import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatchRiders } from '../../src/hooks/useDispatchRiders';
import { dispatchTheme } from '../../src/theme/palette';

export default function FleetScreen() {
  const insets = useSafeAreaInsets();
  const { error, loading, riders } = useDispatchRiders();

  if (loading) {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator size="large" color={dispatchTheme.accent} />
        <Text style={styles.loadingCopy}>Loading rider fleet...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      <Text style={styles.title}>Fleet pulse</Text>
      <Text style={styles.copy}>
        A friendlier read on rider availability, current zones, and who needs rebalancing.
      </Text>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {riders.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No riders configured yet</Text>
          <Text style={styles.emptyCopy}>
            Add rider documents to `dispatchProfiles` and this fleet board will start reading them live.
          </Text>
        </View>
      ) : (
        riders.map((rider) => (
          <View key={rider.id} style={styles.card}>
            <View style={styles.header}>
              <View>
                <Text style={styles.name}>{rider.name}</Text>
                <Text style={styles.zone}>{`${rider.zone} - ${rider.vehicleType}`}</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: rider.badgeBackground }]}>
                <Text style={[styles.badgeText, { color: rider.badgeColor }]}>{rider.status}</Text>
              </View>
            </View>

            <View style={styles.statsRow}>
              <View style={styles.statBlock}>
                <Text style={styles.statLabel}>Trips today</Text>
                <Text style={styles.statValue}>{rider.completedTrips}</Text>
              </View>
              <View style={styles.statBlock}>
                <Text style={styles.statLabel}>Acceptance</Text>
                <Text style={styles.statValue}>{rider.acceptanceRate}</Text>
              </View>
              <View style={styles.statBlock}>
                <Text style={styles.statLabel}>Current load</Text>
                <Text style={styles.statValue}>{rider.activeLoad}</Text>
              </View>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: dispatchTheme.backgroundAlt,
    flex: 1,
  },
  content: {
    padding: 18,
    paddingBottom: 30,
  },
  loadingState: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.backgroundAlt,
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  loadingCopy: {
    color: dispatchTheme.textMuted,
    fontSize: 15,
    marginTop: 12,
    textAlign: 'center',
  },
  title: {
    color: dispatchTheme.text,
    fontSize: 30,
    fontWeight: '800',
  },
  copy: {
    color: dispatchTheme.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
  },
  errorText: {
    color: dispatchTheme.danger,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12,
  },
  emptyCard: {
    backgroundColor: dispatchTheme.surface,
    borderRadius: 22,
    marginTop: 14,
    padding: 20,
  },
  emptyTitle: {
    color: dispatchTheme.text,
    fontSize: 18,
    fontWeight: '800',
  },
  emptyCopy: {
    color: dispatchTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  card: {
    backgroundColor: dispatchTheme.surface,
    borderRadius: 22,
    marginTop: 14,
    padding: 18,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  name: {
    color: dispatchTheme.text,
    fontSize: 18,
    fontWeight: '800',
  },
  zone: {
    color: dispatchTheme.textMuted,
    fontSize: 13,
    marginTop: 4,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 18,
  },
  statBlock: {
    flex: 1,
  },
  statLabel: {
    color: dispatchTheme.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  statValue: {
    color: dispatchTheme.accentStrong,
    fontSize: 20,
    fontWeight: '800',
    marginTop: 6,
  },
});
