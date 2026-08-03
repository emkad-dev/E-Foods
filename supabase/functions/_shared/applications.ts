// Partner and dispatch onboarding applications: the rows an applicant submits
// and an admin reviews.

import { serviceClient } from './client.ts';
import { DEFAULT_DISPATCH_VEHICLE } from './dispatchRiders.ts';
import { DEFAULT_NIGERIA_COORDINATE } from './nigeriaGeography.ts';
import { sanitizeOptionalText, sanitizeText } from './rpc/coercion.ts';

export const DISPATCH_APPLICATION_STATUS = {
  APPROVED: 'approved',
  PENDING: 'pending',
  REJECTED: 'rejected',
} as const;

export const PARTNER_APPLICATION_STATUS = {
  APPROVED: 'approved',
  PENDING: 'pending',
  REJECTED: 'rejected',
} as const;

export type PartnerApplicationRow = {
  address: string;
  approvedByUid?: string | null;
  contactName: string;
  cuisine: string;
  deliveryTime?: string | null;
  description?: string | null;
  email: string;
  id: string;
  logoImage?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  phoneNumber: string;
  rejectionReason?: string | null;
  restaurantId?: string | null;
  restaurantName: string;
  reviewedAt?: string | null;
  status: string;
  submittedAt: string;
  uid: string;
  updatedAt?: string | null;
};

export type DispatchApplicationRow = {
  approvedByUid?: string | null;
  currentAddress?: string | null;
  displayName: string;
  email: string;
  id: string;
  latitude?: number | null;
  lga: string;
  longitude?: number | null;
  phoneNumber: string;
  region: string;
  rejectionReason?: string | null;
  reviewedAt?: string | null;
  status: string;
  submittedAt: string;
  uid: string;
  updatedAt?: string | null;
  vehicleType: string;
};

export const PARTNER_APPLICATION_COLUMNS =
  'id,uid,email,contactName,phoneNumber,restaurantName,cuisine,address,description,logoImage,latitude,longitude,deliveryTime,status,restaurantId,submittedAt,reviewedAt,approvedByUid,rejectionReason,updatedAt';

export const DISPATCH_APPLICATION_COLUMNS =
  'id,uid,email,displayName,phoneNumber,region,lga,vehicleType,currentAddress,latitude,longitude,status,submittedAt,reviewedAt,approvedByUid,rejectionReason,updatedAt';

export const buildPartnerApplicationResponse = (application: PartnerApplicationRow) => ({
  address: sanitizeText(application.address),
  approvedByUid: sanitizeOptionalText(application.approvedByUid),
  contactName: sanitizeText(application.contactName),
  cuisine: sanitizeText(application.cuisine),
  deliveryTime: sanitizeOptionalText(application.deliveryTime),
  description: sanitizeOptionalText(application.description),
  email: sanitizeText(application.email),
  id: application.id,
  logoImage: sanitizeOptionalText(application.logoImage),
  latitude: application.latitude ?? null,
  longitude: application.longitude ?? null,
  phoneNumber: sanitizeText(application.phoneNumber),
  rejectionReason: sanitizeOptionalText(application.rejectionReason),
  restaurantName: sanitizeText(application.restaurantName),
  reviewedAt: application.reviewedAt ?? null,
  status: sanitizeText(application.status, PARTNER_APPLICATION_STATUS.PENDING),
  submittedAt: application.submittedAt,
  uid: application.uid,
});

export const buildDispatchApplicationResponse = (application: DispatchApplicationRow) => ({
  approvedByUid: sanitizeOptionalText(application.approvedByUid),
  currentAddress: sanitizeOptionalText(application.currentAddress),
  displayName: sanitizeText(application.displayName),
  email: sanitizeText(application.email),
  id: application.id,
  latitude: application.latitude ?? DEFAULT_NIGERIA_COORDINATE.latitude,
  lga: sanitizeText(application.lga),
  longitude: application.longitude ?? DEFAULT_NIGERIA_COORDINATE.longitude,
  phoneNumber: sanitizeText(application.phoneNumber),
  region: sanitizeText(application.region),
  rejectionReason: sanitizeOptionalText(application.rejectionReason),
  reviewedAt: application.reviewedAt ?? null,
  status: sanitizeText(application.status, DISPATCH_APPLICATION_STATUS.PENDING),
  submittedAt: application.submittedAt,
  uid: application.uid,
  vehicleType: sanitizeText(application.vehicleType, DEFAULT_DISPATCH_VEHICLE),
});

export const loadPartnerApplication = async (applicationId: string) => {
  const { data, error } = await serviceClient
    .from('PartnerApplicationRecord')
    .select(PARTNER_APPLICATION_COLUMNS)
    .eq('id', applicationId)
    .maybeSingle<PartnerApplicationRow>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? null;
};

export const loadDispatchApplication = async (applicationId: string) => {
  const { data, error } = await serviceClient
    .from('DispatchApplicationRecord')
    .select(DISPATCH_APPLICATION_COLUMNS)
    .eq('id', applicationId)
    .maybeSingle<DispatchApplicationRow>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? null;
};
