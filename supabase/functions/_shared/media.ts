/// <reference path="./edge-runtime.d.ts" />

const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
const cdnBaseUrl = (Deno.env.get('CDN_BASE_URL') ?? '').replace(/\/+$/, '');
const imageCdnBaseUrl = (Deno.env.get('IMAGE_CDN_BASE_URL') ?? '').replace(/\/+$/, '');
const storagePublicPrefix = supabaseUrl ? `${supabaseUrl}/storage/v1/object/public/` : '';

const TRANSFORM_OPTIONS = 'format=auto,quality=78,width=800,onerror=redirect';

export type ImageRewriteConfig = {
  storagePublicPrefix: string;
  imageCdnBaseUrl: string;
};

// Wraps a Supabase public Storage URL in a Cloudflare Image Transformations
// URL (https://img.feasty.com.ng/cdn-cgi/image/<options>/<original-url>),
// which resizes/re-encodes at the edge and caches worldwide. onerror=redirect
// falls back to the original URL if a transformation fails. No-op when the
// base URL is unset or the value isn't a public storage object, so it is
// always safe to wrap an image field.
export const rewriteImageUrl = <T extends string | null | undefined>(
  url: T,
  config: ImageRewriteConfig
): T => {
  if (!url || typeof url !== 'string' || !config.imageCdnBaseUrl || !config.storagePublicPrefix) {
    return url;
  }

  if (url.startsWith(`${config.imageCdnBaseUrl}/cdn-cgi/image/`)) {
    return url;
  }

  return (url.startsWith(config.storagePublicPrefix)
    ? `${config.imageCdnBaseUrl}/cdn-cgi/image/${TRANSFORM_OPTIONS}/${url}`
    : url) as T;
};

// Menu item images live inside the restaurant's `menu` JSON, so they need the
// same rewrite as the cover/logo columns or the two drift apart. Malformed
// categories/items pass through untouched, mirroring the price mapper.
export const rewriteMenuImageUrls = (menu: unknown[], config: ImageRewriteConfig): unknown[] =>
  menu.map((category) => {
    if (!category || typeof category !== 'object') {
      return category;
    }

    const categoryRecord = category as Record<string, unknown>;
    if (!Array.isArray(categoryRecord.items)) {
      return category;
    }

    return {
      ...categoryRecord,
      items: categoryRecord.items.map((item) => {
        if (!item || typeof item !== 'object') {
          return item;
        }

        const itemRecord = item as Record<string, unknown>;
        if (typeof itemRecord.image !== 'string') {
          return item;
        }

        return { ...itemRecord, image: rewriteImageUrl(itemRecord.image, config) };
      }),
    };
  });

const envConfig: ImageRewriteConfig = {
  storagePublicPrefix,
  // IMAGE_CDN_BASE_URL is the live knob; CDN_BASE_URL is the dead Bunny-era
  // variable, kept only so re-setting it can't silently do nothing.
  imageCdnBaseUrl: imageCdnBaseUrl || cdnBaseUrl,
};

export const toCdnImageUrl = <T extends string | null | undefined>(url: T): T =>
  rewriteImageUrl(url, envConfig);

export const toCdnMenuImageUrls = (menu: unknown[]): unknown[] =>
  rewriteMenuImageUrls(menu, envConfig);
