/**
 * How long to wait for the six brand faces before rendering without them.
 *
 * The same ballpark as a browser's own web-font timeout. Long enough that a
 * normal load never shows the fallback, short enough that a stalled one does
 * not read as a broken app.
 */
export const FONT_LOAD_TIMEOUT_MS = 3000;

type FontReadinessInput = {
  /** expo-font's `loaded`. */
  loaded: boolean;
  /** expo-font's error, if the load rejected. */
  error: Error | null | undefined;
  /** Whether FONT_LOAD_TIMEOUT_MS has elapsed since mount. */
  timedOut: boolean;
};

/**
 * Whether the app may render.
 *
 * WHY THIS IS NOT JUST `loaded || error`: that was the previous rule, under a
 * comment promising "a font failure must never brick the app". It covers a
 * load that REJECTS and not a load that HANGS -- and a request that stalls
 * without ever rejecting is the more likely of the two on a flaky mobile
 * connection, which is most of this product's audience.
 *
 * Observed, not theorised: customer's dev server sat with five of six faces
 * `unloaded`, no error raised, `fontsReady` false, and the root holding
 * LoadingSkeleton indefinitely. That is exactly the state the old comment
 * said could not happen.
 *
 * The timeout resolves to the same place the error path already did -- render
 * in the platform sans-serif. If the faces arrive later, `loaded` flips and
 * the type swaps in; a brief fallback is strictly better than a screen that
 * never appears.
 */
export function resolveFontsReady({ loaded, error, timedOut }: FontReadinessInput): boolean {
  return loaded || Boolean(error) || timedOut;
}
