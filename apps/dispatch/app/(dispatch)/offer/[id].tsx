// The rider-facing delivery offer screen (Task 10 / D2).
//
// Reached two ways, and it needs both: the offer push (routeKey
// `dispatch_delivery_offer` -> /offer/<orderId>), and the offer banner on the
// deliveries list. Push alone is not sufficient - a rider with notifications
// denied, a stale Expo token, or the app already foregrounded would never
// learn the offer exists and would watch the window lapse. The
// route param is the ORDER id, not the offer id: a push is addressed to an
// order, and the rider's live offer for it is looked up from the queue.
//
// The countdown is presentational ONLY. The 45s deadline is enforced by
// ebuy_accept_dispatch_offer's own `respondsBy <= now()` check against the
// database clock, so a rider with a skewed device clock, a backgrounded app,
// or a paused JS timer cannot accept a dead offer and cannot be robbed of a
// live one. Reaching zero here disables the button and stops pretending the
// offer is live; it does not itself expire anything.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { radius } from '@feasty/design-system';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SkeletonDetail, SkeletonScreen } from '../../../src/components/Skeleton';
import { useDispatchOrders } from '../../../src/hooks/useDispatchOrders';
import { acceptDispatchOffer, declineDispatchOffer } from '../../../src/services/dispatchOrderActions';
import { dispatchTheme } from '../../../src/theme/palette';
import { calculateDistanceKm } from '../../../src/utils/deliveryDistance';
import type { DispatchOfferNoticeKey } from '../../../src/utils/routeNotices';
import { MIN_TAP_TARGET } from '../../../../../packages/design-system/src/tokens/space';

const formatCurrency = (value?: number | null) => {
  const amount = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return `₦${amount.toLocaleString('en-NG', { maximumFractionDigits: 0 })}`;
};

const formatDistance = (km: number | null) => {
  if (km === null || !Number.isFinite(km)) {
    return 'Distance unavailable';
  }

  return km < 1 ? `${Math.round(km * 1000)} m away` : `${km.toFixed(1)} km away`;
};

/** Whole seconds left, floored at 0. Recomputed from the deadline, never decremented. */
const secondsRemaining = (respondsBy?: string | null) => {
  const deadline = Date.parse(respondsBy ?? '');
  if (!Number.isFinite(deadline)) {
    return 0;
  }

  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
};

