# Play Console submission progress — 2026-09-30

Developer account: **Feasty Fooders** (personal), account ID 6146832145519934502,
owned by the FEASTY Google account. Console path prefix `/console/u/7/`.

## Apps created
- **FEASTY** (customer) — app ID 4975053492598721650, `com.feasty.customer`
- **FEASTY Partner** — app ID 4974464232968568207, `com.feasty.partner`

Both: App, Free, English (UK); Play App Signing + US export + Dev Program Policies accepted.

## Android developer verification (deadline 30 Sept 2026)
✅ Both package names auto-registered (3 keys each). Identity taken from developer account.

## Customer app — App content: ALL DONE ✅
Privacy policy, Ads (No), Government (No), Financial features (none), Health (none),
Advertising ID (No), Target audience (16-17 + 18 and over), Content rating
(IARC — ESRB Everyone / PEGI 3 / USK all ages), Sign-in details (Customer test
account, browse-then-sign-in note, full-access, creds entered by owner),
Data safety (imported from docs/play/data-safety-customer.csv — no data shared;
personal/financial/location/messages/photos/app-perf/app-activity collected; deletion URL).

## Customer app — Store presence: DONE ✅
Category Food & drink; contact feastyfooders@gmail.com + https://feasty.com.ng;
store listing name/short/full desc + icon-512 + feature-graphic + 3 phone screenshots.

## Customer app — REMAINING (owner)
Closed testing release: set up track, select countries (Nigeria + wherever else),
add ≥12 testers, upload AAB, review + roll out.
- Customer vc8 AAB: https://expo.dev/artifacts/eas/pMDQx2M7Y3wl2tTduI9NoP5q-ue8IH6duDs4Ylt-HeY.aab
  (I can't upload it — ~80 MB, over the 10 MB browser-upload limit.)

## Partner app — NOT STARTED
Repeat the App content + Store presence flow. Store assets: apps/partner/store/
(icon-512, feature-graphic) + apps/partner/store/screenshots/ (4).
Data safety CSV template differs — export partner's own, fill with the partner
column of docs/play/fill-data-safety.mjs, import.
Partner reviewer login must be an APPROVED account with a real menu (NOT the
owner's Gojo mojo account).
Partner vc8 AAB: https://expo.dev/artifacts/eas/pOgp8MqA1bYW15Dtt0Daw1y-hGkAXQorAPKvTV1txg8.aab

## Store assets committed to repo
apps/{customer,partner}/store/screenshots/*.png (copied from ~/FEASTY-screenshots,
which is outside this session's readable area).
docs/play/data-safety-customer.csv — the filled data safety import.

## UPDATE 2026-09-30 (later) — customer closed-test track configured
Track: **Closed testing - Alpha** (track ID 4700094111304792866).
- ✅ Countries/regions: Nigeria (Targeted).
- ✅ Testers: email list "FEASTY testers" (ghostyxx326@gmail.com,
  emekacletusanoruo@gmail.com) attached; feedback = feastyfooders@gmail.com.
  Add the remaining 10+ testers to this same list later (Testers tab →
  FEASTY testers → arrow → add emails). Need 12 opted-in for 14 days.
- ⬜ RELEASE (owner): Test and release → Closed testing → Create new release →
  upload customer vc8 AAB
  (https://expo.dev/artifacts/eas/pMDQx2M7Y3wl2tTduI9NoP5q-ue8IH6duDs4Ylt-HeY.aab
  — ~80 MB, over the browser-upload limit, so owner uploads from Downloads),
  add release notes, then Review + Start roll-out.
- After a release exists, the opt-in web link appears on the Testers tab —
  send it to testers; each opts in signed in as the exact email listed.

Everything else for the CUSTOMER app is done. Partner app not started.

## UPDATE 2026-09-30 — CUSTOMER SUBMITTED ✅
Customer vc8 closed-test release + all 14 app-content/store changes SENT FOR
REVIEW (Publishing overview → "Changes in review"). Google review ~7 days.
Release: 8 (1.0.0), 32.5 MB install; only warning = no deobfuscation file (benign).
NEXT for customer after approval:
- Testers tab shows the opt-in link; send to the "FEASTY testers" list.
- Grow list to 12+ real testers, keep opted in 14 days, then Apply for production.

## UPDATE 2026-09-30 — PARTNER app content + listing DONE ✅
FEASTY Partner (app ID 4974464232968568207): all 9 App content declarations,
content rating (Everyone/PEGI 3), data safety (imported data-safety-partner.csv,
after fixing orphaned usage rows), category Business, contact, and the full
store listing (icon + feature graphic + 4 screenshots) all SAVED.
Sign-in details = Gojo mojo (emkad567123@gmail.com) per owner's choice.
Target audience 18+.

⬜ PARTNER remaining (same as customer, owner uploads AAB):
- Test and release → Closed testing → the "FEASTY testers" list is account-wide
  (reuse it), target Nigeria, Create new release → upload partner vc8 AAB
  (https://expo.dev/artifacts/eas/pOgp8MqA1bYW15Dtt0Daw1y-hGkAXQorAPKvTV1txg8.aab),
  release notes, Save → Publishing overview → Send changes for review.
- KNOWN: partner vc8 bank picker only allows 5 of 31 banks; testers finish
  onboarding on partner.feasty.com.ng until a vc10 build ships.

Both apps' content is submitted/ready; only the partner release upload + send
remains, then both wait on Google review (~7 days) + the 12-tester/14-day rule.
