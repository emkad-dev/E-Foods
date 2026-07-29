# Cloudflare Edge Shield Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Cloudflare edge shield per `docs/superpowers/specs/2026-07-18-cloudflare-edge-shield-design.md`: Vercel repo cleanup, image transformations, Paystack webhook queue, Cloudflare Access on admin, and the public-catalog edge cache.

**Architecture:** Two new Cloudflare Workers (`cloudflare/hooks`, `cloudflare/edge-cache`) plus an env-gated change to `supabase/functions/_shared/media.ts` and an env-gated catalog base-URL switch in the customer app. Zone-level config (Transformations toggle, `img.` DNS, Access) is done in the Cloudflare dashboard. Edge functions auto-deploy via GitHub Actions on push to main (`verify_jwt` pinned in `supabase/config.toml`).

**Tech Stack:** Cloudflare Workers (wrangler 4.x, OAuth cached on this machine), Cloudflare Queues (`paystack-webhook-events` + `paystack-webhook-dlq`, already created), Cloudflare Pages (already hosting admin/partner), Supabase Edge Functions (Deno), Expo/React Native customer app.

## Global Constraints

- All repo work happens in the `main` worktree: `C:\Users\emkad\EBuy\pricing-v2-wt`. Do NOT touch `C:\Users\emkad\EBuy\E-Foods` (stale branch checkout) except to READ the untracked `supabase\functions\.env` and to APPEND the new env var there (it is the file the local deploy script syncs to Supabase secrets).
- Do not commit or print secrets. `PAYSTACK_SECRET_KEY` is read from `C:\Users\emkad\EBuy\E-Foods\supabase\functions\.env` and piped straight into `wrangler secret put` / HMAC computation.
- Never stage with `git add -A` or commit with `-am`: the worktree carries the user's own uncommitted `apps/partner/app/(auth)/login.tsx` change. Stage exact paths only.
- Supabase project: `https://rgfbheorvtolixdcpjhy.supabase.co`. Zone: `feasty.com.ng` (id `74412dc6d77c98c3208f3e95fad5be69`), account `04c8ec7606adc0e0b391c2914fc2e429`.
- New public hostnames: `img.feasty.com.ng` (transformations), `hooks.feasty.com.ng` (webhooks), `api.feasty.com.ng` (catalog cache).
- Cloudflare dashboard steps run in the in-app browser (user is logged in as Feastyfooders@gmail.com). Wrangler runs via `npx wrangler` (no global install). PowerShell 5.1 syntax (no `&&`).
- Pushing `main` to origin triggers `.github/workflows/deploy.yml`, which deploys `app-rpc payment-verification paystack-webhook public-catalog` — treat every push as a production edge-function deploy.

---

### Task 1: H1 — Vercel repo cleanup (+ land the Pages hosting fixes on main)

**Files:**
- Modify: `.github/workflows/deploy.yml` (drop VERCEL_* env lines 13–17 and both Vercel deploy steps, lines 45–68)
- Delete: `apps/admin-web/vercel.json`, `apps/partner/vercel.json`
- Modify: `apps/admin-web/package.json` (remove `@vercel/speed-insights`)
- Modify: `apps/admin-web/src/main.tsx` (remove import + `injectSpeedInsights()` call)
- Create: `apps/admin-web/public/_headers` (currently only exists uncommitted in the E-Foods worktree)
- Modify: `apps/admin-web/tsconfig.json` (add test-file exclude, mirroring the uncommitted E-Foods fix)
- Modify: `docs/PARTNER_WEB_DEPLOY.md` (replace Vercel instructions with Pages deploy)

**Interfaces:**
- Produces: a `main` branch whose admin-web build is self-sufficient for `npx wrangler pages deploy` (headers + tsconfig fixes on main, no Vercel references).

- [ ] **Step 1: Edit `.github/workflows/deploy.yml`** — delete the four `VERCEL_*` lines from the job `env:` block (keep the block only if other vars remain; it has none, so delete the whole `env:` block at lines 13–17) and delete both `Deploy admin web to Vercel` and `Deploy partner web to Vercel` steps including the partner comment block (lines 45–68). The job keeps: Checkout, Setup Node, Install deps, Prisma migrations, Supabase functions deploy, Notify.

- [ ] **Step 2: Delete dead Vercel config**

```powershell
git -C C:\Users\emkad\EBuy\pricing-v2-wt rm apps/admin-web/vercel.json apps/partner/vercel.json
```

Note: admin's `vercel.json` headers are superseded by `public/_headers` (Step 4); partner's SPA rewrite is superseded by Pages' automatic SPA fallback (no `404.html` in the build output).

- [ ] **Step 3: Remove speed-insights** — in `apps/admin-web/package.json` delete the `"@vercel/speed-insights": "^2.0.0",` dependency line; in `apps/admin-web/src/main.tsx` delete line 4 (`import { injectSpeedInsights } ...`) and line 8 (`injectSpeedInsights();`).