export default function DispatchOfferScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { error, loading, offers, reload } = useDispatchOrders();
  const [submitting, setSubmitting] = useState<'accept' | 'decline' | null>(null);

  const orderId = typeof id === 'string' ? id : '';
  const offer = useMemo(() => offers.find((entry) => entry.orderId === orderId) ?? null, [offers, orderId]);

  // Derived from the deadline on every tick rather than decremented from a
  // stored value, so a backgrounded app that misses ticks resumes with the
  // correct number instead of a stale one.
  const [remaining, setRemaining] = useState(() => secondsRemaining(offer?.respondsBy));

  useEffect(() => {
    setRemaining(secondsRemaining(offer?.respondsBy));

    if (!offer?.respondsBy) {
      return;
    }

    const timer = setInterval(() => {
      setRemaining(secondsRemaining(offer.respondsBy));
    }, 1000);

    return () => clearInterval(timer);
  }, [offer?.respondsBy]);

  const order = offer?.order;

  const distanceKm = useMemo(() => {
    const restaurant = order?.restaurantLocation as { latitude?: number; longitude?: number } | null | undefined;
    const delivery = order?.deliveryLocation as { latitude?: number; longitude?: number } | null | undefined;

    if (
      typeof restaurant?.latitude !== 'number' ||
      typeof restaurant?.longitude !== 'number' ||
      typeof delivery?.latitude !== 'number' ||
      typeof delivery?.longitude !== 'number'
    ) {
      return null;
    }

    return calculateDistanceKm(
      { latitude: restaurant.latitude, longitude: restaurant.longitude },
      { latitude: delivery.latitude, longitude: delivery.longitude }
    );
  }, [order]);

  const respond = useCallback(
    async (action: 'accept' | 'decline') => {
      if (!offer || submitting) {
        return;
      }

      setSubmitting(action);
      try {
        if (action === 'accept') {
          await acceptDispatchOffer(offer.id);
          await reload();
          // The order is now genuinely theirs, so the delivery detail screen
          // is the right place to land - not back to a consumed offer.
          router.replace(`/delivery/${offer.orderId}`);
          return;
        }

        await declineDispatchOffer(offer.id);
        await reload();
        router.replace('/deliveries');
      } catch {
        // Every refusal reaching here is authoritative and final - the backend
        // decided it under a row lock. Reload so the screen reflects reality
        // (the offer will usually be gone) rather than leaving a dead button.
        //
        // The message CANNOT be shown here, and not only because `Alert` is an
        // empty function under react-native-web: the `router.replace` two lines
        // down unmounts this screen, so an in-screen notice would be destroyed
        // before the rider could read it. It travels to /deliveries as a route
        // param instead and is rendered there (src/utils/routeNotices.ts).
        // Until now the rider was simply bounced back to the queue with the
        // offer gone and nothing saying why.
        const noticeKey: DispatchOfferNoticeKey =
          action === 'accept' ? 'offer-accept-failed' : 'offer-decline-failed';

        await reload();
        router.replace({ pathname: '/deliveries', params: { notice: noticeKey } } as never);
      } finally {
        setSubmitting(null);
      }
    },
    [offer, reload, router, submitting]
  );

  if (loading) {
    return (
      <SkeletonScreen>
        <SkeletonDetail />
      </SkeletonScreen>
    );
  }

  if (!offer || !order) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.emptyTitle}>This offer is no longer available</Text>
        <Text style={styles.emptyBody}>
          {error ?? 'It was accepted by another rider, declined, or it expired.'}
        </Text>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => router.replace('/deliveries')}>
          <Text style={styles.secondaryButtonLabel}>Back to deliveries</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const expired = remaining <= 0;
  const busy = submitting !== null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}
    >
      <View style={[styles.countdownCard, expired && styles.countdownCardExpired]}>
        <Text style={styles.countdownLabel}>{expired ? 'Offer expired' : 'Respond within'}</Text>
        <Text style={styles.countdownValue}>{expired ? '0s' : `${remaining}s`}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.orderRef}>Order #{String(order.id ?? '').slice(-6).toUpperCase()}</Text>
        <Text style={styles.restaurantName}>{order.restaurantName ?? 'Restaurant'}</Text>
        <Text style={styles.distance}>{formatDistance(distanceKm)}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Pickup</Text>
        <Text style={styles.bodyText}>
          {(order.restaurantLocation as { address?: string } | null)?.address ?? 'Address shared on accept'}
        </Text>

        <Text style={[styles.sectionTitle, styles.sectionSpacing]}>Drop-off</Text>
        <Text style={styles.bodyText}>
          {(order.deliveryLocation as { address?: string; shortAddress?: string } | null)?.shortAddress ??
            (order.deliveryLocation as { address?: string } | null)?.address ??
            'Address shared on accept'}
        </Text>
      </View>

      <View style={styles.card}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Items</Text>
          <Text style={styles.summaryValue}>{(order.items ?? []).length}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Order total</Text>
          <Text style={styles.summaryValue}>{formatCurrency(order.total as number | null)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Payment</Text>
          <Text style={styles.summaryValue}>
            {String(order.paymentMethod ?? order.paymentProvider ?? 'Not specified')}
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.acceptButton, (expired || busy) && styles.buttonDisabled]}
        disabled={expired || busy}
        onPress={() => respond('accept')}
      >
        {submitting === 'accept' ? (
          <ActivityIndicator color={dispatchTheme.surface} />
        ) : (
          <Text style={styles.acceptButtonLabel}>{expired ? 'Offer expired' : 'Accept delivery'}</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.declineButton, busy && styles.buttonDisabled]}
        disabled={busy}
        onPress={() => respond('decline')}
      >
        {submitting === 'decline' ? (
          <ActivityIndicator color={dispatchTheme.text} />
        ) : (
          <Text style={styles.declineButtonLabel}>Decline</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.footnote}>
        Declining passes this delivery to the next available rider. It will not be offered to you again.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  acceptButton: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.accent,
    borderRadius: radius.lg,
    marginTop: 20,
    paddingVertical: 16,
  },
  acceptButtonLabel: {
    color: dispatchTheme.surface,
    fontSize: 16,
    fontWeight: '700',
  },
  bodyText: {
    color: dispatchTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  card: {
    backgroundColor: dispatchTheme.surface,
    borderRadius: radius.lg,
    marginTop: 14,
    padding: 16,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  container: {
    backgroundColor: dispatchTheme.background,
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
  },
  countdownCard: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.accent,
    borderRadius: radius.lg,
    paddingVertical: 20,
  },
  countdownCardExpired: {
    backgroundColor: dispatchTheme.textMuted,
  },
  countdownLabel: {
    color: dispatchTheme.surface,
    fontSize: 13,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  countdownValue: {
    color: dispatchTheme.surface,
    fontSize: 40,
    fontWeight: '800',
    marginTop: 4,
  },
  declineButton: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.surface,
    borderRadius: radius.lg,
    marginTop: 12,
    paddingVertical: 16,
  },
  declineButtonLabel: {
    color: dispatchTheme.text,
    fontSize: 15,
    fontWeight: '600',
  },
  distance: {
    color: dispatchTheme.accent,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 6,
  },
  emptyBody: {
    color: dispatchTheme.textMuted,
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  emptyTitle: {
    color: dispatchTheme.text,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  footnote: {
    color: dispatchTheme.textMuted,
    fontSize: 12,
    marginTop: 16,
    textAlign: 'center',
  },
  orderRef: {
    color: dispatchTheme.textMuted,
    fontSize: 12,
    letterSpacing: 0.6,
  },
  restaurantName: {
    color: dispatchTheme.text,
    fontSize: 20,
    fontWeight: '700',
    marginTop: 4,
  },
  secondaryButton: {
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    backgroundColor: dispatchTheme.surface,
    borderRadius: radius.md,
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  secondaryButtonLabel: {
    color: dispatchTheme.text,
    fontSize: 14,
    fontWeight: '600',
  },
  sectionSpacing: {
    marginTop: 16,
  },
  sectionTitle: {
    color: dispatchTheme.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  summaryLabel: {
    color: dispatchTheme.textMuted,
    fontSize: 14,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  summaryValue: {
    color: dispatchTheme.text,
    fontSize: 14,
    fontWeight: '600',
  },
});
