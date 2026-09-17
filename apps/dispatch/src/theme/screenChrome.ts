import type { TextStyle } from 'react-native';

import { dispatchTheme } from './palette';

/**
 * Dispatch sets `headerShown: false` on the whole group, so every screen draws
 * its own title — and each grew its own version. Page titles ran 28, 30 and
 * 31pt, and the safe-area offset was written four ways (+12, +16, +24, +28), so
 * a rider moving between screens saw the title change size and sit at a
 * different height.
 *
 * One definition each, both taken from what dispatch already used most: 28/800
 * for the title, and +12 for the offset on the five `(dispatch)` screens that
 * already agreed on it.
 */
export const SCREEN_TITLE_SIZE = 28;
export const SCREEN_TITLE_WEIGHT: TextStyle['fontWeight'] = '800';

/** A page title on the app background. */
export const screenTitleTextStyle: TextStyle = {
  color: dispatchTheme.text,
  fontSize: SCREEN_TITLE_SIZE,
  fontWeight: SCREEN_TITLE_WEIGHT,
};

/**
 * Space between the safe area and a screen's first content.
 *
 * The `(auth)` group keeps its larger offset: those screens centre a card
 * rather than stacking content under a title, and the extra room belongs to
 * that composition, not to this constant.
 */
export const SCREEN_TOP_INSET = 12;
