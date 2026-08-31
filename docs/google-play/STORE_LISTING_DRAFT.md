# Google Play store-listing draft

Status: **DRAFT — DO NOT PASTE INTO PLAY CONSOLE UNTIL THE PRODUCT-SCOPE GATE IS CLOSED**

This draft is written for **Scope U: one unified public IronDesk Android app**. That production app is not yet present in this repository. The release-oriented native build is the narrower `app.irondesk.health` companion; `mobile-android/` is a disposable, sample-only preview that cannot build a release artifact. Every sentence below must therefore be tested against the final signed AAB before use.

Public policy links already available:

- Privacy policy: [https://irondeskpro.lovable.app/privacy](https://irondeskpro.lovable.app/privacy)
- Account deletion: [https://irondeskpro.lovable.app/account-deletion](https://irondeskpro.lovable.app/account-deletion)

## Proposed listing fields

| Field | Draft value | Status |
| --- | --- | --- |
| Default language | English (United States) | `[OWNER INPUT REQUIRED]` |
| App name | **IronDesk** | Proposed; verify trademark/name availability and final Android label |
| App type | App | Proposed |
| Category | Health & Fitness | Proposed; verify in current Console |
| Price | Free download | `[OWNER INPUT REQUIRED]`; a free app cannot later become a paid-download app under current Play rules |
| In-app products | None in the current code | Do not select or advertise subscriptions until Play Billing and backend entitlements are implemented and tested |
| Contains ads | No | Code-grounded for the current native source; re-audit the final AAB, remote content, and SDKs |
| Target audience | Adults/general fitness audience | `[OWNER INPUT REQUIRED]`; complete the live age-group form accurately |
| Initial countries | United States only | Proposed soft-launch boundary; `[OWNER INPUT REQUIRED]` |
| Developer name | `[OWNER INPUT REQUIRED — public organization/developer name exactly as verified in Play Console]` | Blocker |
| Support email | `[OWNER INPUT REQUIRED — monitored private support address]` | Blocker; do not use a public GitHub issue for sensitive support |
| Website | `[OWNER INPUT REQUIRED — organization-controlled, verified website]` | Blocker; prefer a company-controlled custom domain if available |
| Privacy policy | `https://irondeskpro.lovable.app/privacy` | Implemented; final owner/legal and signed-out checks required |
| External deletion URL | `https://irondeskpro.lovable.app/account-deletion` | Implemented; final end-to-end test required |
| Package name | `[OWNER INPUT REQUIRED — permanent unified package]` | Blocker; do not assume `app.irondesk.health` or legacy `com.irondesk.app` |

## Short description

Proposed (74 characters):

> Plan serious training, log every set, and turn recovery into clear action.

Do not add “AI-powered,” “offline,” “coach-built,” “medical,” “clinically proven,” or device-sync claims unless those exact features are present and verified in the submitted artifact.

## Full description

Proposed draft:

> IronDesk is a focused training command center for athletes who want structure without losing control of the details.
>
> BUILD AND RUN YOUR TRAINING
>
> • Follow an assigned program, choose an IronDesk workout, repeat a recent session, or build your own.
> • Log sets, reps, load, RPE, rest, substitutions, and session notes in a fast workout console.
> • Resume an active session and keep the completed work in your training history.
>
> SEE REAL PROGRESS
>
> • Review workout history, training volume, estimated strength trends, personal records, and conditioning activity.
> • Use metric or imperial display units while IronDesk keeps training records consistent.
>
> TRAIN WITH CONTEXT
>
> • Track nutrition, hydration, body metrics, sleep, fatigue, stress, and recovery inputs.
> • Use readiness-aware training guidance based on the information available in your account.
>
> CONNECT YOUR DATA — WHEN YOU CHOOSE
>
> • With Android Health Connect, select the fitness and recovery record types you want IronDesk to read.
> • Preview the selected range before a manual sync.
> • Health Connect access is read-only. IronDesk does not write records back to Health Connect or run a background health-data sync.
> • Import supported fitness files and export completed training sessions in Garmin-compatible TCX format.
>
> YOUR DATA, YOUR CONTROLS
>
> • Unlink a connected device or revoke Health Connect permissions at any time.
> • Review the privacy policy in the app.
> • Permanently delete your IronDesk account and associated active account data from Settings.
>
> IronDesk is for general fitness and training information. It is not a medical device and does not diagnose, treat, cure, or prevent any medical condition. Consult a qualified professional before making decisions that may affect your health or safety.

### Claims that require final proof

The following draft statements are true in the web product and/or current Health Connect companion, but cannot remain in the public unified listing until the exact signed Android candidate proves them:

- “Follow an assigned program” — verify program enrollment/start/advance in the Android experience.
- “Build your own” — verify custom workout/template creation in the Android experience.
- “Resume an active session” — test process death, background/foreground, device restart, and interrupted network behavior.
- “Readiness-aware training guidance” — show the inputs and deterministic basis; do not imply diagnosis or a live AI model.
- “Track nutrition” — verify nutrition data entry is actually available in the Android artifact, not merely displayed from the website.
- “Health Connect” — verify final-package permissions, rationale, partial grants, preview, manual sync, retry, and unlink.
- “Import supported fitness files” and “TCX export” — verify Android file picker/download behavior and permissions.
- “Permanently delete” — test from the signed app through successful Auth deletion and cascade cleanup.

Delete any sentence that cannot be proven from the exact release candidate.

## Existing companion-only listing fallback

Use this only if the owner explicitly chooses **Scope C** as a separate Play app. It must not be combined with the unified-app copy above.

### Companion name

`IronDesk Health`

### Companion short description

> Manually sync selected Health Connect records to your IronDesk account.

### Companion full description

> IronDesk Health is a read-only Android bridge for an existing IronDesk account.
>
> Choose the Health Connect record types and date range you want to use, grant only those permissions, preview the available records, and press Sync now when you are ready. The app can read selected steps, sleep, resting heart rate, heart-rate variability, weight, active calories, distance, and exercise sessions.
>
> IronDesk Health does not write to Health Connect and does not perform background health-data collection or upload. A failed manual sync can be kept in a small Android Keystore-encrypted retry queue and retried only when you press Sync now again.
>
> An IronDesk account and internet connection are required for pairing and sync. You can revoke Health Connect permissions, unlink the phone, export the prepared data through Android's system file picker, or delete your IronDesk account.
>
> IronDesk Health is for general fitness and training information. It is not a medical device and does not diagnose, treat, cure, or prevent any medical condition.

Current companion identity is `app.irondesk.health`, but it remains an unsigned engineering private beta. Do not publish this fallback listing until every gate in [`android-health-connect/docs/RELEASE_CHECKLIST.md`](../../android-health-connect/docs/RELEASE_CHECKLIST.md) is complete.

## Screenshot story for the unified app

Use real screens from the exact release candidate. Create a clean, synthetic review account; never place a real athlete's name, email, DOB, health metrics, notes, device label, or pairing code in store assets.

| Order | Caption | Required visible proof | Avoid |
| ---: | --- | --- | --- |
| 1 | **Your workout, ready today** | Assigned or selectable workout with clear start action | “Personalized by AI” unless a real model exists |
| 2 | **Log every set without breaking focus** | Reps, load, RPE, rest, previous performance | Tiny text, fake records, unsupported offline claim |
| 3 | **Build training around your goals** | Program/template/custom-workout choice | Claims of guaranteed results |
| 4 | **See the work add up** | History, volume, PR, or strength trend from synthetic data | “Clinically accurate” or unqualified health claims |
| 5 | **Train with recovery context** | Clearly labeled sleep/readiness/recovery inputs and source | Diagnosis, injury prediction, treatment advice |
| 6 | **Connect Health Connect on your terms** | Selected types, read-only rationale, preview/manual sync | Showing broad “Allow all” as mandatory or implying background sync |

The public feature graphic should communicate the core workout product, not only Health Connect. Suggested headline: **Train with evidence. Progress with intent.**

## Asset production checklist

Working draft assets generated for this preparation branch:

- [512×512 app icon](assets/app-icon-512.png)
- [1024×500 feature graphic](assets/feature-graphic-1024x500.png)
- [Generated feature-graphic background](assets/feature-graphic-background-generated.png)
- [Reproducible asset build script](assets/build-store-assets.cjs)
- Draft live-demo phone screenshots: [Today](assets/phone-screenshots/01-today-1080x1920.png), [Workout](assets/phone-screenshots/02-workout-1080x1920.png), [Progress](assets/phone-screenshots/03-progress-1080x1920.png), and [Recovery](assets/phone-screenshots/04-recovery-1080x1920.png)
- [Asset provenance and rebuild notes](assets/README.md)

These files are candidates, not approved store assets. Product/brand review, pixel-dimension/file-format checks, rights/provenance review, and visual QA in a Play listing preview remain required. The four screenshots show the real production web app in explicitly labeled demo mode; they are useful listing-design drafts, but screenshots from the exact signed Android release candidate do not exist yet and must replace them before submission.

- [ ] 512×512 32-bit PNG Play icon, no misleading ranking/price/Play badge.
- [ ] 1024×500 feature graphic.
- [ ] At least two compliant phone screenshots; six are planned above.
- [ ] Screenshots are JPEG or 24-bit PNG without alpha and meet current Play dimension/aspect rules.
- [ ] Screens show the exact release UI, localized in the declared language.
- [ ] No status-bar notifications, personal data, test watermarks, cursor overlays, or prototype-only labels.
- [ ] No image implies a feature, sensor, wearable, subscription, discount, award, ranking, or medical outcome that is not real.
- [ ] App icon, launcher icon, app label, listing name, and in-app brand agree.
- [ ] Optional preview video uses only cleared music/assets and shows the real app.
- [ ] All source design files and usage licenses are retained with the release evidence.

Current Google Play asset requirements are maintained in [Add preview assets](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en). Recheck them immediately before export.

## Search/metadata working set

Use naturally in copy; do not keyword-stuff:

- strength training
- workout log
- training program
- set and rep tracker
- RPE and rest timer
- recovery and readiness
- Health Connect
- workout history
- progress tracking
- nutrition and hydration

## Localization plan

Version 1 proposal: English (United States) only. Before adding a locale:

- translate the app and policy/deletion experiences, not only the store listing;
- have a fluent reviewer check training and health terminology;
- provide localized support coverage;
- repeat screenshot and layout QA;
- ensure any health, subscription, tax, and consumer disclosures are appropriate for the target country.

## Listing sign-off

| Review | Owner | Date | Evidence/result |
| --- | --- | --- | --- |
| Product claims match candidate | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[LINK]` |
| Health/non-medical claims approved | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[LINK]` |
| Privacy/Data safety match | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[LINK]` |
| Trademark/brand/assets cleared | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[LINK]` |
| Support links and email tested | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[LINK]` |
| Final character/asset validation | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[LINK]` |
