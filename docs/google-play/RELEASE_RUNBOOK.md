# Google Play release runbook

Status: **RUNBOOK TEMPLATE — NO RELEASE IS AUTHORIZED BY THIS FILE**

This runbook separates preparation, reversible testing, review submission, and publication. The release manager must stop at every approval gate. Never upload or submit an artifact simply because a build succeeds.

## Roles

Record named owners in the private release ticket, not personal contact details in this repository.

| Role | Responsibility | Assigned |
| --- | --- | --- |
| Account owner | Legal/Play account verification, permissions, organization/payments profile | `[OWNER INPUT REQUIRED]` |
| Release manager | Coordinates gates, Play changes, evidence, and go/no-go | `[OWNER INPUT REQUIRED]` |
| Android engineer | Builds/signs/inspects the candidate | `[OWNER INPUT REQUIRED]` |
| Backend engineer | Production endpoint, database/RLS, deletion, device and billing verification | `[OWNER INPUT REQUIRED]` |
| Privacy/legal reviewer | Privacy, Data safety, Health Apps, health claims, retention, contracts | `[OWNER INPUT REQUIRED]` |
| QA lead | Device matrix, beta, regression and release-candidate evidence | `[OWNER INPUT REQUIRED]` |
| Support/incident owner | Reviewer account, launch support, privacy/security escalation | `[OWNER INPUT REQUIRED]` |
| Publisher | Person authorized to click Send for review / Publish changes | `[OWNER INPUT REQUIRED]` |

## Release record

Create one private release ticket and fill every field before upload.

| Field | Value |
| --- | --- |
| Product scope | `[U — unified / C — companion]` |
| Play app name | `[OWNER INPUT REQUIRED]` |
| Package | `[OWNER INPUT REQUIRED]` |
| Android developer verification registration | `[OWNER INPUT REQUIRED — STATUS + PRIVATE EVIDENCE]` |
| Eligible certificate fingerprints | `[PRIVATE RECORD LINK — DO NOT COPY VALUES HERE]` |
| Version name | `[OWNER INPUT REQUIRED]` |
| Version code | `[OWNER INPUT REQUIRED]` |
| Git remote/repository | `[VERIFY]` |
| Source commit | `[40-CHAR SHA]` |
| Branch/tag | `[VERIFY]` |
| AAB filename | `[VERSIONED NAME]` |
| AAB SHA-256 | `[HASH]` |
| Upload certificate SHA-256 | `[PRIVATE RELEASE EVIDENCE]` |
| Play app-signing certificate SHA-256 | `[PRIVATE RELEASE EVIDENCE]` |
| Build/CI URL | `[LINK]` |
| Production service origin | `https://irondeskpro.lovable.app` unless an approved migration is documented |
| Database/backend release | `[MIGRATION/DEPLOYMENT EVIDENCE]` |
| Privacy/Data safety/Health Apps approval | `[LINKS]` |
| Internal/closed/RC test evidence | `[LINKS]` |
| Reviewer-account rehearsal | `[PRIVATE LINK]` |
| Target countries | `[OWNER INPUT REQUIRED]` |
| Managed publishing | `[ON/OFF — SHOULD BE ON FOR PRODUCTION REVIEW]` |
| Go-live window/timezone | `[OWNER INPUT REQUIRED]` |
| Go/no-go approvers | `[OWNER INPUT REQUIRED]` |

## Phase 0A — account and identity gate

Do not create a Play store app or reserve its listing package during this phase. Android developer verification inspection/registration is handled separately in Phase 0B and still requires the stated owner approvals.

1. Open Play Console as the verified account owner.
2. Confirm the current account state. A read-only inspection on 2026-08-31 showed:
   - account type: **Personal**;
   - **Change account type** disabled;
   - no organization website entered;
   - Console guidance requires an organization website to be provided and verified before changing account type.
