export type AuthRoute = 'signup' | 'login' | 'logout' | 'refresh' | 'otp-request' | 'otp-verify';

const ROUTES: ReadonlySet<string> = new Set([
  'signup', 'login', 'logout', 'refresh', 'otp-request', 'otp-verify',
]);

export const parseRoute = (url: string): AuthRoute | null => {
  const seg = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
  return ROUTES.has(seg) ? (seg as AuthRoute) : null;
};

export const clientIp = (request: Request): string => {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) {
    // Trust ONLY the rightmost entry — appended by the platform proxy. The
    // leftmost value is caller-supplied and spoofable (rotating it would mint a
    // fresh rate-limit bucket per request), so it must never be used as the key.
    const parts = fwd.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
};