- [ ] **Step 4: Create `apps/admin-web/public/_headers`** with exactly:

```
/*
  X-Robots-Tag: noindex, nofollow
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
```

- [ ] **Step 5: Update `apps/admin-web/tsconfig.json`** — change the last line of the JSON from

```json
  "include": ["src", "vite.config.ts", "../../packages/auth/src/backendRpc.ts", "../../packages/auth/src/claims.ts", "../../packages/domain/src"]
}
```

to

```json
  "include": ["src", "vite.config.ts", "../../packages/auth/src/backendRpc.ts", "../../packages/auth/src/claims.ts", "../../packages/domain/src"],
  "exclude": ["../../packages/domain/src/**/*.test.ts"]
}
```

- [ ] **Step 6: Rewrite `docs/PARTNER_WEB_DEPLOY.md`** — read it first; replace Vercel project/DNS setup content with the Pages flow: `npm run build:web` in `apps/partner` (root-hoisted deps; Metro needs `--max-old-space-size=6144`, already wired in `run-expo-with-root-env.cjs`), then `npx wrangler pages deploy apps/partner/dist --project-name feasty-partner`; custom domain `partner.feasty.com.ng` already attached; deploys are manual by design (Metro heap does not fit Pages CI). Keep any still-true env-var documentation.

- [ ] **Step 7: Verify admin-web still typechecks** (proves tsconfig + main.tsx edits):

```powershell
Set-Location C:\Users\emkad\EBuy\pricing-v2-wt\apps\admin-web; npm run typecheck
```

Expected: exit 0, no output errors. (If `node_modules` is missing in this worktree, run `npm ci --ignore-scripts` at the worktree root first.)

- [ ] **Step 8: Commit**

```powershell
git -C C:\Users\emkad\EBuy\pricing-v2-wt add .github/workflows/deploy.yml apps/admin-web/package.json apps/admin-web/src/main.tsx apps/admin-web/public/_headers apps/admin-web/tsconfig.json docs/PARTNER_WEB_DEPLOY.md
git -C C:\Users\emkad\EBuy\pricing-v2-wt commit -m "chore: remove vercel deploy path; land pages _headers + tsconfig fixes (H1)"
```

(The two `git rm` deletions from Step 2 are already staged.)

---

### Task 2: A1a — transformation-aware `media.ts` + deno test

**Files:**
- Modify: `supabase/functions/_shared/media.ts`
- Test: `supabase/functions/_shared/media_test.ts` (new; first test file under functions — deno std asserts)

**Interfaces:**
- Produces: `toCdnImageUrl(url)` (same export name/signature as today, still consumed by `public-catalog/index.ts` and `app-rpc/index.ts` — no caller changes) now emitting Cloudflare transformation URLs when `IMAGE_CDN_BASE_URL` is set; pure helper `rewriteImageUrl(url, config)` exported for tests.

- [ ] **Step 1: Write the failing test** — create `supabase/functions/_shared/media_test.ts`:

```ts
import { assertEquals } from 'jsr:@std/assert';
import { rewriteImageUrl } from './media.ts';

const config = {
  storagePublicPrefix: 'https://rgfbheorvtolixdcpjhy.supabase.co/storage/v1/object/public/',
  imageCdnBaseUrl: 'https://img.feasty.com.ng',
};

Deno.test('rewrites public storage URLs to transformation URLs', () => {
  const original =
    'https://rgfbheorvtolixdcpjhy.supabase.co/storage/v1/object/public/menu/items/jollof.jpg';
  assertEquals(
    rewriteImageUrl(original, config),
    'https://img.feasty.com.ng/cdn-cgi/image/format=auto,quality=78,width=800,onerror=redirect/https://rgfbheorvtolixdcpjhy.supabase.co/storage/v1/object/public/menu/items/jollof.jpg'
  );
});

Deno.test('passes through non-storage URLs', () => {
  assertEquals(rewriteImageUrl('https://example.com/a.png', config), 'https://example.com/a.png');
});

Deno.test('passes through null/undefined/empty', () => {
  assertEquals(rewriteImageUrl(null, config), null);
  assertEquals(rewriteImageUrl(undefined, config), undefined);
  assertEquals(rewriteImageUrl('', config), '');
});

Deno.test('no-ops when imageCdnBaseUrl is unset', () => {
  const original =
    'https://rgfbheorvtolixdcpjhy.supabase.co/storage/v1/object/public/menu/items/jollof.jpg';
  assertEquals(rewriteImageUrl(original, { ...config, imageCdnBaseUrl: '' }), original);
});

Deno.test('does not double-wrap already-transformed URLs', () => {
  const wrapped =
    'https://img.feasty.com.ng/cdn-cgi/image/format=auto,quality=78,width=800,onerror=redirect/https://rgfbheorvtolixdcpjhy.supabase.co/storage/v1/object/public/menu/items/jollof.jpg';
  assertEquals(rewriteImageUrl(wrapped, config), wrapped);
});
```

