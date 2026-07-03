/// <reference path="./edge-runtime.d.ts" />

import { serviceClient } from './client.ts';

export const getBearerToken = (request: Request) => {
  const authHeader = request.headers.get('authorization');

  if (!authHeader) {
    throw new Error('Missing authorization header');
  }

  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new Error("Authorization header must be 'Bearer <token>'");
  }

  return token;
};

export const verifySupabaseJwt = async (request: Request) => {
  const token = getBearerToken(request);
  const { data, error } = await serviceClient.auth.getUser(token);

  if (error || !data?.user?.id) {
    throw new Error(error?.message ?? 'Invalid JWT');
  }

  const user = data.user;
  return {
    claims: {
      sub: user.id,
      email: user.email ?? undefined,
      ...user.app_metadata,
    } as Record<string, unknown>,
    token,
  };
};
