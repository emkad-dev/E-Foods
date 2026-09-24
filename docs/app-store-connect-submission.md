# App Store Connect submission pack

The iOS counterpart to [play-console-submission.md](play-console-submission.md).
Same rule: each answer names the thing in this repo that makes it true. Written
2026-09-24 against `29af53d`.

**Not in here:** the App Store Connect records. Creating them means signing in
with your Apple ID, accepting agreements and submitting for review — yours to do.
The iOS builds themselves also need Apple credentials at the prompt, so you
drive `eas build --platform ios` and I verify what comes out.

---

## 0. Four things to fix or decide before you build

### a. `ITSAppUsesNonExemptEncryption` is not set — set it

Neither app declares it (`ios.infoPlist` is `{}` in both `app.json` files).
Without it, every single upload stops on **"Missing Compliance"** in App Store
Connect and TestFlight refuses to distribute the build until you answer a
questionnaire by hand. Every time.

Both apps use only standard TLS — HTTPS to Supabase, Paystack and Sentry — which
is the exemption. One line in each `app.json`:

```json
"ios": {
  "infoPlist": { "ITSAppUsesNonExemptEncryption": false }
}
```

This is a declaration you are making to Apple about your product, so it is your
call, not mine. Say the word and I will add it to both.

### b. `supportsTablet: true` costs you a second set of screenshots