- [ ] **Step 2: Run to verify it fails** (deno is not on the tool-shell PATH; prepend the winget Links dir):

```powershell
$env:Path = "$env:LOCALAPPDATA\Microsoft\WinGet\Links;$env:Path"; Set-Location C:\Users\emkad\EBuy\pricing-v2-wt\supabase\functions\_shared; deno test media_test.ts
```

Expected: FAIL — `rewriteImageUrl` is not exported.

- [ ] **Step 3: Rewrite `supabase/functions/_shared/media.ts`** to:

```ts
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
// which resizes/re-encodes at the edge and caches worldwide. No-op when the
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

const envConfig: ImageRewriteConfig = {
  storagePublicPrefix,
  // Legacy CDN_BASE_URL is dead (Bunny); IMAGE_CDN_BASE_URL is the live knob.
  imageCdnBaseUrl: imageCdnBaseUrl || cdnBaseUrl,
};

export const toCdnImageUrl = <T extends string | null | undefined>(url: T): T =>
  rewriteImageUrl(url, envConfig);
```

Note the legacy Bunny behavior (prefix-swap) is intentionally replaced by transformation-wrapping; `CDN_BASE_URL` is unset everywhere, so the fallback only matters if someone re-sets it, in which case it now also produces a transformation URL against that base.

- [ ] **Step 4: Run tests to verify they pass** — same command as Step 2. Expected: 5 passed.

- [ ] **Step 5: Commit**

```powershell
git -C C:\Users\emkad\EBuy\pricing-v2-wt add supabase/functions/_shared/media.ts supabase/functions/_shared/media_test.ts
git -C C:\Users\emkad\EBuy\pricing-v2-wt commit -m "feat(images): cloudflare transformation URLs via IMAGE_CDN_BASE_URL (A1a)"
```

---

### Task 3: A1a rollout — zone config, DNS, env, deploy, live verify

**Files:** none in repo (operator/infra task) except appending one line to `C:\Users\emkad\EBuy\E-Foods\supabase\functions\.env`.

**Interfaces:**
- Consumes: Task 2's `toCdnImageUrl` behavior; Task 1+2 commits pushed to main (CI deploys the functions).

- [ ] **Step 1 (dashboard, in-app browser): enable Transformations** — Cloudflare dash → zone `feasty.com.ng` → Media → Images → Transformations → Enable for the zone. If a source-origin restriction option is present, allow `rgfbheorvtolixdcpjhy.supabase.co`; if only an "allow any origin" toggle exists, enable it (required — Supabase is off-zone).

- [ ] **Step 2 (dashboard): create `img` DNS record** — zone → DNS → Add record: type `A`, name `img`, IPv4 `192.0.2.1`, Proxy status ON (orange). (Dummy origin; Cloudflare intercepts `/cdn-cgi/image/*` before any origin fetch.)

- [ ] **Step 3: append env var to the deploy-script-synced .env** (footgun guard — the local deploy script syncs this file to Supabase secrets on every run):

```powershell
Add-Content -Path C:\Users\emkad\EBuy\E-Foods\supabase\functions\.env -Value "IMAGE_CDN_BASE_URL=https://img.feasty.com.ng" -Encoding ascii
```

- [ ] **Step 4: set the live Supabase secret now** (don't wait for the user's next deploy-script run):

```powershell
Set-Location C:\Users\emkad\EBuy\pricing-v2-wt; npx supabase secrets set IMAGE_CDN_BASE_URL=https://img.feasty.com.ng --project-ref rgfbheorvtolixdcpjhy
```

Expected: `Finished supabase secrets set.` If the CLI is not authenticated, ask the user to run their usual deploy script instead (it syncs `.env` → secrets), then continue.

- [ ] **Step 5: push main** (deploys public-catalog + app-rpc via CI):

```powershell
git -C C:\Users\emkad\EBuy\pricing-v2-wt push origin main
```

Then watch: `gh run watch --repo <owner>/<repo>` (or `gh run list -L 1` for status). Expected: Deploy workflow green. (Edge functions read secrets at invocation; new secret + new code both live once CI finishes.)

- [ ] **Step 6: live verify — transformation URL works.** Get a real image path: POST to public-catalog (PowerShell, anon key from `.env.apps` `EXPO_PUBLIC_SUPABASE_ANON_KEY`):

