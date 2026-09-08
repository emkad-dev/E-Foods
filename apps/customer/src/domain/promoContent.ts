export type PromoContent = {
  id: string;
  title: string;
  body: string;
  actionUrl: string | null;
  imageUrl: string | null;
  detailBody: string | null;
  terms: string | null;
  ctaLabel: string | null;
};

const hasText = (value: string | null | undefined): boolean => typeof value === 'string' && value.trim().length > 0;

// A promo warrants its own landing page only when it carries content beyond the
// one-line banner — an image, a full description, or terms.
export const promoHasRichContent = (
  promo: Pick<Partial<PromoContent>, 'imageUrl' | 'detailBody' | 'terms'>
): boolean => hasText(promo.imageUrl) || hasText(promo.detailBody) || hasText(promo.terms);
