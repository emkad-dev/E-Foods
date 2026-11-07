/**
 * Address search with suggestions, shared by the customer and partner apps.
 *
 * The field only FINDS a place; it never decides what happens with it. A pick
 * (a suggestion, or a match from the one-shot map search) goes to `onSelect`
 * and the screen sets its pin from it, so the partner can put its own confirm
 * step in front while the customer's tap is the confirmation.
 *
 * The data comes in as props (`search`, `searchMap`) rather than being fetched
 * here, which keeps this package free of app config and lets each app bind its
 * own Worker URL, User-Agent and native geocoder. The timing and staleness
 * rules live in `suggestionController.ts`, where they are tested.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';

import { OSM_CONTRIBUTORS_ATTRIBUTION } from '../../../runtime/src/addressSearch.ts';
import { border, brand, surface, text as textColor } from '../tokens/color';
import { radius } from '../tokens/radius';
import { MIN_TAP_TARGET, space } from '../tokens/space';
import { typeScale } from '../tokens/type';
import { Text } from '../primitives/Text';
import {
  createSuggestionController,
  moveHighlight,
  selectableResults,
  type AddressSuggestion,
  type MapSearch,
  type SuggestionController,
  type SuggestionSearch,
  type SuggestionView,
} from './suggestionController';

export type AddressPickOrigin = 'suggestion' | 'map-search';

export type AddressSearchFieldProps = {
  search: SuggestionSearch;
  /** The one-shot fallback behind "Search the map". Without it the button is not offered. */
  searchMap?: MapSearch;
  onSelect: (suggestion: AddressSuggestion, origin: AddressPickOrigin) => void;
  label?: string;
  placeholder?: string;
  /** Shown when every service behind "Search the map" failed. */
  mapFailedMessage?: string;
  testID?: string;
};

export const ADDRESS_SEARCH_COPY = {
  label: 'Search for your address',
  placeholder: 'Street, area or landmark',
  loading: 'Looking for matches…',
  mapLoading: 'Searching the map…',
  empty: 'No matches yet. Add the area or city, or search the map.',
  emptyNoFallback: 'No matches yet. Add the area or city.',
  unavailable: 'Suggestions are not available right now.',
  unavailableNoFallback: 'Suggestions are not available right now. Try again in a moment.',
  mapResultsHeading: 'Matches from the map. Tap the right one.',
  mapEmpty: 'The map found nothing for that. Check the spelling, add the area or city, or use your current location.',
  mapFailed: 'We could not search the map right now. Try again, or allow location access and use your current location.',
  searchMapButton: 'Search the map',
} as const;

