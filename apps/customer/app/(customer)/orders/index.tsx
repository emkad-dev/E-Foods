import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import AuthPromptCard from '../../../src/components/AuthPromptCard';
import { useAuth } from '../../../src/contexts/AuthContext';
import {
  formatOrderStatusLabel,
  formatPaymentStatusLabel,
  getOrderStatusColor,
  isTerminalOrderStatus,
  normalizeOrderStatus,
} from '../../../src/domain/orders';
import { getCustomerOrders } from '../../../src/services/customerReadModel';
import { supabase } from '../../../src/services/supabase/config';
import { customerTheme } from '../../../src/theme/palette';

type Order = {
  id: string;
  restaurantName: string;
  total?: number;
  pricing?: {
    total: number;
  };
  payment?: {
    method?: string;
    status?: string;
  };
  status: string;
  createdAt: any;
};

const formatMoney = (amount: number) => `₦${amount.toFixed(2)}`;

// Supabase returns ISO date strings. (Legacy Firestore Timestamps exposed a .toDate()
// helper — tolerate those too so old rows still render a real date instead of "Updating...".)
const formatOrderDate = (value: unknown): string => {
  if (!value) {
    return '';
  }

  if (typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
    try {
      return (value as { toDate: () => Date }).toDate().toLocaleDateString();
    } catch {
      return '';
    }
  }

  const timestamp = typeof value === 'number' ? value : Date.parse(String(value));
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleDateString() : '';
};

type OrderFilter = 'all' | 'ongoing' | 'placed' | 'cancelled';

const ORDER_FILTERS: { label: string; value: OrderFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Ongoing', value: 'ongoing' },
  { label: 'Placed', value: 'placed' },
  { label: 'Cancelled', value: 'cancelled' },
  
];

const matchesOrderFilter = (order: Order, filter: OrderFilter) => {
  const status = normalizeOrderStatus(order.status);

  switch (filter) {
    case 'ongoing':
      return !isTerminalOrderStatus(status);
    case 'placed':
      return status === 'delivered' && (order.payment?.status ?? '') === 'paid';
    case 'cancelled':
      return ['cancelled', 'rejected', 'failed_delivery'].includes(status);
    default:
      return true;
  }
};

const getEmptyStateCopy = (filter: OrderFilter) => {
  switch (filter) {
    case 'ongoing':
      return 'No ongoing orders yet.';
    case 'placed':
      return 'No paid orders yet.';
    case 'cancelled':
      return 'No cancelled orders yet.';
    default:
      return 'No orders yet.';
  }
};

const getEmptyStateTitle = (filter: OrderFilter) => {
  switch (filter) {
    case 'ongoing':
      return 'No ongoing orders yet';
    case 'placed':
      return 'No placed orders yet';
    case 'cancelled':
      return 'No cancelled orders yet';
    default:
      return 'No orders yet';
  }
};

