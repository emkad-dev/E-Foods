import { Platform, type ViewStyle } from 'react-native';

import { elevationValues, type ElevationToken } from '../tokens/elevation';
import { overlay } from '../tokens/color';

/**
 * Ready-to-spread shadow styles, one per elevation token.
 *
 * RN shadows are platform-split three ways (iOS shadow* props, Android `elevation`,
 * web `boxShadow`). Screens previously hand-rolled these per file; this centralizes it
 * so a card looks the same on every platform.
 */
const build = (token: ElevationToken): ViewStyle => {
  const value = elevationValues[token];

  if (value.opacity === 0) {
    return Platform.OS === 'android' ? { elevation: 0 } : {};
  }

  return Platform.select<ViewStyle>({
    ios: {
      shadowColor: overlay.shadow,
      shadowOffset: { width: 0, height: value.offsetY },
      shadowOpacity: value.opacity,
      shadowRadius: value.blur / 2,
    },
    android: {
      elevation: value.android,
      shadowColor: overlay.shadow,
    },
    default: {
      // react-native-web maps boxShadow through to CSS.
      boxShadow: `0px ${value.offsetY}px ${value.blur}px rgba(13, 21, 34, ${value.opacity})`,
    } as ViewStyle,
  }) as ViewStyle;
};

export const elevation: Record<ElevationToken, ViewStyle> = {
  none: build('none'),
  sm: build('sm'),
  md: build('md'),
  lg: build('lg'),
};
