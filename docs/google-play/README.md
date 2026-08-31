# IronDesk Google Play preparation pack

Status: **PREPARATION ONLY — NOT READY FOR SUBMISSION**

Base product snapshot: repository commit `a2d90c50a89f4d7ec04f92b7e63ef7271f8bcdd7`, inspected on 2026-08-31. Preparation-branch additions are identified separately below and must be pinned to their final commit before any release review.

This directory is the working control pack for preparing IronDesk for Google Play. It does not authorize creating a Play app, registering/reserving a package name, submitting an Android developer verification challenge, accepting declarations, uploading an artifact, enrolling a package in Play App Signing, starting a test, submitting for review, or publishing.

## The decision that blocks every irreversible Play action

Two different Android product scopes are currently possible:

| Scope | Intended role | What exists in this repository | Play status |
| --- | --- | --- | --- |
| **U — unified IronDesk app** | Recommended public product: training, workouts, history, recovery, nutrition, progress, account controls, and Health Connect in one install | The working web product exists, plus a deliberately non-releaseable native sample preview in `mobile-android/`; no production-capable unified Android package exists | **Blocked:** permanent package, signing identity, production authentication/sync, final permission set, full native journeys, and release artifact do not exist yet |
| **C — IronDesk Health companion** | Read-only bridge from Health Connect to an athlete's IronDesk account | Native Kotlin/Compose source exists in `android-health-connect/` | Engineering private beta only; release build is intentionally unsigned and physical-device/Play gates remain open |

The public store-listing draft in this pack assumes **Scope U**. The Health Connect permission evidence comes from **Scope C**, because it is the only current product Android implementation with those permissions. The new `mobile-android/` module is sample-only, has no Internet permission, and cannot build a release artifact. If Scope C is instead chosen as the public product, revise every form and listing to the narrower companion behavior before submission.

**Do not create the Play app until the owner records one scope and one permanent package decision in [OWNER_INPUT_CHECKLIST.md](OWNER_INPUT_CHECKLIST.md).** A package name and signing lineage are long-lived product identities.

**Urgent pre-app-creation gate:** the live Android developer verification page currently has no registered packages. Before creating a Play app, the owner must authorize the `com.irondesk.app` claim/registration investigation, privately record every eligible certificate fingerprint shown by Play, and explicitly approve any ownership challenge/request submission. The September 30, 2026 deadline makes this time-sensitive, but it does not authorize Codex or an operator to submit a challenge without approval.

## Code-grounded truth snapshot

These are facts visible in the current repository, not claims about a future Android build:

