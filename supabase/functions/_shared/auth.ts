/// <reference path="./edge-runtime.d.ts" />

import { serviceClient } from './client.ts';
import { ClientSafeError, logEdgeEvent } from './observability.ts';

const AUTH_REQUIRED_MESSAGE = 'Authentication required. Please sign in and try again.';

export const getBearerToken = (request: Request) => {
  const authHeader = request.headers.get('authorization');

  if (!authHeader) {
    throw new ClientSafeError(401, AUTH_REQUIRED_MESSAGE);
  }

  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new ClientSafeError(401, AUTH_REQUIRED_MESSAGE);
  }

  return token;
};

export const verifySupabaseJwt = async (request: Request) => {
  const token = getBearerToken(request);
  const { data, error } = await serviceClient.auth.getUser(token);

  if (error || !data?.user?.id) {
    // Log the underlying reason server-side; return a generic auth message.
    logEdgeEvent('warn', 'JWT verification failed', { reason: error?.message ?? 'missing user id' });
    throw new ClientSafeError(401, 'Your session has expired. Please sign in again.');
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
