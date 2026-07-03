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

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = 'EdgeBackpressureError';
    this.retryAfterSeconds = retryAfterSeconds;
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
    throw new EdgeBackpressureError(`Too many in-flight requests for ${key}.`, retryAfterSeconds);
  }

  try {
    return await work();
  } finally {
    slot.release();
  }
};

export const isEdgeBackpressureError = (value: unknown): value is EdgeBackpressureError =>
  value instanceof EdgeBackpressureError;
