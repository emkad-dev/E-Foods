export type PromoEventType = 'impression' | 'click';
export type PromoTrackResult =
  | { ok: true; value: { promoId: string; type: PromoEventType } }
  | { ok: false; message: string };

export const MAX_PROMO_ID_LENGTH = 128;

export const validatePromoTrack = (data: Record<string, unknown>): PromoTrackResult => {
  const promoId = typeof data.promoId === 'string' ? data.promoId.trim() : '';
  const type = data.type;
  if (!promoId) {
    return { ok: false, message: 'A promoId is required.' };
  }
  if (promoId.length > MAX_PROMO_ID_LENGTH) {
    return { ok: false, message: `promoId must be ${MAX_PROMO_ID_LENGTH} characters or fewer.` };
  }
  if (type !== 'impression' && type !== 'click') {
    return { ok: false, message: 'type must be "impression" or "click".' };
  }
  return { ok: true, value: { promoId, type } };
};
