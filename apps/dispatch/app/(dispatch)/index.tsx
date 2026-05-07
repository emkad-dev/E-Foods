import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatOrderStatusLabel, getOrderStatusColor } from '../../src/domain/orders';
import { useDispatchOrders } from '../../src/hooks/useDispatchOrders';
import { useDispatchRiders } from '../../src/hooks/useDispatchRiders';
import { dispatchTheme } from '../../src/theme/palette';

export default function DispatchDashboard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { activeDeliveryOrders, awaitingPickupCount, deliveredCount, error, loading, onTheWayCount } =
    useDispatchOrders();
  const {
    activeZones,
    error: ridersError,
    idleRiders,
    loading: ridersLoading,
    onlineRiders,
    riders,
  } = useDispatchRiders();
  const delayedRiders = riders.filter((rider) => rider.availabilityLabel.includes('delay'));
  const offlineRiders = riders.filter((rider) => rider.availabilityLabel.includes('offline'));
  const dispatchMetrics = [
    { label: 'Active trips', value: String(activeDeliveryOrders.length), delta: 'Live delivery orders in progress' },
    { label: 'Awaiting pickup', value: String(awaitingPickupCount), delta: 'Restaurant handoffs pending rider movement' },
    { label: 'Riders online', value: String(onlineRiders.length), delta: `${idleRiders.length} idle and ready for assignment` },
    { label: 'Delivered', value: String(deliveredCount), delta: `${onTheWayCount} currently moving toward customers` },
  ];
  const dispatchAlerts = [
    delayedRiders.length > 0
      ? {
          title: `${delayedRiders.length} rider${delayedRiders.length > 1 ? 's are' : ' is'} delayed`,
          copy: 'Review late pickup riders and rebalance assignments before SLA misses spread.',
        }
      : null,
    offlineRiders.length > 0
      ? {
          title: `${offlineRiders.length} rider${offlineRiders.length > 1 ? 's went' : ' went'} offline`,
          copy: 'Watch nearby zones so active deliveries are not left short on reassignment options.',
        }
      : null,
    awaitingPickupCount > onlineRiders.length && onlineRiders.length > 0
      ? {
          title: 'Pickup queue is larger than available rider coverage',
          copy: 'Dispatch pressure is rising. Consider pulling idle riders into restaurant-heavy zones.',
        }
      : null,
  ].filter((alert): alert is { title: string; copy: string } => Boolean(alert));

  if (loading || ridersLoading) {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator size="large" color={dispatchTheme.accent} />
        <Text style={styles.loadingCopy}>Loading live dispatch board...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>E-Fooders</Text>
        <Text style={styles.title}>Live operations overview</Text>
        <Text style={styles.copy}>
          Keep riders, handoffs, and zone pressure in view from a dispatch board that now matches the customer side better.
        </Text>
        <View style={styles.heroMetaRow}>
          <View style={styles.heroPill}>
            <Text style={styles.heroPillLabel}>Shift</Text>
            <Text style={styles.heroPillValue}>Lunch Rush</Text>
          </View>
          <View style={styles.heroPill}>
            <Text style={styles.heroPillLabel}>Last sync</Text>
            <Text style={styles.heroPillValue}>2 mins ago</Text>
          </View>
        </View>
      </View>

      <View style={styles.statsGrid}>
        {dispatchMetrics.map((metric) => (
          <View key={metric.label} style={styles.metricCard}>
            <Text style={styles.metricValue}>{metric.value}</Text>
            <Text style={styles.metricLabel}>{metric.label}</Text>
            <Text style={styles.metricDelta}>{metric.delta}</Text>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Active dispatch board</Text>
        <Text style={styles.sectionCopy}>Orders that need eyes right now, sorted by urgency and handoff stage.</Text>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {activeDeliveryOrders.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No live delivery orders yet</Text>
            <Text style={styles.emptyCopy}>
              New orders from the customer app will appear here as soon as they enter the dispatch flow.
            </Text>
          </View>
        ) : (
          activeDeliveryOrders.slice(0, 6).map((order) => (
            <TouchableOpacity
              key={order.id}
              style={styles.deliveryCard}
              activeOpacity={0.92}
              onPress={() => router.push(`/delivery/${order.id}`)}
            >
              <View style={styles.deliveryHeader}>
                <View>
                  <Text style={styles.deliveryTitle}>Order #{order.id.slice(-6)}</Text>
                  <Text style={styles.deliveryMeta}>
                    {order.restaurantName ?? 'Restaurant'} to{' '}
                    {order.deliveryLocation?.shortAddress ?? order.deliveryAddress ?? 'Customer address pending'}
                  </Text>
                </View>
                <View style={[styles.liveStatusBadge, { backgroundColor: `${getOrderStatusColor(order.status)}20` }]}>
                  <Text style={[styles.statusBadgeText, { color: getOrderStatusColor(order.status) }]}>
                    {formatOrderStatusLabel(order.status)}
                  </Text>
                </View>
              </View>
              <View style={styles.deliveryFacts}>
                <Text style={styles.deliveryFact}>
                  Items: {order.items?.reduce((sum, item) => sum + (item.quantity ?? 0), 0) ?? 0}
                </Text>
                <Text style={styles.deliveryFact}>Total: ${(order.pricing?.total ?? order.total ?? 0).toFixed(2)}</Text>
                <Text style={styles.deliveryFact}>Payment: {order.payment?.status ?? 'pending'}</Text>
              </View>
              {order.deliveryLocation?.note ? <Text style={styles.deliveryNote}>{order.deliveryLocation.note}</Text> : null}
            </TouchableOpacity>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Attention queue</Text>
        {ridersError ? <Text style={styles.errorText}>{ridersError}</Text> : null}
        {dispatchAlerts.length === 0 ? (
          <View style={styles.neutralCard}>
            <Text style={styles.neutralTitle}>No fleet exceptions right now</Text>
            <Text style={styles.neutralCopy}>Rider coverage looks stable from the current live dispatch feed.</Text>
          </View>
        ) : (
          dispatchAlerts.map((alert) => (
            <View key={alert.title} style={styles.alertCard}>
              <Text style={styles.alertTitle}>{alert.title}</Text>
              <Text style={styles.alertCopy}>{alert.copy}</Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Zone pressure</Text>
        {activeZones.length === 0 ? (
          <View style={styles.neutralCard}>
            <Text style={styles.neutralTitle}>No active rider zones yet</Text>
            <Text style={styles.neutralCopy}>
              Once dispatch riders come online, their zone balance will be calculated here automatically.
            </Text>
          </View>
        ) : (
          activeZones.map((zone) => (
            <View key={zone.name} style={styles.zoneRow}>
              <View style={styles.zoneContent}>
                <Text style={styles.zoneName}>{zone.name}</Text>
                <Text style={styles.zoneMeta}>
                  {zone.activeOrders} active orders, {zone.idleRiders} idle riders, {zone.riderCount} riders online
                </Text>
              </View>
              <View style={[styles.zoneTag, { backgroundColor: zone.tagBackground }]}>
                <Text style={[styles.zoneTagText, { color: zone.tagColor }]}>{zone.load}</Text>
              </View>
            </View>
          ))
        )}
      </View>
      <StatusBar style="dark" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: dispatchTheme.background,
    flex: 1,
  },
  loadingState: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.background,
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
  content: {
    padding: 18,
    paddingBottom: 30,
  },
  hero: {
    backgroundColor: dispatchTheme.hero,
    borderRadius: 28,
    padding: 22,
  },
  eyebrow: {
    color: dispatchTheme.accentSoft,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  title: {
    color: dispatchTheme.cream,
    fontSize: 30,
    fontWeight: '800',
  },
  copy: {
    color: '#d6dfeb',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  heroMetaRow: {
    flexDirection: 'row',
    marginTop: 18,
  },
  heroPill: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 18,
    marginRight: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  heroPillLabel: {
    color: '#f3debf',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  heroPillValue: {
    color: dispatchTheme.cream,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 18,
  },
  metricCard: {
    backgroundColor: dispatchTheme.surface,
    borderColor: dispatchTheme.border,
    borderRadius: 22,
    borderWidth: 1,
    marginBottom: 12,
    padding: 18,
    width: '48.2%',
  },
  metricValue: {
    color: dispatchTheme.text,
    fontSize: 28,
    fontWeight: '800',
  },
  metricLabel: {
    color: dispatchTheme.textMuted,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 6,
  },
  metricDelta: {
    color: dispatchTheme.accentStrong,
    fontSize: 13,
    marginTop: 8,
  },
  section: {
    marginTop: 12,
  },
  sectionTitle: {
    color: dispatchTheme.text,
    fontSize: 22,
    fontWeight: '800',
  },
  sectionCopy: {
    color: dispatchTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  errorText: {
    color: dispatchTheme.danger,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
  },
  deliveryCard: {
    backgroundColor: dispatchTheme.surface,
    borderColor: dispatchTheme.border,
    borderRadius: 24,
    borderWidth: 1,
    marginTop: 14,
    padding: 18,
  },
  deliveryHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  deliveryTitle: {
    color: dispatchTheme.text,
    fontSize: 18,
    fontWeight: '800',
  },
  deliveryMeta: {
    color: dispatchTheme.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
    maxWidth: 220,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  liveStatusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  deliveryFacts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 14,
  },
  deliveryFact: {
    color: dispatchTheme.text,
    fontSize: 13,
    fontWeight: '700',
    marginRight: 14,
    marginTop: 4,
  },
  progressTrack: {
    backgroundColor: '#dbeafe',
    borderRadius: 999,
    height: 10,
    marginTop: 14,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: '#0ea5e9',
    borderRadius: 999,
    height: '100%',
  },
  deliveryNote: {
    color: dispatchTheme.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12,
  },
  emptyCard: {
    backgroundColor: dispatchTheme.surface,
    borderColor: dispatchTheme.border,
    borderRadius: 24,
    borderWidth: 1,
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
  alertCard: {
    backgroundColor: dispatchTheme.warningSoft,
    borderColor: '#ebcf9e',
    borderRadius: 22,
    borderWidth: 1,
    marginTop: 12,
    padding: 16,
  },
  alertTitle: {
    color: dispatchTheme.warning,
    fontSize: 15,
    fontWeight: '800',
  },
  alertCopy: {
    color: dispatchTheme.textSoft,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  neutralCard: {
    backgroundColor: dispatchTheme.surface,
    borderColor: dispatchTheme.border,
    borderRadius: 22,
    borderWidth: 1,
    marginTop: 12,
    padding: 16,
  },
  neutralTitle: {
    color: dispatchTheme.text,
    fontSize: 15,
    fontWeight: '800',
  },
  neutralCopy: {
    color: dispatchTheme.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  zoneRow: {
    alignItems: 'flex-start',
    backgroundColor: dispatchTheme.surface,
    borderColor: dispatchTheme.border,
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    padding: 16,
  },
  zoneContent: {
    flex: 1,
    flexShrink: 1,
    marginRight: 12,
  },
  zoneName: {
    color: dispatchTheme.text,
    fontSize: 16,
    fontWeight: '800',
  },
  zoneMeta: {
    color: dispatchTheme.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  zoneTag: {
    alignSelf: 'center',
    borderRadius: 999,
    flexShrink: 0,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  zoneTagText: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
});