- A read-only Play Console inspection on 2026-08-31 showed the developer account is **Personal**, the **Change account type** action is disabled, and no organization website is entered. The Console says an organization website must be provided and verified before the account type can be changed. Do not record private address/contact details in this repository.
- The same inspection showed **no registered package names** on the Android developer verification page and a **Register package name** action. Current Play guidance says Play packages must be registered by September 30, 2026 and unregistered Play apps can be removed from Google Play. Packages distributed outside Play and additional signing keys should be inventoried and registered when applicable. This does not prove `com.irondesk.app` is claimable or that any historical private key is controlled.
- Production web origin: [https://irondeskpro.lovable.app](https://irondeskpro.lovable.app).
- Public privacy policy: [https://irondeskpro.lovable.app/privacy](https://irondeskpro.lovable.app/privacy).
- Public account-deletion instructions: [https://irondeskpro.lovable.app/account-deletion](https://irondeskpro.lovable.app/account-deletion).
- The web product supports email/password accounts, onboarding, workout programs and templates, custom/blank workouts, set logging, history, progress, nutrition, recovery, file import/export, linked-device management, and self-service account deletion.
- The AI Coach screen explicitly says its insights are deterministic and that no live model is connected. Do not advertise live AI coaching.
- The only tracked release-oriented Android product implementation is `android-health-connect/`:
  - application ID and namespace: `app.irondesk.health`;
  - display name: `IronDesk Health`;
  - `versionName`: `1.1.0-beta.1`;
  - `versionCode`: `11001`;
  - minimum SDK: 28 (Android 9);
  - target/compile SDK: 36;
  - default service origin: `https://irondeskpro.lovable.app`;
  - release signing configuration: intentionally absent;
  - Health Connect access: selected, read-only, foreground/user-initiated;
  - requested record types: steps, sleep, resting heart rate, HRV, weight, active calories, distance, and exercise sessions;
  - optional history permission for user-selected reads beyond the normal recent window;
  - no Health Connect write permission and no background Health Connect permission;
  - Internet permission is used for pairing, manual sync, and unlink over HTTPS;
  - a device token and no more than five failed-sync payloads are encrypted with Android Keystore; Android backup/device transfer are disabled;
  - no advertising or analytics dependency is visible in the native companion dependency manifest.
- A separate tracked `mobile-android/` module is an internal native engineering preview, not a Play candidate:
  - disposable debug package: `app.irondesk.mobile.preview.debug`;
  - sample data only, with no Internet permission or backend authentication/synchronization;
  - release variants and release bundle/package tasks are disabled;
  - its encrypted, atomic workout journal demonstrates local durability and replay/conflict handling, but the full unified product journeys do not exist there yet.
- A historical full-app namespace, `com.irondesk.app`, exists outside the current tracked Android app, but the examined historical releases were debug-signed and have split signing lineage: the examined 0.9.0 local debug key differs from 0.5.0. Check Play Console package availability and any eligible-key/developer-verification screen before reservation. A public release needs a new protected upload key and Play App Signing; never assume a historical debug key is a safe upgrade identity.
- The web application uses Supabase authentication and an RLS-protected Supabase data model. The source contains account deletion that globally revokes sessions and deletes the Supabase Auth user, allowing cascade deletion of owned active records.
- Imported files are parsed into normalized activities/health metrics. Current code stores source file name/size/format and normalized records; it does not populate `storage_path` or retain the original file.
- Current source contains no Play Billing, RevenueCat, Stripe, subscription, paywall, purchase-token, or entitlement implementation.

Every one of these facts must be rechecked against the exact release commit, signed AAB, production backend, and current Play Console forms before submission.

## Documents in this pack

| Document | Use |
| --- | --- |
| [STORE_LISTING_DRAFT.md](STORE_LISTING_DRAFT.md) | Draft app name, short/full descriptions, screenshots, listing fields, and claims guardrails |
| [DATA_SAFETY_INVENTORY_DRAFT.md](DATA_SAFETY_INVENTORY_DRAFT.md) | Conservative data-flow inventory to translate into the Play Data safety form after final artifact/vendor review |
| [HEALTH_APPS_AND_HEALTH_CONNECT.md](HEALTH_APPS_AND_HEALTH_CONNECT.md) | Draft Health Apps categories and exact per-permission Health Connect justifications |
| [REVIEWER_ACCESS.md](REVIEWER_ACCESS.md) | Copy-ready reviewer-access instructions with credential placeholders and a Health Connect review path |
| [CLOSED_BETA_PLAN.md](CLOSED_BETA_PLAN.md) | Internal/closed testing matrix, acceptance gates, issue severity, and tester feedback template |
| [RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md) | Reproducible build, evidence, Play Console, testing, review, launch, and rollback sequence |
| [OWNER_INPUT_CHECKLIST.md](OWNER_INPUT_CHECKLIST.md) | All owner/legal/commercial choices that cannot be inferred from source |
| [`assets/`](assets/) | Draft 512 icon, 1024×500 feature graphic, generated background, and reproducible build script; brand approval and release-candidate screenshots remain open |

The existing companion-specific engineering references remain authoritative for that module:

- [`android-health-connect/README.md`](../../android-health-connect/README.md)
- [`android-health-connect/docs/PRIVACY_AND_PERMISSIONS.md`](../../android-health-connect/docs/PRIVACY_AND_PERMISSIONS.md)
- [`android-health-connect/docs/PRIVATE_BETA_SETUP.md`](../../android-health-connect/docs/PRIVATE_BETA_SETUP.md)
- [`android-health-connect/docs/RELEASE_CHECKLIST.md`](../../android-health-connect/docs/RELEASE_CHECKLIST.md)

## Launch checklist

Each checkbox requires a dated evidence link or artifact in the release ticket. A checked planning document is not evidence by itself.

### 0. Owner, account, and product identity

- [ ] Complete every **blocker** in [OWNER_INPUT_CHECKLIST.md](OWNER_INPUT_CHECKLIST.md).
- [ ] Provide and verify an organization website in Play Console so **Change account type** becomes available. Prefer a company-controlled custom domain if one exists; the current production product is hosted at `https://irondeskpro.lovable.app`, but ownership/verification suitability must be confirmed in the live Console.
- [ ] Convert the currently Personal account to an Organization account before submitting the intended health app. Do not rely on old forum guidance or copy private account details into source control.
- [ ] Verify the legal organization name, D-U-N-S record, payments profile, official website, public developer details, private support contact, and account recovery owners all match.
- [ ] Before Play app creation, open **Android developer verification → Package names**, start the `com.irondesk.app` registration/claim investigation, and privately record all eligible SHA-256 certificate fingerprints displayed by Play.
- [ ] Stop before submitting any key challenge, ownership APK, ineligible-key request, rationale, or final package registration until the owner reviews the eligible fingerprints and gives dated approval.
- [ ] Inventory `app.irondesk.health`, every other outside-Play IronDesk package, and any additional signing keys; decide which must be registered without conflating the companion with the unified app.
- [ ] Choose Scope U or Scope C and record the decision.
- [ ] Choose and search the permanent package identity; confirm it is not already registered or tied to an uncontrolled signing lineage.
- [ ] Decide whether any historical `com.irondesk.app` installs must upgrade. Because the audited releases were debug-signed with split lineage, require Play Console eligibility evidence and a proven upgrade path—or choose a new permanent unified package.
- [ ] Confirm the product name (`IronDesk` proposed), subscription name (`IronDesk Pro` proposed), countries, language, category, target audience, and medical-claim boundary.

Google's current Play Console requirements say developers providing health apps should use an organization account. Organization accounts require a D-U-N-S number. Use the current official guidance: [Play Console requirements](https://support.google.com/googleplay/android-developer/answer/10788890?hl=en), [choose an account type](https://support.google.com/googleplay/android-developer/answer/13634885?hl=en), [account conversion](https://support.google.com/googleplay/android-developer/answer/16260648?hl=en), [registering Play package names](https://support.google.com/googleplay/android-developer/answer/16984799?hl=en), and [registering Android package names](https://support.google.com/googleplay/android-developer/answer/16761053?hl=en).

### 1. Android product and release engineering

- [ ] Scope U only: create a tracked, production Android project for the complete app; do not submit a thin or broken remote-site wrapper.
- [ ] Integrate the proven Health Connect behavior into the final package without broadening its permission set.
- [ ] Confirm the final app works with Android Back, process death, screen lock, rotation, poor connectivity, and interrupted workout writes.
- [ ] Store authentication material in Android-secure storage and verify no token is exposed through backup, logs, screenshots, or exported files.
- [ ] Implement idempotent/durable workout writes before promising offline recovery.
- [ ] Target the API level required on the actual submission date. As of this snapshot, new phone/tablet apps must target Android 16/API 36: [target API requirements](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en).
- [ ] Build an Android App Bundle (`.aab`) from a clean, pinned commit.
- [ ] Create or identify a protected upload key; document ownership, backup, recovery, expiration, and SHA-256 certificate fingerprint.
- [ ] Enroll the selected package in Play App Signing only after the owner approves the final identity.
- [ ] Inspect the exact signed candidate's package, versions, SDKs, permissions, certificates, endpoints, native libraries, SDKs, and embedded secrets.
- [ ] Save the AAB SHA-256, source commit, CI run, upload certificate, Play app-signing certificate, and Software Bill of Materials/dependency evidence.

### 2. Privacy, health, and app-content forms

- [ ] Have an authorized owner/legal reviewer approve the production privacy policy; this pack is not legal advice.
- [ ] Replace the current public GitHub issue tracker privacy contact with a private support email or private request form before broad release.
- [ ] Verify the privacy policy is public, active, non-PDF, non-geofenced, and readable while signed out.
- [ ] Verify the same policy is linked from the signed app and the Play listing.
- [ ] Complete [DATA_SAFETY_INVENTORY_DRAFT.md](DATA_SAFETY_INVENTORY_DRAFT.md) from the final AAB, backend, SDK list, vendors, logs, support tools, analytics, and billing implementation.
- [ ] Complete the Data safety form; closed/open/production releases require it. Internal-only apps have different form timing, but preparing it early prevents drift.
- [ ] Complete the Health Apps declaration with every user-visible category, including fitness, nutrition/weight, sleep, and any stress-management functionality actually shipped.
- [ ] Copy only the final-package Health Connect permissions and justifications from [HEALTH_APPS_AND_HEALTH_CONNECT.md](HEALTH_APPS_AND_HEALTH_CONNECT.md).
- [ ] Include the non-medical disclaimer in the listing and in-app where required; do not make diagnostic, treatment, cure, prevention, guaranteed-outcome, or unsupported performance claims.
- [ ] Declare ads accurately. Current native source has no ad SDK, but the final artifact and remote content must be checked.
- [ ] Complete target audience, content rating, app access, account deletion, government/news/COVID declarations, and every other App content item shown by the live Console.
- [ ] Enter the external deletion URL: [https://irondeskpro.lovable.app/account-deletion](https://irondeskpro.lovable.app/account-deletion).
- [ ] Test account deletion from the app and from a signed-out browser; verify sessions/device tokens become unusable and active user-owned rows disappear.

Official references: [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en), [Health Apps declaration](https://support.google.com/googleplay/android-developer/answer/14738291?hl=en), [Health Content and Services policy](https://support.google.com/googleplay/android-developer/answer/16679511?hl=en), [Health Connect publishing](https://developer.android.com/health-and-fitness/health-connect/publish), [account deletion](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en), and [prepare an app for review](https://support.google.com/googleplay/android-developer/answer/9859455?hl=en).

### 3. Store presence and reviewer access

- [ ] Freeze the claims in [STORE_LISTING_DRAFT.md](STORE_LISTING_DRAFT.md) against the final candidate; delete any feature not demonstrably present.
- [ ] Create a 512×512 Play icon and 1024×500 feature graphic that match the production brand.
- [ ] Capture at least two compliant phone screenshots; the recommended set is six screenshots showing the real production build and no personal/health data.
- [ ] Verify every screenshot and caption represents a real reachable state in the submitted artifact.
- [ ] Provide a monitored support email and public website.
- [ ] Create a dedicated, durable review account; pre-confirm its email, remove OTP/MFA dependence, grant access to every paid/restricted feature, and do not reuse a personal account.
- [ ] Test [REVIEWER_ACCESS.md](REVIEWER_ACCESS.md) from a clean device and clean browser with someone who did not write the instructions.
- [ ] Record a short review video demonstrating sign-in, Health Connect rationale, partial permission grant, preview, manual sync, web-side result, unlink/revoke, privacy policy, and deletion path. Do not expose real user data or secrets.

Official asset requirements: [Add preview assets](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en).

### 4. Testing and production readiness

- [ ] Complete the internal round in [CLOSED_BETA_PLAN.md](CLOSED_BETA_PLAN.md).
- [ ] Resolve every pre-launch report, automated check, policy warning, crash, ANR, security finding, and device incompatibility or document an approved disposition.
- [ ] Complete a closed beta with representative Android versions, vendors, Health Connect states, network states, account states, and upgrade paths.
- [ ] If the live account remains a qualifying new personal account, satisfy the current minimum tester/continuous-days requirement before applying for production access. This does not replace the organization-account gate for the intended health product.
- [ ] Prove the critical path: install → sign in/onboard → start workout → log sets → interrupt/resume → finish → reopen history → sync/retry → export/delete.
- [ ] Prove the Health Connect path: pair/authenticate → select types → partial grant → preview → sync → verify server result → duplicate sync → offline retry → revoke/unlink.
- [ ] Confirm no P0/P1 defects, no cross-account access, no lost completed workout, no duplicate set/session caused by retry, and no plaintext credential/health payload.
- [ ] Confirm support, privacy incident, rollback, key-compromise, and account-recovery owners are available for launch.

Official testing guidance: [new personal-account testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en) and [Health Connect test cases](https://developer.android.com/health-and-fitness/health-connect/test/test-cases).

### 5. Controlled release

- [ ] Turn on managed publishing before sending the production package and listing for review.
- [ ] Restrict the first production release to the owner-approved launch countries. A first production release is not percentage-staged; it reaches all eligible users in the selected countries when published.
- [ ] Submit only the exact tested AAB and matching declarations/listing.
- [ ] After approval, recheck the live listing, privacy/deletion links, device catalog, country list, prices/subscriptions, and review notes before selecting **Publish changes**.
- [ ] Record the exact production timestamp, Play release ID, version code/name, AAB hash, source commit, and approver.
- [ ] Monitor Android vitals, authentication, workout-write failures, duplicate rates, Health Connect sync/retry/revoke outcomes, deletion failures, billing entitlement issues (if shipped), ratings, and support.
- [ ] Use a higher version code for every corrective build; never replace a distributed artifact under the same filename/hash.

Official release guidance: [prepare and roll out a release](https://support.google.com/googleplay/android-developer/answer/9859348?hl=en) and [managed publishing](https://support.google.com/googleplay/android-developer/answer/9859654?hl=en).

## Global stop-ship conditions

Stop the release immediately if any of the following is true:

- Product scope or package identity is unresolved.
- `com.irondesk.app` registration/claim status or eligible-key ownership is unresolved, or the owner has not approved the required challenge/request.
- Developer legal/account identity is unverified or inconsistent.
- The final AAB is unsigned, debug-signed, built from an unknown commit, or differs from the tested candidate.
- An upload/signing key is missing, exposed, unbacked-up, or uncontrolled.
- A release endpoint is preview, localhost, plain HTTP, unknown, or secret-bearing.
- The app requests a permission absent from the approved declaration or claims a feature absent from the artifact.
- Any account can read/write another account's records.
- A workout, set, health import, or purchase can be silently lost or duplicated on retry.
- Health data, passwords, tokens, pairing codes, or raw personal records appear in logs/analytics/crash reports.
- Privacy, Data safety, Health Apps, in-app rationale, store copy, and real behavior disagree.
- Reviewer credentials fail, require a live OTP, expire, or cannot reach all restricted features.
- Account deletion, device revocation, or subscription cancellation instructions are broken.
- There is any unresolved P0/P1 defect or material Play policy warning.

## Updating this pack

Before each release:

1. Replace the evidence snapshot commit/date.
2. Reinspect the final Android project and merged manifest.
3. Re-run the dependency/SDK, data-flow, backend/vendor, and billing inventory.
4. Reconcile the privacy policy, Data safety answers, Health Apps form, per-permission justifications, store copy, screenshots, reviewer instructions, and actual app behavior.
5. Preserve the completed copy with the release ticket; do not silently rewrite historical release evidence.
