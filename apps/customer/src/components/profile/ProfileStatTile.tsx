import { StyleSheet } from 'react-native';
import { Card, Text, space } from '@feasty/design-system';

type ProfileStatTileProps = {
  label: string;
  /**
   * `null` means the count has not resolved, or its fetch failed. The tile
   * still navigates, which is the part that must never depend on a network
   * call.
   */
  value: string | null;
  onPress: () => void;
};

/**
 * One of the two side-by-side tiles under the delivery card.
 *
 * No `accessibilityLabel` anywhere: `Card`'s Pressable already announces its
 * children, so the tile reads as "Orders, 3 in progress, button" on its own. An
 * earlier draft put a label on the inner `Text` — which `Card` does not forward
 * to the pressable anyway — and that only replaced the label text while hiding
 * the figure, which is the half worth hearing.
 */
export default function ProfileStatTile({ label, value, onPress }: ProfileStatTileProps) {
  return (
    // The tiles sit in a `flexDirection: 'row'` whose default `alignItems:
    // 'stretch'` keeps them the same height, and both now always render a
    // figure line, so neither can shrink or sit shorter than the other.
    <Card onPress={onPress} padding="md" style={styles.tile}>
      <Text variant="callout" tone="secondary" numberOfLines={1}>
        {label}
      </Text>
      {/* A dash, NOT nothing. Rendering null here was my own choice and seeing
          it beside Saved's "0" is what showed it up: two tiles of identical
          size, one carrying a figure and one carrying a void, does not read as
          "we do not know yet" -- it reads as a tile that failed to draw. The
          dash holds the slot and says the figure is absent, at secondary tone
          so it cannot be mistaken for a count of its own. Nothing about this
          was measurable; it only appears when you look at the screen. */}
      <Text
        variant="title3"
        tone={value ? undefined : 'secondary'}
        numberOfLines={1}
        style={styles.value}
      >
        {value ?? '—'}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    // Two tiles plus a gap must fit a 375pt screen inside a 14pt gutter; without
    // this a long value ("3 in progress") would widen its tile past its share.
    minWidth: 0,
  },
  value: {
    marginTop: space.xs,
  },
});
