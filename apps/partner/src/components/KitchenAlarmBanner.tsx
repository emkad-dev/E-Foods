// The one alert surface for a new order, on every partner screen and at every width.
//
// IT REPLACES A TRAP. The previous alert was a `position: absolute` inset-0
// interstitial inside KitchenBoard, laid over the top bar and all four columns. While
// it was up you could not read the queue, tap a ticket, or reach the mute button, and
// the only way out was one Acknowledge press per order. This sits in normal flow at the
// top of the partner shell instead: it pushes the app down rather than covering it, so
// the board, the list, the tabs and the sidebar all stay live while it sounds. It also
// carries the Acknowledge all that the interstitial never had.
//
// IT IS ALSO THE PHONE'S ALARM. KitchenBoard is only mounted above 900dp, so below that
// there was no sound and no alert of any kind -- a phone was never told an order
// arrived. Rendering this from the (partner) layout means one implementation serves the
// phone list, the tablet board and the desktop sidebar shell.
//
// It renders in two other cases besides an active alarm, both meaning "the alarm you
// are relying on is degraded": browser autoplay refused (so the chime is silent) and
// the screen wake lock failed (so the device can sleep and stop polling). Those warn
// BEFORE an order lands, which is the only time such a warning is any use.
//
// Props, not `useKitchenAlarm()`: its provider renders this component, so reaching back
// into the context from here would make the two modules import each other.
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MIN_TAP_TARGET, radius } from '@feasty/design-system';
import type { OrderDocument } from '../domain/entities';
import { partnerTheme } from '../theme/palette';
import { formatPartnerMoney } from '../utils/partnerQueue';

const orderItemCount = (order: OrderDocument) => order.items?.reduce((sum, item) => sum + (item.quantity ?? 0), 0) ?? 0;

export type KitchenAlarmBannerProps = {
  alarmVisible: boolean;
  alarmingOrders: OrderDocument[];
  muted: boolean;
  soundBlocked: boolean;
  keepAwakeFailed: boolean;
  acknowledge: (orderId: string) => void;
  acknowledgeAll: () => void;
  setMuted: (muted: boolean) => void;
  enableSound: () => void;
};

export function KitchenAlarmBanner({
  acknowledge,
  acknowledgeAll,
  alarmVisible,
  alarmingOrders,
  enableSound,
  keepAwakeFailed,
  muted,
  setMuted,
  soundBlocked,
}: KitchenAlarmBannerProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const degraded = soundBlocked || keepAwakeFailed;

  if (!alarmVisible && !degraded) {
    return null;
  }

  // The degraded notices render on their own when nothing is alarming, and inside the
  // alert when something is -- never twice.
  const notices = (
    <>
      {soundBlocked ? (
        <TouchableOpacity style={styles.notice} onPress={enableSound}>
          <Text style={styles.noticeText}>
            Sound is blocked by this browser. Tap to enable the alarm — until you do, new orders arrive silently.
          </Text>
        </TouchableOpacity>
      ) : null}

      {keepAwakeFailed ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            This device may sleep. Keeping the screen awake failed, and a sleeping screen stops receiving orders.
          </Text>
        </View>
      ) : null}
    </>
  );

  if (!alarmVisible) {
    return <View style={[styles.noticeOnly, { paddingTop: insets.top + 10 }]}>{notices}</View>;
  }

  return (
    <View style={[styles.alarm, { paddingTop: insets.top + 12 }]}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>
          {alarmingOrders.length > 1 ? `${alarmingOrders.length} new orders` : 'New order'}
        </Text>

        <View style={styles.headerActions}>
          {/*
            Mute is reachable WHILE the alarm sounds. It sat behind the interstitial
            before, so the one control that stops the noise was covered by the noise.
          */}
          <TouchableOpacity
            style={[styles.headerButton, muted ? styles.headerButtonMuted : null]}
            onPress={() => setMuted(!muted)}
          >
            <Text style={styles.headerButtonText}>{muted ? 'Sound off' : 'Sound on'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.headerButton, styles.headerButtonPrimary]} onPress={acknowledgeAll}>
            <Text style={styles.headerButtonText}>Acknowledge all</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cardRow}>
        {alarmingOrders.map((order) => (
          <View key={order.id} style={styles.card}>
            <Text style={styles.cardNumber}>#{order.id.slice(-6)}</Text>
            <Text style={styles.cardMeta}>
              {orderItemCount(order)} items · {formatPartnerMoney(order.pricing?.total ?? 0)}
            </Text>

            <View style={styles.cardActions}>
              {/*
                Opening the order is what a kitchen actually wants from an alert, and
                the interstitial did not offer it -- you had to acknowledge, wait for
                the sheet to close, then find the ticket again. Opening also
                acknowledges: you cannot be looking at an order and un-told about it.
              */}
              <TouchableOpacity
                style={[styles.cardButton, styles.cardButtonPrimary]}
                onPress={() => {
                  acknowledge(order.id);
                  router.push(`/(partner)/order/${order.id}`);
                }}
              >
                <Text style={styles.cardButtonPrimaryText}>Open</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.cardButton} onPress={() => acknowledge(order.id)}>
                <Text style={styles.cardButtonText}>Acknowledge</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>

      {notices}
    </View>
  );
}

const styles = StyleSheet.create({
  alarm: {
    backgroundColor: partnerTheme.hero,
    paddingBottom: 14,
    paddingHorizontal: 16,
  },
  noticeOnly: {
    backgroundColor: partnerTheme.dangerSoft,
    paddingBottom: 10,
    paddingHorizontal: 16,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
  },
  headerTitle: {
    color: partnerTheme.textOnHero,
    fontSize: 24,
    fontWeight: '900',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  headerButton: {
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderColor: partnerTheme.textOnHero,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerButtonPrimary: {
    backgroundColor: 'rgba(255, 255, 255, 0.32)',
  },
  headerButtonMuted: {
    backgroundColor: partnerTheme.danger,
    borderColor: partnerTheme.danger,
  },
  headerButtonText: {
    color: partnerTheme.textOnHero,
    fontSize: 14,
    fontWeight: '800',
  },
  cardRow: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 12,
  },
  card: {
    backgroundColor: partnerTheme.surface,
    borderRadius: radius.lg,
    minWidth: 220,
    padding: 14,
  },
  cardNumber: {
    color: partnerTheme.text,
    fontSize: 22,
    fontWeight: '900',
  },
  cardMeta: {
    color: partnerTheme.textMuted,
    fontSize: 14,
    marginTop: 6,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  cardButton: {
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    backgroundColor: partnerTheme.surfaceMuted,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  cardButtonPrimary: {
    backgroundColor: partnerTheme.accent,
  },
  cardButtonText: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    fontWeight: '800',
  },
  cardButtonPrimaryText: {
    color: partnerTheme.textOnAccent,
    fontSize: 13,
    fontWeight: '800',
  },
  notice: {
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    backgroundColor: partnerTheme.dangerSoft,
    borderRadius: radius.md,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noticeText: {
    color: partnerTheme.dangerText,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
});