export function AddressSearchField({
  search,
  searchMap,
  onSelect,
  label = ADDRESS_SEARCH_COPY.label,
  placeholder = ADDRESS_SEARCH_COPY.placeholder,
  mapFailedMessage = ADDRESS_SEARCH_COPY.mapFailed,
  testID,
}: AddressSearchFieldProps) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<SuggestionView>({ kind: 'idle' });
  const [highlight, setHighlight] = useState(-1);
  const controllerRef = useRef<SuggestionController | null>(null);
  // The props can change identity every render; the controller is built once,
  // so it reads the latest ones through refs.
  const searchRef = useRef(search);
  const searchMapRef = useRef(searchMap);
  searchRef.current = search;
  searchMapRef.current = searchMap;

  useEffect(() => {
    const controller = createSuggestionController({
      search: (q, options) => searchRef.current(q, options),
      searchMap: (q) =>
        searchMapRef.current ? searchMapRef.current(q) : Promise.resolve({ kind: 'failed' as const }),
      onChange: (next) => {
        setView(next);
        setHighlight(-1);
      },
    });
    controllerRef.current = controller;
    return () => controller.dispose();
  }, []);

  const rows = selectableResults(view);
  const canSearchMap = Boolean(searchMap);

  const handleChange = (value: string) => {
    setQuery(value);
    controllerRef.current?.update(value);
  };

  const pick = (suggestion: AddressSuggestion) => {
    const origin: AddressPickOrigin = view.kind === 'map-results' ? 'map-search' : 'suggestion';
    // The field shows what was picked; the list closes until the text changes.
    setQuery(suggestion.label);
    controllerRef.current?.reset();
    onSelect(suggestion, origin);
  };

  const handleKeyPress = (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    const key = event.nativeEvent.key;
    if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Escape') {
      return;
    }
    // Arrow keys would otherwise move the caret to the ends of the text.
    (event as unknown as { preventDefault?: () => void }).preventDefault?.();
    if (key === 'Escape') {
      controllerRef.current?.reset();
      return;
    }
    setHighlight((current) => moveHighlight(current, key === 'ArrowDown' ? 'down' : 'up', rows.length));
  };

  const handleSubmit = () => {
    const highlighted = rows[highlight];
    if (highlighted) {
      pick(highlighted);
      return;
    }
    if (view.kind === 'unavailable' && canSearchMap) {
      controllerRef.current?.searchMap();
    }
  };

  const searchMapButton = canSearchMap ? (
    <Pressable
      accessibilityRole="button"
      onPress={() => controllerRef.current?.searchMap()}
      style={({ pressed }) => [styles.mapButton, pressed ? styles.pressed : null]}
    >
      <Text variant="bodyStrong" style={styles.mapButtonText}>
        {ADDRESS_SEARCH_COPY.searchMapButton}
      </Text>
    </Pressable>
  ) : null;

  return (
    <View testID={testID}>
      <Text variant="callout" tone="secondary" style={styles.label}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        autoComplete="off"
        autoCorrect={false}
        blurOnSubmit={Platform.OS === 'web' ? false : undefined}
        onChangeText={handleChange}
        onKeyPress={handleKeyPress}
        onSubmitEditing={handleSubmit}
        placeholder={placeholder}
        placeholderTextColor={textColor.disabled}
        returnKeyType="search"
        style={styles.input}
        value={query}
      />

      {view.kind === 'loading' || view.kind === 'map-loading' ? (
        <View accessibilityLiveRegion="polite" style={styles.statusRow}>
          <ActivityIndicator color={brand.primary} size="small" />
          <Text variant="callout" tone="secondary" style={styles.statusText}>
            {view.kind === 'loading' ? ADDRESS_SEARCH_COPY.loading : ADDRESS_SEARCH_COPY.mapLoading}
          </Text>
        </View>
      ) : null}

      {rows.length > 0 ? (
        <View style={styles.results}>
          {view.kind === 'map-results' ? (
            <Text variant="callout" tone="secondary" style={styles.resultsHeading}>
              {ADDRESS_SEARCH_COPY.mapResultsHeading}
            </Text>
          ) : null}
          <View accessibilityRole="list">
            {rows.map((row, index) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: index === highlight }}
                key={`${row.label}-${row.latitude}-${row.longitude}`}
                onPress={() => pick(row)}
                style={({ pressed }) => [
                  styles.row,
                  index === highlight ? styles.rowHighlighted : null,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Text variant="body" numberOfLines={2}>
                  {row.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text variant="caption" tone="secondary" style={styles.attribution}>
            {OSM_CONTRIBUTORS_ATTRIBUTION}
          </Text>
        </View>
      ) : null}

      {view.kind === 'empty' || view.kind === 'unavailable' ? (
        <View accessibilityLiveRegion="polite" style={styles.notice}>
          <Text variant="callout" tone="secondary">
            {view.kind === 'empty'
              ? canSearchMap
                ? ADDRESS_SEARCH_COPY.empty
                : ADDRESS_SEARCH_COPY.emptyNoFallback
              : canSearchMap
                ? ADDRESS_SEARCH_COPY.unavailable
                : ADDRESS_SEARCH_COPY.unavailableNoFallback}
          </Text>
          {searchMapButton}
        </View>
      ) : null}

      {view.kind === 'map-empty' || view.kind === 'map-failed' ? (
        <View accessibilityLiveRegion="polite" style={styles.notice}>
          <Text variant="callout" tone={view.kind === 'map-failed' ? 'danger' : 'secondary'}>
            {view.kind === 'map-empty' ? ADDRESS_SEARCH_COPY.mapEmpty : mapFailedMessage}
          </Text>
          {view.kind === 'map-failed' ? searchMapButton : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    marginBottom: space.xs,
  },
  input: {
    ...typeScale.body,
    backgroundColor: surface.default,
    borderColor: border.default,
    borderRadius: radius.md,
    borderWidth: 1,
    color: textColor.primary,
    minHeight: MIN_TAP_TARGET + 4,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.sm,
  },
  statusText: {
    flex: 1,
  },
  results: {
    backgroundColor: surface.default,
    borderColor: border.subtle,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: space.sm,
    overflow: 'hidden',
  },
  resultsHeading: {
    paddingHorizontal: space.md,
    paddingTop: space.sm,
  },
  row: {
    borderBottomColor: border.subtle,
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  rowHighlighted: {
    backgroundColor: brand.primaryTint,
  },
  pressed: {
    opacity: 0.7,
  },
  attribution: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  notice: {
    gap: space.sm,
    marginTop: space.sm,
  },
  mapButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: brand.primaryTint,
    borderRadius: radius.md,
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: space.lg,
  },
  mapButtonText: {
    color: brand.primaryStrong,
  },
});
