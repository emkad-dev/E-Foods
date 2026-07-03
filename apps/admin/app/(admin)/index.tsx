import { FontAwesome } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AdminCard from '../../src/components/AdminCard';
import AdminBackendStatusBanner from '../../src/components/AdminBackendStatusBanner';
import AdminEmptyState from '../../src/components/AdminEmptyState';
import AdminStatusBadge from '../../src/components/AdminStatusBadge';
import CumulativeBarChart, { type BarDatum } from '../../src/components/charts/CumulativeBarChart';
import DonutChart, { type DonutSegment } from '../../src/components/charts/DonutChart';
import { useAuth } from '../../src/contexts/AuthContext';
import { useAdminLiveRefresh } from '../../src/hooks/useAdminLiveRefresh';
import type { DispatchProfileDocument, OrderDocument, RestaurantDocument, UserDocument } from '../../src/domain/entities';
import { getAdminDashboardSnapshot } from '../../src/services/platformReads';
import { adminTheme } from '../../src/theme/palette';
import { getAdminToneColors, getApprovalTone, getOrderTone, type AdminTone } from '../../src/theme/status';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const toTimestamp = (value: unknown): number | null => {
  if (value == null) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }

  if (typeof value === 'string') {
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? null : time;
  }

  return null;
};

const getOrderTotal = (order: OrderDocument): number => {
  const fromPricing = Number(order.pricing?.total);
  if (Number.isFinite(fromPricing)) {
    return fromPricing;
  }

  const fromTotal = Number((order as { total?: unknown }).total ?? 0);
  return Number.isFinite(fromTotal) ? fromTotal : 0;
};

// A "failed transaction" is a cancelled/rejected/failed order, or one whose
// payment failed. These must never inflate sales revenue or order-volume
// analytics (Sales overview + Orders this week).
const FAILED_ORDER_STATUSES = new Set(['cancelled', 'rejected', 'failed', 'failed_delivery']);

const isFailedOrder = (order: OrderDocument): boolean => {
  if (FAILED_ORDER_STATUSES.has((order.status ?? '').toString().toLowerCase())) {
    return true;
  }
  return (order.payment?.status ?? '').toString().toLowerCase() === 'failed';
};

const formatNaira = (amount: number): string => `₦${Math.round(amount).toLocaleString('en-NG')}`;

const DASHBOARD_LIVE_REFRESH_SUBSCRIPTIONS = [
  { table: 'UserAccount' },
  { table: 'UserRole' },
  { table: 'RestaurantRecord' },
  { table: 'CustomerOrder' },
  { table: 'OrderItem' },
  { table: 'DeliveryAssignment' },
  { table: 'DispatchRiderRecord' },
] as const;

