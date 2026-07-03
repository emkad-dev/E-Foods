import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AdminBackendStatusBanner from '../../src/components/AdminBackendStatusBanner';
import AdminCard from '../../src/components/AdminCard';
import AdminEmptyState from '../../src/components/AdminEmptyState';
import AdminScreenHeader from '../../src/components/AdminScreenHeader';
import AdminStatusBadge from '../../src/components/AdminStatusBadge';
import type { OrderDocument } from '../../src/domain/entities';
import { useVisibilityRefresh } from '../../src/hooks/useVisibilityRefresh';
import { getAdminDashboardSnapshot } from '../../src/services/platformReads';
import { adminTheme } from '../../src/theme/palette';
import { getOrderTone } from '../../src/theme/status';

export default function AdminOrdersScreen() {
  const insets = useSafeAreaInsets();
  const [orders, setOrders] = useState<OrderDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backendSource, setBackendSource] = useState<'live' | 'cache' | 'fallback'>('live');
  const [query, setQuery] = useState('');

  const loadSnapshot = async (cancelled = false) => {
    try {
      const nextSnapshot = await getAdminDashboardSnapshot();

      if (cancelled) {
        return;
      }

      setOrders(nextSnapshot.data.orders);
      setBackendSource(nextSnapshot.source);
      setError(null);
    } catch (nextError: any) {
      if (cancelled) {
        return;
      }

      console.error('Error loading admin orders view:', nextError);
      setError(nextError.message ?? 'Unable to load orders right now.');
    } finally {
      if (!cancelled) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    let cancelled = false;

    void loadSnapshot();
    const interval = setInterval(() => {
      void loadSnapshot(cancelled);
    }, 20000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useVisibilityRefresh(() => {
    void loadSnapshot();
  });

  const sortedOrders = useMemo(
    () => [...orders].sort((left, right) => String(right.id).localeCompare(String(left.id))),
    [orders]
  );

  const filteredOrders = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return sortedOrders;
    }

    return sortedOrders.filter((order) =>
      [order.restaurantName, order.id, order.status]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(normalizedQuery))
    );
  }, [sortedOrders, query]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
      <AdminScreenHeader
        eyebrow="Operations"
        title="Orders"
        subtitle="Live order traffic across every restaurant on the platform."
      />

      <AdminBackendStatusBanner source={backendSource} />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {loading ? (
        <AdminCard>
          <ActivityIndicator size="large" color={adminTheme.accent} />
          <Text style={styles.loadingText}>Loading orders...</Text>
        </AdminCard>
      ) : null}

      {!loading && orders.length > 0 ? (
        <View style={styles.searchShell}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by restaurant, order id, or status"
            placeholderTextColor={adminTheme.textMuted}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      ) : null}

      {!loading && orders.length === 0 ? (
        <AdminEmptyState
          title="No orders yet"
          body="Orders will appear here once the customer app starts placing checkout traffic into the sandbox."
        />
      ) : null}

      {!loading && orders.length > 0 && filteredOrders.length === 0 ? (
        <AdminEmptyState
          title="No matching orders"
          body="No order matches that search. Try a different restaurant, id, or status."
        />
      ) : null}

      {!loading && filteredOrders.length > 0 ? (
        <AdminCard title="Orders">
          {filteredOrders.map((order) => (
            <View key={order.id} style={styles.orderRow}>
              <View style={styles.orderMeta}>
                <Text style={styles.orderTitle}>{order.restaurantName ?? 'Unknown restaurant'}</Text>
                <Text style={styles.orderSubtext}>
                  #{String(order.id).slice(-6)} | {order.fulfillmentType ?? 'Fulfillment not set'} | ₦
                  {Number(order.pricing?.total ?? 0).toFixed(2)}
                </Text>
              </View>
              <AdminStatusBadge label={order.status ?? 'unknown'} tone={getOrderTone(order.status)} />
            </View>
          ))}
        </AdminCard>
      ) : null}
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
  searchShell: {
    backgroundColor: adminTheme.surface,
    borderColor: adminTheme.border,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 16,
    paddingHorizontal: 14,
  },
  searchInput: {
    color: adminTheme.text,
    fontSize: 14,
    minHeight: 48,
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
