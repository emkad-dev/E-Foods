const ALLOWED_ORIGINS = new Set([
  'https://feasty.com.ng',
  'https://www.feasty.com.ng',
  'https://app.feasty.com.ng',
  'https://partner.feasty.com.ng',
  'https://admin.feasty.com.ng',
]);

const LOCALHOST = /^http:\/\/localhost(:\d{1,5})?$/;

export const isAllowedOrigin = (origin: string): boolean =>
  ALLOWED_ORIGINS.has(origin) || LOCALHOST.test(origin);

// Native apps send no Origin and need no CORS headers. A disallowed browser
// origin also gets none, so the browser itself refuses to expose the response.
// `vary` is always set because the answer depends on the Origin header.
export const corsHeaders = (origin: string | null): Record<string, string> => {
  const headers: Record<string, string> = { vary: 'Origin' };
  if (origin && isAllowedOrigin(origin)) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-methods'] = 'GET, OPTIONS';
    headers['access-control-allow-headers'] = 'content-type';
    headers['access-control-max-age'] = '86400';
  }
  return headers;
};
