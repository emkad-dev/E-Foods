import type { TextStyle } from 'react-native';

import { partnerTheme } from './palette';

/**
 * Partner sets `headerShown: false` on the whole group, so every screen draws
 * its own title. Four screens grew their own version of that: page titles ran
 * 28, 30 and 31pt at weights 700 and 800, and the top inset was written three
 * ways -- `insets.top + 16`, `+ 24` and `+ 28` -- so a partner moving between
 * tabs saw the title change size and sit at a different height.
 *
 * One definition each. 28/800 because that is what six of the nine screens
 * already used; the 30 and 31 were one-offs nobody chose deliberately.
 */
export const SCREEN_TITLE_SIZE = 28;
export const SCREEN_TITLE_WEIGHT: TextStyle['fontWeight'] = '800';

/** A page title on the app background. */
export const screenTitleTextStyle: TextStyle = {
  color: partnerTheme.text,
  fontSize: SCREEN_TITLE_SIZE,
  fontWeight: SCREEN_TITLE_WEIGHT,
};

/**
 * A page title inside one of the green hero panels. Same scale, inverted ink --
 * the panel is a surface treatment, not a different typographic universe.
 */
export const heroTitleTextStyle: TextStyle = {
  color: partnerTheme.textOnHero,
  fontSize: SCREEN_TITLE_SIZE,
  fontWeight: SCREEN_TITLE_WEIGHT,
};

/**
 * Space between the safe area and the first pixel of a screen's own content.
 *
 * The `(auth)` group is deliberately excluded: those screens centre a card on a
 * full-bleed hero rather than stacking content under a title, and their larger
 * inset is part of that composition. Forcing them here would change a layout
 * this constant does not describe.
 */
export const SCREEN_TOP_INSET = 16;
