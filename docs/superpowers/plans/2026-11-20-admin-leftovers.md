# Admin leftovers: permissions revoke, form controls, Inbox truth, Dispatch "On the road now"

Spec: none separate. This plan records the owner's decisions of 2026-11-20 (argued with a planning agent, then chosen by the owner):
- A customer reply moves ANY non-open support thread back to Open.
- Text fields get a darker full border that passes 3:1.
- Build Dispatch "On the road now" now.

Branch: `feature/admin-leftovers` (worktree `C:\Users\emkad\EBuy\admin-leftovers-wt`). Do not push. Do not merge.

## Global Constraints

- Admin web app: `apps/admin-web` (React + Vite, Tailwind v4 WITHOUT preflight; `src/styles/global.css` is hand-written). Edge functions: `supabase/functions` (Deno).
- Design rules (comments in global.css): colour means state; NO BEZELS on cards/badges/buttons/panels (native controls keep `border: 1px solid transparent`, never delete a border rule); text-field edges are the one deliberate exception; sentence-case copy; tabular figures.
- Copy must be TRUE to the data. No label may claim something the data does not support.
- Win hover (`src/components/WinLabel.tsx`): the win line must describe the same outcome as the action; never on destructive actions.
- Verification commands (run from the worktree):
  - Admin typecheck: `cd apps/admin-web && npx tsc --noEmit -p .`
  - Admin tests: `cd apps/admin-web && node --test --experimental-strip-types src/lib/*.test.ts src/styles/*.test.ts`
  - Deno tests for a new file: `deno test -A --no-lock --config supabase/deno.json <file>` (deno may not be on the Bash PATH; in PowerShell prepend `$env:LOCALAPPDATA\Microsoft\WinGet\Links` to PATH). `deno check` has ~210 pre-existing errors and must run from `supabase/`; the bar is "no NEW errors" in files you touched.
  - Every new test file must be added to the root `package.json` `test:node` (node tests) or `test:deno` (deno tests) explicit file lists, or CI never runs it.
- Response-shape changes to an existing RPC action are ADDITIVE only and the admin page must treat new fields as optional (`?:`): the admin site and the edge functions deploy separately, so old page + new server and new page + old server must both work.
- Never run `supabase db push`, never apply migrations, never deploy, never push. The owner applies SQL by hand.
- Files in this repo mix CRLF and LF; preserve each file's existing line endings.
- Commit messages end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Task 1: Migration revoking public EXECUTE on `public.rls_auto_enable()`

Context: the Supabase advisor flags `public.rls_auto_enable()` as SECURITY DEFINER and callable by `anon` and `authenticated` via `/rest/v1/rpc/rls_auto_enable`. It is not defined in any repo migration; it is almost certainly the dashboard's "auto-enable RLS on new tables" event-trigger helper. `supabase/migrations/20261020c_security_hardening.sql` (lines ~58-65) lists it under "DELIBERATELY NOT CHANGED", so no revoke exists yet. Do NOT touch `ebuy_account_pending_deletion()`: `authenticated` needs it inside RLS policies.

Create `supabase/migrations/20261120_revoke_rls_auto_enable.sql` following the header style of `20261020c_security_hardening.sql` (purpose, why, how to verify, reverse steps). Body, in one transaction:

```sql
begin;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
commit;
```

The header must include, as comments the owner can copy into the SQL editor:
1. A BEFORE check: `select p.oid::regprocedure, pg_get_function_result(p.oid), p.prosecdef, p.proacl from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'rls_auto_enable';` and `select evtname, evtevent, evtfoid::regprocedure from pg_event_trigger;`
2. VERIFY after: `select has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE') as anon_can, has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE') as auth_can;` both must be false.
3. Confirm the event trigger still enables RLS on a new table: `create table public.zz_rls_probe (id int); select relrowsecurity from pg_class where oid = 'public.zz_rls_probe'::regclass; drop table public.zz_rls_probe;` (expect true if the auto-enable trigger is installed; if it was false BEFORE the revoke too, the trigger is not installed and this step says nothing).
4. Optional: confirm 20261020c landed: `select has_function_privilege('anon', 'public.auth_rl_hit(text,integer,integer,integer)', 'EXECUTE');` expect false.
5. Note: re-check the Supabase advisor afterwards; toggling the dashboard setting may re-grant.
6. REVERSE: `grant execute on function public.rls_auto_enable() to public, anon, authenticated;`

