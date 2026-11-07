/**
 * The delivery-address form's one rule: the PIN is the address, the text is
 * free. Pure, so every transition is tested (addressEntry.test.ts).
 *
 *  - Only a GPS fix, a tapped suggestion or a tapped map-search match sets the
 *    pin, and a new pin always replaces the old one.
 *  - Editing the text never clears or moves the pin.
 *  - Text the app filled in from a pin follows the next pin. Text the customer
 *    typed is kept (it is often directions the rider needs), and the screen
 *    shows the pinned place beside it so the two can never silently disagree.
 *
 * The old screen tracked "edited" in a ref that started true for every saved
 * address, so a GPS tap kept stale text over new coordinates. The origin of the
 * text is now saved with the address (`addressTextSource`) and restored here.
 */
import type { AddressRecord } from './entities.ts';
import { isUsableCoordinatePair } from '../../../../packages/domain/src/restaurantLocation.ts';
import { coordinatesLabel } from '../services/locationResolution.ts';
import { fallbackAddressFromCoords } from '../utils/deliveryLocation.ts';
import { getUsableAddressPoint } from '../utils/savedAddress.ts';

export type PinSource = 'gps' | 'suggestion' | 'map-search' | 'saved';

export type AddressPin = {
  latitude: number;
  longitude: number;
  /** The place name the pin came with, when it had one. */
  label: string | null;
  /** A shorter name for headings ("Ring Road, Ibadan"), when the source gave one. */
  shortLabel?: string | null;
  source: PinSource;
};

/** `pin`: filled in by the app (or empty), so it follows the pin. `typed`: the customer's words, kept. */
export type AddressTextOrigin = 'pin' | 'typed';

export type AddressEntryState = {
  text: string;
  textOrigin: AddressTextOrigin;
  pin: AddressPin | null;
};

export type AddressEntryAction =
  | { type: 'typed'; text: string }
  | { type: 'pinned'; pin: AddressPin }
  | { type: 'use-pin-text' };

/** How the saved record names where its coordinates came from (shown on the screen). */
export const PIN_SOURCE_LABEL: Record<PinSource, string> = {
  gps: 'Current location',
  suggestion: 'Search result',
  'map-search': 'Map search',
  saved: 'Saved pin',
};

const cleanLabel = (label: unknown): string | null =>
  typeof label === 'string' && label.trim() ? label.trim() : null;

/** What the address text becomes when it follows this pin. */
export const pinText = (pin: AddressPin): string =>
  pin.label ?? fallbackAddressFromCoords(pin.latitude, pin.longitude);

export const initAddressEntry = (saved: AddressRecord | null | undefined): AddressEntryState => {
  const point = getUsableAddressPoint(saved);
  const text = typeof saved?.address === 'string' ? saved.address : '';
  const pin: AddressPin | null = point
    ? {
        ...point,
        label: cleanLabel(saved?.pinLabel),
        // shortAddress holds the nickname when there was one, so it is only
        // the place's short name when no nickname was saved.
        shortLabel: cleanLabel(saved?.label) ? null : cleanLabel(saved?.shortAddress),
        source: 'saved',
      }
    : null;

  // An address saved before the origin was recorded is treated as typed: it
  // may be the customer's own words, and keeping it (with the pin shown beside
  // it) is recoverable where overwriting it is not.
  const textOrigin: AddressTextOrigin = !text.trim() || saved?.addressTextSource === 'pin' ? 'pin' : 'typed';

  return { text, textOrigin, pin };
};

export const addressEntryReducer = (state: AddressEntryState, action: AddressEntryAction): AddressEntryState => {
  switch (action.type) {
    case 'typed':
      // Clearing the field hands it back to the pin, so the next pin fills it.
      return { ...state, text: action.text, textOrigin: action.text.trim() ? 'typed' : 'pin' };

    case 'pinned': {
      const { latitude, longitude } = action.pin;
      if (!isUsableCoordinatePair(latitude, longitude)) {
        return state;
      }
      const pin: AddressPin = {
        ...action.pin,
        label: cleanLabel(action.pin.label),
        shortLabel: cleanLabel(action.pin.shortLabel),
      };
      return state.textOrigin === 'pin' ? { text: pinText(pin), textOrigin: 'pin', pin } : { ...state, pin };
    }

    case 'use-pin-text':
      return state.pin ? { ...state, text: pinText(state.pin), textOrigin: 'pin' } : state;

    default:
      return state;
  }
};

/**
 * "Pin: Bodija Market, Ibadan" beside text the customer typed, or null when
 * there is nothing to show (no pin, or the text already follows the pin).
 */
export const pinBesideText = (state: AddressEntryState): string | null => {
  if (!state.pin || state.textOrigin !== 'typed') {
    return null;
  }
  return `Pin: ${state.pin.label ?? coordinatesLabel(state.pin.latitude, state.pin.longitude)}`;
};

export type SavedAddressExtras = {
  label?: string | null;
  note?: string | null;
};

/**
 * The record to save, or null when there is no usable pin: text alone is not an
 * address. A blank text field saves the pin's own name, so the rider always has
 * words to read.
 */
export const toSavedAddress = (state: AddressEntryState, extras: SavedAddressExtras = {}): AddressRecord | null => {
  if (!state.pin || !isUsableCoordinatePair(state.pin.latitude, state.pin.longitude)) {
    return null;
  }

  const typed = state.text.trim();
  const address = typed || pinText(state.pin);
  const label = cleanLabel(extras.label);

  return {
    address,
    label,
    latitude: state.pin.latitude,
    longitude: state.pin.longitude,
    note: cleanLabel(extras.note),
    shortAddress: label ?? state.pin.shortLabel ?? state.pin.label ?? address,
    coordinateSource: PIN_SOURCE_LABEL[state.pin.source],
    pinLabel: state.pin.label,
    addressTextSource: typed ? state.textOrigin : 'pin',
  };
};
