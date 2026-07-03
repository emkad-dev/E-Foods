import { SupabaseClient } from 'npm:@supabase/supabase-js@2';

type JsonObject = Record<string, unknown>;

export type IdempotencyRecord = {
  actorUid?: string | null;
  key: string;
  response?: JsonObject | null;
  scope: string;
};

/**
 * Shared idempotency helpers backed by the `IdempotencyRecord` table.
 *
 * These mirror the implementation in app-rpc/index.ts so that queue handlers can
 * short-circuit work that has already been completed. This is what makes it safe
 * for the queue-drainer to reclaim stale `processing` jobs back to `pending`: a
 * job that actually finished (but whose worker crashed before finalizing the
 * queue row) will be re-run, and the idempotency guard turns that re-run into a
 * no-op instead of a duplicate order / duplicate charge.
 */
export const getIdempotencyRecord = async (client: SupabaseClient, key: string) => {
  const { data, error } = await client
    .from('IdempotencyRecord')
    .select('key,scope,actorUid,response')
    .eq('key', key)
    .maybeSingle<IdempotencyRecord>();

  if (error) {
    throw new Error(`Failed to load idempotency record: ${error.message}`);
  }

  return data ?? null;
};

export const storeIdempotencyRecord = async (
  client: SupabaseClient,
  key: string,
  scope: string,
  actorUid: string | null,
  response: JsonObject | null
) => {
  const { error } = await client.from('IdempotencyRecord').upsert(
    {
      key,
      scope,
      actorUid,
      response,
      updatedAt: new Date().toISOString(),
    },
    { onConflict: 'key' }
  );

  if (error) {
    throw new Error(`Failed to store idempotency record: ${error.message}`);
  }
};
