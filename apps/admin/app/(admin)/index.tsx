import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AdminCard from '../../src/components/AdminCard';
import AdminEmptyState from '../../src/components/AdminEmptyState';
import AdminStatusBadge from '../../src/components/AdminStatusBadge';
import { useAuth } from '../../src/contexts/AuthContext';
import type { DispatchProfileDocument, OrderDocument, RestaurantDocument, UserDocument } from '../../src/domain/entities';
import { getAdminDashboardSnapshot } from '../../src/services/platformReads';
import { adminTheme } from '../../src/theme/palette';
import { getApprovalTone, getOrderTone } from '../../src/theme/status';

export default function AdminDashboardScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [users, setUsers] = useState<UserDocument[]>([]);
  const [restaurants, setRestaurants] = useState<RestaurantDocument[]>([]);
  const [orders, setOrders] = useState<OrderDocument[]>([]);
  const [dispatchProfiles, setDispatchProfiles] = useState<DispatchProfileDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadSnapshot = async () => {
      try {
        const nextSnapshot = await getAdminDashboardSnapshot();

        if (cancelled) {
          return;
        }

        setUsers(nextSnapshot.users);
        setRestaurants(nextSnapshot.restaurants);
        setOrders(nextSnapshot.orders);
        setDispatchProfiles(nextSnapshot.dispatchProfiles);
        setError(null);
      } catch (nextError: any) {
        if (cancelled) {
          return;
        }

        console.error('Error loading admin dashboard snapshot:', nextError);
        setError(nextError.message ?? 'Unable to load the admin dashboard right now.');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadSnapshot();
    const interval = setInterval(() => {
      void loadSnapshot();
    }, 20000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

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

    return [
      { label: 'Platform users', value: String(users.length), tone: 'primary' as const },
      { label: 'Published stores', value: String(publishedRestaurants), tone: 'success' as const },
      { label: 'Pending approvals', value: String(pendingApprovals), tone: 'warning' as const },
      { label: 'Live orders', value: String(liveOrders), tone: 'danger' as const },
      { label: 'Dispatch online', value: String(onlineDispatch), tone: 'info' as const },
    ];
  }, [dispatchProfiles, orders, restaurants, users.length]);

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
      <View style={styles.greetingBlock}>
        <Text style={styles.greetingText} numberOfLines={1}>
          HI {greetingName}
        </Text>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {loading ? (
        <AdminCard>
          <ActivityIndicator size="large" color={adminTheme.accent} />
          <Text style={styles.loadingText}>Loading the admin overview...</Text>
        </AdminCard>
      ) : null}

      <View style={styles.metricsGrid}>
        {metrics.map((metric) => (
          <View
            key={metric.label}
            style={[
              styles.metricCard,
              metric.tone === 'success' ? styles.metricSuccess : null,
              metric.tone === 'warning' ? styles.metricWarning : null,
              metric.tone === 'danger' ? styles.metricDanger : null,
              metric.tone === 'info' ? styles.metricInfo : null,
            ]}
          >
            <Text style={styles.metricValue}>{metric.value}</Text>
            <Text style={styles.metricLabel}>{metric.label}</Text>
          </View>
        ))}
      </View>

      <AdminCard title="Role coverage">
        <Text style={styles.metaLine}>Admins: {roleCounts.admins}</Text>
        <Text style={styles.metaLine}>Customers: {roleCounts.customers}</Text>
        <Text style={styles.metaLine}>Partners: {roleCounts.partners}</Text>
        <Text style={styles.metaLine}>Dispatch: {roleCounts.dispatch}</Text>
      </AdminCard>

      <AdminCard title="Recent order watch">
        {recentOrders.length === 0 ? (
          <AdminEmptyState
            title="No orders yet"
            body="Orders will appear here once the customer app starts placing checkout traffic into the sandbox."
          />
        ) : null}
        {recentOrders.map((order) => (
          <View key={order.id} style={styles.orderRow}>
            <View style={styles.orderMeta}>
              <Text style={styles.orderTitle}>{order.restaurantName ?? 'Unknown restaurant'}</Text>
              <Text style={styles.orderSubtext}>
                {order.fulfillmentType ?? 'Fulfillment not set'} | {order.id}
              </Text>
            </View>
            <AdminStatusBadge label={order.status ?? 'unknown'} tone={getOrderTone(order.status)} />
          </View>
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
          <View key={restaurant.id} style={styles.orderRow}>
            <View style={styles.orderMeta}>
              <Text style={styles.orderTitle}>{restaurant.name}</Text>
              <Text style={styles.orderSubtext}>{restaurant.address ?? 'Address pending'}</Text>
            </View>
            <AdminStatusBadge
              label={restaurant.approvalStatus ?? (restaurant.isPublished === true ? 'approved' : 'pending')}
              tone={getApprovalTone(restaurant.approvalStatus, restaurant.isPublished)}
            />
          </View>
        ))}
      </AdminCard>
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
    minHeight: 116,
    padding: 16,
    width: '47%',
  },
  metricSuccess: {
    backgroundColor: adminTheme.successSoft,
    borderColor: '#bbf7d0',
  },
  metricWarning: {
    backgroundColor: adminTheme.warningSoft,
    borderColor: '#fed7aa',
  },
  metricDanger: {
    backgroundColor: adminTheme.dangerSoft,
    borderColor: '#fecaca',
  },
  metricInfo: {
    backgroundColor: adminTheme.infoSoft,
    borderColor: '#99f6e4',
  },
  metricValue: {
    color: adminTheme.text,
    fontSize: 26,
    fontWeight: '800',
  },
  metricLabel: {
    color: adminTheme.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
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
