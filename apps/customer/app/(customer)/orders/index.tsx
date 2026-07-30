import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import {
  Card,
  Chip,
  EmptyState,
  Skeleton,
  SkeletonRow,
  SkeletonScreen,
  Text,
  radius,
  space,
  surface,
} from '@feasty/design-system';
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
      return "When you place an order, you'll be able to track it here.";
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
      <SkeletonScreen>
        <Skeleton width={220} height={44} radius="lg" style={styles.filterSkeleton} />
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </SkeletonScreen>
    );
  }

  return (
    <FlatList
      data={visibleOrders}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {ORDER_FILTERS.map((filter) => (
            <Chip
              key={filter.value}
              label={filter.label}
              selected={filter.value === activeFilter}
              onPress={() => setActiveFilter(filter.value)}
            />
          ))}
        </ScrollView>
      }
      ListEmptyComponent={
        <EmptyState
          title={getEmptyStateTitle(activeFilter)}
          body={getEmptyStateCopy(activeFilter)}
        />
      }
      renderItem={({ item, index }) => (
        <Animated.View entering={FadeInUp.delay(index * 90)}>
          <Card
            padding="md"
            radius="xl"
            style={styles.orderCard}
            onPress={() => router.push(`/orders/${item.id}`)}
          >
            <View style={styles.orderHeader}>
              <Text variant="title3" style={styles.restaurantName} numberOfLines={1}>
                {item.restaurantName}
              </Text>
              <View style={styles.statusBadge}>
                <Text variant="caption" style={{ color: getOrderStatusColor(item.status) }}>
                  {formatOrderStatusLabel(item.status).toUpperCase()}
                </Text>
              </View>
            </View>

            <Text variant="title2" tone="primary" style={styles.total}>
              {formatMoney(item.pricing?.total ?? item.total ?? 0)}
            </Text>

            <View style={styles.metaRow}>
              <Text variant="callout" tone="secondary" style={styles.payment} numberOfLines={1}>
                {formatPaymentStatusLabel(item.payment?.status ?? 'pending', item.payment?.method)}
              </Text>
              <Text variant="caption" tone="secondary">
                {formatOrderDate(item.createdAt)}
              </Text>
            </View>
          </Card>
        </Animated.View>
      )}
      contentContainerStyle={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    padding: space.lg,
    paddingBottom: space['3xl'],
  },
  promptContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: space.xl,
  },
  filterSkeleton: {
    marginBottom: space.lg,
  },
  filterRow: {
    flexDirection: 'row',
    gap: space.sm,
    marginBottom: space.lg,
  },
  orderCard: {
    marginBottom: space.md,
  },
  orderHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.md,
  },
  restaurantName: {
    flex: 1,
  },
  statusBadge: {
    backgroundColor: surface.muted,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  total: {
    marginTop: space.md,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    marginTop: space.sm,
  },
  payment: {
    flex: 1,
  },
});
