# Owner input and authorization checklist

Status: **BLOCKING OWNER WORK — DO NOT STORE PRIVATE IDENTITY, PAYMENT, KEY, OR CREDENTIAL VALUES HERE**

This file lists decisions Codex cannot safely infer. Record only status and links to approved private systems. Do not commit legal documents, addresses, phone numbers, D-U-N-S evidence, payment details, passwords, keystores, certificates, account-recovery data, reviewer credentials, health records, or contracts.

## 1. Organization website and Play account conversion — first gate

A read-only Play Console inspection on 2026-08-31 showed:

- account type: **Personal**;
- **Change account type**: disabled;
- organization website: none entered;
- Console guidance: provide and verify an organization website before changing account type.

Complete these before creating/reserving the app:

- [ ] Choose the organization-controlled public website: `[PUBLIC URL OR PRIVATE DECISION LINK]`.
- [ ] Prefer a company-controlled custom domain if available; record whether the current `https://irondeskpro.lovable.app` origin is acceptable for organization verification: `[DECISION LINK]`.
- [ ] Prove site ownership through the method required by the live Play Console/Search Console flow: `[PRIVATE EVIDENCE LINK]`.
- [ ] Confirm the website publicly identifies the same organization/brand that will appear in Play: `[PUBLIC URL]`.
- [ ] Reopen Play Console and confirm **Change account type** becomes available: `[DATE + PRIVATE EVIDENCE LINK]`.
- [ ] Convert the account to Organization using current official guidance: `[STATUS + PRIVATE EVIDENCE LINK]`.
- [ ] Confirm Play shows the Organization account verified, every dashboard task is clear, and the current post-transition wait has elapsed. Current guidance recommends at least 72 hours before submitting a new app: `[STATUS + PRIVATE EVIDENCE LINK]`.

Owner decision: **No Play app creation, Play store package reservation, Play App Signing enrollment, health declaration submission, or artifact upload before this gate is complete.** The urgent Android developer verification work in Section 1B is a separate package-identity safeguard; it has its own owner-confirmation stop before any challenge/request submission.

