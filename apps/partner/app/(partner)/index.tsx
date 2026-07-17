import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/contexts/AuthContext';
import { formatOrderStatusLabel } from '../../src/domain/orders';
import { usePartnerOrders } from '../../src/hooks/usePartnerOrders';
import { partnerTheme } from '../../src/theme/palette';
import { getPartnerStatusColor } from '../../src/theme/statusColors';
import {
  buildPartnerStatusBreakdown,
  computePartnerKpis,
  formatDelta,
  formatOrderTime,
  RANGE_OPTIONS,
  sortOrdersByNewest,
  type RangeDays,
} from '../../src/utils/partnerAnalytics';
import { formatPartnerMoney } from '../../src/utils/partnerQueue';

const WIDE_BREAKPOINT = 1024;

function KpiCard({
  label,
  value,
  current,
  previous,
  note,
  noteColor,
  wide,
}: {
  label: string;
  value: string;
  current?: number;
  previous?: number;
  note?: string;
  noteColor?: string;
  wide: boolean;
}) {
  const delta =
    !note && typeof current === 'number' && typeof previous === 'number' ? formatDelta(current, previous) : null;
  const deltaColor =
    delta?.direction === 'up'
      ? partnerTheme.success
      : delta?.direction === 'down'
        ? partnerTheme.danger
        : partnerTheme.textSoft;

  return (
    <View style={[styles.kpiCard, wide ? styles.kpiCardWide : null]}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={styles.kpiValue} numberOfLines={1}>
        {value}
      </Text>
      {note ? (
        <Text style={[styles.kpiDelta, { color: noteColor ?? partnerTheme.textSoft }]}>{note}</Text>
      ) : (
        <Text style={[styles.kpiDelta, { color: deltaColor }]}>
          {delta
            ? `${delta.direction === 'up' ? '▲ ' : delta.direction === 'down' ? '▼ ' : ''}${delta.label}`
            : 'Live count'}
        </Text>
      )}
    </View>
  );
}

