type BuildDispatchAuthActionUrlOptions = {
  appScheme?: string;
  isWeb?: boolean;
  webOrigin?: string;
};

const normalizeActionPath = (path: string) => path.trim().replace(/^\/+/, '');

/**
 * Dispatch ships as a native app only - there is no rider web host - so auth action links
 * default to the app's own scheme. Pointing them at an https host the project does not serve
 * is what sent rider verification emails to a domain we do not own.
 */
export const buildDispatchAuthActionUrl = (path: string, options: BuildDispatchAuthActionUrlOptions = {}) => {
  const normalizedPath = normalizeActionPath(path);

  if (!normalizedPath) {
    throw new Error('An auth action path is required.');
  }

  const isWeb = options.isWeb ?? (typeof window !== 'undefined' && typeof window.location?.origin === 'string');

  if (isWeb) {
    const origin = options.webOrigin?.trim() || (typeof window !== 'undefined' ? window.location.origin : '');

    if (origin) {
      return new URL(`/${normalizedPath}`, origin).toString();
    }
  }

  const appScheme = (options.appScheme ?? 'feasty-dispatch').trim() || 'feasty-dispatch';
  return `${appScheme}://${normalizedPath}`;
};

export const buildDispatchActionCodeSettings = (
  path: string,
  options: BuildDispatchAuthActionUrlOptions = {}
) => ({
  url: buildDispatchAuthActionUrl(path, {
    appScheme: options.appScheme,
    isWeb: options.isWeb,
    webOrigin: options.webOrigin,
  }),
});
