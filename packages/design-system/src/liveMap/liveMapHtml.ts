/**
 * Pure half of the shared live map: the page that runs inside the native
 * WebView or the web iframe, and the protocol both hosts use to talk to it.
 * No React Native imports, so admin-web never pulls it in and node tests can
 * load it directly.
 *
 * The page is built ONCE per map. Marker changes are pushed into it through
 * `window.__feastyMap.apply(...)` after it reports ready, instead of rebuilding
 * the HTML: rebuilding reloaded the whole map (blank flash, re-download of
 * MapLibre, re-fit, lost pan) on every rider update.
 */

export type LiveMapMarkerKind = 'rider' | 'restaurant' | 'delivery';

export type LiveMapMarker = {
  id: string;
  kind: LiveMapMarkerKind;
  label: string;
  latitude: number;
  longitude: number;
};

export type LiveMapTheme = {
  background: string;
  text: string;
  rider: string;
  restaurant: string;
  delivery: string;
};

export type LiveMapPayload = {
  markers: LiveMapMarker[];
};

/**
 * Raster tiles straight from OpenStreetMap's public servers. Fine for testing,
 * but their usage policy discourages app traffic at scale: swap this one URL
 * (and the attribution) for a keyed provider before public launch.
 */
export const LIVE_MAP_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const LIVE_MAP_TILE_ATTRIBUTION = '&copy; OpenStreetMap contributors';

export const LIVE_MAP_READY_MESSAGE = 'feasty-map:ready';
export const LIVE_MAP_FAILED_MESSAGE = 'feasty-map:failed';
export const LIVE_MAP_APPLY_MESSAGE = 'feasty-map:apply';

/** No ready message by then (CDN or network down) means show the fallback. */
export const LIVE_MAP_READY_TIMEOUT_MS = 8_000;

const MAPLIBRE_VERSION = '5.6.1';

const DEFAULT_CENTRE = { latitude: 6.5244, longitude: 3.3792 };

export const isFiniteCoordinate = (latitude: unknown, longitude: unknown): boolean =>
  typeof latitude === 'number' &&
  Number.isFinite(latitude) &&
  typeof longitude === 'number' &&
  Number.isFinite(longitude);

/**
 * Script for the native host's `injectJavaScript`. JSON is valid JavaScript,
 * and labels reach the page as data rendered with textContent, never as HTML.
 */
export const buildLiveMapApplyScript = (payload: LiveMapPayload): string =>
  `window.__feastyMap && window.__feastyMap.apply(${JSON.stringify(payload)}); true;`;

/** Message the web host posts into the iframe. */
export const buildLiveMapApplyMessage = (payload: LiveMapPayload) => ({
  type: LIVE_MAP_APPLY_MESSAGE,
  payload,
});

