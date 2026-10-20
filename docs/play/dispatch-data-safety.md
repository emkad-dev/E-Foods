# FEASTY Dispatch (com.feasty.dispatch) - Play Console answer sheet

Importable CSV: `docs/play/data-safety-dispatch.csv`
(regenerate: `node docs/play/fill-data-safety.mjs <exported-template.csv> docs/play/data-safety-dispatch.csv dispatch`).
Declared the same way as customer/partner: every type "collected, not shared", not ephemeral.

## Top-level answers

| Question | Answer |
| --- | --- |
| Collects or shares user data | Yes |
| Encrypted in transit | Yes (HTTPS to Supabase / Sentry / Expo push only) |
| Account creation | Username (email) and password |
| Account deletion URL | https://feasty.com.ng/account-deletion.html |
| Users can request data deletion | Yes - in-app (Rider tab, and on the application screen for applicants) and via the URL |
| Privacy policy URL | https://feasty.com.ng/privacy.html |

## Data types

| Play data type | What it is in this app | Required? | Purposes |
| --- | --- | --- | --- |
| Name | Rider display name | Required | App functionality, Account management |
| Email address | Sign-in email, OTP codes | Required | App functionality, Account management, Developer communications |
| User IDs | Supabase account id | Required | App functionality, Account management |
| Phone number | Rider phone (application) | Required | App functionality, Account management |
| Address | Rider home address (application) | Required | App functionality, Fraud prevention/security |
| Other personal info | Driver's licence number, vehicle type/make/model/plate, state + LGA | Required | Fraud prevention/security, Account management |
| Photos | Front/back photos of driver's licence (picked from library; no camera) | Required | Fraud prevention/security, Account management |
| Precise location | GPS while online or on a delivery, app open only | Required to work | App functionality, Fraud prevention/security |
| Approximate location | Same stream (coarse permission is also requested) | Required to work | App functionality |
| Other financial info | Weekly delivery earnings records | Required | App functionality |
| Device or other IDs | Expo push token | Required | App functionality |
| Crash logs | Sentry | Required | Analytics |
| Diagnostics | Sentry performance/errors | Required | Analytics |

Not collected: in-app messages (no support chat in the rider app), payment card/bank details (riders enter none in-app), contacts, SMS, call logs,
audio, video, calendar, web history, installed apps, health, ads/advertising ID.

Judgment call: rider location is shown to the customer and restaurant on an order the rider has
accepted. That is in-app display to other users of the same service after an explicit rider action
(going online / accepting), which is how the customer app's sheet treated delivery addresses, so it is
declared "collected" rather than "shared". Revisit if Play pushes back.

## Permissions / declarations

- Location: ACCESS_FINE + ACCESS_COARSE only. No ACCESS_BACKGROUND_LOCATION, no foreground
  service, so NO background-location declaration and NO foreground-service declaration is needed.
  In-app prominent disclosure is shown before the OS prompt when the rider first goes online.
- Removed from the merged manifest: FOREGROUND_SERVICE*, RECEIVE_BOOT_COMPLETED, CAMERA, RECORD_AUDIO,
  SYSTEM_ALERT_WINDOW (release), expo-location's LocationTaskService.
- POST_NOTIFICATIONS: requested at runtime for delivery offers / assignments (no declaration form).
- No exact alarms, no QUERY_ALL_PACKAGES.

## Other Console sections

- Content rating (IARC): no violence/sexual/gambling/drugs; users do NOT interact or share content
  publicly; shares location with other users = YES (rider location to the customer on an order).
- Target audience: 18+ only (riders need a driver's licence). Not designed for children.
- Ads: none. News app: no. Government app: no. Financial features: none.
- App access: reviewers need a working APPROVED rider account (email + password) - an unapproved
  account only sees the application form. Provide one in "App access" with instructions.