Both apps set it. That tells Apple the app supports iPad, and Apple then
**requires iPad screenshots** (12.9", 2048×2732) on top of the iPhone ones — and
reviews the app on an iPad, where an untested phone layout is a rejection risk.

Neither app has been tested on a tablet as far as this repo shows. Two options:

- **Set `supportsTablet: false`** on both — iPhone only, one screenshot set, no
  iPad review. Fastest path, and reversible later.
- **Keep it** and produce iPad screenshots plus actually check the layout.

My recommendation is `false` for the first release.

### c. Sign in with Apple is no longer required — good

App Store Review Guideline 4.8 forces Sign in with Apple on any app offering a
third-party social login. Removing Google sign-in removed that obligation.
FEASTY is now email + password only, so 4.8 does not apply.

### d. Account deletion is satisfied

Guideline 5.1.1(v) requires in-app account deletion for any app with account
creation. Both have it — `apps/customer/app/(customer)/profile/index.tsx` and
`apps/partner/app/(partner)/account.tsx` — plus the public page at
`https://feasty.com.ng/account-deletion.html`.

---

## 1. App records

| | Customer | Partner |
|---|---|---|
| Bundle ID | `com.feasty.customer` | `com.feasty.partner` |
| Name (30 max) | `FEASTY` | `FEASTY Partner` |
| Subtitle (30 max) | `Food delivery in Nigeria` | `Run your restaurant` |
| Primary category | Food & Drink | Business |
| Secondary | — | Food & Drink |
| Version | 1.0.0 | 1.0.0 |
| Build number | remote, auto-incremented by EAS | same |

Both associate with `applinks:app.feasty.com.ng` (customer only — partner has no
`associatedDomains`, which is correct; it has no deep links).

---

## 2. Listing text

Support URL for both: `https://feasty.com.ng`
Marketing URL: `https://feasty.com.ng`
Privacy policy URL: `https://feasty.com.ng/privacy.html`
Copyright: `2026 FEASTY`

### Customer

**Promotional text** (170 max, changeable without review):

```
Browse restaurants near you without signing up. Pay with Paystack, follow your
rider to the door, and rate the food when it lands.
```

**Keywords** (100 chars, comma-separated, no spaces after commas):

```
food,delivery,restaurant,order,nigeria,jollof,takeaway,lunch,dinner,meal,rider
```

**Description** — reuse the Play full description from
[play-console-submission.md](play-console-submission.md) §2. It is within
Apple's 4000-character limit and needs no changes.

### Partner

**Promotional text:**

```
Take orders with an alarm you can hear across a kitchen, keep your menu current,
and see exactly what you are owed.
```

**Keywords:**

```
restaurant,orders,kitchen,menu,pos,business,food,delivery,nigeria,payouts
```

**Description** — reuse the Play partner description from §2 of the same file.

---

## 3. App Privacy (Apple's labels)

Apple's categories differ from Play's, so this is not a copy of the data-safety
table — but it is built from the same evidence.

Both apps: nothing is used for tracking, so answer **"No"** to the App Tracking
Transparency question. No `NSUserTrackingUsageDescription` is needed and neither
app links `AppTrackingTransparency`.

### Customer

| Apple category | Data type | Used for | Linked to user |
|---|---|---|---|
| Contact Info | Name, Email Address, Phone Number, Physical Address | App Functionality | Yes |
| Location | Precise Location, Coarse Location | App Functionality | Yes |
| User Content | Photos (profile picture) | App Functionality | Yes |
| Purchases | Purchase History | App Functionality | Yes |
| Diagnostics | Crash Data, Performance Data | App Functionality | **No** |

Crash and performance go to Sentry with `sendDefaultPii: false`
(`packages/observability/src/sentry.ts:241`), which is what makes them
not-linked.

**Do not declare Payment Info.** Card entry happens on Paystack's hosted page
inside a WebView (`apps/customer/app/payment/index.tsx:258`).

### Partner

Everything above **except** the two Location rows and Purchase History, plus:

| Apple category | Data type | Used for | Linked to user |
|---|---|---|---|
| Contact Info | Other User Contact Info (NIN / Tax ID) | App Functionality | Yes |
| Financial Info | Other Financial Info (bank account and bank) | App Functionality | Yes |
| User Content | Photos (ID document, restaurant and menu photos) | App Functionality | Yes |

Source: `apps/partner/app/(partner)/complete-restaurant-details.tsx`.

---

## 4. Age rating

Answer every content question **None** / **No**. Nothing in either app involves
violence, sexual content, profanity, drugs, alcohol, tobacco, gambling, horror
or medical information.

- Unrestricted web access: **No.** The only WebView is Paystack's checkout, at a
  fixed URL the app supplies — not a browser.
- User-generated content: **No.** Rating comments reach the restaurant and
  support; nothing a user writes is shown to another user.
- Contests: No. In-app purchases: No (Paystack is physical goods, not IAP).

Expected: **4+** for both.

---

## 5. App Review Information

Same trap as Play, and Apple is stricter about it.

- **Customer:** browsing works signed out, but checkout needs an account. Supply
  a test account and say so in the notes.
- **Partner:** the shell redirects on `user.role !== 'restaurant'`
  (`apps/partner/app/(partner)/_layout.tsx:226`). A reviewer with a fresh signup
  lands on `application-under-review` and will reject the app. Supply an account
  that already has the role. As of 2026-09-23 two accounts do — see
  [play-console-submission.md](play-console-submission.md) §3 for which, and the
  warning about not handing over the repo owner's own credentials.

**Notes field, partner** — worth writing out, because a reviewer will otherwise
assume the app is broken:

```
FEASTY Partner is the restaurant-facing app for a food delivery service; it is
not for ordering food. Restaurants apply in-app, and a FEASTY administrator
approves each one before it can trade. The account below is already approved, so
it opens directly on the dashboard. Test payments are not required to review it.
```

**Physical goods disclosure:** both apps sell/deliver real food. Apple does not
require IAP for physical goods (Guideline 3.1.3(e)); Paystack is correct here.
Say so in the notes if asked.

---

## 6. Screenshots

Apple requires, per app:

- **iPhone 6.9"** — 1320×2868 or 1290×2796. Mandatory.
- **iPhone 6.5"** — 1284×2778 or 1242×2688. Mandatory unless the 6.9" set is
  accepted for all sizes (Apple scales down from the largest in most cases —
  check what the form asks for at the time).
- **iPad 13"** — 2048×2732. **Only if `supportsTablet` stays true.** See §0b.

Minimum 3 per size, maximum 10.

These have to come off a real device or simulator. I cannot produce them: the
browser sandbox in this session blocks `api.feasty.com.ng` and the Supabase
realtime socket (`ERR_BLOCKED_BY_CLIENT`), so the web build renders its chrome
and an empty feed.

---

## 7. Order of operations

1. Decide §0a and §0b; I will apply whichever you pick.
2. `eas build --platform ios --profile production` in each app — you handle the
   Apple credential prompts. First run creates the distribution certificate and
   provisioning profile.
3. Create both app records in App Store Connect (the bundle IDs must exist in
   the Apple Developer portal first; EAS can create them during the build).
4. Upload via `eas submit --platform ios`, or let EAS do it.
5. Fill listing, App Privacy, age rating and App Review Information.
6. Submit.

Watch for **ITMS-90717** (transparent icon). Both apps now ship an opaque
1024×1024 via `ios.icon`, colour type 2, verified zero non-opaque pixels — so
this should not fire. If it does, the icon in the build is not the one in
`assets/images/ios-icon.png`.
