# Play "next release" fixes — vc9 (customer) / vc10 (partner)

Plan date: 2026-10-09. Targets the two "Needs attention" items with real teeth from
Play's pre-launch insights; acknowledges the other two.

## Facts established (from code)
- Stack: Expo SDK 54, RN, committed `android/` prebuild. **EAS builds from committed
  `android/`; the app.json `android` block and `expo-build-properties` only take effect
  if `prebuild` runs.** Both apps config-identical. targetSdk/compileSdk = **36 (Android 16)**.
- `apps/{customer,partner}/android/app/build.gradle` release block already reads
  `android.enableMinifyInReleaseBuilds` (default **false**) and
  `android.enableShrinkResourcesInReleaseBuilds` (default **false**). gradle.properties
  sets **neither** → R8 is OFF → "DEX obfuscation 1%" + "no deobfuscation file".
- `expo-notifications ~0.32.16` is installed in both (the only FGS-capable notif lib;
  no expo-location/task-manager/background-fetch). FGS-from-BOOT_COMPLETED source must be
  pinned precisely before editing (debug merged manifest only showed Firebase/datatransport
  BOOT_COMPLETED receivers, NOT an expo-notifications FGS receiver — so do NOT assume).
- Both apps: `"orientation":"portrait"` → `android:screenOrientation="portrait"` on MainActivity (#4).
- Edge-to-edge already enabled (`edgeToEdgeEnabled=true`); deprecated calls are inside deps (#3).

## In scope
- **#2 R8/minification** (both apps) — enable minify + shrinkResources, add keep-rules, verify.
- **#1 Restricted FGS via BOOT_COMPLETED** (both apps) — diagnose exact component, override, verify.

## Out of scope (with rationale)
- **#4 orientation/large-screen** — portrait-first food apps; Android 16 just *ignores* the lock
  on large screens (no crash). Responsive rework not justified now. Acknowledge only.
- **#3 deprecated edge-to-edge APIs** — from dependencies, not app code; resolved by SDK/lib bumps.

## Global constraints
- Edit the **committed `android/` files directly** (gradle.properties, proguard-rules.pro,
  AndroidManifest.xml) — that is what EAS builds. Mirror any change in `app.json` /
  expo-build-properties ONLY as a secondary safeguard, never as the primary change.
- Keep the two apps' changes identical except where their manifests genuinely differ.
- Do NOT bump versionCode here (build tooling does that). Do NOT run `supabase db push`.
- Never claim runtime success without a real build + device smoke test.

## Tasks

### Task 1 — Pin the exact FGS/BOOT_COMPLETED component (diagnosis, no code)
- Read Play Console → the affected release's insight → "View affected bundle" to get the
  named component(s).
- Cross-check by extracting the **release** AAB's `AndroidManifest.xml`
  (partner AAB already at `~/Downloads/feasty-partner-vc8.aab`; use `bundletool`/`unzip` +
  `aapt2 dump xmltree` on `base/manifest/AndroidManifest.xml`) and list every `<receiver>`
  with a `BOOT_COMPLETED` intent-filter and every `<service>` with `foregroundServiceType`.
- Output: the exact `android:name` of the receiver and the FGS it starts, + whether the app
  actually uses scheduled **local** notifications (grep `scheduleNotificationAsync`/
  `setNotificationChannel` in `apps/*/src`) to judge the blast radius of removing it.
- Gate: if the source is a Google/Firebase component (not expo-notifications), re-evaluate the
  override target before Task 3.

### Task 2 — Enable R8 (both apps)
- In `apps/customer/android/gradle.properties` and `apps/partner/android/gradle.properties` add:
  `android.enableMinifyInReleaseBuilds=true`
  `android.enableShrinkResourcesInReleaseBuilds=true`
- Add baseline keep-rules to each `android/app/proguard-rules.pro` for the libs most likely to
  break under R8 (only those actually in package.json): reanimated, gesture-handler, screens,
  svg, Hermes/JSC, expo-modules autolinking, FCM/Firebase, and any JSON-model classes. Rely on
  libraries' bundled consumer rules first; add app-level keeps only to cover gaps.
- Mirror the two flags into each `app.json` expo-build-properties block as a prebuild safeguard
  (install `expo-build-properties` if absent) — secondary to the gradle.properties edit.
- Static verification only in this task (gradle config parses, flags read correctly).

### Task 3 — Override the restricted FGS receiver (both apps)
- Using Task 1's exact component, add a `tools:`-namespaced override in each
  `android/app/src/main/AndroidManifest.xml`:
  - If local-notif-after-reboot is unused: `tools:node="remove"` the BOOT_COMPLETED receiver,
    OR strip the `android.permission.RECEIVE_BOOT_COMPLETED`-driven path.
  - If it IS used: set the service's `android:foregroundServiceType` to a value permitted from
    BOOT_COMPLETED on Android 15+, or gate the FGS start behind an allowed trigger.
- Ensure `xmlns:tools` is declared on `<manifest>`.
- Static verification: re-generate the merged manifest (`./gradlew :app:processReleaseManifest`
  or a debug merge) and confirm the offending receiver/FGS is gone/retyped.

### Task 4 — Build + device smoke test (gated, needs EAS quota / a device)
- Build **both** release AABs via EAS (quota resets monthly on the 1st — confirm before promising).
  Use `EAS_SKIP_AUTO_FINGERPRINT=1`.
- Install each on a real device and exercise: launch, login/OTP, browse menu, cart/checkout
  (customer), order management + **bank/payout picker** (partner — known vc8 bug, verify vc10 fix
  if that commit is included), notifications, maps. Watch `adb logcat` for R8
  `ClassNotFoundException`/`NoSuchMethodError`.
- If R8 strips something: add the specific keep-rule, rebuild, retest (loop here, not elsewhere).
- Confirm `mapping.txt` is in the AAB (EAS includes it) so Play gets the deobfuscation file.

### Task 5 — Ship + re-verify on Play
- Upload both AABs as new closed-testing releases (vc9 customer, vc10 partner), send for review.
- After processing, confirm the pre-launch insights no longer list #1 and #2.
- Fold in the other pending vc9/vc10 payload (pull-to-refresh, dish cards, ₦4,300, friendly
  errors, partner bank-picker fix) per [[feasty-play-closed-testing-submission]] so one build
  carries everything.

## Verification bar
- #2 fixed = release AAB builds with R8 on, app passes full device smoke test, Play shows a
  deobfuscation file and drops the obfuscation warning.
- #1 fixed = offending receiver/FGS absent from the release merged manifest AND Play's pre-launch
  insight for restricted FGS is gone after the vc9/vc10 review.
