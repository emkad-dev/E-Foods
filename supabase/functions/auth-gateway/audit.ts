import { serviceClient } from '../_shared/client.ts';
import { logEdgeEvent } from '../_shared/observability.ts';
import { hashValue } from './hash.ts';

export const writeAudit = async (input: {
  event: string; email?: string; ip: string; success: boolean; reason?: string;
}): Promise<void> => {
  try {
    await serviceClient.from('auth_audit_log').insert({
      event: input.event,
      subject_hash: input.email ? await hashValue(input.email) : null,
      ip_hash: await hashValue(input.ip),
      success: input.success,
      reason: input.reason ?? null,
    });
  } catch (e) {
    logEdgeEvent('warn', 'audit write failed', { event: input.event, reason: e instanceof Error ? e.message : 'unknown' });
  }
};
