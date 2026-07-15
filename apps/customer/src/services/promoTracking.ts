// apps/customer/src/services/promoTracking.ts
import { Platform } from 'react-native';
import { resolveAttributedPromoId } from '../../../../packages/domain/src/promoAttribution';
import { callCustomerBackendRpc } from './backendRpc';

const LAST_CLICK_KEY = 'feasty.promoLastClick';
const seenThisSession = new Set<string>();

const track = (promoId: string, type: 'impression' | 'click') => {
  // Fire-and-forget: a tracking failure must never surface to the customer.
  void callCustomerBackendRpc('promoTrack', { promoId, type }).catch(() => undefined);
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
    const stored = raw ? (JSON.parse(raw) as { promoId: string; clickedAt: number }) : null;
    const promoId = resolveAttributedPromoId(stored, Date.now());
    window.localStorage.removeItem(LAST_CLICK_KEY);
    return promoId;
  } catch {
    return null;
  }
};
