import { useEffect, useState } from 'react';
import { useFonts } from 'expo-font';

import { FONT_LOAD_TIMEOUT_MS, resolveFontsReady } from './fontsReadiness';

// Per-weight subpath imports, NOT the package root. Importing
// '@expo-google-fonts/karla' would pull all 14 faces into the bundle; these six are
// exactly what the type scale references and what the landing page already loads.
import { BricolageGrotesque_500Medium } from '@expo-google-fonts/bricolage-grotesque/500Medium';
import { BricolageGrotesque_700Bold } from '@expo-google-fonts/bricolage-grotesque/700Bold';
import { BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque/800ExtraBold';
import { Karla_400Regular } from '@expo-google-fonts/karla/400Regular';
import { Karla_500Medium } from '@expo-google-fonts/karla/500Medium';
import { Karla_700Bold } from '@expo-google-fonts/karla/700Bold';

/**
 * Loads the six FEASTY font faces.
 *
 * A font failure must never brick the app, so the app renders in the platform
 * sans-serif rather than waiting forever. That promise used to be kept only for
 * a load that REJECTS: the rule was `loaded || Boolean(error)`, which never
 * resolves for a load that simply HANGS -- and a stalled request is the more
 * likely failure on a flaky mobile connection. Every app root here holds a
 * full-screen skeleton on `fontsReady`, so that state is a screen that never
 * appears; it was observed on the running customer build, five of six faces
 * `unloaded` with no error raised.
 *
 * See fontsReadiness.ts for the rule and its tests. Callers still gate their
 * splash hold on `fontsReady` to avoid a flash of unstyled text on a normal
 * load.
 */
export function useFeastyFonts(): { fontsReady: boolean; fontsError: Error | null } {
  const [loaded, error] = useFonts({
    BricolageGrotesque_500Medium,
    BricolageGrotesque_700Bold,
    BricolageGrotesque_800ExtraBold,
    Karla_400Regular,
    Karla_500Medium,
    Karla_700Bold,
  });

  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (loaded || error) {
      return;
    }

    const timer = setTimeout(() => setTimedOut(true), FONT_LOAD_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [loaded, error]);

  return { fontsReady: resolveFontsReady({ loaded, error, timedOut }), fontsError: error ?? null };
}
