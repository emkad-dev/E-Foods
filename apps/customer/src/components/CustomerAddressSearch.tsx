import { AddressSearchField, type AddressPickOrigin, type AddressSuggestion } from '@feasty/design-system';
import { searchAddresses, searchTheMap } from '../services/addressSearch';

type Props = {
  onSelect: (suggestion: AddressSuggestion, origin: AddressPickOrigin) => void;
  label?: string;
};

/**
 * The shared search field bound to the customer app's Worker URL and its
 * "Search the map" fallback. Used by the launch prompt and the delivery-address
 * screen so both behave the same.
 */
export default function CustomerAddressSearch({ onSelect, label }: Props) {
  return (
    <AddressSearchField
      label={label}
      onSelect={onSelect}
      search={searchAddresses}
      searchMap={searchTheMap}
    />
  );
}
