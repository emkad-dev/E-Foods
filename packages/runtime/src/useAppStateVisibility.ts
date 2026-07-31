import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * True while the app is in the foreground.
 *
 * `AppState` is the right signal for all three React Native apps because
 * react-native-web maps it onto the Page Visibility API, so one adapter covers
 * native builds and the Expo web exports both.
 *
 * Only `active` counts as visible: on iOS `inactive` covers the app switcher and
 * incoming-call banners, where the user cannot see the screen either.
 *
 * Lives in `packages/runtime` rather than in each app because all three RN apps
 * need exactly this. admin-web has its own `document`-based adapter — it has no
 * react-native dependency and importing this would break its Vite build.
 */
export const useAppStateVisibility = () => {
  const [isVisible, setIsVisible] = useState(() => AppState.currentState === 'active');

  useEffect(() => {
    // Re-read on mount: state may have changed between the initial useState and
    // this effect running.
    setIsVisible(AppState.currentState === 'active');

    const subscription = AppState.addEventListener('change', (nextState) => {
      setIsVisible(nextState === 'active');
    });

    return () => {
      subscription.remove();
    };
  }, []);

  return isVisible;
};