export const buildLiveMapHtml = ({ interactive, theme }: { interactive: boolean; theme: LiveMapTheme }): string => {
  const config = JSON.stringify({
    interactive,
    centre: DEFAULT_CENTRE,
    tileUrl: LIVE_MAP_TILE_URL,
    attribution: LIVE_MAP_TILE_ATTRIBUTION,
    readyMessage: LIVE_MAP_READY_MESSAGE,
    failedMessage: LIVE_MAP_FAILED_MESSAGE,
    applyMessage: LIVE_MAP_APPLY_MESSAGE,
  });

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <link href="https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css" rel="stylesheet" />
    <style>
      html, body, #map {
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: ${theme.background};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .marker {
        width: 18px;
        height: 18px;
        border-radius: 999px;
        border: 3px solid rgba(255, 255, 255, 0.95);
        box-shadow: 0 8px 18px rgba(0, 0, 0, 0.22);
      }
      .marker.rider { background: ${theme.rider}; width: 22px; height: 22px; }
      .marker.delivery { background: ${theme.delivery}; }
      .marker.restaurant { background: ${theme.restaurant}; }
      .maplibregl-popup-content {
        border-radius: 14px;
        padding: 8px 10px;
        box-shadow: 0 12px 24px rgba(0, 0, 0, 0.18);
        font-size: 13px;
        font-weight: 800;
        color: ${theme.text};
      }
    </style>
    <script src="https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js"></script>
  </head>
  <body>
    <div id="map"></div>
    <script>
      (function () {
        var config = ${config};

        var post = function (message) {
          try {
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(message);
            } else if (window.parent && window.parent !== window) {
              window.parent.postMessage(message, '*');
            }
          } catch (error) {}
        };

        if (typeof maplibregl === 'undefined') {
          post(config.failedMessage);
          return;
        }

        var map = new maplibregl.Map({
          container: 'map',
          style: {
            version: 8,
            sources: {
              osm: { type: 'raster', tiles: [config.tileUrl], tileSize: 256, attribution: config.attribution }
            },
            layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
          },
          center: [config.centre.longitude, config.centre.latitude],
          zoom: 12,
          interactive: config.interactive,
          attributionControl: { compact: true }
        });

        if (config.interactive) {
          map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
        }

        var loaded = false;
        var pending = null;
        var lastFitKey = null;
        var entries = {};

        // The rider moves; the stops do not. Re-fit only when the set of
        // markers or a stop changes, so a rider update never yanks the view
        // (or undoes a customer's own pan and zoom).
        var fitKeyOf = function (markers) {
          return markers
            .map(function (m) {
              return m.kind === 'rider' ? m.id : m.id + '@' + m.latitude.toFixed(4) + ',' + m.longitude.toFixed(4);
            })
            .sort()
            .join('|');
        };

        var fit = function (markers) {
          if (!markers.length) return;
          var bounds = new maplibregl.LngLatBounds();
          markers.forEach(function (m) { bounds.extend([m.longitude, m.latitude]); });
          if (markers.length === 1) {
            map.easeTo({ center: bounds.getCenter(), zoom: 14, duration: 400 });
          } else {
            map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 500 });
          }
        };

        // Glide the rider between fixes instead of jumping every update.
        // A fix far from the last one (a GPS jump, or the first real fix)
        // snaps, since animating across a city looks wrong.
        var glide = function (entry, to) {
          var from = entry.marker.getLngLat();
          var far = Math.abs(from.lat - to[1]) > 0.02 || Math.abs(from.lng - to[0]) > 0.02;
          if (entry.frame) cancelAnimationFrame(entry.frame);
          if (far) {
            entry.marker.setLngLat(to);
            return;
          }
          var start = null;
          var step = function (now) {
            if (start === null) start = now;
            var t = Math.min(1, (now - start) / 1000);
            var eased = t * (2 - t);
            entry.marker.setLngLat([from.lng + (to[0] - from.lng) * eased, from.lat + (to[1] - from.lat) * eased]);
            entry.frame = t < 1 ? requestAnimationFrame(step) : null;
          };
          entry.frame = requestAnimationFrame(step);
        };

        var apply = function (payload) {
          if (!loaded) {
            pending = payload;
            return;
          }
          // JSON turns NaN into null; one bad fix must not throw and kill the
          // whole update (and with it every later one).
          var markers = ((payload && payload.markers) || []).filter(function (m) {
            return m && typeof m.latitude === 'number' && typeof m.longitude === 'number' && isFinite(m.latitude) && isFinite(m.longitude);
          });
          var seen = {};
          markers.forEach(function (m) {
            seen[m.id] = true;
            var to = [m.longitude, m.latitude];
            var entry = entries[m.id];
            if (!entry) {
              var element = document.createElement('div');
              element.className = 'marker ' + m.kind;
              var popup = new maplibregl.Popup({ offset: 16 }).setText(m.label);
              entry = { marker: new maplibregl.Marker({ element: element }).setLngLat(to).setPopup(popup).addTo(map), popup: popup, label: m.label, frame: null };
              entries[m.id] = entry;
              return;
            }
            if (entry.label !== m.label) {
              entry.label = m.label;
              entry.popup.setText(m.label);
            }
            if (m.kind === 'rider') {
              glide(entry, to);
            } else {
              entry.marker.setLngLat(to);
            }
          });
          Object.keys(entries).forEach(function (id) {
            if (!seen[id]) {
              entries[id].marker.remove();
              delete entries[id];
            }
          });
          var key = fitKeyOf(markers);
          if (key !== lastFitKey) {
            lastFitKey = key;
            fit(markers);
          }
        };

        window.__feastyMap = { apply: apply };

        window.addEventListener('message', function (event) {
          var data = event.data;
          if (data && data.type === config.applyMessage) apply(data.payload);
        });

        // Ready as soon as the style is in, not when 'load' fires: 'load' also
        // waits for the first tiles, and on a slow network that can outlast the
        // host's timeout and swap a working map for the fallback. Markers are
        // plain DOM, so they can be placed before the tiles arrive.
        var markReady = function () {
          if (loaded) return;
          loaded = true;
          post(config.readyMessage);
          if (pending) {
            var next = pending;
            pending = null;
            apply(next);
          }
        };
        map.on('styledata', markReady);
        map.on('load', markReady);
      })();
    </script>
  </body>
</html>`;
};
