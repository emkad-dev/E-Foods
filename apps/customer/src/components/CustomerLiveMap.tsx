import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { radius } from '@feasty/design-system';
import { LiveMap } from '../../../../packages/design-system/src/liveMap/LiveMap';
import {
  isFiniteCoordinate,
  type LiveMapMarker,
  type LiveMapTheme,
} from '../../../../packages/design-system/src/liveMap/liveMapHtml';
import { customerTheme } from '../theme/palette';

// Thin wrapper over the shared map module (also used by dispatch): the same
// MapLibre-in-a-WebView stack on native, an iframe on web. The rider marker is
// the emphasised one; the restaurant origin and the delivery destination are
// secondary pins.

export type MapPoint = {
  latitude: number;
  longitude: number;
};

type CustomerLiveMapProps = {
  rider: MapPoint | null;
  delivery: MapPoint | null;
  restaurant?: MapPoint | null;
};

// Module-level on purpose: LiveMap rebuilds its whole page when the theme
// object changes identity, which is the reload-per-render this replaces.
const MAP_THEME: LiveMapTheme = {
  background: customerTheme.background,
  text: customerTheme.text,
  rider: '#f97316',
  delivery: '#16a34a',
  restaurant: '#5D3FD3',
};

export default function CustomerLiveMap({ delivery, restaurant, rider }: CustomerLiveMapProps) {
  // Keyed on the raw numbers, not the point objects: the parent rebuilds those
  // every render, and a new markers array would re-push an unchanged position.
  const restaurantLat = restaurant?.latitude;
  const restaurantLng = restaurant?.longitude;
  const deliveryLat = delivery?.latitude;
  const deliveryLng = delivery?.longitude;
  const riderLat = rider?.latitude;
  const riderLng = rider?.longitude;

  const markers = useMemo(() => {
    const next: LiveMapMarker[] = [];
    if (isFiniteCoordinate(restaurantLat, restaurantLng)) {
      next.push({ id: 'restaurant', kind: 'restaurant', label: 'Restaurant', latitude: restaurantLat as number, longitude: restaurantLng as number });
    }
    if (isFiniteCoordinate(deliveryLat, deliveryLng)) {
      next.push({ id: 'delivery', kind: 'delivery', label: 'Delivery', latitude: deliveryLat as number, longitude: deliveryLng as number });
    }
    if (isFiniteCoordinate(riderLat, riderLng)) {
      next.push({ id: 'rider', kind: 'rider', label: 'Your rider', latitude: riderLat as number, longitude: riderLng as number });
    }
    return next;
  }, [restaurantLat, restaurantLng, deliveryLat, deliveryLng, riderLat, riderLng]);

  if (markers.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <LiveMap
        interactive
        markers={markers}
        theme={MAP_THEME}
        style={styles.map}
        fallback={
          <View style={styles.fallback}>
            <Text style={styles.fallbackText}>Map unavailable right now. Rider updates still arrive above.</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: customerTheme.background,
    borderRadius: radius.xl,
    marginTop: 12,
    overflow: 'hidden',
  },
  map: {
    height: 260,
    width: '100%',
  },
  fallback: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  fallbackText: {
    color: customerTheme.textMuted,
    fontSize: 14,
    textAlign: 'center',
  },
});
