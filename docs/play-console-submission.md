# Play Console submission pack

Everything needed to create the two Play listings, with each answer traced to
the thing in this repo that makes it true. Written 2026-09-23 against `e35e256`.

**What is not in here:** the Play Console records themselves. Creating them
means signing into a Google account, accepting the Play Developer Distribution
Agreement and publishing public listings — all of which you do yourself. This
file exists so that is a half-hour of clicking rather than a half-day of
guessing.

---

## 1. The binaries

| | Customer | Partner |
|---|---|---|
| Package | `com.feasty.customer` | `com.feasty.partner` |
| Version | 1.0.0 | 1.0.0 |
| versionCode | **8** | **8** |
| Build | `78a495b7` | `7ea1fcb5` |
| Commit | `7611d9b` | `1379550` |
| Keystore | `IMF2w24Tw6` | `DM-aqpCGKm` |

These are the **first closed-testing** binaries, submitted 2026-09-29. There is
no customer vc7: a hung build attempt bumped the counter without producing one.

AABs:

- customer — https://expo.dev/artifacts/eas/pMDQx2M7Y3wl2tTduI9NoP5q-ue8IH6duDs4Ylt-HeY.aab
  **Do not upload vc6 or earlier**: the store screenshots show the "Delivered"
  order tab, which only exists from `c1c12fa`.
- partner — https://expo.dev/artifacts/eas/pOgp8MqA1bYW15Dtt0Daw1y-hGkAXQorAPKvTV1txg8.aab
  **Do not upload vc7 or earlier**: the dashboard screenshot shows `₦83,700`, and
  before `1379550` the app rendered `₦83700.00` and truncated it.

Customer vc8 was verified 2026-09-29 by reading the shipped AAB:
- package `com.feasty.customer`;
- permissions identical to vc6;
- signing certificate SHA256 `88:E1:4E:29…0C:9E`, the same as vc6;
- the Hermes bundle contains the "Delivered" tab and dish-search strings.

### Not in these binaries yet: next upload, 2026-10-01

The Expo Free plan's Android build quota ran out on 2026-09-29 and resets on
2026-10-01. Everything committed after the two build commits is live on the web
apps now and reaches mobile with the next pair. Upload that pair into the
**same closed-testing track**:
- customer next versionCode 9
- partner next versionCode 10 (a quota-refused attempt used 9)

What that pair adds:
- pull-to-refresh (`77341f0`)
- dish cards matching the home card (`0f9d121`)
- customer prices read `₦4,300` (`1fc53cd`)
- friendly error messages, raw errors to Sentry (`47dfa19`, `6ba3504`,
  `e08448c`, `aa8d657`)
- **the partner bank picker scrolls and searches (`657a999`)**. In partner
  vc8, 26 of 31 banks cannot be selected on the payout step. Until the next
  build, closed-testing partners must finish onboarding on
  partner.feasty.com.ng.

After that upload, refresh the customer screenshots: vc8 shows `₦4300.00` and
the old "Add" pill.

Partner vc8 verified 2026-09-28 by reading the shipped bundle, not the repo:
package `com.feasty.partner`; permissions identical to vc6; launcher icons are
partner's own (not customer's); signing certificate `16:11:FA:BF…8D:A3` matches
the backed-up keystore; the money-grouping code is present in the Hermes bundle
(absent from vc6), and the menu-loading fix is an ancestor of the build commit.

Customer requests: `INTERNET`, `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`,
`POST_NOTIFICATIONS`, `VIBRATE`, `WAKE_LOCK`, `ACCESS_NETWORK_STATE`,
`RECEIVE_BOOT_COMPLETED`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`.

Partner requests the same minus both location permissions, plus
`MODIFY_AUDIO_SETTINGS`, `FOREGROUND_SERVICE` and
`FOREGROUND_SERVICE_MEDIA_PLAYBACK` — the kitchen order alarm.

`CAMERA`, `RECORD_AUDIO` and `SYSTEM_ALERT_WINDOW` are absent from both.

---

## 2. Store listing

Contact email on both: `feastyfooders@gmail.com` — the address the published
privacy policy already gives.

### Customer — `com.feasty.customer`

- **App name:** FEASTY
- **Category:** Food & Drink
- **Short description** (80 max):
  `Order food from restaurants near you and track every delivery in real time.`
- **Full description:**

```
FEASTY brings food from restaurants near you to your door.

