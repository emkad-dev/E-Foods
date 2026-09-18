import { FontAwesome } from '@expo/vector-icons';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { customerTheme } from '../theme/palette';

type ImagePlaceholderProps = {
  /** The same style the image it stands in for is given, so the box matches. */
  style?: StyleProp<ViewStyle>;
  /** Glyph size. 20 suits a ~64pt row thumbnail; the default suits a 112pt one. */
  size?: number;
};

/**
 * What a FOOD photo's slot shows when there is no photo.
 *
 * WHY: `RemoteImage` falls back to an empty `<Image>` unless a caller hands it
 * something, and `RestaurantDiscoveryRow` -- which draws both home shelves, the
 * first thing anyone sees -- handed it nothing. A kitchen with no image, or an
 * image that fails to load, punched a blank hole the exact size of the photo
 * into the card. The card kept its border and its 132pt minimum, so it read as
 * broken rather than as "no picture yet".
 *
 * That is not hypothetical: every uploaded image is currently 403ing at the
 * CDN, so on the live feed today the hole is what a customer sees on every card
 * at once.
 *
 * WHY SHARED: search results and menu rows had already grown this same tile
 * inline, at two different glyph sizes. A third hand-rolled copy is how the two
 * home shelves drifted apart in the first place.
 *
 * WHY THE INITIAL-LETTER FALLBACKS ARE LEFT ALONE: the favorites card and the
 * restaurant header show the kitchen's first letter, which stands in for a
 * BRAND, not for a plate of food. Different question, different answer.
 *
 * Deliberately quiet -- a muted tile and one glyph at low emphasis. A
 * placeholder that competes with the real photos beside it is worse than the
 * hole it replaces.
 */
export default function ImagePlaceholder({ style, size = 26 }: ImagePlaceholderProps) {
  return (
    <View style={[styles.box, style]}>
      <FontAwesome name="cutlery" size={size} color={customerTheme.textSoft} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    backgroundColor: customerTheme.surfaceMuted,
    justifyContent: 'center',
  },
});
