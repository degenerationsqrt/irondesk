# IronDesk internal and closed-beta plan

Status: **DRAFT — START ONLY AFTER A SIGNED PLAY-TRACK AAB AND OWNER APPROVAL**

The beta proves that IronDesk preserves an athlete's work and privacy under real Android conditions. It is not a marketing preview. No production-access application or public claim should be made from source tests alone.

## Objectives

The beta must answer:

1. Can a new user install, authenticate, onboard, start a real workout, log every set, finish, and find the exact session in history?
2. Does the active workout survive screen lock, backgrounding, rotation, process death, poor connectivity, and an app update without silent loss or duplication?
3. Are program, workout, recovery, nutrition, progress, import/export, and device states understandable on common phones?
4. Can a user grant only part of the Health Connect request and still use the rest of the app?
5. Does manual Health Connect sync produce correct, deduplicated, account-scoped data and recover safely from failure?
6. Can a user revoke device access and permanently delete the account without support intervention?
7. Do privacy disclosures, Play declarations, screenshots, reviewer instructions, and actual behavior agree?
8. Is support able to diagnose failures without requesting or logging raw health data, passwords, tokens, or pairing codes?

## Scope prerequisites

- [ ] Owner chose unified Scope U or companion Scope C.
- [ ] Final package identity and signing lineage are approved.
- [ ] Play developer organization/account gate is complete or the test is explicitly an internal engineering test that will not proceed to health-app submission.
- [ ] AAB is built from a pinned clean commit, signed with the protected upload key, and uploaded to Play internal testing.
- [ ] Artifact hash, version, package, SDK levels, certificate, permissions, endpoints, and dependencies are recorded.
- [ ] Privacy policy and deletion URL load while signed out:
  - [https://irondeskpro.lovable.app/privacy](https://irondeskpro.lovable.app/privacy)
  - [https://irondeskpro.lovable.app/account-deletion](https://irondeskpro.lovable.app/account-deletion)
- [ ] Dedicated beta support and privacy incident paths are monitored.
- [ ] Synthetic test accounts and test Health Connect records are available.
- [ ] Testers have consented to the test instructions and know not to place sensitive records in feedback.

## Cohorts and timing

Suggested operating plan; the release owner can tighten it but must not waive critical evidence.

| Round | Testers | Duration | Purpose | Exit gate |
| --- | ---: | ---: | --- | --- |
| Internal smoke | 5–10 trusted testers | 3–5 days | Install/signing, authentication, core workout, basic Health Connect, deletion, obvious crashes | All P0/P1 fixed; critical flows pass on at least one Android 13-or-lower and one Android 14+ device |
| Closed beta | 20–30 testers invited, with a buffer above any live Console minimum | At least 14 continuous days | Representative devices, repeated workouts, sync/retry/revoke, usability, retention, support | No open P0/P1; acceptance metrics and full matrix pass |
| Release-candidate soak | 10–20 stable testers on the exact candidate | 7 days without code/config drift | Prove exact AAB/backend/declarations before production | No stop-ship event; sign-offs complete |

If the live account is subject to the current new-personal-account production-access rule, Google currently requires at least 12 opted-in closed testers continuously for 14 days. The account is presently Personal but the intended health-app submission has a separate Organization-account gate. Check the Dashboard rather than assuming that conversion removes or preserves a testing requirement. Official reference: [personal-account testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en).

## Tester recruitment and privacy

Recruit a useful mix rather than only developers:

- strength-training beginners, intermediate users, and experienced lifters;
- users who follow programs and users who build custom sessions;
- Health Connect users and non-users;
- Samsung Health, Fitbit/Pixel, and other source-app users only where interoperability is actually advertised;
- metric and imperial users;
- reliable and unreliable network conditions;
- accessibility users, including larger font/display scaling and TalkBack where possible;
- no child testers unless the target-audience/legal/product decision explicitly includes children and all applicable requirements are complete.

Tester privacy rules:

- Prefer synthetic/test Health Connect records for scripted cases.
- Do not request screenshots containing email, date of birth, health values, workout notes, pairing codes, tokens, or private notifications.
- Ask for timestamps, app version, device model/OS, action taken, expected/actual result, and a redacted screenshot/video.
- Use a private issue intake, not the public GitHub issue tracker, for account, health, or security reports.
- Never ask for a password, access token, pairing code, database row, or raw Health Connect export.

## Device and state matrix

Record model, Android version/API, security-patch date, Health Connect version/provider, display/font scale, install source, app version, and result.

| Dimension | Minimum coverage |
| --- | --- |
| Android versions | Android 9/API 28 minimum-install smoke; Android 13 or lower with separate Health Connect app; Android 14+ framework Health Connect; Android 16/API 36 behavior |
| Vendors | Pixel/Google, Samsung, Motorola or another materially different OEM |
| Form factors | Small phone, common phone, large phone; tablet only if Play distribution includes tablets |
| Install state | Clean install, reinstall, update from preceding signed beta, update with active workout/pending sync |
| Account state | New, existing populated, password-reset, expired session, signed-out, deleted |
| Network state | Online, slow/intermittent, airplane mode, disconnect during write/sync, reconnect and retry |
| Health Connect state | Absent/update required, available/empty, selected data present, partial grant, revoked, history supported/unsupported |
| Units/time | Metric, imperial, DST boundary, non-UTC timezone, travel/timezone change |
| Accessibility | TalkBack basics, 200% font/display where practical, color/contrast, touch targets, one-handed workout entry |

Health Connect is supported on Android 9/API 28+ devices with Google Play services; on Android 14+ it is part of the framework, while Android 13 and lower use the Play-distributed provider. Confirm current platform guidance before test: [Health Connect availability](https://developer.android.com/health-and-fitness/health-connect/availability).

## Critical test suites

### A. Install, identity, and account

- [ ] Play internal/closed opt-in link opens the correct package and developer identity.
- [ ] Clean install has correct name/icon/version and no debug/prototype marker.
- [ ] Sign-up validates name/email/password and handles email confirmation honestly.
- [ ] Dedicated reviewer account signs in without OTP/MFA or owner intervention.
- [ ] Password reset link works end to end.
- [ ] Expired/revoked sessions return to sign-in without exposing data.
- [ ] Signing into account A never displays account B's data, including cached screens after sign-out.
- [ ] Demo/sample mode is clearly labeled and never writes to a real account.
- [ ] Profile, units, goals, equipment, and privacy preferences persist correctly.

### B. Core workout lifecycle — Scope U

- [ ] Start an assigned program workout.
- [ ] Start an IronDesk Original/library workout.
- [ ] Build/save/start a custom or blank workout if advertised.
- [ ] Log weight, reps, RPE, completion, rest, notes, substitution, add/remove set, and add exercise.
- [ ] Verify unit conversion: display changes, canonical values stay consistent, and round trips do not drift.
- [ ] Background/foreground during a set and during rest timer.
- [ ] Lock/unlock the phone.
- [ ] Rotate/change display scale.
- [ ] Kill/relaunch the process with an active session.
- [ ] Lose network before a write, during a write, and after the server commits but before the client receives success.
- [ ] Retry without duplicating a session, exercise, or set.
- [ ] Finish once; verify summary, history, progress, program advancement, and no duplicate completion.
- [ ] Cancel path requires deliberate confirmation and has the documented data result.
- [ ] Update the app with an active session; verify state recovery and schema compatibility.

If Scope U cannot preserve the user's completed input through these interruptions, public release remains blocked. The current web code says sessions save as the user logs and can be resumed, but this must be proven in the Android runtime; no durable offline workout queue is currently evidenced by the tracked Android companion.

### C. History, progress, recovery, and nutrition — Scope U

- [ ] History filters and detail reflect the completed session exactly.
- [ ] Volume, sets, reps, estimated strength, PRs, and load use only evidenced data.
- [ ] Empty states do not show sample values as live athlete data.
- [ ] Recovery distinguishes missing, manual, sample, and Health Connect-derived values.
- [ ] Manual recovery/bodyweight values are not overwritten by device sync.
- [ ] Nutrition, meals, macros, hydration, and targets persist if advertised.
- [ ] Deterministic coaching is labeled accurately; ask-box behavior does not imply a live AI response.
- [ ] Medical, injury-risk, calorie, recovery, and readiness language remains general and non-diagnostic.

### D. Health Connect — both scopes when included

- [ ] Health Connect absent, update-required, available-but-empty, and available-with-data states.
- [ ] Launch from app icon and Health Connect onboarding surface on both pre-14 and 14+ paths.
- [ ] Rationale screen and public policy link work before a grant.
- [ ] Select one type and grant only that type.
- [ ] Select two types, grant one, deny one; preview/sync only the authorized type and identify the skipped type.
- [ ] Cancel permission request twice and provide a clear path to system Health Connect settings.
- [ ] Revoke permission in system settings, return to the app, refresh state, and avoid crash/stale access.
- [ ] Test default-on types and optional Distance default-off behavior.
- [ ] Read 7 and 30 days without history permission.
- [ ] Test 90/365 days with history supported+granted, supported+denied, and unsupported; the effective range must be honest.
- [ ] Preview counts/totals match the synthetic source within documented aggregation rules.
- [ ] Nothing leaves the device before **Sync now** or explicit system-file export.
- [ ] Sync maps sleep/RHR/HRV/weight/activity records to the correct account and day/timezone.
- [ ] Repeat the exact payload; no duplicate normalized record or derived row.
- [ ] Disconnect during sync; exactly one encrypted outbox entry is queued, then drained by a later manual retry.
- [ ] Force-stop/relaunch retains valid pairing without exposing plaintext token/outbox.
- [ ] Server-side unlink rejects the old token.
- [ ] Local-only forget clearly warns about and preserves the remotely removable link.
- [ ] Account deletion revokes device access.

The existing companion's complete matrix is in [`android-health-connect/docs/RELEASE_CHECKLIST.md`](../../android-health-connect/docs/RELEASE_CHECKLIST.md).

### E. Imports, exports, and files — Scope U

- [ ] Valid FIT, TCX, GPX, CSV, JSON, and ZIP examples stay within documented limits and preview before commit.
- [ ] Invalid extension/MIME/magic bytes, oversized input, ZIP traversal/bomb, malformed XML/JSON/CSV, and too many records fail safely.
- [ ] Reimport deduplicates.
- [ ] File-import rollback removes only that batch.
- [ ] Original file content and GPX route geometry are not uploaded/retained if the product continues to make that claim.
- [ ] TCX export contains no fabricated GPS data and opens through an Android-supported share/save path.
- [ ] File names or records with private content do not leak into logs or screenshots.

### F. Privacy, security, and deletion

- [ ] Privacy policy loads signed out in an ordinary browser and in the app.
- [ ] Privacy contact is private and monitored.
- [ ] Data safety and Health Apps drafts match runtime traffic/permissions.
- [ ] Merged manifest has no unexpected permission, component, SDK, host, or cleartext traffic.
- [ ] Logs/crash reports redact password, session/access/refresh token, pairing code, device token, health payload, account email, free-form notes, and raw import content.
- [ ] Unlink/revocation and sign-out clear the intended local state.
- [ ] In-app deletion requires reauthentication and exact confirmation.
- [ ] Successful deletion signs out, makes the old session/token unusable, removes active user-owned data, and leaves no cross-account artifact.
- [ ] External deletion URL works without the app installed.
- [ ] Retained backups/security/support records match the approved privacy language.

### G. Billing — only if implemented

No billing implementation exists today. If billing is added, append and execute a separate suite before release:

- [ ] Play test products/subscriptions only; no real tester charge.
- [ ] New purchase, pending, canceled, renewed, expired, grace period, account hold, refunded, revoked, upgrade/downgrade, restore, and family/device changes.
- [ ] Backend verifies purchase tokens and owns entitlement state.
- [ ] Client callback alone never grants durable entitlement.
- [ ] Reviewer account has full access without purchase.
- [ ] Cancellation/deletion instructions explain subscription handling accurately.
- [ ] Data safety, privacy, store copy, countries/tax/price, and support/refund procedures are updated.

## Severity and response

| Severity | Definition | Examples | Required response |
| --- | --- | --- | --- |
| **P0 — critical** | Active privacy/security/data-integrity harm or unrecoverable release failure | Cross-account access, plaintext secret/health data, wrong production account, malicious code, irreversible mass deletion | Halt testing/distribution; revoke access/keys as needed; incident process; preserve non-sensitive evidence |
| **P1 — high** | Critical user journey broken or silent user-data loss/duplication | Lost/duplicate workout, unusable sign-in, broken deletion/revocation, billing grants wrong access, Health Connect uploads without action | Stop promotion; fix; higher version code; rerun entire affected and regression suites |
| **P2 — medium** | Material function/UX problem with safe workaround | One device layout blocks a secondary feature, clear recoverable sync error, inaccurate non-critical copy | Fix before production unless owner documents risk acceptance |
| **P3 — low** | Cosmetic/minor friction | Spacing, non-blocking wording, small visual defect | Track and prioritize; does not waive policy/accuracy issue |

Any policy mismatch is at least P1 for release purposes, even if the UI still works.

## Suggested release thresholds

These are proposed internal gates, not claims about industry norms. The owner must approve or replace them before testing.

- 0 open P0 or P1 defects.
- 100% pass on install/auth/core workout/history/deletion for required device matrix.
- 100% pass on pair/permission/preview/sync/dedupe/retry/revoke for devices on which Health Connect is supported and advertised.
- 0 confirmed lost completed workouts.
- 0 cross-account results.
- 0 plaintext sensitive-data findings.
- Crash-free users ≥ 99.7% during RC soak.
- ANR-free sessions ≥ 99.8% during RC soak.
- Successful or clearly recoverable workout writes ≥ 99.5%.
- Manual Health Connect sync reaches either confirmed server success or a recoverable encrypted pending state ≥ 99.0%.
- At least 80% of participating closed testers complete two full workouts; use this as a test-participation signal, not a product-retention claim.
- At least 10 testers complete the full written feedback form and at least 5 exercise Health Connect.

## Tester instructions

Provide each tester:

1. Play opt-in link and correct Google account requirement.
2. App scope, package/name/version and known beta limitations.
3. Privacy policy and account-deletion links.
4. A synthetic-account option and safe Health Connect testing guidance.
5. A numbered script for the assigned test cases.
6. Private feedback/security contact.
7. Explicit instruction not to send passwords, tokens, pairing codes, raw health exports, or unredacted personal data.
8. How to leave the test and uninstall/revoke/delete data.

## Feedback form template

Copy this into the approved private feedback system.

```text
IronDesk beta feedback

Build
- App name shown:
- Version name:
- Version code:
- Play track (internal/closed):
- Test date/time and timezone:

Device
- Manufacturer/model:
- Android version/API:
- Security patch date (optional):
- Health Connect: unavailable / needs update / empty / has synthetic data / has personal data (do not attach the data)
- Health Connect provider/version if visible:
- Display size/font size/accessibility service:
- Network: Wi-Fi / cellular / intermittent / offline:

Account and scenario
- New or existing synthetic account:
- Metric or imperial:
- Test case number/name:
- Starting state (clean install/update/active workout/pending sync/etc.):

Result
- Did it complete? yes / no / partly
- Exact steps taken:
- Expected result:
- Actual result:
- Did the app show an error? Copy only non-sensitive text:
- Did you observe missing or duplicate workout/set/import data? Describe without private values:
- Could you recover? How?
- Severity: blocked / major / minor / suggestion
- Reproducible: always / sometimes / once

Usability
- What was hardest to understand?
- Could you use the workout screen one-handed?
- Did any button/text get clipped or become unreachable?
- Did Health Connect clearly explain selected, granted, denied, previewed and synced data?
- Did you understand how to revoke/unlink/delete?
- What one change would most improve the app?

Attachments
- Redacted screenshot/video link:
- Diagnostic reference shown by the app, if any:

Privacy reminder
Do not include your password, email, access token, pairing code, raw Health Connect export,
date of birth, private notes, or unredacted health values. Use the private security contact for
any suspected exposure.
```

## Daily triage log

| Date | Build | Active/opted-in testers | Completed workouts | Health sync tests | P0 | P1 | P2 | Top issue | Decision/owner |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| `[DATE]` | `[VERSION CODE]` | 0 | 0 | 0 | 0 | 0 | 0 | `[NONE]` | `[OWNER]` |

## Production-access evidence

Preserve concise evidence for the questions Play may ask after a qualifying closed test:

- how testers were recruited and why they represent the target audience;
- how many remained opted in continuously and for how long;
- what tasks they completed and how participation was measured;
- what feedback channels were used and what feedback was received;
- which defects or product changes resulted from the test;
- why the app is ready for production;
- how privacy, health data, support, and account deletion were validated.

Do not claim engagement from invitations alone. Keep opt-in evidence, test dates, release versions, issue decisions, and redacted results.

## Beta sign-off

| Gate | Owner | Date | Evidence/result |
| --- | --- | --- | --- |
| Internal smoke complete | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[LINK]` |
| Closed-test participation requirement met | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[PLAY CONSOLE EVIDENCE]` |
| Device/state matrix complete | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[LINK]` |
| Core workout integrity complete | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[LINK]` |
| Health Connect end to end complete | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[LINK]` |
| Security/privacy/deletion complete | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[LINK]` |
| Metrics meet approved thresholds | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[LINK]` |
| P0/P1 = zero | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[LINK]` |
| Release-candidate soak complete | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[LINK]` |
