import type { TextStyle } from 'react-native';
import { customerTheme } from './palette';

/**
 * One definition of a screen title, for both ways this app draws one.
 *
 * The `headerTitleStyle` below had been copy-pasted verbatim into six navigator
 * entries (favorites, cart, orders/index, orders/[id], profile/index,
 * profile/edit) while nine other screens that also show a native header never
 * got the copy -- so they rendered React Navigation's platform default instead.
 * A user walking Cart -> Deals -> Help & Support watched the title change size,
 * weight and colour on every step. Six copies and nine omissions are the same
 * defect: the style had no single home.
 */

type TitleTextStyle = {
  color: string;
  fontSize: number;
  fontWeight: TextStyle['fontWeight'];
};

/**
 * Title-bar scale. The native header title, and any hand-rolled header row
 * standing in for one -- a back button and a title side by side, on a screen
 * that cannot use the native header (delivery-location, payment/index).
 *
 * Those two drew their own bar at 22/900 and 20/900, so the same structural
 * element rendered at three different sizes depending on who built it. Pinning
 * them here means a hand-rolled bar reads exactly like the real one, and a
 * later conversion to a native header is a no-op typographically.
 */
export const screenTitleTextStyle: TitleTextStyle = {
  color: customerTheme.text,
  fontSize: 18,
  fontWeight: '800',
};

/**
 * Page scale. A title that leads the page's own content on a screen with no
 * title bar at all: onboarding, the payment result, search, the auth card.
 *
 * 24 is the size `search` already used; it is one clear step above the title
 * bar without becoming a separate typographic universe. The 22/28/30 it
 * replaces were drift rather than intent -- no screen chose to be bigger than
 * its neighbour, they were simply written at different times.
 */
export const pageTitleTextStyle: TitleTextStyle = {
  color: customerTheme.text,
  fontSize: 24,
  fontWeight: '800',
};

/**
 * Spread into the `screenOptions` of every customer navigator that shows a
 * native header, so the title style is applied once per navigator instead of
 * being remembered per screen -- which is how the nine unstyled screens came
 * to be unstyled in the first place.
 */
export const customerScreenOptions = {
  headerTitleStyle: screenTitleTextStyle,
};
