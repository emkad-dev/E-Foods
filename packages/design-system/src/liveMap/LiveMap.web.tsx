import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import {
  LIVE_MAP_FAILED_MESSAGE,
  LIVE_MAP_READY_MESSAGE,
  LIVE_MAP_READY_TIMEOUT_MS,
  buildLiveMapApplyMessage,
  buildLiveMapHtml,
} from './liveMapHtml';
import type { LiveMapProps } from './LiveMap';

type MapStatus = 'loading' | 'ready' | 'failed';

/**
 * Web host: the same page in a sandboxed iframe. `allow-scripts` without
 * `allow-same-origin` gives it an opaque origin, so the third-party MapLibre
 * script can never read the app's storage or session. Messages are only
 * accepted from this iframe's own window.
 */
export function LiveMap({ markers, theme, interactive = false, style, fallback = null }: LiveMapProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<MapStatus>('loading');
  const html = useMemo(() => buildLiveMapHtml({ interactive, theme }), [interactive, theme]);
  const markersKey = JSON.stringify(markers);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) {
        return;
      }
      if (event.data === LIVE_MAP_READY_MESSAGE) {
        setStatus('ready');
      } else if (event.data === LIVE_MAP_FAILED_MESSAGE) {
        setStatus('failed');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // A rebuilt page (interactive or theme changed) is a fresh document: see the
  // matching effect in LiveMap.tsx.
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
      iframeRef.current?.contentWindow?.postMessage(buildLiveMapApplyMessage({ markers: JSON.parse(markersKey) }), '*');
    }
  }, [status, markersKey]);

  if (status === 'failed') {
    return <View style={style}>{fallback}</View>;
  }

  return (
    <View style={[style, { pointerEvents: interactive ? 'auto' : 'none' }]}>
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
    </View>
  );
}
