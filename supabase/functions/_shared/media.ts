/// <reference path="./edge-runtime.d.ts" />

const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
const cdnBaseUrl = (Deno.env.get('CDN_BASE_URL') ?? '').replace(/\/+$/, '');
const storagePublicPrefix = supabaseUrl ? `${supabaseUrl}/storage/v1/object/public/` : '';

// Rewrites a Supabase public Storage URL to route through the Bunny CDN
// (e.g. https://cdn.feasty.com.ng), which caches images at the edge and cuts
// Supabase egress. No-op when CDN_BASE_URL is unset or the value isn't a
// public storage object, so it is always safe to wrap an image field.
export const toCdnImageUrl = <T extends string | null | undefined>(url: T): T => {
  if (!url || typeof url !== 'string' || !cdnBaseUrl || !storagePublicPrefix) {
    return url;
  }

  return (url.startsWith(storagePublicPrefix)
    ? `${cdnBaseUrl}/${url.slice(storagePublicPrefix.length)}`
    : url) as T;
};
