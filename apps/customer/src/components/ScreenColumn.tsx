import { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * The customer app ships a real web build (app.feasty.com.ng) from the same
 * screens as the phone app, and nothing there constrained a screen's width: on
 * a 1400pt monitor a settings row, a two-line sign-in card and a restaurant
 * feed each ran edge to edge, so a line of body copy could cross the whole
 * display and a 112pt thumbnail sat marooned beside it. These are the widths
 * every customer screen caps its CONTENT at — never its chrome, so a hero
 * image, a sticky bar or a screen background still spans the viewport.
 *
 * Two measures, because a settings list and a restaurant feed are not the same
 * kind of thing to read:
 *
 * - READING (560) is for text the eye tracks line by line and for forms and
 *   row lists: legal pages, the cart, an order, the support thread, the
 *   address form, sign-in forms. Past roughly this width a paragraph loses the
 *   reader on the return sweep, and a settings row becomes a label at one edge
 *   with its value at the other. It is the width the profile screen already
 *   shipped with (b52cc68), kept so the tabs agree with each other.
 *
 * - FEED (720) is for image-led browse surfaces: home, search results,
 *   favorites, deals, a restaurant menu. Those rows are a fixed-size thumbnail
 *   plus two or three short lines, so extra width goes to the gap between the
 *   picture and its text rather than to line length — 560 crops the scannable
 *   grid tighter than it needs, and much past 720 the thumbnail reads as a
 *   stamp stranded at the left edge.
 *
 * Every cap is `width: '100%'` + `maxWidth` + `alignSelf: 'center'` and nothing
 * else. That is deliberately a no-op below the cap: no margin, no extra
 * padding, no change to flex behaviour, so a 375pt phone — the primary surface
 * — renders byte-identically to before. Applying it to an existing style is
 * only safe when that style carries no horizontal MARGIN: in Yoga `width:
 * '100%'` excludes margins, so a node with `marginHorizontal` would start
 * overflowing its parent. Wrap such a node in <ScreenColumn> instead.
 */
export const READING_COLUMN_WIDTH = 560;

/** See READING_COLUMN_WIDTH — the image-led browse measure. */
export const FEED_COLUMN_WIDTH = 720;

/**
 * Apply directly to a screen's own container style, or to a ScrollView /
 * FlatList `contentContainerStyle`, so the existing padding and gap stay on the
 * node that already owns them.
 */
export const screenColumn = StyleSheet.create({
  reading: {
    alignSelf: 'center',
    maxWidth: READING_COLUMN_WIDTH,
    width: '100%',
  },
  feed: {
    alignSelf: 'center',
    maxWidth: FEED_COLUMN_WIDTH,
    width: '100%',
  },
});

type ScreenColumnProps = {
  children: ReactNode;
  /** Defaults to the reading measure; pass 'feed' for browse surfaces. */
  measure?: keyof typeof screenColumn;
  style?: StyleProp<ViewStyle>;
};

/**
 * The wrapper form, for when the content to cap cannot take the style itself —
 * it carries a horizontal margin, or the full-bleed chrome around it (a
 * background, a divider) has to keep spanning the viewport.
 */
export default function ScreenColumn({ children, measure = 'reading', style }: ScreenColumnProps) {
  return <View style={[screenColumn[measure], style]}>{children}</View>;
}
