export interface GatewayAuthEnv {
  gatewayUrl: string; // e.g. https://<project>.functions.supabase.co/auth-gateway
  anonKey: string;
}

const GENERIC = 'Something went wrong. Please try again.';

const extractMessage = (json: unknown): string | null => {
  if (json && typeof json === 'object') {
    const error = (json as { error?: unknown }).error;
    if (error && typeof error === 'object') {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) {
        return message.trim();
      }
    }
  }
  return null;
};

const post = async (env: GatewayAuthEnv, route: string, body: unknown, bearer?: string) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: env.anonKey };
  if (bearer) {
    headers.Authorization = `Bearer ${bearer}`;
  }
  const res = await fetch(`${env.gatewayUrl.replace(/\/$/, '')}/${route}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(extractMessage(json) ?? GENERIC);
  }
  return json;
};

export const createGatewayAuth = (env: GatewayAuthEnv) => ({
  signUp: (email: string, password: string) => post(env, 'signup', { email, password }),
  signIn: (email: string, password: string) => post(env, 'login', { email, password }),
  refresh: (refreshToken: string) => post(env, 'refresh', { refresh_token: refreshToken }),
  signOut: async (accessToken: string) => {
    await post(env, 'logout', {}, accessToken);
  },
});