Official guidance: [Play Console requirements](https://support.google.com/googleplay/android-developer/answer/10788890?hl=en), [choose account type](https://support.google.com/googleplay/android-developer/answer/13634885?hl=en), [conversion guidance](https://support.google.com/googleplay/android-developer/answer/16260648?hl=en).

## 1B. Android developer verification — urgent pre-app-creation gate

A read-only Play Console inspection on 2026-08-31 showed:

- registered package names: **none**;
- available action: **Register package name**;
- Console deadline: Play packages must be registered by **September 30, 2026**; unregistered Play apps may be removed from Google Play;
- Console guidance also calls for applicable outside-Play packages and additional signing keys to be registered.

This is urgent package-identity work, not authorization to create the store app or submit an ownership challenge.

- [ ] Owner authorizes opening the package-registration investigation for historical `com.irondesk.app`: `[OWNER + DATE + PRIVATE APPROVAL LINK]`.
- [ ] Enter `com.irondesk.app` only far enough to inspect the live eligibility result: `[DATE + PRIVATE EVIDENCE LINK]`.
- [ ] Record every eligible SHA-256 certificate fingerprint shown by Play in a private release/security system; do not copy full fingerprints into Git: `[PRIVATE RECORD LINK]`.
- [ ] Map each eligible fingerprint to the examined 0.5.0/0.9.0 artifacts or mark it unknown. The known signing lineage is split, so a displayed fingerprint is not proof that its private key is controlled: `[PRIVATE KEY-CUSTODY EVIDENCE LINK]`.
- [ ] **STOP before submitting** an ownership challenge, proof APK, ineligible-key request, migration rationale, or final registration: `[OWNER REVIEW PENDING]`.
- [ ] Owner reviews eligible fingerprints, key custody, upgrade requirements, and package-sharing risk, then explicitly approves or rejects the challenge/request: `[OWNER + DATE + PRIVATE DECISION LINK]`.
- [ ] If approved, use only the official proof flow and a demonstrably controlled eligible private key. Never reuse, expose, or assume control of an Android Debug key: `[PRIVATE COMPLETION EVIDENCE]`.
- [ ] If no controlled eligible key exists, do not improvise. Escalate the ineligible-key request versus new-package decision to the owner/product/legal reviewers: `[DECISION LINK]`.
- [ ] Inventory `app.irondesk.health`, any other IronDesk package distributed outside Play, and additional signing keys; register each only after its own owner approval and identity decision: `[PRIVATE INVENTORY LINK]`.
- [ ] Confirm the Console shows the intended registration status and package/key records before Play app creation: `[PRIVATE EVIDENCE LINK]`.

Official guidance: [registering Play package names](https://support.google.com/googleplay/android-developer/answer/16984799?hl=en), [registering Android package names](https://support.google.com/googleplay/android-developer/answer/16761053?hl=en), and [selecting a key for an existing package](https://support.google.com/googleplay/android-developer/answer/16762143?hl=en).

## 2. Legal organization and developer identity

- [ ] Legal entity exists and is the intended publisher: `[PRIVATE RECORD LINK]`.
- [ ] Exact legal organization name approved: `[PRIVATE RECORD LINK]`.
- [ ] D-U-N-S number exists and organization name/address match: `[PRIVATE RECORD LINK]`.
- [ ] Organization Google Payments profile created/selected and verified: `[PRIVATE RECORD LINK]`.
- [ ] Organization phone verification complete: `[PRIVATE RECORD LINK]`.
- [ ] Public developer name approved: `[PUBLIC VALUE OR DECISION LINK]`.
- [ ] Public developer website approved: `[PUBLIC URL]`.
- [ ] Public support email approved and monitored: `[PUBLIC ADDRESS OR PRIVATE RECORD LINK]`.
- [ ] Private Play contact email/phone approved: `[PRIVATE RECORD LINK]`.
- [ ] Primary and backup Play account owners/admins documented: `[PRIVATE RECORD LINK]`.
- [ ] Account recovery, hardware keys/MFA, least-privilege roles and offboarding tested: `[PRIVATE RECORD LINK]`.
- [ ] Organization identity, website, D-U-N-S, payments profile and Play details agree exactly: `[SIGN-OFF LINK]`.

## 3. Product scope and brand

- [ ] Choose public Android product:
  - `[ ]` **Scope U — unified IronDesk app** (recommended public product; not implemented yet), or
  - `[ ]` **Scope C — separate IronDesk Health companion** (current private-beta source).
- [ ] Confirm public app name: proposed `IronDesk`; final `[DECISION LINK]`.
- [ ] Confirm companion name/status if retained: proposed `IronDesk Health`, internal/private; final `[DECISION LINK]`.
- [ ] Confirm paid tier name: proposed `IronDesk Pro`; final `[DECISION LINK]`.
- [ ] Complete trademark/name/logo/domain review: `[PRIVATE EVIDENCE LINK]`.
- [ ] Confirm production web origin: current `https://irondeskpro.lovable.app`; final `[DECISION LINK]`.
- [ ] Confirm canonical source repository/release branch: `[DECISION LINK]`.
- [ ] Confirm whether Lovable remote updates can change production during mobile review and define a freeze/change-control process: `[DECISION LINK]`.

## 4. Permanent package and upgrade decision

Known identities:

- `app.irondesk.health` — current separate Health Connect companion.
- `com.irondesk.app` — historical full-app namespace; audited releases were debug-signed and the examined 0.9.0 and 0.5.0 signing lineages differ.

Required decisions:

- [ ] Check Play Console package availability and any Android developer verification/eligible-key screen before reservation: `[PRIVATE EVIDENCE LINK]`.
- [ ] Complete the Section 1B `com.irondesk.app` registration/claim decision and record its outcome: `[PRIVATE EVIDENCE LINK]`.
- [ ] Decide whether historical `com.irondesk.app` installations must upgrade: `[DECISION LINK]`.
- [ ] If preserving `com.irondesk.app`, prove an eligible controlled signing/upgrade path. A debug key or split lineage is not acceptable by assumption: `[PRIVATE EVIDENCE LINK]`.
- [ ] Otherwise choose a new permanent Scope U package: `[PRIVATE DECISION LINK — DO NOT ENTER IN CONSOLE YET]`.
- [ ] Confirm Scope C remains a different package and cannot be mistaken for the full app: `[DECISION LINK]`.
- [ ] Approve final package reservation: `[OWNER + DATE + PRIVATE APPROVAL LINK]`.
- [ ] Confirm Android app links/auth callback domains for the package: `[DECISION LINK]`.
- [ ] Confirm migration/data continuity behavior from any historical APK/PWA install: `[EVIDENCE LINK]`.

## 5. Signing, keys, and release access

- [ ] Approve Play App Signing enrollment for the final package: `[PRIVATE APPROVAL LINK]`.
- [ ] Create a new long-lived Play upload key; do not reuse Android Debug: `[PRIVATE SECRET-STORE RECORD]`.
- [ ] Record upload-key owner, backup owner, recovery process, expiration and certificate fingerprint: `[PRIVATE RECORD LINK]`.
- [ ] Verify at least two controlled recovery paths without exposing the key: `[PRIVATE EVIDENCE LINK]`.
- [ ] Define who can upload to internal/closed/production tracks: `[PRIVATE ROLE MATRIX]`.
- [ ] Define who can submit forms, send for review, and publish changes: `[PRIVATE ROLE MATRIX]`.
- [ ] Configure service accounts/API access only if needed and at minimum scope: `[PRIVATE RECORD LINK OR NOT USED]`.
- [ ] Approve immutable artifact/evidence storage: `[PRIVATE LOCATION LINK]`.
- [ ] Approve key-compromise response and Play upload-key reset procedure: `[PRIVATE RUNBOOK LINK]`.

## 6. Audience, markets, content, and health boundary

- [ ] Choose target age groups in the live Console: `[DECISION LINK]`.
- [ ] Confirm whether children are excluded. Current privacy copy says the product is not directed to children under 13, but this alone does not answer Play's target-age form: `[LEGAL/PRODUCT SIGN-OFF]`.
- [ ] Choose first-launch countries/regions: proposed United States only; final `[DECISION LINK]`.
- [ ] Choose default language/locales: proposed en-US; final `[DECISION LINK]`.
- [ ] Complete content-rating answers against the exact app: `[EVIDENCE LINK]`.
- [ ] Confirm Health & Fitness store category/tags: `[DECISION LINK]`.
- [ ] Approve Health Apps categories:
  - Activity and Fitness: `[YES/NO + REVIEW]`
  - Nutrition and Weight Management: `[YES/NO + REVIEW]`
  - Sleep Management: `[YES/NO + REVIEW]`
  - Stress Management, Relaxation, Mental Acuity: `[YES/NO + REVIEW]`
  - Medical categories: proposed No; `[LEGAL/PRODUCT SIGN-OFF]`
- [ ] Approve the non-medical disclaimer and all readiness/recovery/nutrition claims: `[LEGAL SIGN-OFF]`.
- [ ] Confirm no diagnostic, treatment, cure, prevention, guaranteed-results, injury-prediction, or clinical claim is intended: `[SIGN-OFF]`.
- [ ] Determine whether coaches/teams/minors/medical professionals are in v1 scope; each changes data and policy review: `[DECISION LINK]`.

## 7. Privacy, data, retention, and vendors

- [ ] Appoint privacy/legal reviewer: `[PRIVATE ROLE RECORD]`.
- [ ] Replace public GitHub issue tracker privacy contact with a private support email/form: `[PUBLIC URL/ADDRESS + DEPLOYMENT EVIDENCE]`.
- [ ] Approve final public privacy policy text and effective date: `[SIGN-OFF LINK]`.
- [ ] Verify privacy URL is public, active, non-PDF, non-geofenced and signed-out accessible: `[EVIDENCE LINK]`.
- [ ] Approve account-deletion URL and copy: `[SIGN-OFF LINK]`.
- [ ] Verify in-app and external account deletion on production: `[EVIDENCE LINK]`.
- [ ] Inventory every production table, storage bucket, Auth/email function, log, backup, support system, analytics/crash system, SDK and vendor: `[PRIVATE INVENTORY LINK]`.
- [ ] Approve classification for every row in [DATA_SAFETY_INVENTORY_DRAFT.md](DATA_SAFETY_INVENTORY_DRAFT.md): `[SIGN-OFF LINK]`.
- [ ] Confirm whether each external recipient qualifies as a service provider under the current Play definition: `[LEGAL/DPA REVIEW LINK]`.
- [ ] Define retention and deletion for active data, backups, security logs, support records, import metadata, device records and billing records: `[POLICY LINK]`.
- [ ] Confirm incident/breach notification and data-subject request processes: `[PRIVATE RUNBOOK LINK]`.
- [ ] Confirm no health data is sold or used for advertising/marketing/data-broker activity: `[OWNER/LEGAL SIGN-OFF]`.
- [ ] Decide whether anonymous analytics will exist. The current preference toggle does not implement an analytics collector: `[DECISION LINK]`.
- [ ] If analytics/crash tools are added, approve their field-level redaction and update privacy/Data safety before release: `[EVIDENCE LINK]`.

## 8. Health Connect

- [ ] Decide whether Health Connect is integrated into Scope U, retained only in Scope C, or omitted from the first public build: `[DECISION LINK]`.
- [ ] Approve every requested type and justification in [HEALTH_APPS_AND_HEALTH_CONNECT.md](HEALTH_APPS_AND_HEALTH_CONNECT.md): `[SIGN-OFF LINK]`.
- [ ] Approve default-on types and Distance default-off behavior: `[DECISION LINK]`.
- [ ] Approve whether 90/365-day history access is necessary; remove it if not: `[DECISION LINK]`.
- [ ] Confirm no write or background access is intended: `[PRODUCT/ENGINEERING SIGN-OFF]`.
- [ ] Confirm the final package's rationale, privacy policy, selection UI, permissions, sync behavior and Play declarations match: `[EVIDENCE LINK]`.
- [ ] Complete Android 13-or-lower and Android 14+ physical-device tests, including partial grant, offline retry, dedupe, revoke/unlink and deletion: `[EVIDENCE LINK]`.
- [ ] Approve a synthetic-data reviewer video and private hosting: `[PRIVATE LINK]`.

## 9. Monetization and billing

No billing implementation exists in current source. Do not create subscriptions/products or advertise Pro in the Android listing until the owner decides and engineering implements the full entitlement lifecycle.

- [ ] Choose launch model:
  - `[ ]` Free with no purchases at v1
  - `[ ]` Free + Play Billing subscription
  - `[ ]` Paid download
  - `[ ]` Other owner/legal-approved model
- [ ] Acknowledge that under current Play rules a listing offered free cannot later become a paid-download app: `[OWNER SIGN-OFF]`.
- [ ] Approve proposed product/tier names and benefits: `[DECISION LINK]`.
- [ ] Approve monthly/annual prices, trial/intro offers, countries, taxes and currencies: `[PRIVATE COMMERCIAL RECORD]`.
- [ ] Approve Google Play Billing vs any eligible alternative-billing program after current policy/legal review: `[DECISION LINK]`.
- [ ] Implement backend purchase-token verification, Real-time Developer Notifications, idempotent entitlement ledger, acknowledgment, restore, renewal, grace/hold, refund/revoke and reconciliation: `[ENGINEERING EVIDENCE OR BLOCKED]`.
- [ ] Update Data safety/privacy/vendor/retention inventory for purchase and entitlement data: `[SIGN-OFF LINK]`.
- [ ] Define cancellation, refund, support and account-deletion/subscription interaction: `[POLICY LINK]`.
- [ ] Give Play reviewers full access without a real purchase: `[PRIVATE EVIDENCE LINK]`.

## 10. Support and operations

- [ ] Public support email is monitored at launch: `[PRIVATE OWNER/SCHEDULE LINK]`.
- [ ] Private privacy/security reporting path exists: `[PUBLIC CONTACT + PRIVATE WORKFLOW LINK]`.
- [ ] Support response targets and escalation matrix approved: `[PRIVATE LINK]`.
- [ ] Status/incident communications owner assigned: `[PRIVATE LINK]`.
- [ ] Production backend, Supabase, Lovable, domain/DNS, email and Play access each have primary/backup owners: `[PRIVATE LINK]`.
- [ ] Monitoring/alerting covers auth, workout writes, duplicates/loss, Health Connect, deletion, cross-account access and billing if present: `[PRIVATE LINK]`.
- [ ] Logs exclude passwords, tokens, pairing codes, raw health payloads, emails/free-form notes where not essential: `[EVIDENCE LINK]`.
- [ ] Rollback/containment and compromised-device/token/key procedures tested: `[EVIDENCE LINK]`.
- [ ] Data export/deletion/support procedures are documented for users and staff: `[LINK]`.

## 11. Store creative and review access

- [ ] Approve final listing copy from [STORE_LISTING_DRAFT.md](STORE_LISTING_DRAFT.md): `[SIGN-OFF LINK]`.
- [ ] Approve brand assets and verify usage rights: `[PRIVATE LINK]`.
- [ ] Produce and QA 512×512 icon, 1024×500 feature graphic and phone screenshots from the exact candidate: `[ASSET/EVIDENCE LINK]`.
- [ ] Create dedicated synthetic review account: `[PRIVATE PASSWORD-MANAGER RECORD]`.
- [ ] Pre-confirm account and remove OTP/MFA/subscription gate: `[PRIVATE EVIDENCE LINK]`.
- [ ] Seed synthetic—not personal—training/recovery/import data: `[PRIVATE EVIDENCE LINK]`.
- [ ] Enter credentials only in Play Console App access and approved password manager: `[PRIVATE EVIDENCE LINK]`.
- [ ] Clean-room rehearse [REVIEWER_ACCESS.md](REVIEWER_ACCESS.md): `[PRIVATE EVIDENCE LINK]`.
- [ ] Set recurring review-account health check: `[PRIVATE AUTOMATION/OWNER LINK]`.

## 12. Beta and production authorization

- [ ] Approve beta owner, tester cohort, devices, duration, thresholds and feedback channel: `[DECISION LINK]`.
- [ ] Confirm whether the Dashboard imposes a personal-account closed-test/production-access requirement after organization conversion: `[PLAY CONSOLE EVIDENCE]`.
- [ ] Approve initial countries and production go-live window: `[DECISION LINK]`.
- [ ] Approve managed publishing: proposed On; final `[DECISION LINK]`.
- [ ] Complete internal, closed and exact-RC soak in [CLOSED_BETA_PLAN.md](CLOSED_BETA_PLAN.md): `[EVIDENCE LINK]`.
- [ ] Formal approval to create the Play app/reserve package: `[OWNER + DATE + PRIVATE LINK]`.
- [ ] Formal approval to enroll in Play App Signing/upload internal AAB: `[OWNER + DATE + PRIVATE LINK]`.
- [ ] Formal approval to start closed testing: `[OWNER + DATE + PRIVATE LINK]`.
- [ ] Formal approval to apply for production access: `[OWNER + DATE + PRIVATE LINK]`.
- [ ] Formal approval to select **Send for review**: `[OWNER + DATE + PRIVATE LINK]`.
- [ ] Formal approval to select **Publish changes** after approval: `[OWNER + DATE + PRIVATE LINK]`.

## Owner decision register

Use this table for non-sensitive decisions only. Put sensitive evidence in a private system and link it.

| ID | Decision | Status | Owner | Date | Evidence/link |
| --- | --- | --- | --- | --- | --- |
| O-001 | Organization website | Open | `[ROLE]` | `[DATE]` | `[LINK]` |
| O-002 | Play account converted/verified | Open | `[ROLE]` | `[DATE]` | `[PRIVATE LINK]` |
| O-003 | Android developer verification / `com.irondesk.app` claim | Open | `[ROLE]` | `[DATE]` | `[PRIVATE LINK]` |
| O-004 | Scope U or C | Open | `[ROLE]` | `[DATE]` | `[LINK]` |
| O-005 | Permanent package | Open | `[ROLE]` | `[DATE]` | `[PRIVATE LINK]` |
| O-006 | Signing/Play App Signing | Open | `[ROLE]` | `[DATE]` | `[PRIVATE LINK]` |
| O-007 | Target audience/countries | Open | `[ROLE]` | `[DATE]` | `[LINK]` |
| O-008 | Health categories/claims | Open | `[ROLE]` | `[DATE]` | `[LINK]` |
| O-009 | Data safety/retention/vendors | Open | `[ROLE]` | `[DATE]` | `[PRIVATE LINK]` |
| O-010 | Monetization/billing | Open | `[ROLE]` | `[DATE]` | `[PRIVATE LINK]` |
| O-011 | Support/incident operations | Open | `[ROLE]` | `[DATE]` | `[PRIVATE LINK]` |
| O-012 | Store copy/assets | Open | `[ROLE]` | `[DATE]` | `[LINK]` |
| O-013 | Beta/production authorization | Open | `[ROLE]` | `[DATE]` | `[PRIVATE LINK]` |

No row may be marked complete solely because a draft exists. Completion requires an accountable owner and evidence.
