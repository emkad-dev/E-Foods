import { useFonts } from 'expo-font';

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
 * A font failure must never brick the app, so a load error resolves as "ready" and the
 * type scale falls back to the platform sans-serif. Callers gate their splash-screen
 * hold on `fontsReady` to avoid a flash of unstyled text.
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

  return { fontsReady: loaded || Boolean(error), fontsError: error ?? null };
}
