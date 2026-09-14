import { StyleSheet } from 'react-native';
import { Card, Text, space } from '@feasty/design-system';

type ProfileStatTileProps = {
  label: string;
  /**
   * `null` renders the tile with no figure at all — the honest state when the
   * count has not resolved or the fetch failed. The tile still navigates, which
   * is the part that must never depend on a network call.
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
    // 'stretch'` keeps them the same height even when only one has a figure, so
    // no minHeight is needed to stop a missing count shrinking its tile.
    <Card onPress={onPress} padding="md" style={styles.tile}>
      <Text variant="callout" tone="secondary" numberOfLines={1}>
        {label}
      </Text>
      {value ? (
        <Text variant="title3" numberOfLines={1} style={styles.value}>
          {value}
        </Text>
      ) : null}
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