Also append a short entry to `docs/ops/APPLY-before-push.sql` ONLY if that file is a live run sheet of pending SQL (read it first; if it is a historical record of an applied batch, do not edit it and say so in your report).

Done when: the migration file exists with the header above and the revoke; no other files changed except (maybe) the run sheet.

## Task 2: One text-field rule with a 3:1 edge, and every checkbox at 24px

Owner decision: text fields keep a full 1px border, darkened to pass WCAG 1.4.11 (3:1). Measured: `#8a8580` is 3.65:1 on white (#ffffff) and 3.18:1 on the canvas (#f1efeb); today's `--border-strong` #cfcac2 is only 1.63:1 / 1.42:1.

In `apps/admin-web/src/styles/global.css`:
1. Add a token `--field-edge: #8a8580;` next to `--border-strong` in the `:root` token block (do NOT change `--border-strong`, other things use it).
2. Make every text-entry control use `border: 1px solid var(--field-edge)`. Known text-field styles today (verify each; there may be more):
   - `.field input`, `.field select`, `.field textarea` (~line 948). `.field select` keeps the edge too: in a form it is a field to find, same as an input. (Ruling recorded in the ledger.)
   - `.broadcast-compose textarea` (~line 1369)
   - `.audit-input` (~line 1918)
   - `.inbox-composer textarea` (uses `--border`, 1.30:1, the faintest)
   - an inline-styled input in `apps/admin-web/src/pages/AccessPage.tsx` (~line 358): move its border to a class or the shared rule instead of an inline style.
   - The Orders lookup input (`OrdersPage.tsx` ~line 347) uses `.select-pill` (tinted pill, no edge). Leave it as is: it sits in a filter row of pills and is a pill, not a form field. (Ruling recorded in the ledger.)
   Prefer ONE shared selector list (e.g. a single rule naming all of them) over six copies, so the edge is defined once. Keep each control's existing focus ring.
   Also check placeholder text colour in those fields meets 4.5:1 on white; if a field sets a placeholder colour that fails, fix it to `var(--text-muted)` (#5a5f66, 6.4:1 on white).
3. Checkboxes: there is an existing rule `.check-row input[type='checkbox']` (~line 1414: 24x24, margin 0, flex none) with a comment explaining why the box itself grows rather than padding the label. Promote it to apply to EVERY checkbox in the admin (`input[type='checkbox']`), keeping the comment's reasoning, so the Promo codes "automatic" checkbox (`PromoCodesPage.tsx` ~line 241, measured 13x13) meets the 24px floor. Make sure the promo label still lays out (it is a flex row).
4. Update `apps/admin-web/src/styles/targetSize.test.ts`: it pins `.check-row input[type='checkbox']` by selector; point it at the new global selector so the test still guards 24px. Also add a test (in that file or a new `src/styles/fieldEdge.test.ts`) that reads global.css and asserts `--field-edge` is defined and that it reaches >= 3:1 against #ffffff and #f1efeb (compute WCAG relative luminance in the test). If you add a new test file, add it to root `package.json` `test:node`.
5. Run `src/styles/fillOnlyColors.test.ts` (part of the admin test command): if the new border breaks a "fill only" guard, read what that test protects and adjust correctly (text-field edges are the documented exception), do not weaken it for other elements.

Done when: all text-entry controls share the one edge rule at `var(--field-edge)`, every checkbox renders 24x24, typecheck clean, all admin tests pass (count rises by the tests you add).

## Task 3: Inbox tells the truth about who is waiting

Owner decision: a customer message moves ANY thread that is not open back to Open, so Open means "a customer is waiting on us".

Server (`supabase/functions/_shared/domains/orders.ts`, the customer support-message handler ~lines 2215-2245): today `else if (existing.status === 'closed')` reopens; a `pending` thread stays pending, which hides a fresh customer reply from the Open list and from the admin sidebar badge (it counts open only). Change it so any status other than `'open'` reopens.
- Put the decision in a tiny pure exported helper in `supabase/functions/_shared/support.ts`, e.g. `export const shouldReopenOnCustomerMessage = (status: string): boolean => status !== 'open';`, use it in the handler, and add `supabase/functions/_shared/support.test.ts` (Deno, `Deno.test` + `jsr:@std/assert` or whatever the neighbouring `_shared/*.test.ts` files import) covering open -> false, pending -> true, closed -> true. Add the test file to root `package.json` `test:deno` (the FIRST deno test command, the type-checked one).

Admin page (`apps/admin-web/src/pages/InboxPage.tsx`, `apps/admin-web/src/services/supportInbox.ts`):
1. Status labels shown to the admin (filter control, badges, any status text): `open` -> "Open", `pending` -> "Waiting on customer", `closed` -> "Closed". The stored values do not change. Put the label mapping in one exported function (e.g. `supportStatusLabel` in supportInbox.ts) and use it everywhere a status is shown.
2. Tones (`getSupportTone`): `open` -> `'warning'` (a person is needed), `pending` -> `'info'`, `closed` -> `'neutral'`.
3. Empty-state copy for the Open filter must be true under the new rule: e.g. title "You're caught up", body "No customer is waiting on a reply. A new message, or a reply to a conversation waiting on the customer or closed, moves it back here." Empty copy for `pending` must use the new label ("Nothing is waiting on the customer" or similar), not the raw status word.
4. Message bubbles currently show a time with no date (~line 439). Show date and time (use `formatDateTime` from `src/lib/format.ts`).
5. Win hover: wrap the Close action's label in `WinLabel` with win line "Case closed" (only Close; not Reopen, not Send, not any destructive action). Look at how `WinLabel` is used on `ApprovalsPage.tsx` and copy the pattern exactly.
6. The reply box (`.inbox-composer textarea`) gets the shared field edge — Task 2 already did the CSS; just confirm it.
7. Do NOT show the `subject` field: it is the customer's first-ever message cut to 80 characters and never updated, so it would mislead.
8. Do not restructure the list/thread layout beyond the above.

Done when: helper + deno test pass, the handler uses the helper, admin labels/tones/copy/dates/win hover are as above, typecheck clean, admin tests pass.

## Task 4: Dispatch "On the road now"

Owner decision: build it now. Today `adminGetDispatchOpsView` (`supabase/functions/_shared/domains/admin.ts` ~line 2228) returns `activeAssignments` = the latest 50 `DeliveryAssignment` rows in ANY state (no order status), plus `sosEvents`. The admin page (`apps/admin-web/src/pages/DispatchPage.tsx`) titles that list "Recent assignments" with the note "The 50 most recent, delivered ones included". The client calls the `feasty-admin` function (`packages/domain/src/rpcRoutes.ts`); `app-rpc` also bundles the handler.

Facts: `DeliveryAssignment.orderId` is its primary key and a foreign key to `CustomerOrder.id`. Terminal order statuses are `TERMINAL_ORDER_STATUSES` (delivered, cancelled, rejected, failed_delivery) in `supabase/functions/_shared/orders.ts` (~line 161); statuses should be compared after `normalizeOrderStatus`. House style is two queries joined in code (see `supportGetInbox`), not PostgREST embedded selects. The nav SOS badge (`apps/admin-web/src/contexts/NavCountsContext.tsx`) reads only `sosEvents` from this RPC — it must keep working unchanged.

Server:
1. Filter on the SERVER, not "latest 50 then filter" (an old stuck delivery must not fall off). Query `CustomerOrder` for orders whose status is not terminal (a coarse SQL filter on the raw terminal values is fine; then filter again in code with `normalizeOrderStatus` + `TERMINAL_ORDER_STATUSES` for correctness), selecting `id, status, restaurantName (if that column exists on CustomerOrder — check), updatedAt`, limit 500. Then query `DeliveryAssignment` `.in('orderId', ids)` selecting `orderId, courierId, courierName, assignedAt`. Skip the second query when there are no ids.
2. Put the join + filter in a pure exported function in a new `supabase/functions/_shared/dispatchInProgress.ts` (e.g. `buildInProgressDeliveries(orders, assignments)`): returns only orders that HAVE an assignment and are not terminal, each `{ orderId, status (normalized), restaurantName: string | null, courierId, courierName, assignedAt, updatedAt }`, sorted oldest `assignedAt` first (the longest on the road is the most likely to be stuck). Add `supabase/functions/_shared/dispatchInProgress.test.ts` covering: terminal statuses excluded (including a non-normalized variant), orders without an assignment excluded, sort order, empty inputs. Add it to root `package.json` `test:deno` (first command).
3. Return it as a NEW field `inProgress` on the existing response. Keep `activeAssignments` and `sosEvents` exactly as they are (additive change only; no new RPC action, so no contract-count bumps).

Admin client:
4. `apps/admin-web/src/services/platformReads.ts`: add the row type and `inProgress?: InProgressDeliveryRecord[]` (optional) to `AdminDispatchOpsView`.
5. `DispatchPage.tsx`: in the "Riders and assignments" section, add a card "On the road now" ABOVE "Recent assignments". Table columns: Order (link to `/orders/:id`, `#` + last 8 chars upper-case, same style as the existing order links), Status (`StatusBadge` with the order tone used elsewhere — find `getOrderTone`), Restaurant, Courier (name or short id, same fallback as Recent assignments), Assigned at, and a muted "for <duration>" or similar ONLY if you can compute it truthfully from `assignedAt` and now (optional; skip if it adds complexity). Empty state: title "No deliveries in progress", body "No order is with a FEASTY rider right now." When the field is absent (old server), show nothing for this card's body except the same empty state? NO — when `inProgress` is undefined (old server), render the card with a muted line "Not available yet" instead of claiming there are none. Loading/error states follow the Recent assignments card (they share the `ops` read).
6. The "Right now" tile "Carrying orders" stays as it is.

Done when: helper + deno test pass, handler returns `inProgress`, page shows the card with truthful empty/absent states, typecheck clean, admin tests pass, deno check shows no new errors in touched files.

## Task 5: "On the road now" never drops rows silently, and a blank rider name never shows blank

Owner asked (2026-11-21) to fix two items the final review deferred.

Context: `adminGetDispatchOpsView` (`supabase/functions/_shared/domains/admin.ts`) now queries `CustomerOrder` filtered to `fulfillmentType = 'delivery'` and `status in RIDER_HELD_ORDER_STATUSES`, `limit(500)` ordered by oldest `updatedAt`, inside the existing `Promise.all`; then a guarded (try/catch) follow-up reads `DeliveryAssignment .in('orderId', ids)`; then `buildInProgressDeliveries` (`supabase/functions/_shared/dispatchInProgress.ts`) joins, drops rider-less rows, sorts oldest `assignedAt` first. A failure omits `inProgress` (the page shows "Not available yet"). The page is `apps/admin-web/src/pages/DispatchPage.tsx`, types in `apps/admin-web/src/services/platformReads.ts`.

1. Cap: if stale rider-held orders ever exceed 500, the oldest-first ordering keeps the stale ones and drops live ones, silently.
   - Order the orders query by `updatedAt` DESCENDING (keep the 500 most recently active), keep `limit(500)`.
   - Ask PostgREST for the exact total in the same query (`select(..., { count: 'exact' })`) and return it as a NEW optional response field `inProgressTotal: number` alongside `inProgress` (only when `inProgress` is returned). Additive only.
   - The displayed order of `inProgress` stays oldest `assignedAt` first (the helper's sort is unchanged).
   - Page: when `inProgressTotal` is present and greater than the number of orders the server looked at (500) — i.e. the server says rows were left out — show a muted line under the card title: "Showing the 500 most recently updated of {total} open rider orders." Use the real numbers. Do not show it otherwise. Old servers that don't send the field show nothing extra.
   - Batch the follow-up `DeliveryAssignment` read: query `.in('orderId', chunk)` in chunks of 100 ids (sequentially or with Promise.all), so 500 ids never build an ~18 KB request URL. Errors in any chunk are handled by the existing try/catch (whole `inProgress` omitted). Keep the "skip when no ids" behaviour.
   - Put the chunking in a small pure exported helper (e.g. `chunk<T>(items: readonly T[], size: number): T[][]` in `dispatchInProgress.ts`) with Deno test cases: empty, exact multiple, remainder, size larger than input.
2. Blank rider name: `courierName ?? shortId` shows an empty cell when `courierName` is `''` or whitespace.
   - Add a pure exported helper `courierLabel(name: string | null | undefined, id: string | null | undefined): string` in `apps/admin-web/src/lib/dispatchSummary.ts`: trimmed name if non-empty; else the last 6 chars of the trimmed id upper-cased; else `'—'`. Node tests in `dispatchSummary.test.ts`: real name, whitespace name with id, null name with id, nothing at all.
   - Use it in BOTH Dispatch lists ("On the road now" and "Recent assignments") and anywhere else on DispatchPage that renders a courier/rider name from `courierName` with a short-id fallback (check the SOS rows' `riderLabelFor` too — only change it if it has the same blank-name hole, using the same helper).

Done when: the deno tests (dispatchInProgress + support) pass, `deno check` on touched files shows no new errors, admin tsc clean, admin node tests pass (count rises by the new cases), the page shows the truncation note only when the server says rows were left out, and no blank courier cell is possible.
