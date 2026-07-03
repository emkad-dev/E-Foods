/// <reference path="../_shared/edge-runtime.d.ts" />

import { corsHeaders } from '../_shared/cors.ts';
import { getAuthenticatedRequestContext } from '../_shared/request-context.ts';
import { sendPushNotificationsToRoles, sendPushNotificationsToUsers } from '../_shared/notifications.ts';
import {
  createEdgeObservation,
  finishEdgeObservation,
  jsonResponse,
  runWithBackpressure,
} from '../_shared/observability.ts';

type JsonObject = Record<string, unknown>;

class NotificationError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'NotificationError';
    this.status = status;
  }
}

const sanitizeText = (value: unknown, fallback = '') =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

const ensureAdmin = async (request: Request) => {
  const context = await getAuthenticatedRequestContext(request);
  if (context.role !== 'admin') {
    throw new NotificationError(403, 'Only admin accounts can send manual notifications.');
  }
  return context;
};

Deno.serve(async (request) => {
  const observation = createEdgeObservation(request, 'notifications');
  if (request.method === 'OPTIONS') {
    const response = new Response('ok', {
      headers: corsHeaders,
      status: 204,
    });
    finishEdgeObservation(observation, { status: response.status });
    return response;
  }

  if (request.method !== 'POST') {
    const response = jsonResponse(405, {
      error: {
        message: 'Use POST for notification requests.',
      },
    }, corsHeaders);
    finishEdgeObservation(observation, { status: response.status });
    return response;
  }

  try {
    await ensureAdmin(request);

    const payload = (await request.json().catch(() => ({}))) as {
      body?: string;
      data?: JsonObject;
      targetRoles?: string[];
      targetUserIds?: string[];
      title?: string;
    };

    const title = sanitizeText(payload.title);
    const body = sanitizeText(payload.body);
    const targetUserIds = unique(Array.isArray(payload.targetUserIds) ? payload.targetUserIds.map((value) => sanitizeText(value)) : []);
    const targetRoles = unique(Array.isArray(payload.targetRoles) ? payload.targetRoles.map((value) => sanitizeText(value)) : []);

    if (!title || !body) {
      throw new NotificationError(400, 'Title and body are required.');
    }

    if (targetUserIds.length === 0 && targetRoles.length === 0) {
      throw new NotificationError(400, 'Provide at least one target user id or target role.');
    }

    const sendWork = async () => {
      let sent = 0;

      if (targetUserIds.length > 0) {
        const result = await sendPushNotificationsToUsers(targetUserIds, {
          body,
          data: payload.data ?? {},
          title,
        });
        sent += result.sent;
      }

      if (targetRoles.length > 0) {
        const result = await sendPushNotificationsToRoles(targetRoles, {
          body,
          data: payload.data ?? {},
          title,
        });
        sent += result.sent;
      }

      return sent;
    };

    const sent = await runWithBackpressure('notifications', { maxConcurrent: 3, retryAfterSeconds: 3 }, sendWork);

    const response = jsonResponse(200, {
      data: {
        sent,
        targetRoles,
        targetUserIds,
      },
    }, corsHeaders);
    finishEdgeObservation(observation, { status: response.status });
    return response;
  } catch (error) {
    const status = error instanceof NotificationError ? error.status : 500;
    const response = jsonResponse(status, {
      error: {
        message: error instanceof Error ? error.message : 'Unexpected notification failure.',
      },
    }, corsHeaders);
    finishEdgeObservation(observation, { status: response.status, error });
    return response;
  }
});
