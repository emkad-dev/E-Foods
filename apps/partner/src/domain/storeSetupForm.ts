/**
 * The store-setup form's data model, kept out of the screen so the seeding and
 * validation rules can be read - and tested - without a renderer.
 *
 * TWO RULES DRIVE EVERYTHING HERE.
 *
 * 1. NOTHING IS INVENTED. The old screen seeded `'25-35 min'`, `'08:00'`,
 *    `'22:00'`, `'0'`, `'0'` and `'12'` into empty fields, and Save wrote them
 *    to RestaurantRecord as if the partner had typed them - a store that never
 *    stated its hours was published as open 08:00-22:00 and delivering 12 km.
 *    Every seed below comes from the saved record or is the empty string.
 *
 * 2. THE SERVER IS MIRRORED, NOT GUESSED. `buildPartnerRestaurantPayload` in
 *    supabase/functions/_shared/domains/partner.ts rejects a missing name, a
 *    missing address, a missing or non-`HH:mm` opening/closing time, both
 *    fulfilment modes off, and one coordinate without the other. None of those
 *    were checked here, so each arrived as a bare 400 with no field attached to
 *    it. The server stays the authority; this is the same shape, earlier.
 */

const OPERATING_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const NUMERIC_PATTERN = /^-?\d*\.?\d+$/;

export type StoreSetupFieldKey =
  | 'name'
  | 'address'
  | 'openingTime'
  | 'closingTime'
  | 'deliveryFee'
  | 'minOrder'
  | 'latitude'
  | 'longitude'
  | 'deliveryRadiusKm'
  | 'fulfilment';

export type StoreSetupDraft = {
  name: string;
  cuisine: string;
  description: string;
  address: string;
  image: string;
  logoImage: string;
  deliveryTime: string;
  openingTime: string;
  closingTime: string;
  deliveryFee: string;
  minOrder: string;
  latitude: string;
  longitude: string;
  deliveryRadiusKm: string;
  supportsDelivery: boolean;
  supportsPickup: boolean;
  isPublished: boolean;
  isOpen: boolean;
};

/**
 * Structural rather than `RestaurantDocument`, so this module imports nothing:
 * the entity barrel reaches React Native, which Node's test runner cannot load.
 */
export type StoreRecordLike = {
  name?: string | null;
  cuisine?: string | null;
  description?: string | null;
  address?: string | null;
  image?: string | null;
  logoImage?: string | null;
  deliveryTime?: string | number | null;
  openingTime?: string | null;
  closingTime?: string | null;
  deliveryFee?: number | null;
  minOrder?: number | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  deliveryRadiusKm?: number | string | null;
  supportsDelivery?: boolean | null;
  supportsPickup?: boolean | null;
  isPublished?: boolean | null;
  isOpen?: boolean | null;
};

export const STORE_SETUP_MESSAGES = {
  name: 'Add the restaurant name customers should see.',
  address: 'Add the street, area and city customers order from.',
  openingTime: 'Add the time you open, as 24-hour HH:mm - for example 08:00.',
  closingTime: 'Add the time you close, as 24-hour HH:mm - for example 22:00.',
  fulfilment: 'Turn on delivery, pickup, or both - a store has to offer one of them.',
  number: 'Use a number here, or clear the field to leave it unset.',
  negative: 'Use zero or more.',
  coordinatePair: 'Latitude and longitude go together - add both, or clear both.',
  location: 'Add both latitude and longitude before making this store visible.',
  deliveryRadiusKm: 'Add a delivery distance above zero before making this store visible.',
} as const;

/** `''` for anything the record does not hold. Never a stand-in value. */
const textOf = (value: string | number | null | undefined) =>
  value === null || value === undefined ? '' : String(value);

export const EMPTY_STORE_SETUP_DRAFT: StoreSetupDraft = {
  name: '',
  cuisine: '',
  description: '',
  address: '',
  image: '',
  logoImage: '',
  deliveryTime: '',
  openingTime: '',
  closingTime: '',
  deliveryFee: '',
  minOrder: '',
  latitude: '',
  longitude: '',
  deliveryRadiusKm: '',
  supportsDelivery: false,
  supportsPickup: true,
  isPublished: false,
  isOpen: true,
};

/**
 * The booleans keep their `!== false` / `=== true` readings because that IS the
 * saved state: the server's own response builder resolves them the same way, so
 * there is no third "unset" reading to preserve. `isPublished` reads false for a
 * store with no record - an unsaved store is not live.
 */
export const draftFromStore = (store: StoreRecordLike | null | undefined): StoreSetupDraft => {
  if (!store) {
    return EMPTY_STORE_SETUP_DRAFT;
  }

  return {
    name: textOf(store.name),
    cuisine: textOf(store.cuisine),
    description: textOf(store.description),
    address: textOf(store.address),
    image: textOf(store.image),
    logoImage: textOf(store.logoImage),
    deliveryTime: textOf(store.deliveryTime),
    openingTime: textOf(store.openingTime),
    closingTime: textOf(store.closingTime),
    deliveryFee: textOf(store.deliveryFee),
    minOrder: textOf(store.minOrder),
    latitude: textOf(store.latitude),
    longitude: textOf(store.longitude),
    deliveryRadiusKm: textOf(store.deliveryRadiusKm),
    supportsDelivery: store.supportsDelivery === true,
    supportsPickup: store.supportsPickup !== false,
    isPublished: store.isPublished === true,
    isOpen: store.isOpen !== false,
  };
};

