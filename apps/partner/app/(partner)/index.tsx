import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/contexts/AuthContext';
import { formatOrderStatusLabel, getOrderStatusColor } from '../../src/domain/orders';
import { usePartnerOrders } from '../../src/hooks/usePartnerOrders';
import { partnerTheme } from '../../src/theme/palette';

export default function PartnerHome() {
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const router = useRouter();
  const { activeOrders, completedToday, error, incomingOrders, loading, preparingOrders, restaurant } = usePartnerOrders();

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (nextError: any) {
      Alert.alert('Sign out failed', nextError.message ?? 'Unable to sign out right now.');
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator size="large" color={partnerTheme.accent} />
        <Text style={styles.loadingCopy}>Loading partner dashboard...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>E-Foods Partner</Text>
        <Text style={styles.title}>{restaurant?.name ?? 'Restaurant operations'}</Text>
        <Text style={styles.copy}>
          Stay on top of incoming orders, kitchen flow, and pickup readiness from one control board.
        </Text>
      </View>

      <View style={styles.metricsRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>{incomingOrders.length}</Text>
          <Text style={styles.metricLabel}>Incoming</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>{preparingOrders.length}</Text>
          <Text style={styles.metricLabel}>In kitchen</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>{completedToday}</Text>
          <Text style={styles.metricLabel}>Completed</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Live queue</Text>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {!restaurant ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No linked restaurant profile yet</Text>
            <Text style={styles.emptyCopy}>Head to the Store tab to create or link the restaurant record this account should manage.</Text>
          </View>
        ) : activeOrders.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No active orders right now</Text>
            <Text style={styles.emptyCopy}>New orders for this restaurant will show up here automatically.</Text>
          </View>
        ) : (
          activeOrders.slice(0, 4).map((order) => (
            <TouchableOpacity
              key={order.id}
              style={styles.orderCard}
              activeOpacity={0.92}
              onPress={() => router.push(`/(partner)/order/${order.id}`)}
            >
              <View style={styles.orderHeader}>
                <Text style={styles.orderTitle}>Order #{order.id.slice(-6)}</Text>
                <View style={[styles.statusPill, { backgroundColor: `${getOrderStatusColor(order.status)}20` }]}>
                  <Text style={[styles.statusText, { color: getOrderStatusColor(order.status) }]}>
                    {formatOrderStatusLabel(order.status)}
                  </Text>
                </View>
              </View>
              <Text style={styles.orderMeta}>
                {order.items?.reduce((sum, item) => sum + (item.quantity ?? 0), 0) ?? 0} items |{' '}
                {order.fulfillmentType ?? 'delivery'} | ${(order.pricing?.total ?? order.total ?? 0).toFixed(2)}
              </Text>
              <Text style={styles.orderMeta}>
                {order.deliveryLocation?.shortAddress ?? order.deliveryAddress ?? 'Customer address pending'}
              </Text>
            </TouchableOpacity>
          ))
        )}
      </View>

      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <Text style={styles.signOutButtonText}>Sign out</Text>
      </TouchableOpacity>
      <StatusBar style="dark" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: partnerTheme.background,
    flex: 1,
  },
  content: {
    paddingHorizontal: 18,
    paddingBottom: 30,
  },
  loadingState: {
    alignItems: 'center',
    backgroundColor: partnerTheme.background,
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  loadingCopy: {
    color: partnerTheme.textMuted,
    fontSize: 15,
    marginTop: 12,
  },
  hero: {
    backgroundColor: partnerTheme.hero,
    borderRadius: 26,
    padding: 22,
  },
  eyebrow: {
    color: partnerTheme.heroSoft,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  title: {
    color: '#fffdf8',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 12,
  },
  copy: {
    color: '#e7dbc7',
    fontSize: 16,
    lineHeight: 24,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  metricCard: {
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    width: '31.5%',
  },
  metricValue: {
    color: partnerTheme.text,
    fontSize: 24,
    fontWeight: '800',
  },
  metricLabel: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 6,
  },
  section: {
    marginTop: 18,
  },
  sectionTitle: {
    color: partnerTheme.text,
    fontSize: 22,
    fontWeight: '800',
  },
  errorText: {
    color: partnerTheme.danger,
    fontSize: 13,
    marginTop: 10,
  },
  emptyCard: {
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 12,
    padding: 18,
  },
  emptyTitle: {
    color: partnerTheme.text,
    fontSize: 17,
    fontWeight: '800',
  },
  emptyCopy: {
    color: partnerTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  orderCard: {
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 12,
    padding: 18,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  orderTitle: {
    color: partnerTheme.text,
    fontSize: 17,
    fontWeight: '800',
  },
  orderMeta: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    marginTop: 8,
  },
  statusPill: {
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  signOutButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accent,
    borderRadius: 16,
    marginTop: 22,
    paddingVertical: 14,
  },
  signOutButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
});
