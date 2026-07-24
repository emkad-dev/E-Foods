type BuildPartnerAuthActionUrlOptions = {
  appScheme?: string;
  isWeb?: boolean;
  webOrigin?: string;
};

const normalizeActionPath = (path: string) => path.trim().replace(/^\/+/, '');

export const buildPartnerAuthActionUrl = (path: string, options: BuildPartnerAuthActionUrlOptions = {}) => {
  const normalizedPath = normalizeActionPath(path);

  if (!normalizedPath) {
    throw new Error('An auth action path is required.');
  }

  const isWeb = options.isWeb ?? (typeof window !== 'undefined' && typeof window.location?.origin === 'string');

  if (isWeb) {
    const origin = options.webOrigin ?? window.location.origin;

    if (origin) {
      return new URL(`/${normalizedPath}`, origin).toString();
    }
  }

  const appScheme = (options.appScheme ?? 'feasty-partner').trim() || 'feasty-partner';
  return `${appScheme}://${normalizedPath}`;
};
