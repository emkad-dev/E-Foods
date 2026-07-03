import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

export type DispatchMapRider = {
  hasPreciseLocation: boolean;
  id: string;
  latitude: number;
  longitude: number;
  name: string;
  zone: string;
};

type DispatchLiveMapProps = {
  riders: DispatchMapRider[];
  region: {
    latitude: number;
    latitudeDelta: number;
    longitude: number;
    longitudeDelta: number;
  };
};

const buildHtml = (riders: DispatchMapRider[], region: DispatchLiveMapProps['region']) => {
  const ridersJson = encodeURIComponent(JSON.stringify(riders));
  const regionJson = encodeURIComponent(JSON.stringify(region));

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
        background: #f5f7f6;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .marker {
        width: 18px;
        height: 18px;
        border-radius: 999px;
        border: 3px solid rgba(255, 255, 255, 0.95);
        box-shadow: 0 8px 18px rgba(0, 0, 0, 0.22);
      }
      .marker.live { background: #0f7f4c; }
      .marker.lga { background: #c87d22; }
      .maplibregl-popup-content {
        border-radius: 14px;
        padding: 10px 12px;
        box-shadow: 0 12px 24px rgba(0, 0, 0, 0.18);
      }
      .popup-title {
        font-size: 14px;
        font-weight: 800;
        color: #0d1522;
        margin-bottom: 2px;
      }
      .popup-copy {
        font-size: 12px;
        color: #5b6978;
      }
    </style>
    <script src="https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.js"></script>
  </head>
  <body>
    <div id="map"></div>
    <script>
      const riders = JSON.parse(decodeURIComponent('${ridersJson}'));
      const region = JSON.parse(decodeURIComponent('${regionJson}'));

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
        layers: [
          {
            id: 'osm',
            type: 'raster',
            source: 'osm'
          }
        ]
      };

      const map = new maplibregl.Map({
        container: 'map',
        style,
        center: [region.longitude, region.latitude],
        zoom: 10,
        attributionControl: true
      });

      map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');

      map.on('load', () => {
        const bounds = new maplibregl.LngLatBounds();

        riders.forEach((rider) => {
          const element = document.createElement('div');
          element.className = 'marker ' + (rider.hasPreciseLocation ? 'live' : 'lga');

          const popup = new maplibregl.Popup({ offset: 16 }).setHTML(
            '<div class="popup-title">' +
              escapeHtml(rider.name) +
              '</div>' +
              '<div class="popup-copy">' +
              escapeHtml(rider.zone) +
              ' · ' +
              (rider.hasPreciseLocation ? 'Live' : 'LGA pin') +
              '</div>'
          );

          new maplibregl.Marker({ element })
            .setLngLat([rider.longitude, rider.latitude])
            .setPopup(popup)
            .addTo(map);

          bounds.extend([rider.longitude, rider.latitude]);
        });

        if (!bounds.isEmpty()) {
          if (riders.length === 1) {
            map.easeTo({ center: bounds.getCenter(), zoom: 12, duration: 400 });
          } else {
            map.fitBounds(bounds, {
              padding: { top: 56, bottom: 56, left: 56, right: 56 },
              maxZoom: 14,
              duration: 500
            });
          }
        }
      });
    </script>
  </body>
</html>`;
};

export default function DispatchLiveMap({ region, riders }: DispatchLiveMapProps) {
  const html = useMemo(() => buildHtml(riders, region), [region, riders]);

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
    backgroundColor: '#f5f7f6',
    borderRadius: 24,
    overflow: 'hidden',
  },
  webView: {
    backgroundColor: '#f5f7f6',
    height: 320,
    width: '100%',
  },
});
