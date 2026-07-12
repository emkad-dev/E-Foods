export type AuthRoute = 'signup' | 'login' | 'logout' | 'refresh';

export const parseRoute = (url: string): AuthRoute | null => {
  const seg = new URL(url).pathname.split('/').filter(Boolean).pop();
  return seg === 'signup' || seg === 'login' || seg === 'logout' || seg === 'refresh' ? seg : null;
};

export const clientIp = (request: Request): string => {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
};