```powershell
$anon = (Select-String -Path C:\Users\emkad\EBuy\pricing-v2-wt\.env.apps -Pattern '^EXPO_PUBLIC_SUPABASE_ANON_KEY=(.+)$').Matches[0].Groups[1].Value
$r = Invoke-RestMethod -Method Post -Uri 'https://rgfbheorvtolixdcpjhy.supabase.co/functions/v1/public-catalog' -Headers @{ apikey = $anon; Authorization = "Bearer $anon"; 'Content-Type' = 'application/json' } -Body '{"action":"customerGetPublishedRestaurants","data":{}}'
$r | ConvertTo-Json -Depth 6 | Select-String 'img.feasty.com.ng' | Select-Object -First 3
```

Expected: image URLs now start with `https://img.feasty.com.ng/cdn-cgi/image/format=auto,quality=78,width=800,onerror=redirect/https://rgfbheorvtolixdcpjhy.supabase.co/...`. Then fetch one of those URLs:

```powershell
(Invoke-WebRequest -Uri '<one transformed url>' -UseBasicParsing).Headers['Content-Type']
```

Expected: an image content-type (`image/webp`/`image/avif`/`image/jpeg`), HTTP 200. If Cloudflare returns an error page, check the Transformations toggle (Step 1) and re-test.

---

### Task 4: A2 — hooks Worker (code + local smoke)

**Files:**
- Create: `cloudflare/hooks/wrangler.jsonc`
- Create: `cloudflare/hooks/src/index.ts`
- Create: `cloudflare/hooks/README.md`

**Interfaces:**
- Consumes: queues `paystack-webhook-events` / `paystack-webhook-dlq` (exist); Supabase fn `POST /functions/v1/paystack-webhook` verifying HMAC-SHA512(raw body) against `x-paystack-signature` (unchanged).
- Produces: public endpoint `POST https://hooks.feasty.com.ng/paystack`; queue message shape `{ receivedAt: string; signature: string; rawBody: string }`.

- [ ] **Step 1: Create `cloudflare/hooks/wrangler.jsonc`:**

```jsonc
{
  "name": "feasty-hooks",
  "main": "src/index.ts",
  "compatibility_date": "2026-07-01",
  "routes": [{ "pattern": "hooks.feasty.com.ng", "custom_domain": true }],
  "vars": {
    "SUPABASE_WEBHOOK_URL": "https://rgfbheorvtolixdcpjhy.supabase.co/functions/v1/paystack-webhook"
  },
  "queues": {
    "producers": [{ "queue": "paystack-webhook-events", "binding": "WEBHOOK_QUEUE" }],
    "consumers": [
      {
        "queue": "paystack-webhook-events",
        "max_batch_size": 10,
        "max_batch_timeout": 5,
        "max_retries": 25,
        "dead_letter_queue": "paystack-webhook-dlq"
      }
    ]
  }
}
```

- [ ] **Step 2: Create `cloudflare/hooks/src/index.ts`:**

```ts
// Paystack webhook edge buffer. Producer: verifies the Paystack HMAC and
// enqueues the raw event so a Supabase outage never loses a payment event.
// Consumer: replays the raw body + original signature to the Supabase
// paystack-webhook function (which re-verifies it unchanged).

export interface Env {
  WEBHOOK_QUEUE: Queue<WebhookMessage>;
  PAYSTACK_SECRET_KEY: string;
  SUPABASE_WEBHOOK_URL: string;
}

export type WebhookMessage = {
  receivedAt: string;
  signature: string;
  rawBody: string;
};

const MAX_BODY_BYTES = 100_000; // queue message limit is 128 KB; Paystack events are a few KB
const RETRY_BASE_SECONDS = 60;
const RETRY_MAX_SECONDS = 900;

const encoder = new TextEncoder();

const hexEncode = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

const computeSignature = async (body: string, secretKey: string) => {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  return hexEncode(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(body)));
};

const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const deliverToSupabase = (env: Env, message: WebhookMessage) =>
  fetch(env.SUPABASE_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-paystack-signature': message.signature,
    },
    body: message.rawBody,
  });

const isDelivered = (response: Response) => response.status >= 200 && response.status < 300;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/paystack') {
      return json(404, { error: 'Not found' });
    }
    if (request.method !== 'POST') {
      return json(405, { error: 'Method not allowed' });
    }

    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return json(413, { error: 'Payload too large' });
    }

    const signature = request.headers.get('x-paystack-signature') ?? '';
    const expected = await computeSignature(rawBody, env.PAYSTACK_SECRET_KEY);
    if (!signature || !timingSafeEqual(signature.toLowerCase(), expected.toLowerCase())) {
      return json(401, { error: 'Invalid Paystack signature' });
    }

    const message: WebhookMessage = {
      receivedAt: new Date().toISOString(),
      signature,
      rawBody,
    };

    try {
      await env.WEBHOOK_QUEUE.send(message);
    } catch {
      // Queue unavailable: degrade to today's behavior (direct forward).
      const direct = await deliverToSupabase(env, message).catch(() => null);
      if (!direct || !isDelivered(direct)) {
        // Non-200 makes Paystack retry on its own schedule.
        return json(500, { error: 'Enqueue and direct delivery both failed' });
      }
    }

    return json(200, { received: true });
  },

  async queue(batch: MessageBatch<WebhookMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      let response: Response | null = null;
      try {
        response = await deliverToSupabase(env, message.body);
      } catch {
        response = null;
      }

      if (response && isDelivered(response)) {
        message.ack();
        continue;
      }

      // Retry everything else (5xx, 4xx, network): exponential backoff
      // 60s -> 120s -> ... capped at 900s; after max_retries (25, ~6h of
      // outage coverage) the message lands in paystack-webhook-dlq.
      const delaySeconds = Math.min(
        RETRY_BASE_SECONDS * 2 ** Math.max(0, message.attempts - 1),
        RETRY_MAX_SECONDS
      );
      message.retry({ delaySeconds });
    }
  },
};
```

