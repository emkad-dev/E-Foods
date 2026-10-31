import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Imported by module path, not from the '@feasty/design-system' barrel: see the
// note at the top of app/(dispatch)/delivery/[id].tsx.
import { LiveMap } from '../../../../packages/design-system/src/liveMap/LiveMap';
import type { LiveMapMarker, LiveMapTheme } from '../../../../packages/design-system/src/liveMap/liveMapHtml';
import { useNotice } from '../../../../packages/design-system/src/primitives/Notice';
import { radius } from '../../../../packages/design-system/src/tokens/radius';
import {
  describeExternalLinkFailure,
  openExternalLink,
} from '../../../../packages/runtime/src/externalLink';
import { useAuth } from '../contexts/AuthContext';
import { useRiderLocation } from '../contexts/RiderLocationContext';
import type { OrderDocument } from '../domain/entities';
import { getDropoffPoint, getNavigateTarget, getRestaurantPoint, getTripLeg } from '../domain/riderTrip';
import { dispatchTheme } from '../theme/palette';

// Module-level on purpose: LiveMap rebuilds its whole page when the theme
// object changes identity.
const MAP_THEME: LiveMapTheme = {
  background: dispatchTheme.background,
  text: dispatchTheme.text,
  rider: dispatchTheme.accent,
  delivery: '#16a34a',
  restaurant: '#5D3FD3',
};

const COMPACT_MAP_HEIGHT = 200;

type RiderTripMapProps = {
  order: OrderDocument;
};

type NavigateControlProps = {
  url: string;
  label: string;
};

/**
 * The Navigate button plus its own failure notice. Rendered once in the card
 * and once in the full-screen modal: the screen's floating notice sits behind a
 * Modal, so a failure raised from inside it would be invisible without a notice
 * of its own.
 */
function NavigateControl({ url, label }: NavigateControlProps) {
  const { notice, showNotice } = useNotice();

  const handlePress = () => {
    // openExternalLink must run inside the press gesture or the browser blocks
    // the popup, so it is called before anything is awaited.
    void openExternalLink(url).then((result) => {
      if (!result.ok) {
        showNotice({
          tone: 'error',
          title: 'Navigation unavailable',
          message: describeExternalLinkFailure(result.reason, 'Google Maps'),
        });
      }
    });
  };

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={handlePress}
        style={({ pressed }) => [styles.navigateButton, pressed ? styles.pressed : null]}
      >
        <Text style={styles.navigateButtonText}>{label}</Text>
      </Pressable>
      {notice}
    </View>
  );
}

/**
 * The rider's trip at a glance: a small map of where they are against the next
 * stop, a tap-to-expand full-screen map, and a Navigate button that hands the
 * turn-by-turn work to Google Maps.
 *
 * Renders nothing when there is no active leg (terminal, pickup, not yet
 * dispatched, or an escalated order whose side of pickup is unknown), or when
 * the order is not the signed-in rider's own.
 */
