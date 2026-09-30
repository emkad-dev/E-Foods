# FEASTY Partner — Play Console submission cheat sheet

Everything to paste for the **FEASTY Partner** (`com.feasty.partner`) listing, so the
browser pass is fast. Companion to `docs/play-console-submission.md` (the source
of truth this was built from) and `docs/play/data-safety-partner.csv` (the data
safety CSV import). Written 2026-09-30.

---

## 1. Basics

| Field | Value |
|---|---|
| App name | `FEASTY Partner` |
| Package | `com.feasty.partner` |
| Category | **Business** |
| Contact email | `feastyfooders@gmail.com` |
| Website | `https://feasty.com.ng` |
| Default language | English (UK) |
| App type / pricing | App, Free |

---

## 2. Store listing text

**Short description** (80 max):
```
Run your restaurant on FEASTY: take orders, manage your menu, track payouts.
```

**Full description:**
```
FEASTY Partner is for restaurants on FEASTY. It is not for ordering food: if
you want to order, install FEASTY.

WHAT YOU CAN DO
- Receive new orders with an alarm loud enough to hear across a kitchen
- Accept orders and move them through preparation to ready-for-pickup
- Build and edit your menu, with photos, prices and availability
- Open and close your restaurant, and set your own delivery radius
- Give your staff their own logins instead of sharing one
- See your ratings and what customers said
- Track what you are owed and where your payouts go

GETTING STARTED
Apply from inside the app. You will be asked for your business details, an
identity document and the bank account you want to be paid into. A FEASTY
administrator reviews every application before a restaurant goes live.

WHERE WE OPERATE
FEASTY currently serves Nigeria.
```

(Verbatim from `docs/play-console-submission.md` §2.)

---

## 3. App content declarations

| Declaration | Answer |
|---|---|
| Privacy policy URL | `https://feasty.com.ng/privacy.html` |
| Ads | **No** — no ad SDK in the partner dependency tree |
| Government app | **No** |
| Financial features | **None** — the bank details collected are the restaurant's own payout account, not a financial product FEASTY offers |
| Health | **None** |
| News app | No |
| COVID-19 contact tracing | No |
| Data deletion | In-app, plus `https://feasty.com.ng/account-deletion.html` |

**Advertising ID — verified by source inspection, not the AAB:**
I could not open the built AAB (no download/execute tooling in this prep-only
task), so this wasn't confirmed from the manifest itself. Instead I checked
`apps/partner/package.json` and `apps/partner/app.json` for anything that pulls
in `com.google.android.gms.permission.AD_ID` automatically (ad SDKs, mobile
analytics/attribution SDKs like AdMob, Firebase Analytics, Segment, Amplitude,
Facebook SDK, AppsFlyer, Adjust, OneSignal). **None are present** — same as
`apps/customer/package.json`, which is why the customer app's answer is "No."
Recommendation: answer **No** for partner too, on that parity. If you want
certainty rather than inference, unzip the AAB and grep
`AndroidManifest.xml` for `AD_ID` before submitting — flagging this as
**verify in browser / verify in AAB** if you'd rather not rely on the inference.

---

## 4. Content rating (IARC)

- Category: **All other app types**
- Email: `feastyfooders@gmail.com`

Exact answers (per `docs/play-console-submission.md` §5, with the one partner
difference called out):