- [ ] **Step 3: Create `cloudflare/hooks/README.md`:**

```markdown
# feasty-hooks — Paystack webhook edge buffer

`POST https://hooks.feasty.com.ng/paystack` verifies the Paystack signature,
enqueues `{receivedAt, signature, rawBody}` on the `paystack-webhook-events`
Cloudflare Queue, and returns 200 immediately. The queue consumer (same
Worker) replays the raw body + original `x-paystack-signature` header to the
Supabase `paystack-webhook` function, retrying with backoff for ~6h before
dead-lettering to `paystack-webhook-dlq` (4-day retention).

## Deploy

    npx wrangler deploy            # from this directory
    npx wrangler secret put PAYSTACK_SECRET_KEY   # live Paystack secret key

## DLQ replay runbook

1. Inspect: Cloudflare dash -> Storage & Databases -> Queues -> paystack-webhook-dlq.
2. For each message, POST its `rawBody` verbatim with header
   `x-paystack-signature: <signature>` to
   https://rgfbheorvtolixdcpjhy.supabase.co/functions/v1/paystack-webhook
3. The function is idempotent per payment reference — duplicates are safe.

Paystack dashboard webhook URL must point at
`https://hooks.feasty.com.ng/paystack` (Settings -> API Keys & Webhooks).
```

- [ ] **Step 4: Local smoke test.** Terminal A (background): `Set-Location C:\Users\emkad\EBuy\pricing-v2-wt\cloudflare\hooks; npx wrangler dev --port 8788 --var PAYSTACK_SECRET_KEY:test_secret --var SUPABASE_WEBHOOK_URL:http://127.0.0.1:9/unreachable`. Then:

```powershell
$body = '{"event":"charge.success","data":{"reference":"local-smoke-1"}}'
$hmac = New-Object System.Security.Cryptography.HMACSHA512
$hmac.Key = [Text.Encoding]::UTF8.GetBytes('test_secret')
$sig = -join ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($body)) | ForEach-Object { $_.ToString('x2') })
# valid signature -> 200
Invoke-WebRequest -Uri http://127.0.0.1:8788/paystack -Method Post -Body $body -Headers @{ 'x-paystack-signature' = $sig; 'Content-Type' = 'application/json' } -UseBasicParsing | Select-Object -ExpandProperty StatusCode
# bad signature -> 401 (Invoke-WebRequest throws; catch and read status)
try { Invoke-WebRequest -Uri http://127.0.0.1:8788/paystack -Method Post -Body $body -Headers @{ 'x-paystack-signature' = 'deadbeef'; 'Content-Type' = 'application/json' } -UseBasicParsing } catch { $_.Exception.Response.StatusCode.value__ }
# wrong path -> 404, GET -> 405 (same catch pattern)
```

Expected: 200, 401. The wrangler dev log then shows the local queue consumer attempting delivery to the unreachable URL and retrying — proof the retry path runs. Stop wrangler dev afterwards.

- [ ] **Step 5: Commit**

```powershell
git -C C:\Users\emkad\EBuy\pricing-v2-wt add cloudflare/hooks
git -C C:\Users\emkad\EBuy\pricing-v2-wt commit -m "feat(edge): paystack webhook buffer worker + queue consumer (A2)"
```

---

### Task 5: A2 rollout — deploy, secret, live verify, Paystack cutover

**Files:** none (operator task).

**Interfaces:**
- Consumes: Task 4 Worker; live `PAYSTACK_SECRET_KEY` value in `C:\Users\emkad\EBuy\E-Foods\supabase\functions\.env`.

- [ ] **Step 1: Deploy** — `Set-Location C:\Users\emkad\EBuy\pricing-v2-wt\cloudflare\hooks; npx wrangler deploy`. Expected output includes the custom domain `hooks.feasty.com.ng` and queue consumer registration. (If custom-domain attach fails from CLI scopes, add it in dash: Workers & Pages → feasty-hooks → Settings → Domains & Routes.)

