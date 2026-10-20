// Pure Expo push transport: request batching, ticket/receipt interpretation.
//
// Deliberately free of any Supabase import so it can be unit tested with a
// stubbed fetch (notifications.ts wires the database side effects: clearing
// dead tokens and scheduling receipt checks).
//
// Why this exists: the previous sender treated an HTTP 200 from exp.host as
// "delivered". Expo answers 200 even when every message failed - the per-message
// outcome lives in the ticket array (DeviceNotRegistered, InvalidCredentials,
// MismatchSenderId, ...), and the FCM/APNs outcome only arrives later as a
// receipt. None of that was ever read, so dead tokens were never cleared and a
// missing FCM credential was completely invisible.

type JsonObject = Record<string, unknown>;

export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data?: JsonObject;
  sound?: 'default' | null;
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
};

export type ExpoPushTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message?: string; details?: { error?: string; expoPushToken?: string } };

export type ExpoPushReceipt =
  | { status: 'ok' }
  | { status: 'error'; message?: string; details?: { error?: string } };

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type ExpoPushFailure = {
  error: string;
  message: string;
  token: string;
};

export type ExpoPushOutcome = {
  /** Messages Expo accepted (an `ok` ticket). Not the same as "on the device". */
  accepted: number;
  /** Tokens Expo/FCM/APNs say will never work again - safe to delete. */
  deadTokens: string[];
  failures: ExpoPushFailure[];
  /** Ticket ids to poll for receipts, with the token each one was sent to. */
  receiptTickets: Array<{ id: string; token: string }>;
};

export const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
export const EXPO_RECEIPTS_ENDPOINT = 'https://exp.host/--/api/v2/push/getReceipts';
export const EXPO_PUSH_BATCH_SIZE = 100;
export const EXPO_RECEIPT_BATCH_SIZE = 1000;
export const EXPO_PUSH_TIMEOUT_MS = 10_000;

/** A token that will never deliver again; the row holding it should be cleared. */
const DEAD_TOKEN_ERRORS = new Set(['DeviceNotRegistered']);

/**
 * Errors that mean the PROJECT is misconfigured, not the device. These affect
 * every Android (or iOS) user of that app at once, so they get a loud,
 * actionable log line instead of being counted as an ordinary failure.
 */
export const CREDENTIAL_ERROR_HINTS: Record<string, string> = {
  InvalidCredentials:
    'Push credentials for this app are missing or invalid in EAS. Android needs an FCM V1 Google service account key uploaded via `eas credentials` (Android > Push Notifications: FCM V1); iOS needs an APNs key.',
  MismatchSenderId:
    'The FCM sender of the build does not match the FCM V1 credentials uploaded to EAS. Make sure google-services.json and the uploaded service account key come from the SAME Firebase project.',
};

