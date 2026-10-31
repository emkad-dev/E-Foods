import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import {
  LIVE_MAP_FAILED_MESSAGE,
  LIVE_MAP_READY_MESSAGE,
  LIVE_MAP_READY_TIMEOUT_MS,
  buildLiveMapApplyScript,
  buildLiveMapHtml,
  type LiveMapMarker,
  type LiveMapTheme,
} from './liveMapHtml';

export type LiveMapProps = {
  markers: LiveMapMarker[];
  /** Must be a stable (module-level) object: a new one rebuilds the page. */
  theme: LiveMapTheme;
  /** False: no pan/zoom/controls and touches pass through to the parent. */
  interactive?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Shown instead of the map when it cannot load (CDN or network down). */
  fallback?: ReactNode;
};

type MapStatus = 'loading' | 'ready' | 'failed';

/**
 * Native host (Android/iOS): MapLibre inside react-native-webview. The web
 * build resolves LiveMap.web.tsx instead, because react-native-webview has no
 * web implementation and renders an error string there.
 */
export function LiveMap({ markers, theme, interactive = false, style, fallback = null }: LiveMapProps) {
  const webViewRef = useRef<WebView>(null);
  const [status, setStatus] = useState<MapStatus>('loading');
  const html = useMemo(() => buildLiveMapHtml({ interactive, theme }), [interactive, theme]);
  // Callers rebuild marker objects every render; key on the values so an
  // unchanged position never re-sends.
  const markersKey = JSON.stringify(markers);
  const applyScript = useMemo(() => buildLiveMapApplyScript({ markers: JSON.parse(markersKey) }), [markersKey]);

  // A rebuilt page (interactive or theme changed) is a fresh document with no
  // markers and, if the last one failed, no WebView at all. Without this the
  // status would stay 'ready'/'failed', the apply effect would not re-run on
  // the new page's ready message, and the new map would stay empty.
  useEffect(() => {
    setStatus('loading');
  }, [html]);

  useEffect(() => {
    if (status !== 'loading') {
      return;
    }
    const timer = setTimeout(() => setStatus((current) => (current === 'loading' ? 'failed' : current)), LIVE_MAP_READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    if (status === 'ready') {
      webViewRef.current?.injectJavaScript(applyScript);
    }
  }, [status, applyScript]);

  const handleMessage = (event: WebViewMessageEvent) => {
    if (event.nativeEvent.data === LIVE_MAP_READY_MESSAGE) {
      setStatus('ready');
    } else if (event.nativeEvent.data === LIVE_MAP_FAILED_MESSAGE) {
      setStatus('failed');
    }
  };

  if (status === 'failed') {
    return <View style={style}>{fallback}</View>;
  }

  return (
    <View style={[style, { pointerEvents: interactive ? 'auto' : 'none' }]}>
      <WebView
        ref={webViewRef}
        javaScriptEnabled
        originWhitelist={['*']}
        scrollEnabled={false}
        source={{ html }}
        onMessage={handleMessage}
        onError={() => setStatus('failed')}
        style={[styles.webView, { backgroundColor: theme.background }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  webView: {
    flex: 1,
  },
});