3. Establish the owner-approved organization website. Prefer a company-controlled custom domain if one exists. The product currently runs at `https://irondeskpro.lovable.app`, but the owner must confirm whether that URL can satisfy the current organization-site ownership verification.
4. Verify the organization website through the mechanism requested by the current Console.
5. Complete the current personal-to-organization conversion flow, organization payments profile, identity verification, D-U-N-S match, official phone, and public/private developer details.
6. Do not put D-U-N-S documents, addresses, phone numbers, account recovery details, payment records, or identity documents in Git.
7. Wait for Play to show the Organization account as verified and clear every dashboard task. Current conversion guidance recommends waiting at least 72 hours after the transition completes before submitting a new app; recheck the live guidance at execution time.
8. Save only a private evidence link and status in the release ticket.

Official sources: [Play Console requirements](https://support.google.com/googleplay/android-developer/answer/10788890?hl=en), [choose account type](https://support.google.com/googleplay/android-developer/answer/13634885?hl=en), [conversion guidance](https://support.google.com/googleplay/android-developer/answer/16260648?hl=en).

**Gate A1:** verified Organization account, owner-approved website, legal identity and payments profile agree.

## Phase 0B — urgent Android developer verification gate

A read-only inspection on 2026-08-31 found no registered package names and showed **Register package name**. Current Play guidance sets September 30, 2026 as the package-registration deadline and says unregistered Play apps can be removed from Google Play. Treat this as urgent, but never treat urgency as permission to submit a challenge.

1. Obtain dated owner authorization to investigate the existing `com.irondesk.app` package claim before creating a Play app.
2. In **Android developer verification → Package names**, enter `com.irondesk.app` only far enough to expose the package and eligible-key result.
3. Privately record every eligible SHA-256 certificate fingerprint shown by Play. Do not commit full fingerprints or key material.
4. Compare those fingerprints with controlled historical artifact/key records. The examined 0.5.0 and 0.9.0 releases have split debug-signing lineage, so eligibility and private-key custody must both be proven.
5. **STOP before submitting** an ownership challenge, proof APK, ineligible-key request, rationale, or final registration. Present the eligibility and custody evidence to the owner.
6. Continue only with dated owner approval and a demonstrably controlled eligible private key. If no controlled key is eligible, escalate the request-versus-new-package decision; do not improvise a proof artifact or reuse a debug key.
7. Inventory `app.irondesk.health`, all other outside-Play IronDesk packages, and additional signing keys. Keep the companion and unified identities distinct and obtain separate approval for each registration.
8. After any approved registration, save the Console status and package/key evidence privately.

Official sources: [registering Play package names](https://support.google.com/googleplay/android-developer/answer/16984799?hl=en), [registering Android package names](https://support.google.com/googleplay/android-developer/answer/16761053?hl=en), and [selecting a key for an existing package](https://support.google.com/googleplay/android-developer/answer/16762143?hl=en).

**Gate A2:** owner-approved `com.irondesk.app` claim/registration decision, eligible fingerprints and key custody recorded privately, and any approved verification action complete. No challenge/request may be submitted on draft documentation alone.

## Phase 1 — product/package/signing decision

1. Confirm Gates A1 and A2 are complete, then choose **Scope U** or **Scope C** in the release ticket.
2. Check package availability and any “eligible key”/developer verification screen in the live Console before reservation.
3. Treat the identities as distinct:
   - `app.irondesk.health` is the current Health Connect companion.
   - `com.irondesk.app` is a historical full-app namespace, but audited releases were debug-signed and the signing lineage is split: the examined 0.9.0 local debug key differs from 0.5.0.
4. Do not assume an old debug-signed package can become a safe upgrade path. If preserving `com.irondesk.app` is proposed, require Play Console eligibility evidence and an explicit migration decision; otherwise select a new permanent unified package.
5. Create a new protected **upload key** for the final Play package and enroll in **Play App Signing** after the owner approves the package. Do not reuse a debug key.
6. Store the upload keystore/password and recovery material in the approved secret store with at least two controlled recovery owners. Never commit or paste them into tickets/logs.
7. Record upload-certificate and Play app-signing certificate fingerprints privately.
8. Decide versioning. Version codes must strictly increase and must never be reused.

**Gate B:** package is owner-approved and available/eligible; upload key is protected/backed up; Play App Signing plan is approved; no ambiguous upgrade claim remains.

## Phase 2 — implementation freeze

### Scope U

Current source has no production-capable unified Android project. The tracked `mobile-android/` module is deliberately sample-only and cannot build a release artifact. Before release:

- implement the unified Android app in a tracked project;
- integrate Health Connect under the final package;
- implement secure native auth/session storage;
- implement and prove durable/idempotent workout writes and interruption recovery;
- implement Android Back, process-death restore, file import/export, app links/auth callback, and accessibility;
- add Play Billing/backend entitlements only if the owner approves monetization;
- keep server-authoritative program and entitlement rules;
- update the privacy/Data safety/Health Apps/store/reviewer documents for the final behavior.

### Scope C

Use `android-health-connect/` only. Current expected metadata is:

- package `app.irondesk.health`;
- version `1.1.0-beta.1` / code `11001`;
- min SDK 28, target/compile SDK 36;
- endpoint `https://irondeskpro.lovable.app`;
- read-only selected Health Connect types;
- release signing intentionally absent from source.

Confirm these against the intended release ticket; do not change them casually to make a build pass.

### Common freeze checks

- Merge all intended source/backend/privacy changes.
- Deploy and verify the exact production backend/migrations before final mobile testing.
- Freeze dependencies and generate a dependency/SBOM record.
- Resolve secret scanning, dependency, static analysis, lint, typecheck, unit/integration, and backend tests.
- Pin the release commit and tag/branch according to the repository release process.
- Do not amend/rebase published Lovable-connected history.

**Gate C:** intended implementation is complete; no unreviewed change is pending; release commit and production backend are pinned.

## Phase 3 — clean verification build

Run from a clean checkout/worktree at the exact release commit. Use approved Java/Android tooling and capture versions.

Example for the existing companion:

```powershell
$androidProject = Join-Path (Get-Location) 'android-health-connect'
Set-Location -LiteralPath $androidProject
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
.\gradlew.bat --no-daemon clean lintDebug testDebugUnitTest assembleDebug assembleRelease bundleRelease
```

For the final project, use its approved tasks and run at least:

- unit/integration tests;
- release lint;
- release bundle build;
- instrumentation/UI tests where present;
- backend contract tests;
- dependency and secret scans.

The unconfigured `bundleRelease` output may be unsigned. A successful unsigned build is verification evidence, not a distributable release.

**Gate D:** all required checks pass at the exact commit; failures are fixed or have an explicit non-P0/P1 approved disposition.

## Phase 4 — protected signed AAB

1. Use the authorized protected build environment.
2. Retrieve the upload key without printing secrets.
3. Build the signed release AAB once.
4. Copy it to a controlled release staging directory with a unique versioned filename.
5. Hash it immediately:

```powershell
$releaseBundle = '[ABSOLUTE PATH TO SIGNED AAB]'
Get-FileHash -LiteralPath $releaseBundle -Algorithm SHA256
```

6. Verify the AAB signature with the approved JDK tooling:

```powershell
$releaseBundle = '[ABSOLUTE PATH TO SIGNED AAB]'
& jarsigner -verify -verbose -certs $releaseBundle
```

7. Record the upload certificate fingerprint without publishing unnecessary full fingerprints in public documentation.
8. Use Android Studio APK Analyzer and/or an approved `bundletool` flow to generate device APKs and inspect the merged manifest/resources/classes from this exact AAB.
9. Verify:
   - package, version code/name, min/target SDK;
   - only approved permissions/components/queries/features;
   - production HTTPS hosts only;
   - no preview/localhost/plain-HTTP endpoint;
   - no key, token, password, service-account JSON, private URL, or debug certificate;
   - no unexpected analytics, ads, attribution, billing, social, location, camera, microphone, contact, storage, accessibility, VPN, or background service;
   - app name/icon/theme/rationale/privacy links;
   - native library ABI/device coverage;
   - dependency/SBOM matches the reviewed lockfiles.

10. Place the signed AAB in immutable/restricted release storage. Never replace its bytes under the same name or claim a new hash for the same artifact.

**Gate E:** exact signed AAB is fully inspected, hashed, traceable, and contains no discrepancy.

## Phase 5 — final policy/listing reconciliation

1. Re-run [DATA_SAFETY_INVENTORY_DRAFT.md](DATA_SAFETY_INVENTORY_DRAFT.md) against the signed AAB, backend, vendors/logs/support and billing.
2. Re-run [HEALTH_APPS_AND_HEALTH_CONNECT.md](HEALTH_APPS_AND_HEALTH_CONNECT.md) against the merged manifest and runtime behavior.
3. Freeze [STORE_LISTING_DRAFT.md](STORE_LISTING_DRAFT.md) to only verified features.
4. Test [REVIEWER_ACCESS.md](REVIEWER_ACCESS.md) from a clean device/browser.
5. Verify the public pages while signed out:
   - [https://irondeskpro.lovable.app/privacy](https://irondeskpro.lovable.app/privacy)
   - [https://irondeskpro.lovable.app/account-deletion](https://irondeskpro.lovable.app/account-deletion)
6. Replace the privacy page's public GitHub issue contact with the owner-approved private support route before production.
7. Complete and cross-check live Console items:
   - privacy policy;
   - ads;
   - sign-in/app access;
   - target audience and content;
   - content rating;
   - Data safety and data deletion;
   - Health Apps categories and Health Connect data types;
   - any sensitive-permission form triggered by the exact bundle;
   - app category, contact information, countries and pricing;
   - any other current Dashboard/App content task.
8. Have product, engineering, privacy/legal and release owners sign off.

**Gate F:** artifact, runtime, privacy, Play forms, store assets, reviewer access, and health claims all say the same thing.

## Phase 6 — internal testing

1. Create the Play app only after Gates A1, A2 and B–F plus owner approval.
2. Turn on Play App Signing with the approved identity and save private evidence.
3. Upload the exact signed AAB hash to **Internal testing**.
4. Add trusted tester list; do not use production countries/visibility as a shortcut.
5. Install from the Play opt-in path on clean devices.
6. Complete the internal smoke suite in [CLOSED_BETA_PLAN.md](CLOSED_BETA_PLAN.md).
7. Review pre-launch report, Android vitals, device catalog, permission/policy warnings and App Bundle Explorer details.
8. If a defect requires code change, increase version code, rebuild/reinspect a new AAB, and repeat from Phase 3. Do not silently swap artifacts.

**Gate G:** no open P0/P1; internal critical flows and required pre-launch checks pass.

## Phase 7 — closed testing

1. Complete all setup and app-content forms required to start the closed track.
2. Upload/promote the exact approved candidate according to Play's track behavior; verify the artifact hash/version in App Bundle Explorer.
3. Recruit representative testers and maintain the owner-approved buffer.
4. Run the complete closed-beta matrix for at least the approved duration.
5. Track opt-in continuity and substantive participation separately.
6. Triage feedback privately; do not collect raw health data/secrets.
7. For every new build, repeat Phases 3–7 with a higher version code.
8. Complete the release-candidate soak on the exact artifact intended for production.
9. If the Dashboard requires a production-access application, answer it from retained evidence, not estimates.

**Gate H:** closed test/production-access requirements are satisfied; exact RC passes; no open P0/P1 or policy discrepancy.

## Phase 8 — production review preparation

1. Turn on **Managed publishing** before production submission.
2. Set only owner-approved first-launch countries. Remember: the first production release has no percentage-staged rollout; publishing makes it available to all eligible users in selected countries.
3. Verify free/paid choice. If starting free, current Play rules do not allow that listing later to become a paid-download app; subscriptions/IAP are a separate model.
4. Verify pricing/subscriptions only if Play Billing and backend entitlements passed the full test suite.
5. Upload/promote only the exact tested RC.
6. Add final release notes with no unsupported claim.
7. Review Publishing overview for every pending change: artifact, listing, countries, pricing, declarations, access, category and contact.
8. Take private screenshots/export of the final form values and change set.
9. Conduct formal go/no-go with all approvers.

**Gate I — authority required:** the publisher has explicit approval to select **Send for review**.

## Phase 9 — submit for review

Only the authorized publisher performs this phase.

1. Confirm managed publishing is on.
2. Confirm the review account works immediately before submission.
3. Confirm production service/support/incident owners are on call.
4. Select **Send for review**.
5. Record submission timestamp, Play change set, release/version, reviewers and evidence.
6. Do not add unrelated changes while review is in progress; additional changes can alter review timing.
7. Respond to review questions with the exact artifact/data flow and update the appropriate form/code rather than arguing from intent.
8. A rejection returns the release to the appropriate earlier phase. Any changed AAB gets a higher version code and full regression.

Review may take up to seven days or longer in exceptional cases; plan at least a week. Official reference: [Managed publishing](https://support.google.com/googleplay/android-developer/answer/9859654?hl=en).

## Phase 10 — approve and publish

Approval is not automatic authorization to launch.

1. When Play shows every intended item **Ready to publish**, rerun a production-readiness check:
   - production origin and health/deletion endpoints healthy;
   - reviewer/support account healthy;
   - policy/privacy/deletion links live;
   - country and price lists exact;
   - no new P0/P1 or security incident;
   - support/incident/rollback owners ready.
2. Conduct final go/no-go.
3. Only the authorized publisher selects **Publish changes**.
4. Record exact publish timestamp and Play status.
5. Install from the public listing with a non-team account/device in a launch country.
6. Verify listing, app identity/version, sign-in, core workout, Health Connect rationale, privacy/deletion links, support email, and any purchase path.
7. Preserve production screenshots and content checks as evidence.

**Gate J:** live content and installed binary match the approved release.

## Phase 11 — monitoring and rollback

Monitor immediately, hourly during the launch window, daily during the first week, and at the owner-approved cadence thereafter:

- Play availability/listing correctness;
- installs/update failures/device exclusions;
- crash-free users and ANR-free sessions;
- authentication/signup/reset failures;
- workout write/finish/resume failures and duplicate/loss alerts;
- Health Connect pair/permission/sync/duplicate/retry/revoke/unlink outcomes without raw payload logging;
- account-deletion failures;
- cross-account authorization/security alerts;
- billing purchase/acknowledgment/entitlement/refund issues if shipped;
- support volume, ratings and policy notifications.

Rollback/containment actions depend on severity:

1. For P0, stop promotion, use the incident process, revoke compromised credentials/tokens/keys where necessary, protect users, and preserve non-sensitive evidence.
2. For a bad update, halt staged rollout where available. The first release cannot be percentage-staged; use Play controls/support and a rapid higher-version fix as appropriate.
3. Disable a vulnerable server feature through an already-approved server-side control only if it is safe and does not create a privacy/policy mismatch.
4. Do not delete audit evidence or overwrite the distributed artifact.
5. Build a fix with a higher version code, repeat all affected and regression gates, update declarations/listing if behavior changed, and submit normally.
6. After resolution, document cause, affected scope, containment, verification, and prevention in the private incident/release record.

Immediate stop/contain triggers include cross-account data, plaintext sensitive data, compromised signing/upload credentials, wrong backend, lost/duplicated workout writes, unauthorized health transfer, broken deletion/revocation, or incorrect billing entitlement.

## Release completion record

| Completion item | Value |
| --- | --- |
| Public Play URL | `[URL]` |
| Live version name/code | `[VALUE]` |
| Source commit | `[SHA]` |
| AAB SHA-256 | `[HASH]` |
| Publish timestamp/timezone | `[VALUE]` |
| Countries | `[VALUE]` |
| Post-publish smoke evidence | `[LINK]` |
| 24-hour health report | `[LINK]` |
| 7-day review | `[LINK]` |
| Known low-risk issues | `[LINK/NONE]` |
| Final release manager sign-off | `[OWNER + DATE]` |
