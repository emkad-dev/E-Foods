/**
 * What to tell an admin when a write fails, and whether the page must reload.
 *
 * Writes are never re-sent automatically (backendRpc's `write: true`), so when
 * the reply is lost in transport the write may well have landed. The raw
 * "Failed to fetch" said nothing useful, and nothing reloaded, so a page with
 * no poll kept showing the row as it was before a change that had in fact
 * gone through. A refusal the server actually sent (any 4xx) is different:
 * the server said no, nothing changed, and its own message is the answer.
 *
 * Duck-typed rather than importing BackendRpcError so it runs under Node's
 * test runner without pulling in the Supabase client.
 */
export const UNCONFIRMED_WRITE_MESSAGE =
  'We could not confirm this saved. The page has been reloaded, so check the row.';

export const SESSION_EXPIRED_WRITE_MESSAGE = 'Your session expired. Sign in again.';

// backendRpc could not refresh the session, so nothing was sent: the write
// definitely did not land, and "could not confirm" would be wrong.
const SESSION_REFRESH_ERROR_NAME = 'SessionRefreshError';

const TRANSPORT_ERROR_NAMES = new Set(['NetworkError', 'TimeoutError', 'AbortError']);

// The browsers' own words for a fetch that never got an answer, for anything
// that reaches here without backendRpc's NetworkError tag.
const TRANSPORT_MESSAGE = /failed to fetch|networkerror when attempting|load failed|network request failed/i;

/**
 * True when the write's outcome is unknown: the request may have reached the
 * server but no usable answer came back. That is a transport failure, a
 * timeout, or a 5xx (the server or a gateway broke partway, possibly after
 * writing). False for a 4xx, which is a definite refusal.
 */
export const isUnconfirmedWrite = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  if ((error as { name?: unknown }).name === SESSION_REFRESH_ERROR_NAME) {
    return false;
  }

  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number') {
    return status >= 500;
  }

  const name = (error as { name?: unknown }).name;
  if (typeof name === 'string' && TRANSPORT_ERROR_NAMES.has(name)) {
    return true;
  }

  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && TRANSPORT_MESSAGE.test(message);
};

/**
 * The message to show for a failed write. When the outcome is unknown it
 * reloads first (a failed reload is ignored: the message already tells the
 * admin to check), so the sentence "the page has been reloaded" is true by the
 * time it renders.
 */
export const describeWriteFailure = async (
  error: unknown,
  options: { fallback: string; reload: () => Promise<unknown> | unknown }
): Promise<string> => {
  if (error instanceof Error && error.name === SESSION_REFRESH_ERROR_NAME) {
    return SESSION_EXPIRED_WRITE_MESSAGE;
  }

  if (isUnconfirmedWrite(error)) {
    try {
      await options.reload();
    } catch {
      // The banner already says to check the row.
    }
    return UNCONFIRMED_WRITE_MESSAGE;
  }

  return error instanceof Error && error.message ? error.message : options.fallback;
};
