# FEASTY Idea Book

Running capture of ideas, decisions, and research. Newest entries at top. Each entry: what we want → what we already have → what's still needed (research) → status.

---

## 2026-07-07 — Vercel / site latency reduction

**Goal:** Sites (admin panel + partner web) load slowly; cut the latency.

**What we already have**
- `apps/admin-web`: Vite + React 19 SPA, deployed on Vercel (`admin.feasty.com.ng`), served as static assets from Vercel's CDN.
- `apps/partner`: Expo web export on Vercel (`partner.feasty.com.ng`).
- Backend = Supabase (project `ebuy-platform`). Admin data refreshes via **20s polling** (`usePolledRpc`, `POLL_INTERVAL_MS = 20000`).
- Images already routed through Bunny CDN (`CDN_BASE_URL`).

**Diagnosis (most likely causes, biggest first)** — *updated 2026-07-07 after checking the project*
1. ~~Supabase region distance.~~ **RULED OUT.** The Supabase project (`rgfbheorvtolixdcpjhy`) is already in **Central EU (Frankfurt)** — the closest low-latency region to West Africa. Region is NOT the problem; do not migrate.
2. **Heavy first paint.** Recharts + the full SPA bundle load before anything renders. No route-level code splitting. **← now the leading lever.**
3. **Redundant polling.** Every mounted page polls every 20s (`usePolledRpc`); adds constant backend load and jank.
4. **Edge function cold starts** on hot paths (`app-rpc` is a single large function).
5. **The Vercel ↔ Supabase hop + TLS + auth round-trips** on load (getSession, then RPCs) stack up serially.

**What's needed (research / actions, aside from what we have)**
- Add **route-based code splitting** (`React.lazy` + `Suspense`) so login/overview paint before Statistics/Recharts load. Biggest expected win now that region is excluded.
- Replace blanket 20s polling with **Realtime subscriptions** (already have Supabase Broadcast) or on-demand refresh for heavy pages.
- Enable Vercel build output caching / immutable asset headers (Vite hashes assets already — verify `Cache-Control`).
- Parallelize / defer non-critical RPCs on first load; cache stable reads.
- Keep `app-rpc` warm or split hot read paths to cut cold starts.
- Measure first with real numbers: Vercel Analytics / Lighthouse + Supabase query timings before/after, so we know which lever actually moved it.

**Status:** Idea captured. Not yet scheduled. Needs a measurement pass first.

---

## 2026-07-07 — Wall off the admin panel (team-only, private from public)

**Goal:** Keep the admin panel private so the public can't access it — only the team.

**What we already have**
- Supabase email/password login on `admin-web`.
- A hard **role gate**: only `role === 'admin'` sessions get in; others see "This account does not have admin access." So team-only *data* access is already enforced (assuming RLS backs it on the DB).
- Accounts are provisioned by a super user (no public signup on admin).

**The actual gap**
- The **app URL and login page are still publicly reachable** — anyone can load the JS bundle and see the sign-in screen and attempt logins. "Private from the public" means putting a perimeter *in front of* the app, not just gating data.

**Options (research, weakest → strongest)**
1. **Vercel Password Protection / Vercel Authentication** (Pro feature) — puts a wall in front of the whole deployment; visitors must authenticate before the app even loads. Simplest.
2. **IP allowlist** at the edge (Vercel Firewall / Cloudflare Access rule) — only office/VPN IPs reach it. Good if the team has stable IPs; awkward for remote/mobile admins.
3. **Cloudflare Access (Zero Trust)** in front of `admin.feasty.com.ng` — team logs in with Google/email OTP at the edge before reaching FEASTY's own login. Strong, flexible, free tier exists. **Recommended for "team-only" without fixed IPs.**
4. **Enforce MFA** on the Supabase admin accounts regardless (defense in depth).
5. Optionally move admin to a non-guessable subdomain + `noindex` + robots deny (obscurity only; do not rely on alone).

**Recommendation:** Cloudflare Access (or Vercel Authentication) as the outer wall + keep the existing role gate + turn on MFA. Layered.

**Status:** Idea captured. Decision pending on which perimeter (depends on whether the team has stable IPs and the Vercel plan tier).

---

## 2026-07-07 — Customer service messaging system (support inbox + broadcasts)

**Goal:** Customers send messages that reach the admin panel; admin replies back — personal (1:1) and bulk. Requested channels and behaviors (from requirements Q&A):

- **Inbound channels:** in-app support screen · inbound email replies · WhatsApp/social
- **Conversation model:** threaded inbox (helpdesk-style, open/closed, full history)
- **Admin reply delivery:** email via Resend · in-app message · push notification
- **Bulk messaging:** marketing/promos to all · transactional/operational · segmented sends · also to partners & riders

**What we already have (reusable)**
- Supabase: Postgres + RLS, Auth, **Realtime Broadcast**, Edge Functions, pg_cron/queues available.
- **Resend** outbound email, `send.feasty.com.ng` domain verified.
- Customer + partner + dispatch Expo apps (Expo push notifications available).
- Admin SPA to host the inbox UI.

**What's still needed (research — aside from what we have)**
- **Inbound email capture:** Resend is send-only; it does **not** parse inbound mail. Need an inbound pipeline — e.g. Cloudflare Email Workers, or Mailgun/Postmark/SendGrid Inbound Parse → webhook → Supabase Edge Function → thread. Also need reply threading (Message-ID / `In-Reply-To`, or plus-addressed reply-to like `reply+<conversationId>@send.feasty.com.ng`).
- **WhatsApp channel:** Meta WhatsApp Business Platform (Cloud API) — requires a Meta Business account, a dedicated number, **template approval** (lead time), and a webhook. Or a BSP (Twilio / 360dialog). Longest lead time; treat as its own phase.
- **Bulk marketing compliance:** opt-in/consent tracking + **unsubscribe link + suppression list**; NDPR (Nigeria Data Protection Regulation) applies to marketing sends. For large volume, use **Resend Broadcasts** or a queued sender (pg-cron + queue) to respect rate limits and deliverability.
- **Segmentation layer:** query customers/partners/riders by attributes (city, restaurant, order history, active/inactive).

**Decomposition (phased — see below). Status (2026-07-07):** Phase 1 **code complete** on branch `feature/support-inbox-phase1` (spec + plan in `docs/superpowers/`). Live so far: `AppRole` enum gained `support`, and `SupportConversation`/`SupportMessage` tables created with RLS on the Frankfurt project. **Pending deploys (owner action):** (a) `app-rpc` edge function redeploy — blocked from the agent by the auto-mode security classifier because it needs `--no-verify-jwt` to match current prod config; run manually; (b) admin-web → Vercel; (c) customer app → Expo build/OTA. E2E test + PR follow once (a)–(c) are live.

### Proposed phases
1. **Phase 1 — Core Support Inbox (MVP).** In-app support screen → threaded conversations in admin → admin replies via **email (Resend) + in-app (Realtime) + push (Expo)**. 100% current stack, highest value, lowest risk. **← recommend spec this first.**
2. **Phase 2 — Inbound email capture.** Customer email replies flow back into the same threads (new inbound-mail dependency).
3. **Phase 3 — Broadcast / bulk messaging.** Transactional + segmented + marketing (with consent + unsubscribe), audiences incl. partners & riders.
4. **Phase 4 — WhatsApp / social channel.** Unify into the same inbox (Meta Cloud API; longest lead time / approvals).
