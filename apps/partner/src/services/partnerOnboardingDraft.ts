import AsyncStorage from '@react-native-async-storage/async-storage';

const ONBOARDING_DRAFT_STORAGE_KEY = '@feasty/partner-onboarding-draft';

export type PartnerOnboardingDraft = {
  accountNumber?: string | null;
  address?: string | null;
  bankCode?: string | null;
  bankName?: string | null;
  contactName?: string | null;
  cuisine?: string | null;
  deliveryRadiusKm?: number | null;
  deliveryTime?: string | null;
  description?: string | null;
  documentBackPath?: string | null;
  documentFrontPath?: string | null;
  documentType?: string | null;
  email?: string | null;
  latitude?: number | null;
  legalName?: string | null;
  longitude?: number | null;
  phoneNumber?: string | null;
  restaurantName?: string | null;
  savedAt: string;
};

export const loadPartnerOnboardingDraft = async () => {
  const serialized = await AsyncStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY);

  if (!serialized) {
    return null;
  }

  try {
    return JSON.parse(serialized) as PartnerOnboardingDraft;
  } catch {
    await AsyncStorage.removeItem(ONBOARDING_DRAFT_STORAGE_KEY);
    return null;
  }
};

export const savePartnerOnboardingDraft = async (draft: Omit<PartnerOnboardingDraft, 'savedAt'>) => {
  const payload: PartnerOnboardingDraft = {
    ...draft,
    savedAt: new Date().toISOString(),
  };

  await AsyncStorage.setItem(ONBOARDING_DRAFT_STORAGE_KEY, JSON.stringify(payload));
  return payload;
};

export const clearPartnerOnboardingDraft = () => AsyncStorage.removeItem(ONBOARDING_DRAFT_STORAGE_KEY);
