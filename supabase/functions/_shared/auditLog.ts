// Admin audit trail. Every privileged mutation writes one row here; the write
// is not best-effort — a failure propagates so the caller cannot report success
// for an action that left no trace.

import { serviceClient } from './client.ts';
import type { JsonObject } from './rpc/coercion.ts';

export const createAuditEntry = async (
  actorUid: string | null,
  action: string,
  targetType: string,
  targetId: string | null,
  details: JsonObject | null = null
) => {
  const { error } = await serviceClient.from('AdminAuditLog').insert({
    actorUid,
    action,
    targetType,
    targetId,
    details,
  });

  if (error) {
    throw new Error(error.message);
  }
};