export default function AdminDashboardScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const mountedRef = useRef(true);
  const [users, setUsers] = useState<UserDocument[]>([]);
  const [restaurants, setRestaurants] = useState<RestaurantDocument[]>([]);
  const [orders, setOrders] = useState<OrderDocument[]>([]);
  const [dispatchProfiles, setDispatchProfiles] = useState<DispatchProfileDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backendSource, setBackendSource] = useState<'live' | 'cache' | 'fallback'>('live');

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadSnapshot = useCallback(async () => {
    try {
      const nextSnapshot = await getAdminDashboardSnapshot();

      if (!mountedRef.current) {
        return;
      }

      setUsers(nextSnapshot.data.users);
      setRestaurants(nextSnapshot.data.restaurants);
      setOrders(nextSnapshot.data.orders);
      setDispatchProfiles(nextSnapshot.data.dispatchProfiles);
      setBackendSource(nextSnapshot.source);
      setError(null);
    } catch (nextError: any) {
      if (!mountedRef.current) {
        return;
      }

      console.error('Error loading admin dashboard snapshot:', nextError);
      setError(nextError.message ?? 'Unable to load the admin dashboard right now.');
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useAdminLiveRefresh({
    onRefresh: loadSnapshot,
    pollIntervalMs: 20000,
    subscriptions: DASHBOARD_LIVE_REFRESH_SUBSCRIPTIONS,
  });

  const metrics = useMemo(() => {
    const publishedRestaurants = restaurants.filter((restaurant) => restaurant.isPublished === true).length;
    const pendingApprovals = restaurants.filter((restaurant) => restaurant.isPublished !== true).length;
    const liveOrders = orders.filter((order) => {
      const status = (order.status ?? '').toLowerCase();
      return status.length > 0 && !['cancelled', 'delivered', 'rejected'].includes(status);
    }).length;
    const onlineDispatch = dispatchProfiles.filter((profile) =>
      ['online', 'active', 'available'].includes((profile.status ?? '').toLowerCase())
    ).length;

    const weekAgo = Date.now() - 7 * DAY_MS;
    const newUsers = users.filter((entry) => {
      const created = toTimestamp(entry.createdAt);
      return created !== null && created >= weekAgo;
    }).length;
    const newOrders = orders.filter((order) => {
      const created = toTimestamp(order.createdAt);
      return created !== null && created >= weekAgo;
    }).length;

    return [
      {
        delta: newUsers > 0 ? `+${newUsers} this week` : 'No new this week',
        deltaPositive: newUsers > 0,
        icon: 'users' as const,
        label: 'Platform users',
        route: '/users',
        tone: 'primary' as AdminTone,
        value: String(users.length),
      },
      {
        delta: `${publishedRestaurants} live now`,
        deltaPositive: false,
        icon: 'cutlery' as const,
        label: 'Published stores',
        route: '/approvals',
        tone: 'success' as AdminTone,
        value: String(publishedRestaurants),
      },
      {
        delta: `${pendingApprovals} awaiting`,
        deltaPositive: false,
        icon: 'clock-o' as const,
        label: 'Pending approvals',
        route: '/approvals',
        tone: 'warning' as AdminTone,
        value: String(pendingApprovals),
      },
      {
        delta: newOrders > 0 ? `+${newOrders} this week` : 'No new this week',
        deltaPositive: newOrders > 0,
        icon: 'shopping-bag' as const,
        label: 'Live orders',
        route: '/orders',
        tone: 'info' as AdminTone,
        value: String(liveOrders),
      },
      {
        delta: `${onlineDispatch} online`,
        deltaPositive: false,
        icon: 'truck' as const,
        label: 'Dispatch online',
        route: '/dispatch',
        tone: 'danger' as AdminTone,
        value: String(onlineDispatch),
      },
    ];
  }, [dispatchProfiles, orders, restaurants, users]);

  const salesOverview = useMemo<{ revenue: number; segments: DonutSegment[] }>(() => {
    let delivery = 0;
    let pickup = 0;
    let other = 0;
    let revenue = 0;

    for (const order of orders) {
      if (isFailedOrder(order)) {
        continue;
      }
      revenue += getOrderTotal(order);
      const type = (order.fulfillmentType ?? '').toLowerCase();
      if (type === 'delivery') {
        delivery += 1;
      } else if (type === 'pickup') {
        pickup += 1;
      } else {
        other += 1;
      }
    }

    const segments: DonutSegment[] = [
      { color: adminTheme.accent, label: 'Delivery', value: delivery },
      { color: adminTheme.info, label: 'Pickup', value: pickup },
    ];

    if (other > 0) {
      segments.push({ color: adminTheme.warning, label: 'Other', value: other });
    }

    return { revenue, segments };
  }, [orders]);

  const ordersThisWeek = useMemo<BarDatum[]>(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dailyCounts = new Array(7).fill(0);

    for (const order of orders) {
      if (isFailedOrder(order)) {
        continue;
      }
      const created = toTimestamp(order.createdAt);
      if (created === null) {
        continue;
      }

      const dayIndex = Math.floor((startOfToday - new Date(created).setHours(0, 0, 0, 0)) / DAY_MS);
      if (dayIndex >= 0 && dayIndex < 7) {
        dailyCounts[6 - dayIndex] += 1;
      }
    }

    let runningTotal = 0;
    return dailyCounts.map((count, index) => {
      runningTotal += count;
      const dayDate = new Date(startOfToday - (6 - index) * DAY_MS);
      return { label: WEEKDAY_LABELS[dayDate.getDay()], value: runningTotal };
    });
  }, [orders]);

  const roleCounts = useMemo(
    () => ({
      admins: users.filter((entry) => entry.role === 'admin').length,
      customers: users.filter((entry) => entry.role === 'customer').length,
      partners: users.filter((entry) => entry.role === 'restaurant').length,
      dispatch: users.filter((entry) => entry.role === 'dispatch').length,
    }),
    [users]
  );

  const recentOrders = useMemo(
    () => [...orders].sort((left, right) => String(right.id).localeCompare(String(left.id))).slice(0, 5),
    [orders]
  );

  const approvalPulse = useMemo(
    () =>
      [...restaurants]
        .sort((left, right) => {
          const leftPublished = left.isPublished === true ? 1 : 0;
          const rightPublished = right.isPublished === true ? 1 : 0;

          if (leftPublished !== rightPublished) {
            return leftPublished - rightPublished;
          }

          return left.name.localeCompare(right.name);
        })
        .slice(0, 4),
    [restaurants]
  );
  const rawName = user?.displayName?.trim() || user?.email?.split('@')[0]?.trim() || 'ADMIN';
  const greetingName = rawName.toUpperCase().slice(0, 18);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
      <View style={styles.maxWidth}>
        <View style={styles.greetingBlock}>
          <Text style={styles.greetingText} numberOfLines={1}>
            HI {greetingName}
          </Text>
        </View>

        <AdminBackendStatusBanner source={backendSource} />

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {loading ? (
          <AdminCard>
            <ActivityIndicator size="large" color={adminTheme.accent} />
            <Text style={styles.loadingText}>Loading the admin overview...</Text>
          </AdminCard>
        ) : null}

        <View style={styles.metricsGrid}>
          {metrics.map((metric) => {
            const toneColors = getAdminToneColors(metric.tone);
            return (
              <TouchableOpacity
                key={metric.label}
                style={styles.metricCard}
                activeOpacity={0.85}
                onPress={() => router.push(metric.route as never)}
              >
                <View style={styles.metricCardHeader}>
                  <Text style={styles.metricLabel}>{metric.label}</Text>
                  <View style={[styles.metricIconCircle, { backgroundColor: toneColors.backgroundColor }]}>
                    <FontAwesome name={metric.icon} size={15} color={toneColors.textColor} />
                  </View>
                </View>
                <Text style={styles.metricValue}>{metric.value}</Text>
                <View style={styles.metricDeltaRow}>
                  {metric.deltaPositive ? (
                    <FontAwesome name="caret-up" size={13} color={adminTheme.success} />
                  ) : null}
                  <Text style={[styles.metricDelta, metric.deltaPositive ? styles.metricDeltaPositive : null]}>
                    {metric.delta}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <AdminCard title="Sales overview" subtitle="Order mix by fulfillment and total revenue.">
          <DonutChart
            segments={salesOverview.segments}
            centerLabel={formatNaira(salesOverview.revenue)}
            centerSubLabel="Revenue"
          />
        </AdminCard>

        <AdminCard title="Orders this week" subtitle="Running total of orders across the last 7 days.">
          <CumulativeBarChart data={ordersThisWeek} />
        </AdminCard>

        <TouchableOpacity activeOpacity={0.85} onPress={() => router.push('/users' as never)}>
          <AdminCard title="Role coverage">
            <Text style={styles.metaLine}>Admins: {roleCounts.admins}</Text>
            <Text style={styles.metaLine}>Customers: {roleCounts.customers}</Text>
            <Text style={styles.metaLine}>Partners: {roleCounts.partners}</Text>
            <Text style={styles.metaLine}>Dispatch: {roleCounts.dispatch}</Text>
          </AdminCard>
        </TouchableOpacity>

      <AdminCard title="Recent order watch">
        {recentOrders.length === 0 ? (
          <AdminEmptyState
            title="No orders yet"
            body="Orders will appear here once the customer app starts placing checkout traffic into the sandbox."
          />
        ) : null}
        {recentOrders.map((order) => (
          <TouchableOpacity
            key={order.id}
            style={styles.orderRow}
            activeOpacity={0.85}
            onPress={() => router.push('/orders' as never)}
          >
            <View style={styles.orderMeta}>
              <Text style={styles.orderTitle}>{order.restaurantName ?? 'Unknown restaurant'}</Text>
              <Text style={styles.orderSubtext}>
                {order.fulfillmentType ?? 'Fulfillment not set'} | {order.id}
              </Text>
            </View>
            <AdminStatusBadge label={order.status ?? 'unknown'} tone={getOrderTone(order.status)} />
          </TouchableOpacity>
        ))}
      </AdminCard>

      <AdminCard title="Approval pulse">
        {approvalPulse.length === 0 ? (
          <AdminEmptyState
            title="No restaurants to review"
            body="Partner-side restaurant records will show up here once they exist."
          />
        ) : null}
        {approvalPulse.map((restaurant) => (
          <TouchableOpacity
            key={restaurant.id}
            style={styles.orderRow}
            activeOpacity={0.85}
            onPress={() => router.push('/approvals' as never)}
          >
            <View style={styles.orderMeta}>
              <Text style={styles.orderTitle}>{restaurant.name}</Text>
              <Text style={styles.orderSubtext}>{restaurant.address ?? 'Address pending'}</Text>
            </View>
            <AdminStatusBadge
              label={restaurant.approvalStatus ?? (restaurant.isPublished === true ? 'approved' : 'pending')}
              tone={getApprovalTone(restaurant.approvalStatus, restaurant.isPublished)}
            />
          </TouchableOpacity>
        ))}
      </AdminCard>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: adminTheme.background,
    flex: 1,
  },
  content: {
    paddingBottom: 28,
    paddingHorizontal: 18,
  },
  maxWidth: {
    alignSelf: 'center',
    maxWidth: 1200,
    width: '100%',
  },
  greetingBlock: {
    alignItems: 'flex-start',
  },
  greetingText: {
    color: adminTheme.text,
    fontSize: 24,
    fontWeight: '800',
  },
  errorText: {
    color: adminTheme.danger,
    fontSize: 13,
    marginTop: 14,
  },
  loadingText: {
    color: adminTheme.textMuted,
    fontSize: 14,
    marginTop: 16,
    textAlign: 'center',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 14,
  },
  metricCard: {
    backgroundColor: adminTheme.surface,
    borderColor: adminTheme.border,
    borderRadius: 18,
    borderWidth: 1,
    flexBasis: 180,
    flexGrow: 1,
    minWidth: 180,
    padding: 16,
  },
  metricCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metricIconCircle: {
    alignItems: 'center',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  metricValue: {
    color: adminTheme.text,
    fontSize: 28,
    fontWeight: '800',
    marginTop: 10,
  },
  metricLabel: {
    color: adminTheme.textMuted,
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    lineHeight: 16,
    marginRight: 8,
    textTransform: 'uppercase',
  },
  metricDeltaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginTop: 6,
  },
  metricDelta: {
    color: adminTheme.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  metricDeltaPositive: {
    color: adminTheme.success,
  },
  metaLine: {
    color: adminTheme.textMuted,
    fontSize: 14,
    lineHeight: 22,
  },
  orderRow: {
    alignItems: 'center',
    borderColor: adminTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
    padding: 14,
  },
  orderMeta: {
    flex: 1,
  },
  orderTitle: {
    color: adminTheme.text,
    fontSize: 15,
    fontWeight: '800',
  },
  orderSubtext: {
    color: adminTheme.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
});
