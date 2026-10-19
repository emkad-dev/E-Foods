import { callAdminRpc } from '../lib/rpc';

export interface Promo {
  id: string;
  title: string;
  body: string;
  actionUrl: string | null;
  imageUrl: string | null;
  detailBody: string | null;
  terms: string | null;
  ctaLabel: string | null;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdByUid: string;
  createdAt: string;
  updatedAt: string;
  impressions?: number;
  clicks?: number;
  attributedOrders?: number;
  attributedRevenue?: number;
}

export const listPromos = () => callAdminRpc<{ promos: Promo[] }>('promoList');

export const createPromo = (input: {
  title: string;
  body: string;
  actionUrl?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  imageUrl?: string | null;
  detailBody?: string | null;
  terms?: string | null;
  ctaLabel?: string | null;
}) => callAdminRpc<{ promo: Promo }>('promoCreate', input);

export const setPromoActive = (id: string, active: boolean) =>
  callAdminRpc<{ promo: Promo }>('promoSetActive', { id, active });

export type PromoCodeType = 'percent' | 'fixed' | 'free_delivery';
export type PromoCodeFunding = 'platform' | 'restaurant';

export interface PromoCode {
  id: string;
  code: string;
  type: PromoCodeType;
  value: number | null;
  minBasket: number | null;
  perUserCap: number | null;
  globalCap: number | null;
  startsAt: string | null;
  endsAt: string | null;
  restaurantId: string | null;
  fundingSource: PromoCodeFunding;
  isActive: boolean;
  isAutomatic: boolean;
  createdAt?: string;
}

export interface CreatePromoCodeInput {
  code: string;
  type: PromoCodeType;
  value: number;
  minBasket?: number;
  perUserCap?: number | null;
  globalCap?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  restaurantId?: string | null;
  fundingSource: PromoCodeFunding;
  isAutomatic?: boolean;
  isActive?: boolean;
}

export const listPromoCodes = () => callAdminRpc<{ promoCodes: PromoCode[] }>('adminListPromoCodes');

export const createPromoCode = (input: CreatePromoCodeInput) =>
  callAdminRpc<{ promoCode: PromoCode }>('adminCreatePromoCode', input as unknown as Record<string, unknown>);

export const setPromoCodeActive = (id: string, isActive: boolean) =>
  callAdminRpc<{ promoCode: PromoCode }>('adminSetPromoCodeActive', { id, isActive });
