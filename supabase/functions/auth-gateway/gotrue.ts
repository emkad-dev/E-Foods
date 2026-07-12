/// <reference path="../_shared/edge-runtime.d.ts" />

const base = () => `${Deno.env.get('SUPABASE_URL') ?? ''}/auth/v1`;
const anon = () => Deno.env.get('ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const call = async (path: string, init: RequestInit) => {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', apikey: anon(), ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
};

export const gotrue = {
  signUp: (email: string, password: string) =>
    call('/signup', { method: 'POST', body: JSON.stringify({ email, password }) }),
  passwordGrant: (email: string, password: string) =>
    call('/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) }),
  refresh: (refresh_token: string) =>
    call('/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token }) }),
  logout: (accessToken: string) =>
    call('/logout', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: '{}' }),
};