Browse before you sign up. Open the app and see what is available around you
straight away — you only need an account when you are ready to order.

WHAT YOU CAN DO
- Find restaurants near you, sorted by how close they are
- Search by meal, not just by restaurant: find the dish first, then see who
  makes it nearby
- Save your favourite restaurants and reorder in a couple of taps
- Pay securely through Paystack
- Follow your order from the kitchen to your door, and see your rider
- Get order updates as notifications
- Rate the restaurant and the rider once your food arrives
- Message support from inside the app if something goes wrong

WHERE WE OPERATE
FEASTY currently serves Nigeria.

YOUR ACCOUNT
You can delete your account and its data from the Profile tab at any time, or
from feasty.com.ng/account-deletion.html if you cannot open the app.
```

### Partner — `com.feasty.partner`

- **App name:** FEASTY Partner
- **Category:** Business
- **Short description** (80 max):
  `Run your restaurant on FEASTY: take orders, manage your menu, track payouts.`
- **Full description:**

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

---

## 3. App content declarations

Same for both apps unless noted.

| Declaration | Answer |
|---|---|
| Privacy policy URL | `https://feasty.com.ng/privacy.html` |
| Ads | **No ads** — no ad SDK in either dependency tree |
| Data deletion | In-app, plus `https://feasty.com.ng/account-deletion.html` |
| Target audience | 18+ for both; neither is designed for children |
| News app | No |
| COVID-19 contact tracing | No |
| Government app | No |
| Financial features | **Customer:** no. **Partner:** no — the bank details collected are the restaurant's own payout account, not a financial product |

### App access — read this one

Play rejects apps a reviewer cannot get into.

**Customer** browses without an account, but checkout does not. Give the
reviewer a test account under *App access → All functionality requires special
access*, with the email and password, and say that browsing works signed out.

**Partner needs a demo account that is already through the gate.** The shell
redirects on `user.role !== 'restaurant'`
(`apps/partner/app/(partner)/_layout.tsx:226`), sending anyone without the role
to `complete-restaurant-details` or `application-under-review`. A reviewer given
a fresh signup sees a waiting screen and rejects the app as non-functional.

Measured 2026-09-23: **two live accounts already pass that gate** — both have
`roleDisplay = 'restaurant'`, a linked restaurant, a password and a confirmed
email, so both land on the dashboard.

| account | restaurant | menu items | orders |
|---|---|---|---|
| `emkad567123@gmail.com` | Gojo mojo | 2 | 109 |
| `eniolajames36@gmail.com` | Neeta's Food Haven | 1 | 0 |

The first is the repo owner's own account — do not hand its password to Google.
Either make a third account and give it the role, or use the second. Whichever
you pick needs a menu worth looking at first; one item is not a demo.

---

## 4. Data safety

Answers below come from the code, not from what the apps feel like they do.

Both apps: **encrypted in transit — yes** (TLS to Supabase and Paystack).
**Users can request deletion — yes.** No data is sold. No data is used for
advertising or marketing.

### Customer

| Category | Type | Purpose | Optional? |
|---|---|---|---|
| Personal info | Name | Account management, order fulfilment | Required |
| Personal info | Email address | Account management, order updates | Required |
| Personal info | Phone number | Rider and support contact | Required |
| Personal info | Address | Delivery | Required |
| Location | Approximate location | App functionality — nearby restaurants | Optional |
| Location | Precise location | App functionality — delivery | Optional |
| Photos and videos | Photos | Profile picture | Optional |
| Financial info | Purchase history | Order history, fraud prevention | Required |
| App info and performance | Crash logs | Diagnostics | Required |
| App info and performance | Diagnostics | Performance monitoring | Required |

All of the above is **collected and linked to the user**, except crash logs and
diagnostics, which go to Sentry with `sendDefaultPii: false`
(`packages/observability/src/sentry.ts:241`). Declare those two as collected but
**not** linked, and as shared with a third party.

