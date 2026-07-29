/// <reference path="./edge-runtime.d.ts" />

type JsonObject = Record<string, unknown>;

export type EdgeRequestObservation = {
  action?: string;
  functionName: string;
  method: string;
  path: string;
  requestId: string;
  startedAt: number;
};

export type EdgeObservationResult = {
  error?: unknown;
  status: number;
};

export type BackpressureOptions = {
  maxConcurrent: number;
  retryAfterSeconds?: number;
};

type BackpressureSlot = {
  release: () => void;
};

class EdgeBackpressureError extends Error {
  readonly retryAfterSeconds: number;
  readonly status = 429;
  // `expose` marks an error whose message is safe to return to the client.
  readonly expose = true;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = 'EdgeBackpressureError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Generic, user-facing message returned to clients whenever an error is not
 * explicitly marked as safe to expose. The real error is always logged
 * server-side (see `finishEdgeObservation`) — never surfaced to the caller.
 */
export const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';

/**
 * Resolve an HTTP status from an error. Errors that carry an explicit `status`
 * (RpcError, NotificationError, ClientSafeError, backpressure) keep it; anything
 * else is treated as an unexpected server fault (500).
 */
export const getErrorStatus = (error: unknown): number => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status <= 599 ? status : 500;
};

/**
 * An error is safe to surface to the client only when it opts in via `expose`
 * AND represents a client-side condition (4xx). Server faults (5xx) are never
 * exposed even when flagged, so a mislabeled internal message can't leak.
 */
export const isClientSafeError = (value: unknown): boolean =>
  value instanceof Error &&
  (value as { expose?: unknown }).expose === true &&
  getErrorStatus(value) < 500;

/**
 * The message to return to the client: the error's own message when it is
 * client-safe, otherwise a generic fallback. Actual details are logged, not
 * returned.
 */
export const clientErrorMessage = (
  error: unknown,
  fallback: string = GENERIC_ERROR_MESSAGE
): string => (isClientSafeError(error) ? (error as Error).message : fallback);

/**
 * Base class for deliberately user-facing errors raised in shared helpers.
 * Its message is crafted for end users and is safe to return in a response.
 */
export class ClientSafeError extends Error {
  readonly status: number;
  readonly expose = true;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ClientSafeError';
    this.status = status;
  }
}

const inflightByKey = new Map<string, number>();

const getRequestId = (request: Request) =>
  request.headers.get('x-request-id')?.trim() || crypto.randomUUID();

export const createEdgeObservation = (
  request: Request,
  functionName: string,
  action?: string
): EdgeRequestObservation => ({
  action,
  functionName,
  method: request.method,
  path: new URL(request.url).pathname,
  requestId: getRequestId(request),
  startedAt: performance.now(),
});

export const logEdgeEvent = (
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  fields: JsonObject = {}
) => {
  const payload = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...fields,
  };

  if (level === 'error') {
    console.error(JSON.stringify(payload));
    return;
  }

  if (level === 'warn') {
    console.warn(JSON.stringify(payload));
    return;
  }

  console.log(JSON.stringify(payload));
};

export const finishEdgeObservation = (
  observation: EdgeRequestObservation,
  result: EdgeObservationResult
) => {
  const durationMs = Math.max(0, Math.round(performance.now() - observation.startedAt));
  const payload: JsonObject = {
    action: observation.action ?? null,
    durationMs,
    functionName: observation.functionName,
    method: observation.method,
    path: observation.path,
    requestId: observation.requestId,
    status: result.status,
  };

  if (result.error) {
    payload.error =
      result.error instanceof Error
        ? {
            message: result.error.message,
            name: result.error.name,
            stack: result.error.stack ?? null,
          }
        : {
            message: String(result.error),
          };
  }

  const level = result.status >= 500 ? 'error' : result.status >= 400 ? 'warn' : 'info';
  logEdgeEvent(level, `${observation.functionName} request complete`, payload);
};

export const jsonResponse = (
  status: number,
  body: unknown,
  headers: HeadersInit = {}
) =>
  new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    status,
  });

export const acquireBackpressureSlot = (
  key: string,
  options: BackpressureOptions
): BackpressureSlot | null => {
  const current = inflightByKey.get(key) ?? 0;
  if (current >= options.maxConcurrent) {
    return null;
  }

  inflightByKey.set(key, current + 1);

  let released = false;
  return {
    release: () => {
      if (released) {
        return;
      }

      released = true;
      const nextCount = (inflightByKey.get(key) ?? 1) - 1;
      if (nextCount > 0) {
        inflightByKey.set(key, nextCount);
      } else {
        inflightByKey.delete(key);
      }
    },
  };
};

export const runWithBackpressure = async <T>(
  key: string,
  options: BackpressureOptions,
  work: () => Promise<T>
): Promise<T> => {
  const slot = acquireBackpressureSlot(key, options);
  if (!slot) {
    const retryAfterSeconds = options.retryAfterSeconds ?? Math.max(2, Math.ceil(options.maxConcurrent / 2));
    // Log the internal key server-side; return only a generic busy message.
    logEdgeEvent('warn', 'request rejected by backpressure', { key, maxConcurrent: options.maxConcurrent });
    throw new EdgeBackpressureError('The service is busy right now. Please try again in a moment.', retryAfterSeconds);
  }

  try {
    return await work();
  } finally {
    slot.release();
  }
};

export const isEdgeBackpressureError = (value: unknown): value is EdgeBackpressureError =>
  value instanceof EdgeBackpressureError;