/** Blank stays blank: `null` is how "the partner did not set this" is sent. */
export const toNumberOrNull = (value: string) => {
  if (!value.trim()) {
    return null;
  }

  const parsedValue = Number.parseFloat(value);
  return Number.isFinite(parsedValue) ? parsedValue : null;
};

const isBlank = (value: string) => value.trim().length === 0;

/** Blank is allowed (it means unset); anything else has to be a real number. */
const numberProblem = (value: string, options: { allowNegative: boolean }) => {
  if (isBlank(value)) {
    return null;
  }

  const trimmed = value.trim();
  const parsedValue = Number.parseFloat(trimmed);

  // Both checks: parseFloat happily reads '12abc' as 12, and the pattern alone
  // would accept a string too long to be finite.
  if (!Number.isFinite(parsedValue) || !NUMERIC_PATTERN.test(trimmed)) {
    return STORE_SETUP_MESSAGES.number;
  }

  return !options.allowNegative && parsedValue < 0 ? STORE_SETUP_MESSAGES.negative : null;
};

export type StoreSetupErrors = Partial<Record<StoreSetupFieldKey, string>>;

export const validateStoreSetup = (draft: StoreSetupDraft): StoreSetupErrors => {
  const errors: StoreSetupErrors = {};

  if (isBlank(draft.name)) {
    errors.name = STORE_SETUP_MESSAGES.name;
  }

  if (isBlank(draft.address)) {
    errors.address = STORE_SETUP_MESSAGES.address;
  }

  if (!OPERATING_TIME_PATTERN.test(draft.openingTime.trim())) {
    errors.openingTime = STORE_SETUP_MESSAGES.openingTime;
  }

  if (!OPERATING_TIME_PATTERN.test(draft.closingTime.trim())) {
    errors.closingTime = STORE_SETUP_MESSAGES.closingTime;
  }

  if (!draft.supportsDelivery && !draft.supportsPickup) {
    errors.fulfilment = STORE_SETUP_MESSAGES.fulfilment;
  }

  const feeProblem = numberProblem(draft.deliveryFee, { allowNegative: false });
  if (feeProblem) {
    errors.deliveryFee = feeProblem;
  }

  const minOrderProblem = numberProblem(draft.minOrder, { allowNegative: false });
  if (minOrderProblem) {
    errors.minOrder = minOrderProblem;
  }

  // Coordinates may legitimately be negative; a radius may not.
  const latitudeProblem = numberProblem(draft.latitude, { allowNegative: true });
  if (latitudeProblem) {
    errors.latitude = latitudeProblem;
  }

  const longitudeProblem = numberProblem(draft.longitude, { allowNegative: true });
  if (longitudeProblem) {
    errors.longitude = longitudeProblem;
  }

  const radiusProblem = numberProblem(draft.deliveryRadiusKm, { allowNegative: false });
  if (radiusProblem) {
    errors.deliveryRadiusKm = radiusProblem;
  }

  const hasLatitude = !isBlank(draft.latitude) && !latitudeProblem;
  const hasLongitude = !isBlank(draft.longitude) && !longitudeProblem;

  // The server rejects one coordinate without the other outright, published or
  // not, so this is checked before the publish gate rather than inside it.
  if (hasLatitude !== hasLongitude) {
    if (!hasLatitude && !errors.latitude) {
      errors.latitude = STORE_SETUP_MESSAGES.coordinatePair;
    }

    if (!hasLongitude && !errors.longitude) {
      errors.longitude = STORE_SETUP_MESSAGES.coordinatePair;
    }
  }

  if (draft.isPublished) {
    if (!hasLatitude && !errors.latitude) {
      errors.latitude = STORE_SETUP_MESSAGES.location;
    }

    if (!hasLongitude && !errors.longitude) {
      errors.longitude = STORE_SETUP_MESSAGES.location;
    }

    const radius = toNumberOrNull(draft.deliveryRadiusKm);
    if (!errors.deliveryRadiusKm && (radius === null || radius <= 0)) {
      errors.deliveryRadiusKm = STORE_SETUP_MESSAGES.deliveryRadiusKm;
    }
  }

  return errors;
};

export const hasStoreSetupErrors = (errors: StoreSetupErrors) => Object.keys(errors).length > 0;

/**
 * What the Store tab can tell a partner to go and fix, derived from the SAVED
 * record only. The read-only dump this replaces mirrored saved state beside the
 * live switches and contradicted them on every unsaved edit; nothing listed here
 * is editable on the screen that shows it, so there is nothing to contradict.
 */
export const storeSetupGaps = (store: StoreRecordLike | null | undefined): string[] => {
  if (!store) {
    return ['Your store record has not been created yet.'];
  }

  const gaps: string[] = [];

  if (isBlank(textOf(store.address))) {
    gaps.push('No address saved, so customers cannot see where you are.');
  }

  if (isBlank(textOf(store.openingTime)) || isBlank(textOf(store.closingTime))) {
    gaps.push('No trading hours saved.');
  }

  if (isBlank(textOf(store.latitude)) || isBlank(textOf(store.longitude))) {
    gaps.push('No map location saved, which your store needs before it can be visible.');
  }

  if (store.supportsDelivery === true && toNumberOrNull(textOf(store.deliveryRadiusKm)) === null) {
    gaps.push('Delivery is on but no delivery distance is saved.');
  }

  return gaps;
};