export default function PartnerHome() {
  const insets = useSafeAreaInsets();
  const { signOut, user } = useAuth();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = Platform.OS === 'web' && width >= WIDE_BREAKPOINT;
  const { completedToday, error, incomingOrders, loading, orders, preparingOrders, restaurant } = usePartnerOrders();
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);

  const rawName =
    restaurant?.name?.trim() || user?.restaurantName?.trim() || user?.displayName?.trim() || user?.email?.split('@')[0]?.trim() || 'Partner';
  const greetingName = rawName.slice(0, 24);

  const kpis = useMemo(() => computePartnerKpis(orders, rangeDays), [orders, rangeDays]);
  const statusBreakdown = useMemo(() => buildPartnerStatusBreakdown(orders, rangeDays), [orders, rangeDays]);
  const breakdownTotal = useMemo(
    () => statusBreakdown.reduce((total, slice) => total + slice.count, 0),
    [statusBreakdown]
  );
  const recentOrders = useMemo(() => sortOrdersByNewest(orders).slice(0, 8), [orders]);

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
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: (isWide ? 8 : insets.top) + 16 }]}
    >
      <View style={styles.headerRow}>
        <View style={styles.greetingBlock}>
          <Text style={styles.greetingText} numberOfLines={1}>
            Hello, {greetingName}!
          </Text>
          {restaurant?.name ? (
            <Text style={styles.greetingMeta} numberOfLines={1}>
              {restaurant.name}
            </Text>
          ) : null}
        </View>
        {!isWide ? (
          <TouchableOpacity onPress={handleSignOut}>
            <Text style={styles.signOutLink}>Sign out</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.rangeRow}>
        {RANGE_OPTIONS.map((option) => {
          const active = rangeDays === option.value;

          return (
            <TouchableOpacity
              key={option.value}
              style={[styles.rangeChip, active ? styles.rangeChipActive : null]}
              onPress={() => setRangeDays(option.value)}
            >
              <Text style={active ? styles.rangeChipActiveText : styles.rangeChipText}>{option.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {!restaurant ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No linked restaurant profile yet</Text>
          <Text style={styles.emptyCopy}>
            Head to the Store tab to create or link the restaurant record this account should manage.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.kpiGrid}>
            <KpiCard
              label={`Orders (${rangeDays}d)`}
              value={String(kpis.orders.current)}
              current={kpis.orders.current}
              previous={kpis.orders.previous}
              wide={isWide}
            />
            <KpiCard
              label={`Earnings (${rangeDays}d)`}
              value={formatPartnerMoney(kpis.earnings.current)}
              current={kpis.earnings.current}
              previous={kpis.earnings.previous}
              wide={isWide}
            />
            <KpiCard
              label="Avg order value"
              value={formatPartnerMoney(kpis.avgOrder.current)}
              current={kpis.avgOrder.current}
              previous={kpis.avgOrder.previous}
              wide={isWide}
            />
            <KpiCard label="Incoming" value={String(incomingOrders.length)} wide={isWide} />
            <KpiCard label="In kitchen" value={String(preparingOrders.length)} wide={isWide} />
            <KpiCard label="Delivered today" value={String(completedToday)} wide={isWide} />
          </View>

          <View style={[styles.splitRow, isWide ? styles.splitRowWide : null]}>
            <View style={[styles.card, isWide ? styles.splitCardNarrow : null]}>
              <Text style={styles.cardTitle}>Orders by status ({rangeDays}d)</Text>
              {breakdownTotal === 0 ? (
                <View style={styles.emptyInline}>
                  <Text style={styles.emptyCopy}>No orders in this window yet.</Text>
                </View>
              ) : (
                <>
                  <View style={styles.breakdownBar}>
                    {statusBreakdown.map((slice) => (
                      <View
                        key={slice.status}
                        style={{
                          backgroundColor: slice.color,
                          flex: slice.count,
                        }}
                      />
                    ))}
                  </View>
                  {statusBreakdown.map((slice) => (
                    <View key={slice.status} style={styles.legendRow}>
                      <View style={styles.legendLeft}>
                        <View style={[styles.legendDot, { backgroundColor: slice.color }]} />
                        <Text style={styles.legendLabel}>{slice.label}</Text>
                      </View>
                      <Text style={styles.legendValue}>
                        {slice.count} · {Math.round((slice.count / breakdownTotal) * 100)}%
                      </Text>
                    </View>
                  ))}
                </>
              )}
            </View>

            <View style={[styles.card, isWide ? styles.splitCardWide : null]}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>Orders history</Text>
                <TouchableOpacity onPress={() => router.push('/(partner)/orders')}>
                  <Text style={styles.moreLink}>more →</Text>
                </TouchableOpacity>
              </View>
              {recentOrders.length === 0 ? (
                <View style={styles.emptyInline}>
                  <Text style={styles.emptyCopy}>New orders for this restaurant will show up here automatically.</Text>
                </View>
              ) : (
                recentOrders.map((order) => {
                  const statusColor = getPartnerStatusColor(order.status);

                  return (
                    <TouchableOpacity
                      key={order.id}
                      style={styles.orderRow}
                      activeOpacity={0.92}
                      onPress={() => router.push(`/(partner)/order/${order.id}`)}
                    >
                      <View style={styles.orderMeta}>
                        <Text style={styles.orderTitle}>#{order.id.slice(-6).toUpperCase()}</Text>
                        <Text style={styles.orderSub}>{formatOrderTime(order.createdAt)}</Text>
                      </View>
                      <View style={[styles.statusPill, { backgroundColor: `${statusColor}20` }]}>
                        <Text style={[styles.statusText, { color: statusColor }]}>
                          {formatOrderStatusLabel(order.status)}
                        </Text>
                      </View>
                      <Text style={styles.orderAmount}>
                        {formatPartnerMoney(order.pricing?.total ?? (order as { total?: number }).total ?? 0)}
                      </Text>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: partnerTheme.background,
    flex: 1,
  },
  content: {
    alignSelf: 'center',
    maxWidth: 1100,
    paddingBottom: 30,
    paddingHorizontal: 18,
    width: '100%',
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
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  greetingBlock: {
    flex: 1,
    paddingRight: 12,
  },
  greetingText: {
    color: partnerTheme.text,
    fontSize: 24,
    fontWeight: '800',
  },
  greetingMeta: {
    color: partnerTheme.textMuted,
    fontSize: 14,
    marginTop: 2,
  },
  signOutLink: {
    color: partnerTheme.danger,
    fontSize: 13,
    fontWeight: '700',
  },
  rangeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  rangeChip: {
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  rangeChipActive: {
    backgroundColor: partnerTheme.accent,
    borderColor: partnerTheme.accent,
  },
  rangeChipText: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  rangeChipActiveText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  errorText: {
    color: partnerTheme.danger,
    fontSize: 13,
    marginTop: 12,
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 16,
  },
  kpiCard: {
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: 18,
    borderWidth: 1,
    minHeight: 104,
    padding: 16,
    width: '47.5%',
  },
  kpiCardWide: {
    flex: 1,
    minWidth: 160,
    width: 'auto',
  },
  kpiLabel: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  kpiValue: {
    color: partnerTheme.text,
    fontSize: 24,
    fontWeight: '800',
    marginTop: 6,
  },
  kpiDelta: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 6,
  },
  splitRow: {
    gap: 14,
    marginTop: 16,
  },
  splitRowWide: {
    alignItems: 'flex-start',
    flexDirection: 'row',
  },
  splitCardNarrow: {
    flex: 1,
  },
  splitCardWide: {
    flex: 1.6,
  },
  card: {
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
  },
  cardTitle: {
    color: partnerTheme.text,
    fontSize: 16,
    fontWeight: '800',
  },
  cardTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  moreLink: {
    color: partnerTheme.accentStrong,
    fontSize: 13,
    fontWeight: '700',
  },
  breakdownBar: {
    borderRadius: 999,
    flexDirection: 'row',
    height: 14,
    marginTop: 14,
    overflow: 'hidden',
  },
  legendRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  legendLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  legendDot: {
    borderRadius: 999,
    height: 10,
    width: 10,
  },
  legendLabel: {
    color: partnerTheme.text,
    fontSize: 13,
    fontWeight: '600',
  },
  legendValue: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  orderRow: {
    alignItems: 'center',
    borderColor: partnerTheme.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    padding: 12,
  },
  orderMeta: {
    flex: 1,
  },
  orderTitle: {
    color: partnerTheme.text,
    fontSize: 14,
    fontWeight: '800',
  },
  orderSub: {
    color: partnerTheme.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  statusPill: {
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  orderAmount: {
    color: partnerTheme.accentStrong,
    fontSize: 14,
    fontWeight: '800',
  },
  emptyCard: {
    backgroundColor: partnerTheme.surface,
    borderRadius: 20,
    marginTop: 14,
    padding: 18,
  },
  emptyInline: {
    marginTop: 12,
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
});
