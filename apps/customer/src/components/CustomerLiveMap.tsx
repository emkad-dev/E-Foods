import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { customerTheme } from '../theme/palette';

// Uses the SAME react-native-webview + MapLibre-in-a-WebView approach as
// apps/dispatch/src/components/DispatchLiveMap.tsx - deliberately NOT
// react-native-maps or any native mapping module. One mapping stack across the
// platform. The rider marker is the emphasised one; the restaurant origin and
// the delivery destination are secondary pins.

export type MapPoint = {
  latitude: number;
  longitude: number;
};

type CustomerLiveMapProps = {
  rider: MapPoint | null;
  delivery: MapPoint | null;
  restaurant?: MapPoint | null;
};

type Marker = {
  kind: 'rider' | 'delivery' | 'restaurant';
  label: string;
  latitude: number;
  longitude: number;
};

const isPoint = (point: MapPoint | null | undefined): point is MapPoint =>
  !!point &&
  typeof point.latitude === 'number' &&
  Number.isFinite(point.latitude) &&
  typeof point.longitude === 'number' &&
  Number.isFinite(point.longitude);

const buildMarkers = (props: CustomerLiveMapProps): Marker[] => {
  const markers: Marker[] = [];
  if (isPoint(props.restaurant)) {
    markers.push({ kind: 'restaurant', label: 'Restaurant', latitude: props.restaurant.latitude, longitude: props.restaurant.longitude });
  }
  if (isPoint(props.delivery)) {
    markers.push({ kind: 'delivery', label: 'Delivery', latitude: props.delivery.latitude, longitude: props.delivery.longitude });
  }
  if (isPoint(props.rider)) {
    markers.push({ kind: 'rider', label: 'Your rider', latitude: props.rider.latitude, longitude: props.rider.longitude });
  }
  return markers;
};

const buildHtml = (markers: Marker[]) => {
  const markersJson = encodeURIComponent(JSON.stringify(markers));
  const centre = markers[markers.length - 1] ?? { latitude: 6.5244, longitude: 3.3792 };
  const centreJson = encodeURIComponent(JSON.stringify({ latitude: centre.latitude, longitude: centre.longitude }));

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link href="https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.css" rel="stylesheet" />
    <style>
      html, body, #map {
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: ${customerTheme.background};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .marker {
        width: 18px;
        height: 18px;
        border-radius: 999px;
        border: 3px solid rgba(255, 255, 255, 0.95);
        box-shadow: 0 8px 18px rgba(0, 0, 0, 0.22);
      }
      .marker.rider { background: #f97316; width: 22px; height: 22px; }
      .marker.delivery { background: #16a34a; }
      .marker.restaurant { background: #5D3FD3; }
      .maplibregl-popup-content {
        border-radius: 14px;
        padding: 8px 10px;
        box-shadow: 0 12px 24px rgba(0, 0, 0, 0.18);
      }
      .popup-title {
        font-size: 13px;
        font-weight: 800;
        color: ${customerTheme.text};
      }
    </style>
    <script src="https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.js"></script>
  </head>
  <body>
    <div id="map"></div>
    <script>
      const markers = JSON.parse(decodeURIComponent('${markersJson}'));
      const centre = JSON.parse(decodeURIComponent('${centreJson}'));

      const escapeHtml = (value) =>
        String(value)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');

      const style = {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap contributors'
          }
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
      };

      const map = new maplibregl.Map({
        container: 'map',
        style,
        center: [centre.longitude, centre.latitude],
        zoom: 12,
        attributionControl: true
      });

      map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');

      map.on('load', () => {
        const bounds = new maplibregl.LngLatBounds();

        markers.forEach((marker) => {
          const element = document.createElement('div');
          element.className = 'marker ' + marker.kind;

          const popup = new maplibregl.Popup({ offset: 16 }).setHTML(
            '<div class="popup-title">' + escapeHtml(marker.label) + '</div>'
          );

          new maplibregl.Marker({ element })
            .setLngLat([marker.longitude, marker.latitude])
            .setPopup(popup)
            .addTo(map);

          bounds.extend([marker.longitude, marker.latitude]);
        });

        if (!bounds.isEmpty()) {
          if (markers.length === 1) {
            map.easeTo({ center: bounds.getCenter(), zoom: 13, duration: 400 });
          } else {
            map.fitBounds(bounds, {
              padding: { top: 48, bottom: 48, left: 48, right: 48 },
              maxZoom: 15,
              duration: 500
            });
          }
        }
      });
    </script>
  </body>
</html>`;
};

export default function CustomerLiveMap({ delivery, restaurant, rider }: CustomerLiveMapProps) {
  const markers = useMemo(() => buildMarkers({ delivery, restaurant, rider }), [delivery, restaurant, rider]);
  const html = useMemo(() => buildHtml(markers), [markers]);

  if (markers.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <WebView
        allowFileAccess
        javaScriptEnabled
        originWhitelist={['*']}
        scrollEnabled={false}
        source={{ html }}
        style={styles.webView}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: customerTheme.background,
    borderRadius: 18,
    marginTop: 12,
    overflow: 'hidden',
  },
  webView: {
    backgroundColor: customerTheme.background,
    height: 260,
    width: '100%',
  },
});