- [ ] **Step 2: Set the live secret without printing it:**

```powershell
$secret = (Select-String -Path C:\Users\emkad\EBuy\E-Foods\supabase\functions\.env -Pattern '^PAYSTACK_SECRET_KEY=(.+)$').Matches[0].Groups[1].Value
Set-Location C:\Users\emkad\EBuy\pricing-v2-wt\cloudflare\hooks; $secret | npx wrangler secret put PAYSTACK_SECRET_KEY
```

Expected: `Success! Uploaded secret PAYSTACK_SECRET_KEY`.

- [ ] **Step 3: Live signed smoke test** (uses the real secret from the same variable; the reference is fake so the function acks it as ignored — 2xx — and the message is consumed):

```powershell
$body = '{"event":"charge.success","data":{"reference":"edge-shield-smoke-20260718"}}'
$hmac = New-Object System.Security.Cryptography.HMACSHA512
$hmac.Key = [Text.Encoding]::UTF8.GetBytes($secret)
$sig = -join ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($body)) | ForEach-Object { $_.ToString('x2') })
Invoke-WebRequest -Uri https://hooks.feasty.com.ng/paystack -Method Post -Body $body -Headers @{ 'x-paystack-signature' = $sig; 'Content-Type' = 'application/json' } -UseBasicParsing | Select-Object -ExpandProperty StatusCode
```

Expected: 200. Then confirm consumption: `npx wrangler queues info paystack-webhook-events` — backlog returns to 0; Supabase function logs (dash or `get_logs`) show the request arriving with 200/202 within ~1 min.

- [ ] **Step 4 (USER): Paystack dashboard cutover** — Settings → API Keys & Webhooks → set Live webhook URL to `https://hooks.feasty.com.ng/paystack`. (Also closes the "live webhook URL unconfirmed" loose end.) Reversible instantly; the direct Supabase URL keeps working.

- [ ] **Step 5 (USER, optional but recommended): E2E live payment** — one small real order (as done for pricing v2) after cutover; verify order reaches `paid` and the queue backlog drains.

---

### Task 6: H2 — Cloudflare Access on admin (dashboard)

**Files:** none (dashboard task, in-app browser).

- [ ] **Step 1:** Zero Trust dash (one-time team setup if prompted — pick any team name, Free plan) → Access → Applications → Add application → Self-hosted. Application domain: `admin.feasty.com.ng` (entire site). Session duration: 24 h.

- [ ] **Step 2:** Policy "feasty-admins": Action Allow; Include → Emails: `Feastyfooders@gmail.com`, `bladeshadow554@gmail.com`. Login method: One-time PIN (default; no IdP setup).

- [ ] **Step 3:** Protect the Pages back door: Workers & Pages → `feasty-admin` → Settings → Access policy → Enable (this puts `feasty-admin.pages.dev` + preview URLs behind the same Access).

- [ ] **Step 4: Verify:**

```powershell
$resp = Invoke-WebRequest -Uri https://admin.feasty.com.ng -MaximumRedirection 0 -UseBasicParsing -ErrorAction SilentlyContinue
$resp.StatusCode; $resp.Headers.Location
```

Expected: 302 with `Location` on `*.cloudflareaccess.com`. Then the user logs in once via emailed PIN to confirm the allow-path works (agent cannot receive the PIN).

---

### Task 7: A1b — catalog edge-cache Worker + customer app switch

**Files:**
- Create: `cloudflare/edge-cache/wrangler.jsonc`
- Create: `cloudflare/edge-cache/src/index.ts`
- Modify: `apps/customer/src/config/env.ts` (add `catalogUrl` to `appEnv`)
- Modify: `apps/customer/src/services/publicRestaurantReadModel.ts:38-52` (env-gated fetch path)
- Modify: `.env.apps` and `.env.apps.example` (add `EXPO_PUBLIC_CATALOG_URL`)

**Interfaces:**
- Consumes: `public-catalog` POST-RPC contract `{action, data}`; anon key headers.
- Produces: `POST https://api.feasty.com.ng/public-catalog` (same request/response contract as the Supabase function, plus `x-edge-cache: HIT|MISS` and `x-feasty-stale: 1` response headers); `appEnv.catalogUrl?: string`.

- [ ] **Step 1: Create `cloudflare/edge-cache/wrangler.jsonc`:**

```jsonc
{
  "name": "feasty-edge-cache",
  "main": "src/index.ts",
  "compatibility_date": "2026-07-01",
  "routes": [{ "pattern": "api.feasty.com.ng", "custom_domain": true }],
  "vars": {
    "ORIGIN_URL": "https://rgfbheorvtolixdcpjhy.supabase.co/functions/v1/public-catalog"
  }
}
```

- [ ] **Step 2: Create `cloudflare/edge-cache/src/index.ts`:**

