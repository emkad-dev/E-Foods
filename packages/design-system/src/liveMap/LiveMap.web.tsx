import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { buildLiveMapApplyMessage, buildLiveMapHtml } from './liveMapHtml';
import type { LiveMapProps } from './LiveMap';
import { useLiveMapStatus } from './useLiveMapStatus';

/**
 * Web host: the same page in a sandboxed iframe. `allow-scripts` without
 * `allow-same-origin` gives it an opaque origin, so the third-party MapLibre
 * script can never read the app's storage or session. Messages are only
 * accepted from this iframe's own window.
 */
export function LiveMap({ markers, theme, interactive = false, style, fallback = null, onFallbackChange }: LiveMapProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const html = useMemo(() => buildLiveMapHtml({ interactive, theme }), [interactive, theme]);
  const { status, showFallback, handlePageMessage } = useLiveMapStatus(html, onFallbackChange);
  const markersKey = JSON.stringify(markers);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) {
        return;
      }
      handlePageMessage(event.data);
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handlePageMessage]);

  useEffect(() => {
    if (status === 'ready') {
      iframeRef.current?.contentWindow?.postMessage(buildLiveMapApplyMessage({ markers: JSON.parse(markersKey) }), '*');
    }
  }, [status, markersKey]);

  return (
    <View style={[style, { pointerEvents: interactive ? 'auto' : 'none' }]}>
      {/* Stays mounted while the fallback shows: a slow first MapLibre download can report ready after the timeout, and that must bring the map back. */}
      <iframe
        ref={iframeRef}
        title="Live map"
        sandbox="allow-scripts"
        srcDoc={html}
        style={{
          border: 0,
          width: '100%',
          height: '100%',
          display: 'block',
          backgroundColor: theme.background,
          // pointer-events is inherited, but say it: a non-interactive map must never eat a tap meant for its parent.
          pointerEvents: interactive ? 'auto' : 'none',
        }}
      />
      {showFallback ? <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }]}>{fallback}</View> : null}
    </View>
  );
}