export function RiderTripMap({ order }: RiderTripMapProps) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const riderLocation = useRiderLocation();
  const [expanded, setExpanded] = useState(false);

  const leg = getTripLeg(order);
  const restaurant = getRestaurantPoint(order);
  const dropoff = getDropoffPoint(order);
  const target = getNavigateTarget(order);
  // Only the rider's own assigned order is mapped: this screen is also where a
  // dispatcher assigns couriers, and an unowned or someone else's order carries
  // only a coarsened drop-off that must not be drawn as a pin.
  const isOwnOrder = Boolean(user?.uid) && order.assignment?.courierId === user?.uid;
  const riderLat = riderLocation?.latitude;
  const riderLng = riderLocation?.longitude;
  const restaurantLabel = order.restaurantName?.trim() || 'Restaurant';
  const restaurantLat = restaurant?.latitude;
  const restaurantLng = restaurant?.longitude;
  const dropoffLat = dropoff?.latitude;
  const dropoffLng = dropoff?.longitude;

  // Keyed on the raw numbers: callers and the GPS hook hand back fresh objects
  // every render, and a new array would re-push an unchanged position.
  const markers = useMemo(() => {
    const next: LiveMapMarker[] = [];
    if (restaurantLat !== undefined && restaurantLng !== undefined) {
      next.push({ id: 'restaurant', kind: 'restaurant', label: restaurantLabel, latitude: restaurantLat, longitude: restaurantLng });
    }
    if (dropoffLat !== undefined && dropoffLng !== undefined) {
      next.push({ id: 'delivery', kind: 'delivery', label: 'Drop-off', latitude: dropoffLat, longitude: dropoffLng });
    }
    if (typeof riderLat === 'number' && typeof riderLng === 'number') {
      next.push({ id: 'rider', kind: 'rider', label: 'You', latitude: riderLat, longitude: riderLng });
    }
    return next;
  }, [restaurantLabel, restaurantLat, restaurantLng, dropoffLat, dropoffLng, riderLat, riderLng]);

  if (!leg || !isOwnOrder) {
    return null;
  }

  const dropoffAddress =
    order.deliveryAddress ?? order.deliveryLocation?.address ?? order.deliveryLocation?.shortAddress ?? 'Customer address pending';
  const stopLabel = leg === 'to_restaurant' ? `Pick up at ${restaurantLabel}` : `Drop-off: ${dropoffAddress}`;
  const navigateLabel = leg === 'to_restaurant' ? 'Navigate to restaurant' : 'Navigate to drop-off';

  // Shown whenever the map cannot load, so the rider still has the address.
  const fallback = (
    <View style={styles.fallback}>
      <Text style={styles.fallbackTitle}>Map unavailable right now</Text>
      <Text style={styles.fallbackText}>Drop-off: {dropoffAddress}</Text>
    </View>
  );

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Next stop</Text>
      <Text style={styles.stopLabel}>{stopLabel}</Text>

      {markers.length > 0 ? (
        <View style={styles.mapFrame}>
          <LiveMap markers={markers} theme={MAP_THEME} style={styles.compactMap} fallback={fallback} />
          {/*
            A sibling AFTER the map rather than a Pressable around it: on
            Android a native WebView can keep consuming taps even under a
            parent with pointerEvents none, so the overlay has to sit above it.
          */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Expand trip map"
            onPress={() => setExpanded(true)}
            style={styles.expandOverlay}
          >
            <View style={styles.expandHint}>
              <Text style={styles.expandHintText}>Tap to expand</Text>
            </View>
          </Pressable>
        </View>
      ) : null}

      {target ? <NavigateControl url={target.url} label={navigateLabel} /> : null}

      <Modal
        visible={expanded}
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setExpanded(false)}
      >
        <View style={styles.modalScreen}>
          <View style={styles.modalMapFrame}>
            <LiveMap interactive markers={markers} theme={MAP_THEME} style={StyleSheet.absoluteFill} fallback={fallback} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close map"
              onPress={() => setExpanded(false)}
              hitSlop={8}
              style={({ pressed }) => [styles.closeButton, { top: insets.top + 12 }, pressed ? styles.pressed : null]}
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </Pressable>
          </View>
          <View style={[styles.modalFooter, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.stopLabel}>{stopLabel}</Text>
            {target ? <NavigateControl url={target.url} label={navigateLabel} /> : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: dispatchTheme.surface,
    borderColor: dispatchTheme.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    marginTop: 14,
    padding: 18,
  },
  title: {
    color: dispatchTheme.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
  },
  stopLabel: {
    color: dispatchTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  mapFrame: {
    backgroundColor: dispatchTheme.background,
    borderRadius: radius.lg,
    marginTop: 12,
    overflow: 'hidden',
  },
  compactMap: {
    height: COMPACT_MAP_HEIGHT,
    width: '100%',
  },
  expandOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    padding: 10,
  },
  expandHint: {
    backgroundColor: dispatchTheme.hero,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  expandHintText: {
    color: dispatchTheme.textOnInverse,
    fontSize: 12,
    fontWeight: '700',
  },
  fallback: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  fallbackTitle: {
    color: dispatchTheme.text,
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  fallbackText: {
    color: dispatchTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
    textAlign: 'center',
  },
  navigateButton: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.hero,
    borderRadius: radius.lg,
    marginTop: 14,
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 13,
  },
  navigateButtonText: {
    color: dispatchTheme.textOnInverse,
    fontSize: 13,
    fontWeight: '900',
  },
  pressed: {
    opacity: 0.8,
  },
  modalScreen: {
    backgroundColor: dispatchTheme.background,
    flex: 1,
  },
  modalMapFrame: {
    flex: 1,
  },
  closeButton: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.hero,
    borderRadius: radius.pill,
    elevation: 4,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 18,
    position: 'absolute',
    right: 16,
    zIndex: 2,
  },
  closeButtonText: {
    color: dispatchTheme.textOnInverse,
    fontSize: 14,
    fontWeight: '800',
  },
  modalFooter: {
    backgroundColor: dispatchTheme.surface,
    borderTopColor: dispatchTheme.border,
    borderTopWidth: 1,
    paddingHorizontal: 18,
    paddingTop: 14,
  },
});
