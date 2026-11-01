/**
 * Run with: node --test --experimental-strip-types packages/design-system/src/liveMap/liveMapHtml.test.ts
 *
 * The page script is exercised for real, in a node:vm context with a fake
 * MapLibre: the glide, re-fit and ready-handshake rules live inside that
 * string, so asserting on its text alone would prove nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import {
  LIVE_MAP_APPLY_MESSAGE,
  LIVE_MAP_BASE_URL,
  LIVE_MAP_FAILED_MESSAGE,
  LIVE_MAP_READY_MESSAGE,
  LIVE_MAP_TILE_URL,
  buildLiveMapApplyMessage,
  buildLiveMapApplyScript,
  buildLiveMapHtml,
  classifyLiveMapNavigation,
  isFiniteCoordinate,
  type LiveMapMarker,
  type LiveMapTheme,
} from './liveMapHtml.ts';

const theme: LiveMapTheme = {
  background: '#101820',
  text: '#202124',
  rider: '#ff3366',
  restaurant: '#33aa55',
  delivery: '#3355ff',
};

const rider = (latitude: number, longitude: number): LiveMapMarker => ({
  id: 'rider',
  kind: 'rider',
  label: 'Rider',
  latitude,
  longitude,
});
const restaurant: LiveMapMarker = { id: 'restaurant', kind: 'restaurant', label: 'Kitchen', latitude: 6.52, longitude: 3.37 };
const delivery: LiveMapMarker = { id: 'delivery', kind: 'delivery', label: 'You', latitude: 6.6, longitude: 3.4 };

const configOf = (html: string) => {
  const match = /var config = (\{.*\});/.exec(html);
  assert.ok(match, 'config line present');
  return JSON.parse(match[1]);
};

const APPLY_PREFIX = 'window.__feastyMap && window.__feastyMap.apply(';
const APPLY_SUFFIX = '); true;';

test('buildLiveMapApplyScript embeds the payload as parseable JSON and calls the page API', () => {
  const payload = { markers: [rider(6.5, 3.3), { ...delivery, label: 'Ada\'s "place" </script>' }] };
  const script = buildLiveMapApplyScript(payload);

  assert.ok(script.startsWith(APPLY_PREFIX));
  assert.ok(script.endsWith(APPLY_SUFFIX), 'ends with a truthy expression for injectJavaScript');
  const json = script.slice(APPLY_PREFIX.length, -APPLY_SUFFIX.length);
  assert.deepEqual(JSON.parse(json), payload);
});

test('buildLiveMapApplyMessage has the shape the page listens for', () => {
  const payload = { markers: [rider(6.5, 3.3)] };
  assert.deepEqual(buildLiveMapApplyMessage(payload), { type: LIVE_MAP_APPLY_MESSAGE, payload });
});

test('buildLiveMapHtml reflects interactive in its config, and uses the tile constant and theme', () => {
  const interactive = buildLiveMapHtml({ interactive: true, theme });
  const passive = buildLiveMapHtml({ interactive: false, theme });

  assert.equal(configOf(interactive).interactive, true);
  assert.equal(configOf(passive).interactive, false);
  assert.equal(configOf(interactive).tileUrl, LIVE_MAP_TILE_URL);
  assert.equal(configOf(interactive).readyMessage, LIVE_MAP_READY_MESSAGE);
  assert.equal(configOf(interactive).applyMessage, LIVE_MAP_APPLY_MESSAGE);
  for (const colour of Object.values(theme)) {
    assert.ok(interactive.includes(colour), `theme colour ${colour} injected`);
  }
});

test('isFiniteCoordinate rejects NaN, strings, null, undefined and infinities', () => {
  assert.equal(isFiniteCoordinate(6.5, 3.3), true);
  assert.equal(isFiniteCoordinate(0, 0), true);
  assert.equal(isFiniteCoordinate(Number.NaN, 3.3), false);
  assert.equal(isFiniteCoordinate(6.5, Number.NaN), false);
  assert.equal(isFiniteCoordinate('6.5', '3.3'), false);
  assert.equal(isFiniteCoordinate(null, 3.3), false);
  assert.equal(isFiniteCoordinate(6.5, undefined), false);
  assert.equal(isFiniteCoordinate(Number.POSITIVE_INFINITY, 3.3), false);
});

// ---- the page script, run against a fake MapLibre ----

type FakeMarker = { lngLat: { lng: number; lat: number }; removed: boolean };

const runPage = (options: { withMaplibre?: boolean; interactive?: boolean } = {}) => {
  const { withMaplibre = true, interactive = true } = options;
  const html = buildLiveMapHtml({ interactive, theme });
  const match = /<script>\n([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match, 'inline script present');

  const posted: string[] = [];
  const markers: FakeMarker[] = [];
  const mapHandlers: Record<string, () => void> = {};
  const fits: string[] = [];
  const controls: string[] = [];
  const frames = new Map<number, (now: number) => void>();
  let nextFrame = 1;
  let mapOptions: Record<string, unknown> = {};

  class FakeMap {
    constructor(opts: Record<string, unknown>) {
      mapOptions = opts;
    }
    on(event: string, handler: () => void) {
      mapHandlers[event] = handler;
    }
    addControl(_control: unknown, position: string) {
      controls.push(position);
    }
    easeTo() {
      fits.push('ease');
    }
    fitBounds() {
      fits.push('fit');
    }
  }
  class FakeBounds {
    points: number[][] = [];
    extend(point: number[]) {
      this.points.push(point);
    }
    getCenter() {
      return this.points[0];
    }
  }
  class FakePopup {
    text = '';
    setText(text: string) {
      this.text = text;
      return this;
    }
  }
  class FakeMarkerImpl {
    state: FakeMarker = { lngLat: { lng: 0, lat: 0 }, removed: false };
    constructor() {
      markers.push(this.state);
    }
    setLngLat(point: number[]) {
      this.state.lngLat = { lng: point[0], lat: point[1] };
      return this;
    }
    getLngLat() {
      return this.state.lngLat;
    }
    setPopup() {
      return this;
    }
    addTo() {
      return this;
    }
    remove() {
      this.state.removed = true;
    }
  }

  const windowListeners: Record<string, (event: unknown) => void> = {};
  const window: Record<string, unknown> = {
    ReactNativeWebView: { postMessage: (message: string) => posted.push(message) },
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      windowListeners[type] = handler;
    },
  };
  const context = vm.createContext({
    window,
    document: { createElement: () => ({ className: '' }) },
    maplibregl: withMaplibre
      ? { Map: FakeMap, LngLatBounds: FakeBounds, Popup: FakePopup, Marker: FakeMarkerImpl, NavigationControl: class {} }
      : undefined,
    requestAnimationFrame: (callback: (now: number) => void) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id: number) => {
      frames.delete(id);
    },
  });
  vm.runInContext(match[1], context);

  const api = window.__feastyMap as { apply: (payload: { markers: unknown[] }) => void } | undefined;
  return {
    posted,
    markers,
    fits,
    controls,
    get mapOptions() {
      return mapOptions;
    },
    api,
    fireLoad: () => mapHandlers.load(),
    fireStyleData: () => mapHandlers.styledata(),
    deliverMessage: (data: unknown) => windowListeners.message({ data }),
    /** Runs every pending animation frame at `now`, like one browser tick. */
    tick: (now: number) => {
      const due = [...frames.values()];
      frames.clear();
      due.forEach((callback) => callback(now));
    },
    pendingFrames: () => frames.size,
  };
};