| Question | Answer |
|---|---|
| Ratings-relevant downloadable/updatable content | **No** |
| User interaction (chat/communicate with each other) | **No** — support messaging is restaurant↔admin only, not user-to-user |
| Online or downloadable (unrated) content | **No** |
| Age-restricted goods (alcohol/tobacco/drugs/weapons) | **No** |
| Precise-location sharing with other users | **No** |
| Digital goods purchase (real-money purchase) | **No** — this is the partner difference: restaurants are paid, they do not buy anything in-app (customer's answer is Yes) |
| Cash rewards / real-money gambling / crypto | **No** |
| Unrestricted web browser or search engine | **No** — the Paystack WebView is a fixed payment page, not a general browser |
| News or educational content | **No** |

Expected outcome: Everyone / PEGI 3, same as customer.

---

## 5. Target audience

**18+ only.** Partner is a business tool for restaurant owners/staff, not
something aimed at or appealing to minors. `docs/play-console-submission.md`
§3 recommends 18+ for both apps; the customer app was actually submitted as
"16-17 + 18 and over" in Play Console per `docs/play/SUBMISSION-PROGRESS.md`,
but that's the customer app's own choice — for partner, 18+ only is the
clear, doc-supported call. Confirm this reading if you want a second look
before submitting, but there's no ambiguity in the source doc for partner.

---

## 6. Data safety

Import `docs/play/data-safety-partner.csv` directly (Play Console → App content
→ Data safety → Import from CSV). Do not hand-fill the questionnaire — the CSV
was built by taking `docs/play/data-safety-customer.csv` (the already-imported,
working customer CSV) and editing exactly the rows that differ for partner,
row-by-row, against the same blank Play export template.

**What it declares** (54 `true` rows total, vs. 63 for customer):
- Personal info: **Name, Email address, User IDs, Address, Phone number, Other
  info** (NIN / Tax ID, for identity verification)
- Financial info: **Other financial info only** (bank account number + bank
  code, for paying the restaurant) — **no purchase history**, no user payment
  info
- Photos and videos: **Photos** (identity document, restaurant and menu
  photos) — declared **required**, not optional (customer's profile photo is
  optional; partner's onboarding photos are not)
- App info and performance: **Crash logs, Diagnostics**
- Messages: **Other in-app messages** (restaurant↔support)
- **No location data types** (approximate or precise) — partner has no
  location feature
- **No data shared with third parties** (all `..._ONLY_SHARED` rows are
  blank), no data sold, deletion URL present
  (`https://feasty.com.ng/account-deletion.html`)

This matches `docs/play-console-submission.md` §4's partner table (Personal ×
Other info, Photos, Financial × Other financial info) with one thing to flag:

**Discrepancy to be aware of — not something I changed silently:** §4 says
crash logs and diagnostics should be declared "collected but not linked... and
shared with a third party" (Sentry). The CSV format Play now exports has no
"linked to user" field at all, so that half of the instruction has nothing to
set. More importantly, the **already-committed, already-imported customer
CSV** (`docs/play/data-safety-customer.csv`) declares crash logs/diagnostics
as **collected only, not shared** — the `PSL_DATA_USAGE_ONLY_SHARED` row is
blank for both, contradicting §4's "declare as shared" instruction. I carried
that same "collected only" pattern into the partner CSV for consistency with
what's already live on the customer listing, rather than silently diverging
partner from customer on a question neither app's actual committed
declaration currently answers the way the doc says to. If you want this fixed,
it should be fixed on **both** apps' CSVs together, as a deliberate follow-up.

**Important note about `docs/play/fill-data-safety.mjs`:** this task's brief,
and `docs/play/SUBMISSION-PROGRESS.md`, both refer to this script as the way to
generate the partner CSV from a blank export. It does not exist anywhere in
this repository — not on `main`, not in any branch, not in any worktree — even
though the commit that added `data-safety-customer.csv` (`5862a81`) claims in
its message to have added it too; the commit's actual diff never included it.
I could not run it. Instead I reconstructed `data-safety-partner.csv` by hand:
copied the working customer CSV, then edited exactly the 34 rows that needed
to change (verified against the blank template at
`C:/Users/emkad/Downloads/data_safety_export.csv`, whose row order and question
IDs are byte-identical to the customer CSV's, just with values blanked out).
Every edit was applied by exact old-value → new-value line targeting and
spot-checked afterward; see the verification below. If someone finds the
original script later, it's worth diffing its output against this CSV.

**Verification performed:**
- `true` count: **54** (customer: 63)
- `PSL_DATA_TYPES_*` rows set true: Personal/Name, Personal/Email, Personal/User
  IDs, Personal/Address, Personal/Phone, Personal/Other info, Financial/Other
  financial info, Messages/Other in-app messages, Photos/Photos, App
  performance/Crash logs, App performance/Diagnostics — 11 rows, matching the
  brief's expected list exactly (no location, no purchase history, no app
  activity/user-generated content)
- `grep -c 'ONLY_SHARED,true'` → **0**, confirming "no data shared with third
  parties" across the whole file
- `diff` against the customer CSV touches exactly 34 lines (68 diff lines,
  i.e. 34 changed × 2) — nothing outside the intended edits moved

---

## 7. App access / sign-in details

**This is an OWNER DECISION — I cannot make it for you.**

The partner shell redirects any account without `role === 'restaurant'` to an
onboarding/waiting screen
(`apps/partner/app/(partner)/_layout.tsx:226`). A reviewer given a fresh signup
sees a dead end and rejects the app. The demo account must already be through
the approval gate, **with a real menu** — one item is not a demo, per
`docs/play-console-submission.md` §3.

Two live accounts already clear the gate (measured 2026-09-23):

| Account | Restaurant | Menu items | Orders |
|---|---|---|---|
| `emkad567123@gmail.com` | Gojo mojo | 2 | 109 | ← **repo owner's own account — do NOT give this password to Google** |
| `eniolajames36@gmail.com` | Neeta's Food Haven | 1 | 0 |

Your options, per the source doc:
1. **Use `eniolajames36@gmail.com`**, but add more menu items first — one item
   isn't enough to demo the menu editor, ratings, or order flow convincingly.
2. **Create a third account**, grant it the `restaurant` role, link it to a
   restaurant, and populate a real menu before handing credentials to Google.

Either way, whoever picks this needs to actually add menu content before
submitting — that's a content/DB task, not something this prep pass can do.

---

## 8. Store assets

| Asset | Path |
|---|---|
| Icon (512×512) | `apps/partner/store/icon-512.png` |
| Feature graphic (1024×500, no alpha) | `apps/partner/store/feature-graphic.png` |
| Screenshots (4) | `apps/partner/store/screenshots/1-dashboard.png`, `2-store.png`, `3-menu.png`, `4-orders.png` |

All confirmed present on disk.

---

## 9. AAB for the closed-testing release

- **Partner vc8 AAB:**
  `https://expo.dev/artifacts/eas/pOgp8MqA1bYW15Dtt0Daw1y-hGkAXQorAPKvTV1txg8.aab`
- Do not upload vc7 or earlier (money-grouping bug, pre-`1379550`).
- Verified 2026-09-28 by reading the shipped bundle: package
  `com.feasty.partner`, permissions match vc6, partner's own launcher icons,
  signing cert `16:11:FA:BF…8D:A3` matches the backed-up keystore.

**Known blocker in this build — tell testers about it:** vc8's bank picker on
the payout step only lets **5 of 31 banks** be selected (26 are stuck; fixed
in code on `main` via `657a999`, but not yet in a shipped build — the next
build, vc10, carries the fix and unlocks 2026-10-01 once the Expo Free
Android quota resets). Until vc10 exists:

> Closed testers who hit the bank picker should finish restaurant onboarding
> at **partner.feasty.com.ng** on the web instead of in the Android app, then
> come back to the app once approved.

Say this in the release notes or tester communication for this track.

---

## 10. Closed testing track

- Reuse the same **"FEASTY testers"** email list already set up for the
  customer app's closed-testing track — it's account-wide, not per-app.
- Target country: **Nigeria** (same as customer's track).
- Need 12 testers opted in for 14 days before Google will allow promotion to
  production, same rule as the customer app.
- After creating the release, the opt-in link appears on the Testers tab —
  send it to testers; each opts in signed in as the exact email on the list.

---

## Summary of what's still an owner decision

1. **Reviewer/demo account** — pick option 1 or 2 in §7 and populate real menu
   content; I cannot touch the database or Play Console to do this.
2. **Advertising ID** — I inferred "No" from source (no ad/analytics SDK in
   `package.json`), matching customer's declared answer, but did not read the
   AAB manifest directly. Treat as high-confidence, not certain.
3. **Data safety `shared` discrepancy** (§6) — whether to also fix the
   customer CSV's crash-log/diagnostics "not shared" declaration to match
   §4's "shared with Sentry" instruction. Left unchanged on both apps for
   this pass.
