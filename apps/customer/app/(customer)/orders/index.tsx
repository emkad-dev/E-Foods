import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import AuthPromptCard from '../../../src/components/AuthPromptCard';
import { useAuth } from '../../../src/contexts/AuthContext';
import {
  formatOrderStatusLabel,
  formatPaymentStatusLabel,
  getOrderStatusColor,
} from '../../../src/domain/orders';
import { getCustomerOrders } from '../../../src/services/customerReadModel';
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

export default function OrdersList() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
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
    const interval = setInterval(() => {
      void loadOrders();
    }, 10000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user]);

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

  if (orders.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No orders yet</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={orders}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={
        <View style={styles.headerCard}>
          <Text style={styles.headerEyebrow}>Order queue</Text>
          <Text style={styles.headerTitle}>Track every customer order in one place.</Text>
          <Text style={styles.headerCopy}>
            Active, paid, and past orders stay here so you can jump into details without digging through the app.
          </Text>
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
              <Text style={styles.date}>
                {item.createdAt?.toDate ? item.createdAt.toDate().toLocaleDateString() : 'Updating...'}
              </Text>
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
  emptyContainer: {
    alignItems: 'center',
    backgroundColor: customerTheme.background,
    flex: 1,
    justifyContent: 'center',
  },
  emptyText: {
    color: customerTheme.textMuted,
    fontSize: 16,
    fontWeight: '700',
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
  headerCard: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 14,
    padding: 16,
  },
  headerEyebrow: {
    color: customerTheme.accentStrong,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  headerTitle: {
    color: customerTheme.text,
    fontSize: 20,
    fontWeight: '800',
    marginTop: 8,
  },
  headerCopy: {
    color: customerTheme.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
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