test('page: posts ready on load, and applies markers pushed before load once ready', () => {
  const page = runPage();
  assert.deepEqual(page.posted, [], 'no ready before the map has loaded');

  page.api!.apply({ markers: [restaurant, delivery] });
  assert.equal(page.markers.length, 0, 'queued, not drawn, before load');

  page.fireLoad();
  assert.deepEqual(page.posted, [LIVE_MAP_READY_MESSAGE]);
  assert.equal(page.markers.length, 2, 'the queued payload is drawn on load');
});

test('page: is ready once the style is in, without waiting for tiles, and only announces it once', () => {
  const page = runPage();
  page.api!.apply({ markers: [delivery] });
  page.fireStyleData();
  assert.deepEqual(page.posted, [LIVE_MAP_READY_MESSAGE]);
  assert.equal(page.markers.length, 1);

  page.fireStyleData();
  page.fireLoad();
  assert.deepEqual(page.posted, [LIVE_MAP_READY_MESSAGE], 'later style or load events do not re-announce');
});

test('page: accepts the iframe postMessage form of an update', () => {
  const page = runPage();
  page.fireLoad();
  page.deliverMessage(buildLiveMapApplyMessage({ markers: [restaurant] }));
  page.deliverMessage({ type: 'something-else', payload: { markers: [delivery] } });
  assert.equal(page.markers.length, 1, 'only the apply message is honoured');
});

test('page: reports failure when MapLibre did not load', () => {
  const page = runPage({ withMaplibre: false });
  assert.deepEqual(page.posted, [LIVE_MAP_FAILED_MESSAGE]);
  assert.equal(page.api, undefined);
});

test('page: re-fits on first load and when a stop changes, never on rider movement', () => {
  const page = runPage();
  page.fireLoad();

  page.api!.apply({ markers: [rider(6.5, 3.3), restaurant, delivery] });
  assert.deepEqual(page.fits, ['fit']);

  page.api!.apply({ markers: [rider(6.501, 3.301), restaurant, delivery] });
  page.api!.apply({ markers: [rider(6.505, 3.305), restaurant, delivery] });
  assert.deepEqual(page.fits, ['fit'], 'rider updates do not move the camera');

  page.api!.apply({ markers: [rider(6.505, 3.305), restaurant, { ...delivery, latitude: 6.7 }] });
  assert.deepEqual(page.fits, ['fit', 'fit'], 'a moved stop re-fits');

  page.api!.apply({ markers: [rider(6.505, 3.305), restaurant] });
  assert.deepEqual(page.fits, ['fit', 'fit', 'fit'], 'a removed stop re-fits');
});