```ts
// Edge cache for the anonymous public-catalog POST-RPC. Caches an allowlist
// of read actions keyed on a hash of the raw request body: 60s fresh, and on
// origin failure serves up to 24h stale so menus stay browsable during a
// Supabase outage. Everything else proxies straight through uncached.

export interface Env {
  ORIGIN_URL: string;
}

const CACHEABLE_ACTIONS = new Set([
  'customerGetPublishedRestaurants',
  'customerGetPublishedRestaurantDetail',
]);

const FRESH_MS = 60_000;
const STALE_MS = 24 * 60 * 60 * 1000;
const CACHED_AT_HEADER = 'x-feasty-cached-at';

const hexEncode = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

const sha256Hex = async (text: string) =>
  hexEncode(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

const forwardHeaders = (request: Request) => {
  const headers = new Headers();
  for (const name of ['content-type', 'apikey', 'authorization']) {
    const value = request.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }
  return headers;
};

const fetchOrigin = (env: Env, request: Request, rawBody: string) =>
  fetch(env.ORIGIN_URL, {
    method: 'POST',
    headers: forwardHeaders(request),
    body: rawBody,
  });

const withExtraHeaders = (response: Response, extra: Record<string, string>) => {
  const next = new Response(response.body, response);
  for (const [name, value] of Object.entries(extra)) {
    next.headers.set(name, value);
  }
  return next;
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/public-catalog') {
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    }

    // CORS preflights and non-POSTs go straight to the origin function,
    // which owns the CORS policy.
    if (request.method !== 'POST') {
      return fetch(env.ORIGIN_URL, request);
    }

    const rawBody = await request.text();

    let action = '';
    try {
      const parsed = JSON.parse(rawBody) as { action?: unknown };
      action = typeof parsed.action === 'string' ? parsed.action : '';
    } catch {
      action = '';
    }

    if (!CACHEABLE_ACTIONS.has(action)) {
      return fetchOrigin(env, request, rawBody);
    }

    const cache = caches.default;
    const cacheKey = new Request(
      `https://api.feasty.com.ng/__cache/public-catalog/${await sha256Hex(rawBody)}`,
      { method: 'GET' }
    );

    const cached = await cache.match(cacheKey);
    const cachedAt = cached ? Number(cached.headers.get(CACHED_AT_HEADER) ?? 0) : 0;
    const age = Date.now() - cachedAt;

    if (cached && age < FRESH_MS) {
      return withExtraHeaders(cached, { 'x-edge-cache': 'HIT' });
    }

    let origin: Response | null = null;
    try {
      origin = await fetchOrigin(env, request, rawBody);
    } catch {
      origin = null;
    }

    if (origin && origin.status === 200) {
      const body = await origin.text();
      const toStore = new Response(body, {
        status: 200,
        headers: origin.headers,
      });
      toStore.headers.set(CACHED_AT_HEADER, String(Date.now()));
      // Cache API eviction honors Cache-Control; the 24h window is our
      // stale-serve budget, freshness is enforced above via CACHED_AT_HEADER.
      toStore.headers.set('cache-control', 'public, max-age=86400');
      ctx.waitUntil(cache.put(cacheKey, toStore.clone()));
      return withExtraHeaders(toStore, { 'x-edge-cache': 'MISS' });
    }

    if (cached && age < STALE_MS) {
      return withExtraHeaders(cached, { 'x-edge-cache': 'HIT', 'x-feasty-stale': '1' });
    }

    return (
      origin ??
      new Response(JSON.stringify({ error: 'Catalog origin unavailable' }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      })
    );
  },
};
```

- [ ] **Step 3: Deploy + verify cache behavior live:**

```powershell
Set-Location C:\Users\emkad\EBuy\pricing-v2-wt\cloudflare\edge-cache; npx wrangler deploy
$anon = (Select-String -Path C:\Users\emkad\EBuy\pricing-v2-wt\.env.apps -Pattern '^EXPO_PUBLIC_SUPABASE_ANON_KEY=(.+)$').Matches[0].Groups[1].Value
$headers = @{ apikey = $anon; Authorization = "Bearer $anon"; 'Content-Type' = 'application/json' }
$body = '{"action":"customerGetPublishedRestaurants","data":{}}'
(Invoke-WebRequest -Uri https://api.feasty.com.ng/public-catalog -Method Post -Body $body -Headers $headers -UseBasicParsing).Headers['x-edge-cache']
(Invoke-WebRequest -Uri https://api.feasty.com.ng/public-catalog -Method Post -Body $body -Headers $headers -UseBasicParsing).Headers['x-edge-cache']
```

Expected: `MISS` then `HIT`, identical JSON bodies, and the response matches a direct Supabase call.

- [ ] **Step 4: customer app env plumbing.** In `apps/customer/src/config/env.ts`, add to the `appEnv` object (after `backendRpcUrl`):

```ts
  catalogUrl: getEnvValue(
    process.env.EXPO_PUBLIC_CATALOG_URL,
    Constants.expoConfig?.extra?.EXPO_PUBLIC_CATALOG_URL
  ),
```

Append to `.env.apps` and `.env.apps.example`:

```
EXPO_PUBLIC_CATALOG_URL=https://api.feasty.com.ng
```

(`.env.apps.example` gets the same line as documentation; it already ships placeholder values.)

- [ ] **Step 5: env-gated fetch path in `publicRestaurantReadModel.ts`.** Add imports `import { appEnv, supabaseEnv } from '../config/env';` and, above `callPublicCatalog`, insert:

```ts
const invokeViaEdgeCache = async <T>(action: string, data?: Record<string, unknown>): Promise<T> => {
  const anonKey = supabaseEnv.anonKey ?? '';
  const response = await fetch(`${appEnv.catalogUrl}/public-catalog`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ action, data: data ?? {} }),
  });

  if (!response.ok) {
    let message = `Catalog request failed (${response.status})`;
    try {
      const body = (await response.json()) as { message?: unknown; error?: unknown };
      const parsed = body?.message ?? body?.error;
      if (typeof parsed === 'string' && parsed.trim()) {
        message = parsed.trim();
      }
    } catch {
      // keep default message
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
};
```

Then in `callPublicCatalog`, replace the direct `supabase.functions.invoke` call so the edge cache is used when configured:

```ts
  try {
    if (appEnv.catalogUrl) {
      const responseData = await invokeViaEdgeCache<T>(action, data);
      writeCache(cacheKey, responseData);
      return responseData;
    }

    const { data: responseData, error } = await supabase.functions.invoke<T>('public-catalog', {
      ...
```

(keep the existing invoke branch and its error handling untouched as the fallback when `EXPO_PUBLIC_CATALOG_URL` is unset).

- [ ] **Step 6: typecheck the customer app** — `Set-Location C:\Users\emkad\EBuy\pricing-v2-wt; npx tsc --noEmit -p apps/customer` (use the app's existing typecheck script if one exists in `apps/customer/package.json`). Expected: exit 0.

- [ ] **Step 7: Commit**

```powershell
git -C C:\Users\emkad\EBuy\pricing-v2-wt add cloudflare/edge-cache apps/customer/src/config/env.ts apps/customer/src/services/publicRestaurantReadModel.ts .env.apps.example
git -C C:\Users\emkad\EBuy\pricing-v2-wt commit -m "feat(edge): public-catalog edge cache worker + env-gated client path (A1b)"
```

Note: `.env.apps` (real values) is untracked/gitignored — verify with `git status` and do not force-add it.

---

### Task 8: Wrap-up — push, spec status, user handoff list

- [ ] **Step 1:** Push main (`git -C C:\Users\emkad\EBuy\pricing-v2-wt push origin main`); confirm the Deploy workflow is green (`gh run list -L 1`).
- [ ] **Step 2:** Edit the spec header `**Status:** Draft — pending review` → `**Status:** Implemented 2026-07-18 (A3 order-intents deferred)`; commit with the plan file: `git add docs/superpowers/specs/2026-07-18-cloudflare-edge-shield-design.md docs/superpowers/plans/2026-07-18-cloudflare-edge-shield.md; git commit -m "docs: edge shield spec/plan status"`. Push.
- [ ] **Step 3:** Report the remaining USER actions in the final summary: (a) Paystack dashboard webhook URL cutover (Task 5 Step 4) if not yet done, (b) optional E2E live payment, (c) delete `VERCEL_*` GitHub secrets, Vercel projects, then account, (d) Access one-time PIN login test, (e) mobile builds pick up `EXPO_PUBLIC_CATALOG_URL` whenever the pending pricing-v2 builds are cut.
- [ ] **Step 4:** Update memory (`feasty-domain-infra.md` + `MEMORY.md` index line) with what shipped and what's pending.

## Self-Review Notes

- Spec coverage: A1a → Tasks 2–3; A1b → Task 7; A2 → Tasks 4–5; H1 → Task 1; H2 → Task 6; H3 → user actions in Task 8 (agent cannot delete the user's Vercel account). DLQ runbook → Task 4 README. Paystack cutover → Task 5.
- `toCdnImageUrl` keeps its name/signature so `public-catalog`/`app-rpc` callers are untouched (verified callers via grep).
- Consumer retries ALL failures (incl. 4xx) — deliberate: max_retries caps the damage and the DLQ preserves the event; acking a 4xx would silently drop a payment event.
- Worker TS has no local typecheck step (no per-worker package.json — wrangler bundles TS directly); correctness is exercised by the wrangler-dev smoke (Task 4 Step 4) and live smokes (Task 5 Step 3, Task 7 Step 3).
