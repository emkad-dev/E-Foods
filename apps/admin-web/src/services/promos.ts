import { callAdminRpc } from '../lib/rpc';

export interface Promo {
  id: string;
  title: string;
  body: string;
  actionUrl: string | null;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdByUid: string;
  createdAt: string;
  updatedAt: string;
  impressions: number;
  clicks: number;
  attributedOrders: number;
  attributedRevenue: number;
}

export const listPromos = () => callAdminRpc<{ promos: Promo[] }>('promoList');

export const createPromo = (input: {
  title: string;
  body: string;
  actionUrl?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
}) => callAdminRpc<{ promo: Promo }>('promoCreate', input);

export const setPromoActive = (id: string, active: boolean) =>
  callAdminRpc<{ promo: Promo }>('promoSetActive', { id, active });