export default function OrdersList() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<OrderFilter>('all');
  const router = useRouter();

  useEffect(() => {
    if (!user) {
      setOrders([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const loadOrders = async () => {
      try {
        const nextData = await getCustomerOrders();

        if (cancelled) {
          return;
        }

        setOrders(nextData.orders as Order[]);
      } catch (nextError) {
        if (cancelled) {
          return;
        }

        console.error('Error fetching orders:', nextError);
        setOrders([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadOrders();
    const channel = supabase
      .channel(`customer-orders:${user.uid}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'CustomerOrder',
          filter: `customerId=eq.${user.uid}`,
        },
        () => {
          void loadOrders();
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void loadOrders();
        }
      });

    const interval = setInterval(() => {
      void loadOrders();
    }, 30000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [user]);

  const visibleOrders = useMemo(
    () => orders.filter((order) => matchesOrderFilter(order, activeFilter)),
    [activeFilter, orders]
  );

  if (!user) {
    return (
      <View style={styles.promptContainer}>
        <AuthPromptCard
          title="Sign in to track orders"
          message="Your current and past orders will show up here once you sign in."
        />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={customerTheme.accentStrong} />
      </View>
    );
  }

  return (
    <FlatList
      data={visibleOrders}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={
        <View style={styles.filterShell}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {ORDER_FILTERS.map((filter) => {
              const active = filter.value === activeFilter;

              return (
                <TouchableOpacity
                  key={filter.value}
                  activeOpacity={0.9}
                  onPress={() => setActiveFilter(filter.value)}
                  style={[styles.filterButton, active ? styles.filterButtonActive : null]}
                >
                  <Text style={[styles.filterButtonText, active ? styles.filterButtonTextActive : null]}>
                    {filter.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      }
      ListEmptyComponent={
        <View style={styles.emptyStateCard}>
          <Text style={styles.emptyStateTitle}>{getEmptyStateTitle(activeFilter)}</Text>
          <Text style={styles.emptyStateCopy}>{getEmptyStateCopy(activeFilter)}</Text>
        </View>
      }
      renderItem={({ item, index }) => (
        <Animated.View entering={FadeInUp.delay(index * 90)}>
          <TouchableOpacity style={styles.orderCard} onPress={() => router.push(`/orders/${item.id}`)}>
            <View style={styles.orderHeader}>
              <Text style={styles.restaurantName}>{item.restaurantName}</Text>
              <View style={styles.statusBadge}>
                <Text style={[styles.status, { color: getOrderStatusColor(item.status) }]}>
                  {formatOrderStatusLabel(item.status).toUpperCase()}
                </Text>
              </View>
            </View>
            <Text style={styles.total}>{formatMoney(item.pricing?.total ?? item.total ?? 0)}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.payment}>
                {formatPaymentStatusLabel(item.payment?.status ?? 'pending', item.payment?.method)}
              </Text>
              <Text style={styles.date}>{formatOrderDate(item.createdAt)}</Text>
            </View>
          </TouchableOpacity>
        </Animated.View>
      )}
      contentContainerStyle={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    backgroundColor: customerTheme.background,
    flex: 1,
    justifyContent: 'center',
  },
  emptyStateCard: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 10,
    padding: 18,
  },
  emptyStateTitle: {
    color: customerTheme.text,
    fontSize: 16,
    fontWeight: '800',
  },
  emptyStateCopy: {
    color: customerTheme.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  list: {
    padding: 14,
    paddingBottom: 30,
  },
  promptContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  filterShell: {
    backgroundColor: customerTheme.headerSurface,
    borderColor: 'rgba(3, 184, 51, 0.12)',
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 14,
    padding: 4,
  },
  filterRow: {
    flexDirection: 'row',
  },
  filterButton: {
    alignItems: 'center',
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    marginRight: 8,
    minWidth: 80,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  filterButtonActive: {
    backgroundColor: customerTheme.accentStrong,
    borderColor: customerTheme.accentStrong,
    shadowColor: customerTheme.accentStrong,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 8,
    elevation: 2,
  },
  filterButtonText: {
    color: customerTheme.text,
    fontSize: 12,
    fontWeight: '800',
  },
  filterButtonTextActive: {
    color: '#ffffff',
  },
  orderCard: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 12,
    padding: 14,
  },
  orderHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  restaurantName: {
    color: customerTheme.text,
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    marginRight: 10,
  },
  statusBadge: {
    backgroundColor: customerTheme.accentTint,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  status: {
    fontSize: 10,
    fontWeight: '800',
  },
  total: {
    color: customerTheme.accentStrong,
    fontSize: 18,
    fontWeight: '800',
    marginTop: 10,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  payment: {
    color: customerTheme.textMuted,
    flex: 1,
    fontSize: 12,
    marginRight: 8,
  },
  date: {
    color: customerTheme.textSoft,
    fontSize: 11,
  },
});
