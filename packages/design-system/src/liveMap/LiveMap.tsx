import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

import { openExternalLink } from '../../../runtime/src/externalLink';
import {
  LIVE_MAP_BASE_URL,
  buildLiveMapApplyScript,
  buildLiveMapHtml,
  classifyLiveMapNavigation,
  type LiveMapMarker,
  type LiveMapTheme,
} from './liveMapHtml';
import { useLiveMapStatus } from './useLiveMapStatus';

export type LiveMapProps = {
  markers: LiveMapMarker[];
  /** Must be a stable (module-level) object: a new one rebuilds the page. */
  theme: LiveMapTheme;
  /** False: no pan/zoom/controls and touches pass through to the parent. */
  interactive?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Shown instead of the map when it cannot load (CDN or network down). */
  fallback?: ReactNode;
  /** Called with true when the fallback replaces the map and false when the map is back. */
  onFallbackChange?: (showing: boolean) => void;
};

/**
 * Native host (Android/iOS): MapLibre inside react-native-webview. The web
 * build resolves LiveMap.web.tsx instead, because react-native-webview has no
 * web implementation and renders an error string there.
 */
export function LiveMap({ markers, theme, interactive = false, style, fallback = null, onFallbackChange }: LiveMapProps) {
  const webViewRef = useRef<WebView>(null);
  const html = useMemo(() => buildLiveMapHtml({ interactive, theme }), [interactive, theme]);
  const { status, showFallback, markFailed, handlePageMessage } = useLiveMapStatus(html, onFallbackChange);
  // Callers rebuild marker objects every render; key on the values so an
  // unchanged position never re-sends.
  const markersKey = JSON.stringify(markers);
  const applyScript = useMemo(() => buildLiveMapApplyScript({ markers: JSON.parse(markersKey) }), [markersKey]);

  useEffect(() => {
    if (status === 'ready') {
      webViewRef.current?.injectJavaScript(applyScript);
    }
  }, [status, applyScript]);

  const handleMessage = (event: WebViewMessageEvent) => handlePageMessage(event.nativeEvent.data);

  // The page never navigates after its first load, so any other top-frame
  // request is a tapped link (the MapLibre attribution). Android reports
  // navigationType as always 'other', so a click cannot be told apart from
  // anything else there; that is fine because nothing else may navigate either.
  // Subframe requests are not ours to judge and are left alone.
  const handleShouldStartLoad = (request: ShouldStartLoadRequest) => {
    if (!request.isTopFrame) {
      return true;
    }
    const navigation = classifyLiveMapNavigation(request.url);
    if (navigation === 'external') {
      void openExternalLink(request.url);
    }
    return navigation === 'allow';
  };

  return (
    <View style={[style, { pointerEvents: interactive ? 'auto' : 'none' }]}>
      {/* Stays mounted while the fallback shows: a slow first MapLibre download can report ready after the timeout, and that must bring the map back. */}
      <WebView
        ref={webViewRef}
        javaScriptEnabled
        originWhitelist={['*']}
        scrollEnabled={false}
        source={{ html, baseUrl: LIVE_MAP_BASE_URL }}
        onMessage={handleMessage}
        onShouldStartLoadWithRequest={handleShouldStartLoad}
        onError={markFailed}
        style={[styles.webView, { backgroundColor: theme.background }]}
      />
      {showFallback ? <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }]}>{fallback}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  webView: {
    flex: 1,
  },
});