const chunk = <T>(values: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

const isRecord = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const emptyOutcome = (): ExpoPushOutcome => ({ accepted: 0, deadTokens: [], failures: [], receiptTickets: [] });

const mergeOutcome = (into: ExpoPushOutcome, from: ExpoPushOutcome) => {
  into.accepted += from.accepted;
  into.deadTokens.push(...from.deadTokens);
  into.failures.push(...from.failures);
  into.receiptTickets.push(...from.receiptTickets);
};

/** Maps each ticket back to the message it answers (Expo preserves order). */
export const interpretTickets = (messages: ExpoPushMessage[], tickets: unknown[]): ExpoPushOutcome => {
  const outcome = emptyOutcome();

  messages.forEach((message, index) => {
    const ticket = tickets[index];
    if (!isRecord(ticket)) {
      outcome.failures.push({ error: 'MissingTicket', message: 'Expo returned no ticket for this message.', token: message.to });
      return;
    }

    if (ticket.status === 'ok' && typeof ticket.id === 'string' && ticket.id) {
      outcome.accepted += 1;
      outcome.receiptTickets.push({ id: ticket.id, token: message.to });
      return;
    }

    const details = isRecord(ticket.details) ? ticket.details : {};
    const error = typeof details.error === 'string' && details.error ? details.error : 'UnknownError';
    const token =
      typeof details.expoPushToken === 'string' && details.expoPushToken ? details.expoPushToken : message.to;
    outcome.failures.push({
      error,
      message: typeof ticket.message === 'string' ? ticket.message : '',
      token,
    });
    if (DEAD_TOKEN_ERRORS.has(error)) {
      outcome.deadTokens.push(token);
    }
  });

  return outcome;
};

/**
 * Expo rejects a whole request whose tokens belong to more than one project
 * (PUSH_TOO_MANY_EXPERIENCE_IDS). FEASTY has three apps = three projects, and a
 * broadcast or a role fan-out mixes them, so without this every mixed batch
 * failed outright. The error's `details` maps project -> tokens; returns the
 * messages regrouped per project, or null when the body is some other error.
 */
export const splitByExperience = (messages: ExpoPushMessage[], body: unknown): ExpoPushMessage[][] | null => {
  if (!isRecord(body) || !Array.isArray(body.errors)) {
    return null;
  }

  const experienceError = body.errors.find(
    (entry) => isRecord(entry) && entry.code === 'PUSH_TOO_MANY_EXPERIENCE_IDS' && isRecord(entry.details)
  ) as JsonObject | undefined;
  if (!experienceError) {
    return null;
  }

  const groups: ExpoPushMessage[][] = [];
  const assigned = new Set<number>();
  for (const tokens of Object.values(experienceError.details as JsonObject)) {
    if (!Array.isArray(tokens)) continue;
    const tokenSet = new Set(tokens.filter((token): token is string => typeof token === 'string'));
    const group: ExpoPushMessage[] = [];
    messages.forEach((message, index) => {
      if (!assigned.has(index) && tokenSet.has(message.to)) {
        assigned.add(index);
        group.push(message);
      }
    });
    if (group.length > 0) groups.push(group);
  }

  // Anything Expo did not attribute to a project still gets its own attempt
  // rather than being silently dropped.
  const leftovers = messages.filter((_, index) => !assigned.has(index));
  if (leftovers.length > 0) groups.push(leftovers);

  return groups.length > 1 ? groups : null;
};

const postJson = async (fetchImpl: FetchLike, url: string, payload: unknown, timeoutMs: number) => {
  try {
    return await fetchImpl(url, {
      body: JSON.stringify(payload),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error(`Expo push request timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
};

const sendOneRequest = async (
  messages: ExpoPushMessage[],
  fetchImpl: FetchLike,
  timeoutMs: number,
  allowSplit: boolean
): Promise<ExpoPushOutcome> => {
  const response = await postJson(fetchImpl, EXPO_PUSH_ENDPOINT, messages, timeoutMs);
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (allowSplit) {
    const groups = splitByExperience(messages, body);
    if (groups) {
      const outcome = emptyOutcome();
      for (const group of groups) {
        mergeOutcome(outcome, await sendOneRequest(group, fetchImpl, timeoutMs, false));
      }
      return outcome;
    }
  }

  if (!response.ok) {
    throw new Error(`Expo push delivery failed: ${response.status} ${text}`);
  }

  const tickets = isRecord(body) && Array.isArray(body.data) ? body.data : [];
  return interpretTickets(messages, tickets);
};

/** Sends messages in Expo-sized batches and returns every per-message outcome. */
export const deliverExpoPushMessages = async (
  messages: ExpoPushMessage[],
  options: { fetchImpl?: FetchLike; timeoutMs?: number } = {}
): Promise<ExpoPushOutcome> => {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? EXPO_PUSH_TIMEOUT_MS;
  const outcome = emptyOutcome();

  for (const batch of chunk(messages, EXPO_PUSH_BATCH_SIZE)) {
    mergeOutcome(outcome, await sendOneRequest(batch, fetchImpl, timeoutMs, true));
  }

  outcome.deadTokens = Array.from(new Set(outcome.deadTokens));
  return outcome;
};

/**
 * Polls Expo for the FCM/APNs outcome of previously accepted tickets. Receipts
 * are where DeviceNotRegistered (uninstalled app) and InvalidCredentials
 * (missing FCM V1 key) actually show up for most failures.
 */
export const checkExpoPushReceipts = async (
  tickets: Array<{ id: string; token: string }>,
  options: { fetchImpl?: FetchLike; timeoutMs?: number } = {}
): Promise<{ checked: number; deadTokens: string[]; failures: ExpoPushFailure[]; pending: number }> => {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? EXPO_PUSH_TIMEOUT_MS;
  const tokenById = new Map(tickets.map((ticket) => [ticket.id, ticket.token]));
  const deadTokens = new Set<string>();
  const failures: ExpoPushFailure[] = [];
  let checked = 0;

  for (const ids of chunk(Array.from(tokenById.keys()), EXPO_RECEIPT_BATCH_SIZE)) {
    const response = await postJson(fetchImpl, EXPO_RECEIPTS_ENDPOINT, { ids }, timeoutMs);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Expo receipt lookup failed: ${response.status} ${text}`);
    }

    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    const receipts = isRecord(body) && isRecord(body.data) ? body.data : {};

    for (const [id, receipt] of Object.entries(receipts)) {
      if (!isRecord(receipt)) continue;
      checked += 1;
      if (receipt.status === 'ok') continue;
      const token = tokenById.get(id) ?? '';
      const details = isRecord(receipt.details) ? receipt.details : {};
      const error = typeof details.error === 'string' && details.error ? details.error : 'UnknownError';
      failures.push({ error, message: typeof receipt.message === 'string' ? receipt.message : '', token });
      if (token && DEAD_TOKEN_ERRORS.has(error)) {
        deadTokens.add(token);
      }
    }
  }

  return { checked, deadTokens: Array.from(deadTokens), failures, pending: tokenById.size - checked };
};

/** Collapses failures into `{error: count}` plus the credential hints that apply. */
export const summarizeFailures = (failures: ExpoPushFailure[]) => {
  const counts: Record<string, number> = {};
  for (const failure of failures) {
    counts[failure.error] = (counts[failure.error] ?? 0) + 1;
  }
  const hints = Object.keys(counts)
    .filter((error) => error in CREDENTIAL_ERROR_HINTS)
    .map((error) => `${error}: ${CREDENTIAL_ERROR_HINTS[error]}`);
  return { counts, hints };
};
