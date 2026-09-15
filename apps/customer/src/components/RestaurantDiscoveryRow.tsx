import type { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { radius } from '@feasty/design-system';
import RemoteImage from './RemoteImage';
import { customerTheme } from '../theme/palette';

/**
 * How a discovery row is drawn.
 *
 * ONE named axis on purpose. Home's two shelves differ in background, border,
 * cuisine colour and meta typography, and every one of those differences is
 * downstream of a single question -- can the customer order from this kitchen
 * right now -- so that is the only thing a caller gets to vary. Handing the
 * caller `muted`/`compact`/`showHeart` booleans instead would let them assemble
 * combinations that are not a real state of this screen, and the defect that
 * follows is a card whose colour says "unavailable" while its copy says
 * otherwise.
 */
export type RestaurantDiscoveryRowTone = 'available' | 'outOfZone' | 'closed';

type RestaurantDiscoveryRowProps = {
  /** Already resolved by the caller -- see getRestaurantCuisineLabel. */
  cuisine: string;
  /** Optional extra line under the meta, e.g. the out-of-coverage tag. */
  footnote?: string | null;
  imageUri?: string | null;
  meta: string;
  name: string;
  onPress: () => void;
  tone: RestaurantDiscoveryRowTone;
  /**
   * The one control the row's header may carry on its trailing edge: a heart on
   * the orderable shelf, a status badge on the out-of-zone one. A slot rather
   * than a `showHeart` flag, because these are different KINDS of thing (a
   * button and a label) and a boolean cannot express that.
   */
  trailing?: ReactNode;
};

/**
 * The restaurant row both home shelves are built from.
 *
 * WHY IT EXISTS: the nearby shelf and the "outside your delivery zone" shelf
 * stated the same geometry twice -- 112x132 thumbnail, 132pt minimum row, 14pt
 * info padding, a flex-1 name against a trailing control -- and the two copies
 * had already drifted (the name's trailing gap was 8 on one and 10 on the
 * other, and only one of them dimmed on press). Stated once, they cannot drift
 * again.
 *
 * WHY FAVORITES AND SEARCH ARE NOT HERE: favorites is a full-bleed feed card
 * (image on top, logo badge straddling the seam, a rating row) -- a different
 * presentation of the same data, not a size of this one. Search shows a DISH,
 * with the restaurant demoted to a subtitle; it carries a price, a chevron and
 * no heart, because a meal cannot be favourited. Folding either in would buy
 * one component back and cost an `imageOnTop` boolean no caller could read.
 */
export default function RestaurantDiscoveryRow({
  cuisine,
  footnote,
  imageUri,
  meta,
  name,
  onPress,
  tone,
  trailing,
}: RestaurantDiscoveryRowProps) {
  // Both non-orderable tones share the muted treatment; only the card fill and
  // border tell them apart.
  const isMuted = tone !== 'available';
  const toneStyle =
    tone === 'closed' ? styles.cardClosed : tone === 'outOfZone' ? styles.cardOutOfZone : styles.cardAvailable;

  return (
    <TouchableOpacity
      style={[styles.card, toneStyle]}
      // 0.92 on both. The out-of-zone card used TouchableOpacity's default 0.2,
      // so the identical card dimmed to a fifth of itself on one shelf and
      // barely moved on the other.
      activeOpacity={0.92}
      onPress={onPress}
    >
      <RemoteImage uri={imageUri} style={styles.image} />
      <View style={styles.info}>
        <View style={styles.header}>
          {/* One line on both shelves. The out-of-zone copy let a long name wrap
              and push its own status badge around; a card header that changes
              height with the data is what the fixed 132pt thumbnail cannot
              follow. */}
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          {trailing}
        </View>
        <Text style={[styles.cuisine, isMuted ? styles.cuisineMuted : null]} numberOfLines={1}>
          {cuisine}
        </Text>
        <Text
          style={[styles.meta, isMuted ? styles.metaMuted : null]}
          // The orderable row's meta is a fixed-shape chip line (distance, ETA)
          // that must never grow the card. The muted rows' meta is a full
          // sentence explaining WHY the kitchen cannot serve this address, and
          // clamping that to one line would truncate away the only reason the
          // section exists -- so it wraps, a step smaller, to stay inside the
          // 132pt the thumbnail fixes.
          numberOfLines={isMuted ? undefined : 1}
        >
          {meta}
        </Text>
        {footnote ? <Text style={styles.footnote}>{footnote}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 12,
    minHeight: 132,
    overflow: 'hidden',
    width: '100%',
  },
  cardAvailable: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
  },
  cardClosed: {
    backgroundColor: '#fdecec',
    borderColor: '#ef4444',
  },
  cardOutOfZone: {
    backgroundColor: customerTheme.dangerSoft,
    borderColor: '#ebc0b7',
  },
  cuisine: {
    color: customerTheme.textMuted,
    fontSize: 12,
    marginTop: 6,
  },
  cuisineMuted: {
    color: customerTheme.textSoft,
  },
  footnote: {
    color: customerTheme.warningText,
    fontSize: 11,
    fontWeight: '800',
    marginTop: 2,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  image: {
    height: 132,
    width: 112,
  },
  info: {
    flex: 1,
    padding: 14,
  },
  meta: {
    color: customerTheme.textMuted,
    fontSize: 12,
    marginTop: 6,
  },
  metaMuted: {
    color: customerTheme.dangerText,
    fontSize: 11,
    lineHeight: 16,
  },
  name: {
    color: customerTheme.text,
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    marginRight: 10,
  },
});
