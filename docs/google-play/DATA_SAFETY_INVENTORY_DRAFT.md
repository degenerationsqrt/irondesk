# Google Play Data safety inventory — draft

Status: **WORKING INVENTORY, NOT A COMPLETED PLAY CONSOLE FORM**

This document is deliberately conservative. Google Play's Data safety form describes the sum of data practices across the app versions, regions, features, SDKs, and services distributed under one package. The final answers must come from the exact signed AAB, production backend, SDK/vendor contracts, support systems, analytics/crash systems, and billing implementation—not from this source review alone.

Public references:

- [IronDesk Privacy Policy](https://irondeskpro.lovable.app/privacy)
- [IronDesk account-deletion instructions](https://irondeskpro.lovable.app/account-deletion)
- [Google Play Data safety guidance](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)
- [Google Play account-deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)

This is product/compliance preparation, not legal advice. The authorized owner and legal/privacy reviewer must approve the final form.

## Scope and status vocabulary

This inventory assumes the proposed **unified public IronDesk app** exposes the current account-backed web features and the current read-only Health Connect integration. No unified Android artifact exists yet, so the form is blocked.

Status meanings:

- **YES — code-evidenced**: current source contains a path that sends or stores this data.
- **NO — current-source evidence**: no path is visible in the inspected source; the final artifact/vendor review can change the answer.
- **CONDITIONAL**: depends on a user action, optional feature, final product scope, or policy classification.
- **OWNER VERIFY**: operational/legal/vendor facts cannot be proven from the repository.
- **BLOCKED**: an implementation or product decision does not exist yet.

For Play terminology, “collected” normally includes data transmitted off the device, even when it goes to the user's own account. “Shared” has specific exceptions, including some transfers to service providers acting on the developer's behalf; do not mark “not shared” until contracts and actual use qualify.

## Current data-flow map

| Source | Data | Destination/retention visible in code | User control |
| --- | --- | --- | --- |
| Account sign-up/sign-in | Email, password, display name, Auth user ID/session | Supabase Auth; profile data in Supabase tables | Password reset, sign out, account deletion |
| Athlete setup/settings | DOB, height, weight, timezone, units, goals, equipment, targets, notification/privacy preferences | RLS-protected Supabase profile/preferences tables | Edit settings; delete account |
| Training | Programs, templates, workout/session metadata, exercises, sets, reps, load, RPE, rest, notes, timestamps | RLS-protected Supabase training tables | Edit/finish/cancel according to product flow; delete account |
| Fitness/recovery/nutrition | Cardio, calories, HR, distance, zones, body metrics, sleep, HRV, resting HR, readiness, fatigue, stress, soreness context, meals/macros/hydration | RLS-protected Supabase tables | App editing where implemented; account deletion |
| File import | Source file name, size, format, normalized activities/metrics, source metadata, warnings/errors | Supabase import jobs and normalized rows; current code does not populate original-file `storage_path` | Preview before commit, rollback file-import batch, delete account |
| Health Connect | Selected steps, sleep, resting HR, HRV, weight, active calories, distance, exercise sessions; timestamps; source package; device manufacturer/model; recording method; timezone | Read into memory, previewed, then either exported via Android's system picker or manually synced over HTTPS to the user's IronDesk account | Per-type selection and Health Connect permission; manual sync; revoke/unlink; account deletion |
| Companion pairing | One-time code, device label/platform, generated device ID, token hash, pair/sync timestamps and summary | Raw pairing token held encrypted on device; only hashes reach Supabase; short-lived pairing code stored as a hash | Unlink locally/remotely; remove device from web; delete account |
| Failed Health Connect sync | At most five already-prepared sync payloads | Android app-private files, encrypted with Android Keystore; no background drain | Retry on next manual Sync now; unlink/clear app data/uninstall |
| Hosting/security operations | Request/network/security logs may include IP, user agent, identifiers, timestamps, URLs, error metadata | Hosting, Supabase, email, support, and security systems | **OWNER VERIFY** retention, access, deletion, and vendor roles |
| Billing/subscription | No implementation in current source | **BLOCKED** | Must be added to this inventory before monetization |

## Proposed per-data-type answers

The “required/optional” column refers to the persisted account experience, not demo mode. A user may be able to explore non-persistent sample data without creating an account.

### Personal information

| Play data type | Collected? | Shared? draft | Required/optional | Purpose draft | Evidence and open issues |
| --- | --- | --- | --- | --- | --- |
| Name | **YES — code-evidenced** | Likely no external sharing; **OWNER VERIFY** provider exception | Required to create a current account (display name); editable | App functionality; account management | `auth.tsx` requires display name; `profiles.display_name` stores it |
| Email address | **YES — code-evidenced** | Likely no external sharing; **OWNER VERIFY** Supabase/email providers | Required for account | Authentication; account management; password reset; possibly notifications if implemented | Supabase Auth; notification preferences exist, but actual email delivery/vendor must be inventoried |
| User IDs | **YES — code-evidenced** | Likely no external sharing; **OWNER VERIFY** | Required for account | Authentication; account management; security; app functionality | Supabase Auth UUID owns RLS data; generated import/device IDs relate records to the user |
| Address | **NO — current-source evidence** | No | N/A | N/A | Recheck billing/tax/support changes; do not confuse developer address with end-user data |
| Phone number | **NO — current-source evidence** | No | N/A | N/A | Recheck future MFA/support |
| Race and ethnicity | **NO — current-source evidence** | No | N/A | N/A | Final schema/UI scan required |
| Political or religious beliefs | **NO — current-source evidence** | No | N/A | N/A | Final schema/UI scan required |
| Sexual orientation | **NO — current-source evidence** | No | N/A | N/A | Final schema/UI scan required |
| Other personal information | **CONDITIONAL** | **OWNER VERIFY** | Optional | App functionality | Date of birth, height, timezone, training goal, equipment and preference fields may fall here or under Health info depending on current form wording |

Authentication note: the current app sends a password to Supabase Auth for sign-in and again through a same-origin deletion endpoint to reauthenticate an irreversible deletion. Current source does not store the password in IronDesk tables. Confirm Supabase Auth behavior, log redaction, breach controls, and final native secure-storage behavior.

### Health and fitness

| Play data type | Collected? | Shared? draft | Required/optional | Purpose draft | Evidence and open issues |
| --- | --- | --- | --- | --- | --- |
| Health info | **YES — code-evidenced** | Proposed **No**, subject to provider-contract verification | Optional | App functionality; training/recovery guidance | DOB, height, weight/body composition, sleep, resting HR, HRV, recovery, readiness, fatigue, stress, soreness context, nutrition/hydration, and health imports are stored when entered/imported/synced |
| Fitness info | **YES — code-evidenced** | Proposed **No**, subject to provider-contract verification | Optional, although core workout logging is the product's purpose | App functionality; analytics shown to the user | Workouts, exercises, sets/reps/load/RPE/rest, cardio, steps, distance, active calories, exercise sessions, HR/zone summaries and progress records |

Health Connect records transferred to the user's IronDesk account still count as collected. On-device preview-only data that is never transmitted can be treated differently under current Play definitions, but the same types become collected when the user presses Sync now. Do not use the preview-only behavior to answer “No.”

### App activity

| Play data type | Collected? | Shared? draft | Required/optional | Purpose draft | Evidence and open issues |
| --- | --- | --- | --- | --- | --- |
| App interactions | **OWNER VERIFY** | **OWNER VERIFY** | Unknown | Security, diagnostics, analytics only if actually used | No analytics SDK is visible in current app/native dependencies. Hosting/access logs and any future analytics must be reviewed. A stored preference named `share_anonymous_analytics` is not evidence that analytics collection exists. |
| In-app search history | **NO — current-source evidence** | No | N/A | N/A | Exercise/search inputs appear UI-local; recheck final telemetry/network traces |
| Installed apps | **NO — current-source evidence** | No | N/A | N/A | Health Connect source package names are provenance for records, not an installed-app inventory; confirm current Play classification |
| Other user-generated content | **YES — code-evidenced** | Proposed **No**, subject to provider-contract verification | Optional | App functionality | Custom exercise/template names, workout/session/set notes, meal names, import notes/mappings, device labels and other athlete-entered text |
| Other actions | **CONDITIONAL** | **OWNER VERIFY** | Optional | App functionality; security | Program enrollments, favorites, device pair/unlink, imports/rollbacks and deletion actions may fall here; classify against the live form |

### Files and documents

| Play data type | Collected? | Shared? draft | Required/optional | Purpose draft | Evidence and open issues |
| --- | --- | --- | --- | --- | --- |
| Files and documents | **YES — conservative/code-evidenced** | Proposed **No**, subject to provider-contract verification | Optional | App functionality | The app stores uploaded source file name, size and format plus normalized records. Current source parses files client-side and does not retain the original file or populate `storage_path`; recheck the final native implementation and Play's current definition. |

The source supports FIT, TCX, GPX, CSV, JSON and ZIP input. GPX latitude/longitude trackpoints are used locally to derive distance/elevation and are listed as skipped; individual trackpoints and route geometry are not stored. If any future version uploads or retains raw source files, coordinates, routes, photos, or attachments, update this declaration immediately.

### Device or other identifiers

| Play data type | Collected? | Shared? draft | Required/optional | Purpose draft | Evidence and open issues |
| --- | --- | --- | --- | --- | --- |
| Device or other IDs | **YES — conservative/code-evidenced** | Proposed **No**, subject to provider-contract verification | Optional for device integration | App functionality; account management; security; fraud/abuse prevention | Health sync includes generated device ID/label/platform and may include source package, device manufacturer/model and recording method. Only token hashes are stored server-side. No advertising ID, Android ID, IMEI or hardware serial collection is visible. Confirm live form classification and operational logs. |

### Location

| Play data type | Collected? | Shared? draft | Required/optional | Purpose draft | Evidence and open issues |
| --- | --- | --- | --- | --- | --- |
| Approximate location | **NO — current-source evidence** | No | N/A | N/A | No location permission is declared by the current native companion; IP-based location use by vendors is **OWNER VERIFY** |
| Precise location | **NO — current-source evidence** | No | N/A | N/A | GPX lat/lon is processed locally to derive summaries and is intentionally not persisted; final implementation/network trace must prove this |

### Financial information

| Play data type | Collected? | Shared? draft | Required/optional | Purpose draft | Evidence and open issues |
| --- | --- | --- | --- | --- | --- |
| Purchase history | **BLOCKED / currently no** | **BLOCKED** | N/A today | Future account management/app functionality | If IronDesk Pro uses Play Billing, inventory purchase tokens, product/subscription IDs, transaction/renewal/refund status, entitlement state, Real-time Developer Notifications, and backend processors |
| Payment information | **NO — current-source evidence** | No | N/A | N/A | Do not collect raw card/bank details in app; Play/approved processor handles payment credentials. Reassess alternative billing if chosen. |
| Credit score/other financial info | **NO — current-source evidence** | No | N/A | N/A | Final scan required |

### Messages, photos, audio, contacts, calendar, and browsing

Current source does not request or collect email/SMS message bodies, photos/videos, audio/voice recordings, contacts, calendar entries, or web browsing history. Mark these **No** only after final merged-manifest, dependency, WebView/remote-content, file-picker, and network inspection.

## Collection purposes likely needed in the Play form

Use only purposes that actually apply to each data type:

- **App functionality** — accounts, workouts, programs, history, progress, nutrition, recovery, imports, device sync, export, and deletion.
- **Account management** — sign-up, authentication, password reset, settings, device links, deletion, and future entitlements.
- **Security, fraud prevention, and compliance** — token hashes, authentication/session controls, rate limiting, audit/security logs, if verified.
- **Analytics** — do not select unless a real analytics path collects that data. User-facing progress calculations are product functionality, not automatically Play “analytics.”
- **Developer communications** — select only if emails/notifications are actually sent for non-account purposes and the data type is used for them.
- **Advertising or marketing** — current draft is No. Any campaign attribution, ad SDK, remarketing, or cross-app tracking changes the answer.
- **Personalization** — determine whether training/program/recovery recommendations meet Play's current definition. Do not select by reflex; document the actual logic and data types.

## Sharing assessment

Current product intent is no sale of health data, no advertising use, and no third-party data-broker sharing. That does not by itself prove “not shared” in the Play form.

Before finalizing “No sharing,” complete this table:

| Recipient/vendor | Data received | Purpose | Processor/service-provider only? | Contract/DPA reviewed? | Retention/deletion verified? |
| --- | --- | --- | --- | --- | --- |
| Supabase/Auth/database | Account, profile, training, health, fitness, import/device data | Auth/database/app operation | `[OWNER VERIFY]` | `[OWNER INPUT REQUIRED]` | `[OWNER INPUT REQUIRED]` |
| Lovable/application hosting/runtime | HTTP request/response and operational metadata; exact logs unknown | App delivery/security/diagnostics | `[OWNER VERIFY]` | `[OWNER INPUT REQUIRED]` | `[OWNER INPUT REQUIRED]` |
| Transactional email provider | Email/account-flow content; provider unknown | Confirmation/password reset/notifications | `[OWNER VERIFY]` | `[OWNER INPUT REQUIRED]` | `[OWNER INPUT REQUIRED]` |
| Google Play | App distribution, vitals, billing if enabled | Distribution/security/payment | Governed by Play terms; classify current form | `[OWNER INPUT REQUIRED]` | `[OWNER INPUT REQUIRED]` |
| Crash/analytics provider | None visible in current code | N/A today | N/A | Recheck final AAB | Recheck final AAB |
| Customer support system | `[OWNER INPUT REQUIRED]` | Support | `[OWNER VERIFY]` | `[OWNER INPUT REQUIRED]` | `[OWNER INPUT REQUIRED]` |
| Billing/entitlement backend | Not implemented | Future subscription | `[BLOCKED]` | `[BLOCKED]` | `[BLOCKED]` |
| Any coach/team/admin access | Product design unresolved | Future coaching | `[OWNER INPUT REQUIRED]` | `[OWNER INPUT REQUIRED]` | `[OWNER INPUT REQUIRED]` |

Do not include secrets, credentials, private contact information, or contract documents in this repository; link to the approved private record instead.

## Security-practice answers

| Play question | Draft | Evidence needed before submit |
| --- | --- | --- |
| Is all collected user data encrypted in transit? | **Likely Yes; OWNER VERIFY** | Final AAB network security configuration, HTTPS-only endpoint scan, production traffic capture, every SDK/vendor transport path |
| Can users request deletion? | **Yes — code-evidenced** | In-app Settings deletion and signed-out external URL both tested on production; active rows/auth/device tokens removed; provider backup/log exceptions documented |
| Is data independently security reviewed? | `[OWNER INPUT REQUIRED]` | Only answer Yes if the current Play definition and a qualifying completed review are satisfied |
| Does the app follow Families requirements? | `[OWNER INPUT REQUIRED]` | Target-audience decision; current privacy copy says not directed to children under 13, but Play age selections require separate review |

Security behavior currently visible:

- Supabase RLS policies scope user-owned tables.
- The Android companion uses read-only Health Connect permissions selected at runtime.
- Device tokens and retry payloads are encrypted with Android Keystore.
- Android backup and device transfer are disabled for the companion.
- Raw device tokens are not stored server-side; hashes are stored.
- Account deletion reauthenticates with the current password, globally revokes sessions, and deletes the Auth user.

These are implementation controls, not proof of an independent audit or of every production/vendor control.

## Retention and deletion matrix

| Data | Current product statement | Evidence/decision still required |
| --- | --- | --- |
| Active account/training/health data | Remains until the user deletes records/account | Confirm record-specific controls and whether any product/legal minimum retention applies |
| Account deletion | Deletes Supabase Auth account and cascade-owned active records | Run end-to-end production test; inventory every table/bucket/function/external vendor and verify orphan scan |
| Import batches | File-import batch can be rolled back; original file not retained in current code | Verify `storage_path` remains null and storage buckets contain no original |
| Device pairing codes | Short-lived and single-use; stored as hashes | Verify configured TTL/cleanup in production |
| Device tokens | Encrypted locally; hashes server-side; revoked on unlink/deletion | Verify old token returns unauthorized after unlink/deletion |
| Failed sync payloads | Maximum five encrypted local payloads; removed after success/unlink/app-data removal | Physical-device evidence required |
| Backups/security logs | Privacy page says provider schedules apply and copies are not active accounts | `[OWNER INPUT REQUIRED — exact provider schedules and deletion exception language]` |
| Support records | Unknown | `[OWNER INPUT REQUIRED]` |
| Billing records | Not implemented | `[BLOCKED — define legal/tax/refund retention before launch with billing]` |

## Final verification procedure

1. Pin the release commit and signed AAB hash.
2. Export the merged manifest and list every permission, service, receiver, provider, activity, query, and SDK.
3. Generate the full Gradle dependency tree and scan the AAB for advertising, analytics, crash, attribution, social, payment, and support SDKs.
4. Exercise every feature through a proxy/network capture in a synthetic account: install, sign-up/sign-in, settings, workout, imports, Health Connect, notifications, support, billing, export, unlink, and deletion.
5. Inventory production database tables, storage buckets, edge/server functions, Auth/email, backups, request logs, security logs, analytics, support, and billing systems.
6. Map every transmitted field to Play data type, required/optional status, purposes, retention, deletion, and recipient.
7. Validate each proposed “shared = no” recipient against the current Play sharing exceptions and actual contract/use.
8. Reconcile the completed form with the public privacy policy, in-app disclosure/rationale, Health Apps declaration, store listing, reviewer instructions, and screenshots.
9. Have product, engineering, privacy/legal, and release owners sign off.
10. Save the Play form preview/export or screenshots with the release evidence and repeat this process whenever data practice changes.

## Final sign-off

| Review | Owner | Date | Evidence/result |
| --- | --- | --- | --- |
| Final AAB/SDK inspection | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[LINK]` |
| Backend/log/vendor inventory | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[LINK]` |
| Data classification and sharing review | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[LINK]` |
| Retention/deletion verification | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[LINK]` |
| Privacy policy reconciliation | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[LINK]` |
| Play form submitted values | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[PRIVATE EVIDENCE LINK]` |
