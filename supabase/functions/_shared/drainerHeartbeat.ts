// queue-drainer liveness (migration 20261021b_drainer_heartbeat.sql).
//
// The drainer stamps CronHeartbeat after its sweeps; broadcast-runner - a
// separate cron job and function - checks the stamp every minute and alerts
// the admins (OperationalAlert + deduped email) when it goes stale. A pg_cron
// SQL job performs the same check inside Postgres in case the edge runtime is
// what failed. Everything here is best-effort and never throws: a monitoring
// failure must not break the work it monitors.

import { serviceClient } from './client.ts';
import { notifyAdmins } from './notifications.ts';
import { logEdgeEvent } from './observability.ts';
import { recordOperationalAlert } from './operationalAlerts.ts';

export const DRAINER_HEARTBEAT_NAME = 'queue-drainer';
export const DRAINER_STALE_AFTER_MS = 5 * 60_000;

/** Pure: a missing heartbeat is "unknown" (not yet deployed), never "stale". */
export const evaluateDrainerHeartbeat = (lastRunAt: string | null | undefined, nowMs: number) => {
  const parsed = lastRunAt ? Date.parse(lastRunAt) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return { ageMs: null, stale: false };
  }
  const ageMs = Math.max(0, nowMs - parsed);
  return { ageMs, stale: ageMs > DRAINER_STALE_AFTER_MS };
};

export const recordDrainerHeartbeat = async (details: Record<string, unknown> = {}) => {
  try {
    const { error } = await serviceClient
      .from('CronHeartbeat')
      .upsert({ details, lastRunAt: new Date().toISOString(), name: DRAINER_HEARTBEAT_NAME }, { onConflict: 'name' });
    if (error) {
      logEdgeEvent('warn', 'drainer heartbeat not recorded', { error: error.message });
    }
  } catch (error) {
    logEdgeEvent('warn', 'drainer heartbeat not recorded', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const checkDrainerHeartbeat = async (nowMs = Date.now()) => {
  try {
    const { data, error } = await serviceClient
      .from('CronHeartbeat')
      .select('lastRunAt')
      .eq('name', DRAINER_HEARTBEAT_NAME)
      .maybeSingle<{ lastRunAt?: string | null }>();
    if (error) {
      logEdgeEvent('warn', 'drainer heartbeat check skipped', { error: error.message });
      return { checked: false, stale: false };
    }

    const { ageMs, stale } = evaluateDrainerHeartbeat(data?.lastRunAt ?? null, nowMs);
    if (!stale) {
      return { checked: true, stale: false };
    }

    const minutes = Math.round((ageMs ?? 0) / 60_000);
    const details =
      `No successful queue-drainer run for ${minutes} min. Acceptance-deadline refunds, offer expiry and ` +
      'scheduled-order release are not happening. Check the queue-drainer-every-minute cron job, the Vault ' +
      'secrets project_url/queue_worker_token, the QUEUE_WORKER_TOKEN function secret and the function logs.';

    logEdgeEvent('error', 'queue-drainer heartbeat stale', { ageMinutes: minutes });
    await recordOperationalAlert({
      alertType: 'queue_drainer_stale',
      dedupeKey: 'queue-drainer-heartbeat-stale',
      details,
      metadata: { ageMinutes: minutes, lastRunAt: data?.lastRunAt ?? null, source: 'broadcast-runner' },
      severity: 'high',
      subjectId: DRAINER_HEARTBEAT_NAME,
      subjectType: 'system',
      title: 'queue-drainer has stopped running',
    });
    // notifyAdmins dedupes its email per (type, subject) for 10 minutes, so a
    // long outage produces a reminder every 10 minutes, not one per minute.
    await notifyAdmins({
      body: details,
      data: { app: 'admin', type: 'queue_drainer_stale' },
      title: 'queue-drainer has stopped running',
    });
    return { checked: true, stale: true };
  } catch (error) {
    logEdgeEvent('warn', 'drainer heartbeat check failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { checked: false, stale: false };
  }
};
