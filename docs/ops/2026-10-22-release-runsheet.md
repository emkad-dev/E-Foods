# FEASTY release run sheet — 2026-10-22

31 local commits on `main` (unpushed). Pushing `main` auto-deploys the edge
functions, so **migrations must be applied before the push**. Rider-pay
functions have no auto-deploy workflow and are deployed by hand.

All new code is written to be safe if its migration has not run yet (missing
table/column → fallback or logged warning), so a push before every migration
will not crash — but features stay dark until their migration lands.

## Order of operations

### 1. Apply migrations in the Supabase SQL editor (project rgfbheorvtolixdcpjhy)
Run each file's contents, in this order. All are additive and re-runnable.

1. `supabase/migrations/20261020c_security_hardening.sql`
   - revokes `auth_rl_hit` from anon/authenticated (open-redirect / quota-abuse hole)
   - guards `email` + `phoneVerifiedAt` on UserAccount
   - fixes mutable search_path on 5 functions
   - locks the demo `notes` table, limits the `promo-assets` bucket (5 MB, jpeg/png/webp)
   - rewrites 13 RLS policies to `(select auth.uid())`
2. `supabase/migrations/20261021_push_devices.sql` — per-app push token table
3. `supabase/migrations/20261021b_drainer_heartbeat.sql` — queue-drainer watchdog + pg_cron check
4. `supabase/migrations/20261020_rider_payouts.sql` — rider-pay ledger, recipients, state machine, `rider_auto_payouts` flag seeded OFF, `RestaurantRecord.deliveryProvider` default 'restaurant'

Then, separately (own query, brief lock, reclaims ~190 MB):
```sql
VACUUM FULL net._http_response;
```

### 2. Push and let CI deploy
```bash
git push origin main
```
CI redeploys the domain edge functions (feasty-orders/dispatch/partner/admin/account,
app-rpc, notifications, queue-drainer, broadcast-runner, paystack-webhook) and the
web apps (admin / customer / partner / landing).

### 3. Deploy rider-pay by hand (no auto-deploy workflow), then its schedule
After step 2's functions are up and migration 4 is applied:
- deploy the `rider-payouts` function
- apply `supabase/migrations/20261020b_rider_payouts_schedule.sql` (daily cron 09:00 UTC)

### 4. Dashboard / console steps (owner only)
- **Supabase → Auth → Settings:** turn on Leaked Password Protection.
- **Cloudflare:** `wrangler deploy` the edge-cache Worker (no-store header fix).
- **Firebase (push notifications):** create a project; add Android apps
  `com.feasty.customer`, `com.feasty.partner`, `com.feasty.dispatch`; drop each
  `google-services.json` into `apps/<app>/android/app/`; add the google-services
  gradle classpath + `apply plugin` per app; create an FCM V1 service-account key
  and upload it per app via `eas credentials`; run `eas init` in `apps/dispatch`
  so `extra.eas.projectId` exists. Then rebuild all three apps.
- **Paystack (only before turning rider payouts on):** enable Transfers, turn
  OFF transfer OTP, fund the Transfers balance, keep the webhook subscribed.
  Confirm in test mode that a duplicate transfer reference is rejected.

## Feature switches (stay OFF until piloted)
- `platform_dispatch` (admin → Observability → Feature flags): enables auto-dispatch.
- `rider_auto_payouts`: enables the daily Paystack transfer run. Pilot with one
  restaurant set to `deliveryProvider='platform'` (admin → Restaurants → Delivery)
  and its riders' bank details submitted first.

## Play Console (dispatch, first submission)
BUILD-READY after `eas init`. Data-safety sheet: `docs/play/dispatch-data-safety.md`.
Content rating: shares location with other users = yes; audience 18+. Give
reviewers an approved rider login. Privacy: https://feasty.com.ng/privacy.html;
deletion: https://feasty.com.ng/account-deletion.html.

## Known-unverified (no live run happened)
- All plpgsql bodies parse but have never executed against Postgres.
- Paystack duplicate-reference rejection is assumed, not tested.
- No end-to-end checkout or on-device push/dispatch test was run.