**Do not declare "User payment info."** Card entry happens on Paystack's own
hosted page inside a WebView (`apps/customer/app/payment/index.tsx:258`); the
app never sees a card number. Only transaction metadata is stored.

Also not collected: contacts, calendar, SMS, call logs, health, fitness, audio,
files, browsing history, installed apps.

### Partner

Everything in the customer table **except** the two location rows and
"Purchase history", plus:

| Category | Type | Purpose | Optional? |
|---|---|---|---|
| Personal info | Other info (NIN / Tax ID) | Identity verification | Required |
| Photos and videos | Photos | Identity document, restaurant and menu photos | Required |
| Financial info | Other financial info (bank account number and bank) | Paying the restaurant | Required |

Source: `apps/partner/app/(partner)/complete-restaurant-details.tsx` — the
onboarding wizard takes `accountNumber`, `bankCode`, and one of
`documentTypeOptions` (`nin`, `tax_id`) with an uploaded document.

Getting this section wrong is a policy violation rather than a rejection, so it
is the part worth re-reading before you submit.

---

## 5. Content rating (IARC)

Answer the questionnaire for both apps as follows. Nothing in either app is
violent, sexual, or gambling-related, and neither references drugs, alcohol or
tobacco.

- Violence / sexual content / profanity / drugs / gambling or simulated
  gambling: **no** to all.
- Does the app let users **interact or communicate with each other**? **No.**
  Messaging is customer↔support only (`support.tsx`), and rating comments
  (`RatingPromptCard.tsx`) go to the restaurant and staff. Nothing a user writes
  is shown to another user — there is no customer-facing reviews surface.
- Does the app **share the user's location with other users**? **No.** The
  customer sees the rider's position; riders do not see customers on a map.
- Does the app let users **purchase real goods**? **Yes** (customer).
  **No** (partner — restaurants are paid, they do not buy).
- Publicly shared user-generated content? **No.**

Expected outcome: Everyone / PEGI 3 for both.

---

## 6. Graphics

Generated and committed, both 1024×500 PNG with no alpha channel:

- `apps/customer/store/feature-graphic.png`
- `apps/partner/store/feature-graphic.png`

They are the logo on each app's own brand colour — correct and accepted, but
plain. Replace them if you want something with a wordmark.

The store icon Play asks for is 512×512. Both apps now have an opaque 1024×1024
at `assets/images/ios-icon.png`; downscale either for Play.

**Still needed, and only you can produce them:** at least 2 phone screenshots
per app (Play allows up to 8; 16:9 or 9:16, min 320px on the short edge).
Install a build on a device and capture — **customer:** home feed, a restaurant
page, the cart, live order tracking. **partner:** incoming order, menu editor,
orders list, ratings.

Installable APKs for capturing them:

- customer — https://expo.dev/artifacts/eas/TRuGqWYIAfKckxLznsSA2rm7qkXEI7lzJIZUfvbINXo.apk
  (versionCode 1, commit `c408f80`)
- partner — https://expo.dev/artifacts/eas/rqA7gFsh7WLzMLAetYzN2-1u5gYNu3KA8YJRgzDGcvU.apk
  (build `552f46c5`, versionCode 5, commit `5d85d3b`)

Both are for screenshots only — upload the AABs from §1, not these.

If an `eas build` hangs after "Resolved … environment" and never prints a
build id, it is stuck computing the project fingerprint. Re-run it with
`EAS_SKIP_AUTO_FINGERPRINT=1` set.

---

## 7. Order of operations

1. Create both apps in Play Console (`com.feasty.customer`, `com.feasty.partner`).
2. Store listing — name, descriptions, icon, feature graphic, screenshots.
3. App content — privacy policy, ads, app access (**the demo accounts**),
   content rating, target audience, data safety.
4. Create a **Closed testing** release first and upload the AABs. Google now
   requires a run of closed testing with real testers before a personal
   developer account can promote to production. Check what your account is
   asked for early: it moves the timeline more than anything else here.
5. Promote to production once the testing requirement is met.

Google Play App Signing will offer to take over signing on first upload. If you
accept, the EAS keystores above become **upload** keys, and losing one stops you
shipping updates. Export both before you upload anything:

```bash
cd apps/customer && npx eas credentials -p android
```
