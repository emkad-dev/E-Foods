import { useCallback, useEffect, useState } from 'react';

import { LIVE_MAP_FAILED_MESSAGE, LIVE_MAP_READY_MESSAGE, LIVE_MAP_READY_TIMEOUT_MS } from './liveMapHtml';

/**
 * 'timedOut' and 'failed' both show the fallback, but only 'timedOut' can
 * recover: it means "no ready message YET" (a slow first MapLibre download on
 * mobile can outlast the timeout), whereas 'failed' is a real verdict from the
 * page (MapLibre never loaded) or the WebView (load error).
 */
export type LiveMapStatus = 'loading' | 'ready' | 'timedOut' | 'failed';

/**
 * Status/timeout/reset logic shared by the native and web hosts. Pure React: no
 * RN or DOM imports, so both hosts can use it. The host must stay MOUNTED while
 * the fallback shows, otherwise a late ready has no page to come from.
 *
 * `onFallbackChange` lets a parent react to the fallback appearing or going away
 * (e.g. drop a tap overlay that would only open another copy of the fallback).
 *
 * `html` is the page source: a rebuilt page is a fresh document with no markers,
 * so the status restarts from 'loading' (otherwise the apply effect would not
 * re-run on the new page's ready message and the new map would stay empty).
 */
export function useLiveMapStatus(html: string, onFallbackChange?: (showing: boolean) => void) {
  const [status, setStatus] = useState<LiveMapStatus>('loading');

  useEffect(() => {
    setStatus('loading');
  }, [html]);

  useEffect(() => {
    if (status !== 'loading') {
      return;
    }
    const timer = setTimeout(() => setStatus((current) => (current === 'loading' ? 'timedOut' : current)), LIVE_MAP_READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [status]);

  const markFailed = useCallback(() => setStatus('failed'), []);

  /** Routes a message from the page; returns nothing for unrelated messages. */
  const handlePageMessage = useCallback((data: unknown) => {
    if (data === LIVE_MAP_READY_MESSAGE) {
      // A late ready revives a timed-out map; a real failure stays failed.
      setStatus((current) => (current === 'failed' ? current : 'ready'));
    } else if (data === LIVE_MAP_FAILED_MESSAGE) {
      setStatus('failed');
    }
  }, []);

  const showFallback = status === 'timedOut' || status === 'failed';

  useEffect(() => {
    onFallbackChange?.(showFallback);
  }, [showFallback, onFallbackChange]);

  return { status, showFallback, markFailed, handlePageMessage };
}
