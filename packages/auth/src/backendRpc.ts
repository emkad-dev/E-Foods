import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { clearSupabaseSession, isStaleSupabaseSessionError, SESSION_EXPIRED_ERROR_MESSAGE } from './session';

export interface BackendRpcEnv {
  anonKey?: string;
  backendRpcUrl?: string;
  projectId?: string;
  region?: string;
  supabaseUrl?: string;
}

export const callBackendRpc = async <T>(
  supabase: SupabaseClient,
  env: BackendRpcEnv,
  action: string,
  data?: Record<string, unknown>
): Promise<T> => {
  const resolveSession = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session?.access_token) {
      return session;
    }

    const refreshResult = await supabase.auth.refreshSession().catch((error) => ({ error, data: null }));
    const refreshedSession = refreshResult?.data?.session ?? null;

    if (refreshedSession?.access_token) {
      return refreshedSession;
    }

    if (isStaleSupabaseSessionError(refreshResult?.error)) {
      await clearSupabaseSession(supabase);
      throw new Error(SESSION_EXPIRED_ERROR_MESSAGE);
    }

    return session;
  };

  const session = await resolveSession();

  if (!session?.access_token) {
    throw new Error(SESSION_EXPIRED_ERROR_MESSAGE);
  }

  const payload = {
    action,
    data: data ?? {},
  };

  const parseResponseError = async (response: Response) => {
    const responseForJson = response.clone();
    let parsedMessage: string | null = null;

    try {
      const body = await responseForJson.json();
      const message =
        typeof body === 'object' && body !== null
          ? (body as { message?: unknown }).message ??
            (body as { error?: unknown }).error ??
            (body as { msg?: unknown }).msg
          : null;

      if (typeof message === 'string' && message.trim()) {
        parsedMessage = message.trim();
      }
    } catch {
      // Ignore JSON parse errors and fall back to text below.
    }

    if (parsedMessage) {
      return parsedMessage;
    }

    const text = await response.text().catch(() => '');

    if (text.trim()) {
      return text.trim();
    }

    return `Backend RPC ${action} failed with HTTP ${response.status}.`;
  };

  const callViaDirectUrl = async () => {
    if (!env.backendRpcUrl?.trim()) {
      return null;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    };

    if (env.anonKey?.trim()) {
      headers.apikey = env.anonKey.trim();
    }

    const response = await fetch(env.backendRpcUrl.trim(), {
      body: JSON.stringify(payload),
      headers,
      method: 'POST',
    }).catch((error) => {
      throw new Error(error instanceof Error ? error.message : `Backend RPC ${action} failed to send request.`);
    });

    if (!response.ok) {
      throw new Error(await parseResponseError(response));
    }

    const responseData = (await response.json().catch(() => null)) as { data?: T } | T | null;
    if (responseData && typeof responseData === 'object' && 'data' in responseData) {
      return (responseData as { data: T }).data;
    }

    return responseData as T;
  };

  try {
    const directResponse = await callViaDirectUrl();
    if (directResponse !== null) {
      return directResponse;
    }
  } catch (error) {
    // Fall back to the Supabase function relay if the direct URL path fails.
    console.warn(`Backend RPC ${action} direct URL fallback failed:`, error);
  }

  const { data: responseData, error } = await supabase.functions.invoke<T>('app-rpc', {
    body: payload,
  });

  if (error) {
    if (error instanceof FunctionsHttpError) {
      const response = error.context as Response | undefined;

      if (response) {
        const responseForJson = response.clone();
        let parsedMessage: string | null = null;

        try {
          const body = await responseForJson.json();
          const message =
            typeof body === 'object' && body !== null
              ? (body as { message?: unknown }).message ??
                (body as { error?: unknown }).error ??
                (body as { msg?: unknown }).msg
              : null;

          if (typeof message === 'string' && message.trim()) {
            parsedMessage = message.trim();
          }
        } catch {
          // Ignore JSON parse errors and fall back to text below.
        }

        if (parsedMessage) {
          throw new Error(parsedMessage);
        }

        const text = await response.text().catch(() => '');

        if (text.trim()) {
          throw new Error(text.trim());
        }

        throw new Error(`Backend RPC ${action} failed with HTTP ${response.status}.`);
      }
    }

    if (error instanceof FunctionsRelayError || error instanceof FunctionsFetchError) {
      throw new Error(`Backend RPC ${action} failed: ${error.message}`);
    }

    throw new Error(
      error instanceof Error ? error.message : 'Backend RPC request failed. Check Supabase function availability.'
    );
  }

  if (responseData && typeof responseData === 'object' && 'data' in responseData) {
    return (responseData as { data: T }).data;
  }

  return responseData as T;
};
