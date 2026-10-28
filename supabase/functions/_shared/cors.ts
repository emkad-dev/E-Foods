export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  // Without this, `Retry-After` is invisible to client JS on web even though
  // the server sends it: browsers only expose a small CORS-safelisted set of
  // response headers to `fetch`/XHR by default, and `Retry-After` isn't in
  // it. That silently broke every rate-limit cooldown timer across every app
  // (packages/auth/src/backendRpc.ts reads `response.headers.get('Retry-After')`,
  // always got `null`, and never set a countdown) -- the UI just showed a
  // generic error with no "try again in Xs".
  'Access-Control-Expose-Headers': 'Retry-After',
};
