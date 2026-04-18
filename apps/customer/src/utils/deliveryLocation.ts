import type { LocationGeocodedAddress } from 'expo-location';

const joinParts = (parts: (string | null | undefined)[]) =>
  parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(', ');

export const formatDeliveryLocation = (address: LocationGeocodedAddress | null) => {
  if (!address) {
    return {
      address: 'Pinned location',
      shortAddress: 'Selected map pin',
    };
  }

  const shortAddress = joinParts([
    address.name,
    address.street,
    address.city ?? address.subregion,
  ]);

  const fullAddress = joinParts([
    address.name,
    address.streetNumber && address.street
      ? `${address.streetNumber} ${address.street}`
      : address.street,
    address.district,
    address.city,
    address.region,
    address.country,
  ]);

  return {
    address: fullAddress || shortAddress || 'Pinned location',
    shortAddress: shortAddress || address.city || address.region || 'Selected map pin',
  };
};

export const fallbackAddressFromCoords = (latitude: number, longitude: number) =>
  `Pinned location (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`;
