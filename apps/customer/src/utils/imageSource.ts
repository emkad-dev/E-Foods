// Remote images are served through Cloudflare Image Transformations
// (img.feasty.com.ng/cdn-cgi/image/<options>/<original-url>) when the backend
// has IMAGE_CDN_BASE_URL set. That layer can refuse a request outright — a
// zone that cannot transform off-zone sources answers 403 before ever touching
// the origin, so the transformation's own `onerror=redirect` never fires. The
// original URL is right there in the path, so treat it as a second candidate
// and let the client recover instead of rendering a blank tile.

const TRANSFORM_PATH_PATTERN = /\/cdn-cgi\/image\/[^/]+\//;

export const buildImageCandidates = (uri: string | null | undefined): string[] => {
  const trimmed = typeof uri === 'string' ? uri.trim() : '';
  if (!trimmed) {
    return [];
  }

  const match = TRANSFORM_PATH_PATTERN.exec(trimmed);
  if (!match) {
    return [trimmed];
  }

  const original = trimmed.slice(match.index + match[0].length);
  // Only absolute origins are worth retrying; a same-zone relative source
  // would just resolve back to the host that already refused us.
  if (!/^https?:\/\//i.test(original)) {
    return [trimmed];
  }

  return [trimmed, original];
};
