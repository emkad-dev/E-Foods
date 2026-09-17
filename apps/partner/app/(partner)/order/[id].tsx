import { useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, useNotice } from '@feasty/design-system';
import { SkeletonDetail, SkeletonScreen } from '../../../src/components/Skeleton';
import { formatOrderStatusLabel, normalizeOrderStatus } from '../../../src/domain/orders';
import { getPartnerStatusColor } from '../../../src/theme/statusColors';
import { usePartnerOrder } from '../../../src/hooks/usePartnerOrder';
import {
  acceptPartnerOrder,
  markPartnerOrderDelivered,
  markPartnerOrderPreparing,
  markPartnerOrderReady,
  rejectPartnerOrder,
} from '../../../src/services/partnerOrderActions';
import { partnerTheme } from '../../../src/theme/palette';
import { formatOrderItemOptions, formatPartnerMoney } from '../../../src/utils/partnerQueue';

/** The five transitions this screen can fire; at most one may be in flight. */
type OrderAction = 'accept' | 'preparing' | 'ready' | 'delivered' | 'reject';

export default function PartnerOrderDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { error, loading, order } = usePartnerOrder(id as string);
  const isCompactRail = width < 480;
  // Every action on this screen used to report failure through `Alert`, which
  // is `class Alert { static alert() {} }` in react-native-web — nothing at all
  // on partner.feasty.com.ng. `error` above belongs to `usePartnerOrder` and
  // carries LOAD failures only (it is consumed by the early return below), so a
  // failed Accept or Reject moved no status chip and printed no message: from
  // the kitchen it was indistinguishable from a slow network, and the partner
  // either retried or assumed the order was accepted.
  //
  // Floating rather than inline: the actions live on a horizontally scrolling
  // rail at the bottom of a scrolling page, so an inline notice would often
  // render off-screen. The offset clears the tab bar, which is still mounted
  // here (this route is a `href: null` Tabs.Screen); a notice hidden behind
  // chrome would be the same silence it replaces.
  const { notice, showNotice } = useNotice({
    placement: 'floating',
    offsetBottom: width >= 1024 ? insets.bottom + 16 : insets.bottom + 86,
  });

  // Each action reports its own failure through the one banner. Sticky (errors
  // default to `durationMs: null`): the status chip has not moved and this is
  // the only thing saying why.
  const reportFailure = (message: string) => {
    showNotice({ tone: 'error', title: 'Update failed', message });
  };

  // Per-action, not one screen-wide flag: the same reason the customer profile
  // screen keeps its own `busy` rather than reusing the auth context's. Only the
  // button that was tapped should say "Accepting...".
  const [busy, setBusy] = useState<OrderAction | null>(null);

  // THE guard. `busy` drives the labels and the disabled styling, but setState
  // is asynchronous — two taps landing in the same tick both read `busy === null`
  // and both fire. A double-tapped Accept therefore sent a second request that
  // the server correctly refused with 412 "Only newly placed orders can be
  // accepted", and this screen pinned a sticky "Update failed" over an order
  // that HAD accepted — the one outcome worse than silence, because it tells a
  // kitchen to redo work that already succeeded. The ref is written before the
  // first await, so the second tap returns immediately.
  const busyRef = useRef<OrderAction | null>(null);

  // The order is read once and handed to the callback, so every action works on
  // the snapshot that was on screen when the button was tapped rather than
  // whatever realtime has swapped in since.
  const runAction = async (
    action: OrderAction,
    run: (target: NonNullable<typeof order>) => Promise<unknown>,
    fallbackMessage: string
  ) => {
    const target = order;
    if (!target || busyRef.current) return;

    busyRef.current = action;
    setBusy(action);

    try {
      await run(target);
    } catch (nextError: any) {
      reportFailure(nextError?.message ?? fallbackMessage);
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
  };

  const handleAccept = () =>
    runAction('accept', (target) => acceptPartnerOrder(target.id, target.timeline ?? null), 'Unable to accept this order.');

  const handlePreparing = () =>
    runAction(
      'preparing',
      (target) => markPartnerOrderPreparing(target.id, target.timeline ?? null),
      'Unable to mark this order as preparing.'
    );

  const handleReady = () =>
    runAction('ready', (target) => markPartnerOrderReady(target.id, target.timeline ?? null), 'Unable to mark this order ready.');

  const handleDelivered = () =>
    runAction(
      'delivered',
      (target) => markPartnerOrderDelivered(target.id, target.timeline ?? null),
      'Unable to complete this order.'
    );

  const handleReject = () =>
    runAction(
      'reject',
      async (target) => {
        await rejectPartnerOrder(target.id, target.timeline ?? null);
        router.back();
      },
      'Unable to reject this order.'
    );

  if (loading) {
    return (
      <SkeletonScreen>
        <SkeletonDetail />
      </SkeletonScreen>
    );
  }

  if (!order || error) {
    return (
      <View style={styles.loadingState}>
        <Text style={styles.errorTitle}>Order unavailable</Text>
        <Text style={styles.errorCopy}>{error ?? 'We could not load this order right now.'}</Text>
      </View>
    );
  }

  const normalizedStatus = normalizeOrderStatus(order.status);
  const isPickup = (order.fulfillmentType ?? 'delivery') === 'pickup';
  const canComplete = ['preparing', 'ready_for_pickup'].includes(normalizedStatus);

  return (
    // Wrapped rather than used as the root because the floating notice
    // positions itself absolutely: inside a ScrollView that would anchor it to
    // the bottom of the CONTENT and let it scroll away.
    <View style={styles.screen}>
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Kitchen flow</Text>
          <Text style={styles.title}>Order #{order.id.slice(-6)}</Text>
          <Text style={styles.copy}>
            {(order.items?.reduce((sum, item) => sum + (item.quantity ?? 0), 0) ?? 0)} items ·{' '}
            {(order.fulfillmentType ?? 'delivery').toUpperCase()} · {formatPartnerMoney(order.pricing?.total ?? order.total ?? 0)}
          </Text>
          {/*
            The label is `textOnHero`, not the status colour. The status colours are
            designed to sit on a light card; on the hero they never cleared AA, and
            once the hero became FEASTY green the accepted/preparing tone (#2e7d32)
            landed at 1.45:1 on the pill's own tinted fill — invisible. The tint
            still carries the status hue; the wording carries the meaning.
          */}
          <View style={[styles.statusPill, { backgroundColor: `${getPartnerStatusColor(order.status)}20` }]}>
            <Text style={[styles.statusText, { color: partnerTheme.textOnHero }]}>
              {formatOrderStatusLabel(order.status)}
            </Text>
          </View>
        </View>

        {/*
          The acceptance deadline, surfaced where the accept decision is made.
          The sweep leaves the order 'placed' and only raises `needsAttention`,
          so the status chip above says "Placed" exactly as it did a minute after
          checkout — nothing on this screen told the restaurant its clock had run
          out, or that the miss is counted against it.

          No countdown, deliberately: `acceptanceDeadlineMinutes` lives in
          PlatformSettings and is never sent to this app, so a timer here would be
          guessed from createdAt rather than measured. The flag is a fact; the
          remaining seconds are not.
        */}
        {order.needsAttention === true ? (
          <View style={styles.overdueCard}>
            <Text style={styles.overdueTitle}>Acceptance overdue</Text>
            <Text style={styles.overdueCopy}>
              This order passed its acceptance deadline and support has been notified. If it is not accepted, it will be
              cancelled automatically, refunded in full, and counted as a missed order for this restaurant.
            </Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Order items</Text>
          {order.items?.map((item) => {
            // Null, not an empty string: most items are ordered plain, and a
            // permanent empty "Options:" line on every row is how a kitchen
            // learns to stop reading the row that occasionally says "no onions".
            const options = formatOrderItemOptions(item);

            return (
              <View key={item.id ?? item.name} style={styles.itemRow}>
                <View style={styles.itemDetails}>
                  <Text style={styles.itemName}>{item.name ?? 'Order item'}</Text>
                  <Text style={styles.itemMeta}>Qty {item.quantity ?? 0}</Text>
                  {options ? <Text style={styles.itemOptions}>{options}</Text> : null}
                </View>
                <Text style={styles.itemPrice}>{formatPartnerMoney(((item.price ?? 0) * (item.quantity ?? 0)) || 0)}</Text>
              </View>
            );
          })}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Handoff notes</Text>
          <Text style={styles.metaLine}>Payment: {order.payment?.status ?? 'pending'}</Text>
          {/*
            The server has loaded and sent customerPhone on this response all
            along (`loadUserPhoneNumber` in partnerGetRestaurantOrder); nothing
            rendered it, so a kitchen with a question about an order had no way
            to reach the person who placed it.
          */}
          <Text style={styles.metaLine}>Customer phone: {order.customerPhone?.trim() || 'Not provided'}</Text>
          <Text style={styles.metaLine}>
            Pickup/delivery point: {order.deliveryLocation?.shortAddress ?? order.deliveryAddress ?? 'Pending'}
          </Text>
          <Text style={styles.metaLine}>
            Fulfilment: {isPickup ? 'Customer pickup' : 'Restaurant delivery'}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Actions</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.actionRail, isCompactRail ? styles.actionRailCompact : null]}
          >
            {/*
              Every button is disabled while ANY action is in flight, not just
              the one that was tapped: the transitions are a chain, so letting
              "Start preparing" fire while Accept is still open sends the second
              request against a status the server has not moved yet and earns the
              same spurious 412 the double-tap did.
            */}
            <TouchableOpacity
              style={[
                styles.actionButton,
                isCompactRail ? styles.actionButtonCompact : null,
                busy !== null || normalizedStatus !== 'placed' ? styles.actionButtonDisabled : null,
              ]}
              disabled={busy !== null || normalizedStatus !== 'placed'}
              onPress={handleAccept}
            >
              <Text style={styles.actionButtonText}>{busy === 'accept' ? 'Accepting...' : 'Accept order'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.actionButton,
                isCompactRail ? styles.actionButtonCompact : null,
                busy !== null || !['accepted', 'placed'].includes(normalizedStatus) ? styles.actionButtonDisabled : null,
              ]}
              disabled={busy !== null || !['accepted', 'placed'].includes(normalizedStatus)}
              onPress={handlePreparing}
            >
              <Text style={styles.actionButtonText}>{busy === 'preparing' ? 'Starting...' : 'Start preparing'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.actionButton,
                isCompactRail ? styles.actionButtonCompact : null,
                busy !== null || !['accepted', 'preparing'].includes(normalizedStatus) ? styles.actionButtonDisabled : null,
              ]}
              disabled={busy !== null || !['accepted', 'preparing'].includes(normalizedStatus)}
              onPress={handleReady}
            >
              <Text style={styles.actionButtonText}>
                {busy === 'ready' ? 'Marking...' : isPickup ? 'Mark ready for pickup' : 'Mark ready'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.actionButton,
                isCompactRail ? styles.actionButtonCompact : null,
                busy !== null || !canComplete ? styles.actionButtonDisabled : null,
              ]}
              disabled={busy !== null || !canComplete}
              onPress={handleDelivered}
            >
              <Text style={styles.actionButtonText}>
                {busy === 'delivered' ? 'Completing...' : isPickup ? 'Mark collected' : 'Mark delivered'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.rejectButton,
                isCompactRail ? styles.actionButtonCompact : null,
                busy !== null || !['placed', 'accepted'].includes(normalizedStatus) ? styles.actionButtonDisabled : null,
              ]}
              disabled={busy !== null || !['placed', 'accepted'].includes(normalizedStatus)}
              onPress={handleReject}
            >
              <Text style={styles.rejectButtonText}>{busy === 'reject' ? 'Rejecting...' : 'Reject order'}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </ScrollView>
      {notice}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: partnerTheme.background,
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    alignSelf: 'center',
    maxWidth: 1100,
    paddingHorizontal: 18,
    paddingBottom: 30,
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
  errorTitle: {
    color: partnerTheme.text,
    fontSize: 24,
    fontWeight: '800',
  },
  errorCopy: {
    color: partnerTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    textAlign: 'center',
  },
  hero: {
    backgroundColor: partnerTheme.hero,
    borderRadius: radius['2xl'],
    padding: 22,
  },
  eyebrow: {
    color: partnerTheme.heroSoft,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  title: {
    color: partnerTheme.textOnHero,
    fontSize: 30,
    fontWeight: '800',
  },
  copy: {
    color: partnerTheme.textOnHero,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  statusPill: {
    alignSelf: 'flex-start',
    borderRadius: radius.lg,
    marginTop: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: partnerTheme.surface,
    borderRadius: radius.xl,
    marginTop: 14,
    padding: 18,
  },
  cardTitle: {
    color: partnerTheme.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  actionRail: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingTop: 4,
  },
  actionRailCompact: {
    gap: 8,
    paddingLeft: 2,
    paddingRight: 2,
  },
  overdueCard: {
    backgroundColor: partnerTheme.dangerSoft,
    borderColor: partnerTheme.danger,
    borderRadius: radius.xl,
    borderWidth: 1,
    marginTop: 14,
    padding: 18,
  },
  overdueTitle: {
    // `dangerText` on `dangerSoft`, never the saturated fill red — same pairing
    // the kitchen chips settled on for this surface.
    color: partnerTheme.dangerText,
    fontSize: 17,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  overdueCopy: {
    color: partnerTheme.dangerText,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  itemRow: {
    alignItems: 'center',
    borderTopColor: partnerTheme.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  itemDetails: {
    // The options line is free text of unbounded length; without a flex bound it
    // pushes the price off the row instead of wrapping.
    flex: 1,
    paddingRight: 12,
  },
  itemName: {
    color: partnerTheme.text,
    fontSize: 15,
    fontWeight: '700',
  },
  itemMeta: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    marginTop: 4,
  },
  itemOptions: {
    color: partnerTheme.accentStrong,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
    marginTop: 4,
  },
  itemPrice: {
    color: partnerTheme.accentStrong,
    fontSize: 15,
    fontWeight: '800',
  },
  metaLine: {
    color: partnerTheme.textMuted,
    fontSize: 14,
    lineHeight: 22,
    marginTop: 4,
  },
  actionButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accent,
    borderRadius: radius.lg,
    justifyContent: 'center',
    marginTop: 10,
    minWidth: 158,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  actionButtonCompact: {
    minWidth: 138,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  actionButtonDisabled: {
    // Was backgroundColor '#d7d2c7', a cream-era leftover that put the white
    // label at 1.51:1 -- and since only one action is valid per status, most of
    // these five buttons are disabled most of the time, so staff could not read
    // which was which. Dimming the whole control keeps the label's contrast
    // against its own fill and matches the controlDisabled pattern the Store
    // screens use.
    opacity: 0.5,
  },
  actionButtonText: {
    color: partnerTheme.textOnBrand,
    fontSize: 14,
    fontWeight: '800',
  },
  rejectButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.danger,
    borderRadius: radius.lg,
    justifyContent: 'center',
    marginTop: 10,
    minWidth: 158,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  rejectButtonText: {
    color: partnerTheme.textOnBrand,
    fontSize: 14,
    fontWeight: '800',
  },
});
