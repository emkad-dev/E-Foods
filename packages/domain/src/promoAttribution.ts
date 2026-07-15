export const PROMO_ATTRIBUTION_WINDOW_MS = 86_400_000; // 24h

export const resolveAttributedPromoId = (
  stored: { promoId: string; clickedAt: number } | null,
  nowMs: number,
): string | null => {
  if (!stored || typeof stored.promoId !== 'string' || typeof stored.clickedAt !== 'number') {
    return null;
  }
  return nowMs - stored.clickedAt <= PROMO_ATTRIBUTION_WINDOW_MS ? stored.promoId : null;
};

export const promoCtr = (impressions: number, clicks: number): number =>
  impressions > 0 ? clicks / impressions : 0;