test('page: a single marker eases to it instead of fitting bounds', () => {
  const page = runPage();
  page.fireLoad();
  page.api!.apply({ markers: [delivery] });
  assert.deepEqual(page.fits, ['ease']);
});

test('page: removes markers that disappear from the payload', () => {
  const page = runPage();
  page.fireLoad();
  page.api!.apply({ markers: [rider(6.5, 3.3), delivery] });
  page.api!.apply({ markers: [delivery] });
  assert.equal(page.markers[0].removed, true, 'rider removed');
  assert.equal(page.markers[1].removed, false);
});

test('page: the rider glides over ~1s between nearby fixes', () => {
  const page = runPage();
  page.fireLoad();
  page.api!.apply({ markers: [rider(6.5, 3.3), delivery] });
  const riderMarker = page.markers[0];
  assert.equal(page.pendingFrames(), 0, 'first placement is immediate');

  page.api!.apply({ markers: [rider(6.51, 3.31), delivery] });
  assert.equal(riderMarker.lngLat.lat, 6.5, 'does not jump on update');

  page.tick(1000); // start of the animation
  page.tick(1500); // t = 0.5, eased = 0.75
  assert.ok(Math.abs(riderMarker.lngLat.lat - (6.5 + 0.01 * 0.75)) < 1e-9);
  assert.ok(Math.abs(riderMarker.lngLat.lng - (3.3 + 0.01 * 0.75)) < 1e-9);

  page.tick(2000);
  assert.ok(Math.abs(riderMarker.lngLat.lat - 6.51) < 1e-9);
  assert.equal(page.pendingFrames(), 0, 'animation stops once it lands');
  assert.equal(page.markers[1].lngLat.lat, delivery.latitude, 'stops never move');
});

test('page: a new fix mid-glide cancels the old animation instead of stacking another', () => {
  const page = runPage();
  page.fireLoad();
  page.api!.apply({ markers: [rider(6.5, 3.3)] });
  page.api!.apply({ markers: [rider(6.51, 3.3)] });
  page.tick(0);
  page.tick(500);
  page.api!.apply({ markers: [rider(6.52, 3.3)] });
  assert.equal(page.pendingFrames(), 1, 'the old frame was cancelled');
});

test('page: a far-away fix snaps instead of gliding across the city', () => {
  const page = runPage();
  page.fireLoad();
  page.api!.apply({ markers: [rider(6.5, 3.3)] });
  page.api!.apply({ markers: [rider(6.9, 3.3)] });
  assert.equal(page.markers[0].lngLat.lat, 6.9);
  assert.equal(page.pendingFrames(), 0);
});

test('page: a marker with a non-finite coordinate is skipped without breaking the update', () => {
  const page = runPage();
  page.fireLoad();
  // NaN serialises to null across the WebView bridge.
  page.api!.apply({ markers: [{ ...rider(6.5, 3.3), latitude: null as unknown as number }, delivery] });
  assert.equal(page.markers.length, 1);
  page.api!.apply({ markers: [rider(6.5, 3.3), delivery] });
  assert.equal(page.markers.length, 2, 'later updates still work');
});

test('page: only the interactive map gets zoom controls', () => {
  const interactive = runPage({ interactive: true });
  const passive = runPage({ interactive: false });
  assert.deepEqual(interactive.controls, ['top-right']);
  assert.deepEqual(passive.controls, []);
  assert.equal(passive.mapOptions.interactive, false);
});

test('page: cooperative gestures follow interactive, so a map in a scrolling page does not eat the scroll', () => {
  assert.equal(runPage({ interactive: true }).mapOptions.cooperativeGestures, true);
  assert.equal(runPage({ interactive: false }).mapOptions.cooperativeGestures, false);
});

test('classifyLiveMapNavigation allows only the initial load, sends http(s) links out, drops the rest', () => {
  assert.equal(classifyLiveMapNavigation(LIVE_MAP_BASE_URL), 'allow');
  assert.equal(classifyLiveMapNavigation('about:blank'), 'allow');
  assert.equal(classifyLiveMapNavigation('data:text/html,<p>x</p>'), 'allow');
  assert.equal(classifyLiveMapNavigation('https://www.openstreetmap.org/copyright'), 'external');
  assert.equal(classifyLiveMapNavigation('http://maplibre.org/'), 'external');
  assert.equal(classifyLiveMapNavigation('https://feasty.com.ng/other'), 'external', 'only the exact baseUrl is the initial load');
  assert.equal(classifyLiveMapNavigation('javascript:alert(1)'), 'block');
  assert.equal(classifyLiveMapNavigation('intent://scan#Intent;end'), 'block');
  assert.equal(classifyLiveMapNavigation('file:///etc/passwd'), 'block');
});
