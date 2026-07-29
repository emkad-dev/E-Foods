// apps/customer/src/services/promoTracking.ts
import { Platform } from 'react-native';
import { resolveAttributedPromoId } from '../../../../packages/domain/src/promoAttribution';
import { appEnv, supabaseEnv } from '../config/env';
import { supabase } from './supabase/config';

const LAST_CLICK_KEY = 'feasty.promoLastClick';
const seenThisSession = new Set<string>();

// Deliberately NOT using callCustomerBackendRpc: that helper throws
// SESSION_EXPIRED_ERROR_MESSAGE before making any network call when there is
// no session, which would silently drop every logged-out promo event even
// though the server's promoTrack action is reachable pre-auth. This talks to
// the backend RPC endpoint directly so it works with or without a session.
const track = (promoId: string, type: 'impression' | 'click') => {
  // Fire-and-forget: a tracking failure must never surface to the customer.
  void (async () => {
    try {
      const backendRpcUrl = appEnv.backendRpcUrl;
      const anonKey = supabaseEnv.anonKey;
      if (!backendRpcUrl || !anonKey) return;

      const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
      const token = data?.session?.access_token || anonKey;

      await fetch(backendRpcUrl, {
        body: JSON.stringify({ action: 'promoTrack', data: { promoId, type } }),
        headers: {
          'Content-Type': 'application/json',
          apikey: anonKey,
          Authorization: `Bearer ${token}`,
        },
        method: 'POST',
      });
    } catch {
      // ignore — tracking must never surface to the customer
    }
  })();
};

export const trackPromoImpression = (promoId: string) => {
  if (Platform.OS === 'web') {
    try {
      const key = `feasty.promoSeen:${promoId}`;
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, '1');
    } catch {
      if (seenThisSession.has(promoId)) return;
      seenThisSession.add(promoId);
    }
  } else {
    if (seenThisSession.has(promoId)) return;
    seenThisSession.add(promoId);
  }
  track(promoId, 'impression');
};

export const trackPromoClick = (promoId: string) => {
  track(promoId, 'click');
  const record = JSON.stringify({ promoId, clickedAt: Date.now() });
  if (Platform.OS === 'web') {
    try { window.localStorage.setItem(LAST_CLICK_KEY, record); } catch { /* ignore */ }
  }
};

export const takeAttributedPromoId = (): string | null => {
  if (Platform.OS !== 'web') return null; // attribution is web-first (Phase 1)
  try {
    const raw = window.localStorage.getItem(LAST_CLICK_KEY);
    try {
      const stored = raw ? (JSON.parse(raw) as { promoId: string; clickedAt: number }) : null;
      return resolveAttributedPromoId(stored, Date.now());
    } finally {
      // Always clear, even on corrupt JSON — a bad record must not persist forever.
      window.localStorage.removeItem(LAST_CLICK_KEY);
    }
  } catch {
    return null;
  }
};
