import type { Promo } from '../services/promos';

/**
 * Reads a promo's analytics block, or reports that there isn't one.
 *
 * WHY THIS EXISTS: the promo row printed `promo.impressions ?? 0` and three
 * siblings of the same shape, so "nobody has seen this promo yet" and "the
 * metrics never arrived" rendered as the same four zeros. An operator reading
 * `0 impr · 0 clicks · — CTR · 0 orders · ₦0` under a promo that is plainly
 * Live concludes the campaign is dead and pulls it. There is no reading of
 * that row that tells them the numbers are missing.
 *
 * WHAT THIS FIXES, AND WHAT IT DOES NOT. The `?? 0` on the client is one of
 * TWO coercions on this path, and only the client's is ours to remove. The
 * other is in the deployed handler (supabase/functions/_shared/domains/admin.ts,
 * `promoList`): when the `ebuy_promo_stats` RPC errors, the handler logs it to
 * the function console and then maps every promo through `s?.impressions ?? 0`
 * anyway. The failure is therefore ERASED BEFORE THE RESPONSE IS SERIALISED --
 * a promo with no stats row and a promo whose stats query blew up leave the
 * server as literal zeros, indistinguishable on the wire from a promo that was
 * genuinely seen zero times.
 *
 * So against today's backend this module cannot separate those two cases and
 * deliberately does not pretend to: inferring "stats are down" from an
 * all-zero list would be a guess that reads as a fact, and a brand-new promo
 * would trip it every time. What it DOES close is the remaining case the
 * client owns -- metrics absent from the payload entirely, which is what any
 * fix on the server side would produce (omit the fields, or add an explicit
 * availability flag) and also what an older deployed `promoList` returns,
 * since the `Promo` type marks all four fields optional. Today that renders as
 * an honest "stats unavailable" instead of four invented zeros; the day the
 * handler stops inventing them, this reports the outage with no further
 * change here.
 *
 * Closing it properly needs that handler edited, which is out of scope for a
 * client-only change and is called out in the report instead.
 */
export type PromoStats = {
  attributedOrders: number;
  attributedRevenue: number;
  clicks: number;
  impressions: number;
};

type PromoStatsFields = Pick<Promo, 'attributedOrders' | 'attributedRevenue' | 'clicks' | 'impressions'>;

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * The four metrics are one measurement and travel together, so a payload
 * missing any of them is treated as having none rather than half-rendered:
 * `12 impr · — clicks` invites arithmetic nobody can do.
 */
export const readPromoStats = (promo: PromoStatsFields): PromoStats | null => {
  if (
    !isCount(promo.impressions) ||
    !isCount(promo.clicks) ||
    !isCount(promo.attributedOrders) ||
    !isCount(promo.attributedRevenue)
  ) {
    return null;
  }

  return {
    attributedOrders: promo.attributedOrders,
    attributedRevenue: promo.attributedRevenue,
    clicks: promo.clicks,
    impressions: promo.impressions,
  };
};

/**
 * A ratio with an empty denominator has no value, and "0% CTR" is not that --
 * it is the reading for a promo that was shown and ignored, which is the
 * opposite conclusion from one nobody has been shown yet.
 */
export const formatCtr = (stats: PromoStats): string =>
  stats.impressions > 0 ? `${Math.round((stats.clicks / stats.impressions) * 100)}%` : '—';
