# Health Apps declaration and Health Connect permission justifications

Status: **DRAFT — BASED ON THE CURRENT `app.irondesk.health` COMPANION, NOT A FINAL UNIFIED AAB**

Use this document to prepare, not submit, the Play Console Health Apps form. Google reviews requested Health Connect data types by package name. If the public package is a new unified IronDesk identity, the permissions must be implemented, declared, tested, and approved under that final package; approval for `app.irondesk.health` would not automatically transfer.

Public references:

- [IronDesk Privacy Policy](https://irondeskpro.lovable.app/privacy)
- [IronDesk account deletion](https://irondeskpro.lovable.app/account-deletion)
- [Google Play Health Apps declaration guidance](https://support.google.com/googleplay/android-developer/answer/14738291?hl=en)
- [Google Play Health Content and Services policy](https://support.google.com/googleplay/android-developer/answer/16679511?hl=en)
- [Publish a Health Connect app](https://developer.android.com/health-and-fitness/health-connect/publish)
- [Health Connect permissions and data access](https://developer.android.com/health-and-fitness/health-connect/ui/permissions)
- [Health Connect test cases](https://developer.android.com/health-and-fitness/health-connect/test/test-cases)

## Product-purpose draft

IronDesk is a general fitness and training application for adult athletes. It lets users plan and log workouts, review training history and progress, track nutrition and recovery inputs, and—when the user chooses—read selected fitness/recovery records from Android Health Connect into the user's own IronDesk account.

IronDesk is not a medical device. It does not diagnose, treat, cure, or prevent any medical condition. Current recovery/readiness guidance is based on logged data and deterministic training logic; no live AI model or clinical decision-support system is implemented.

## Health Apps feature categories

The final selections must match every user-visible feature in the submitted AAB, listing, screenshots, remote content, and review account.

| Play Health Apps category | Draft selection | Current evidence | Submission rule |
| --- | --- | --- | --- |
| **Activity and Fitness** | **Select** | Workout programs/routines, strength sets, cardio, heart-rate summaries, activity imports, steps, calories, distance, weight/body metrics | Required for either the unified app or Health Connect companion |
| **Nutrition and Weight Management** | **Select for Scope U** | Nutrition days, meals, macros, hydration, weight goals, body weight | Do not select for a companion-only listing if none of those features are accessible except Health Connect weight sync; inspect the live form's scope |
| **Sleep Management** | **Select** | Sleep is tracked/imported and used in the Recovery/readiness view | Required when sleep remains in the product or `READ_SLEEP` remains requested |
| **Stress Management, Relaxation, Mental Acuity** | **Likely select for Scope U; owner/legal review** | Recovery stores fatigue and stress and uses recovery inputs for training guidance | Compare final UI/copy with the live category definition; remove the selection only if the app neither offers nor represents stress-management functionality |
| Medical categories | **Do not select based on current product** | No diagnosis, treatment, disease management, medication, clinical decision support, medical device, or health research implementation is visible | Any future medical claim or function requires a new policy/legal/regulatory review before release |

Do not choose “My app doesn't provide any health features.”

## Health Connect operating model

The current native implementation is intentionally minimum-scope:

1. The athlete selects specific record types and a 7-, 30-, 90-, or 365-day range.
2. Runtime permission requests include only the selected types.
3. Android Health Connect controls grants; denied types are skipped while granted types continue.
4. The app reads authorized data into memory and shows counts/totals before transfer.
5. Nothing is sent to IronDesk until the athlete presses **Sync now**. Alternatively, the athlete may export JSON through Android's system document picker.
6. Sync sends the normalized payload over HTTPS to the paired athlete's own IronDesk account.
7. There is no scheduled/background Health Connect read or upload. A failed manual sync may leave one encrypted prepared payload in an outbox; at most five are retained, and retry occurs only on a later manual **Sync now**.
8. The user can revoke individual Health Connect permissions, unlink the device locally/remotely, clear app data, uninstall, or delete the IronDesk account.

## Permission declaration table

Copy these justifications only if the final merged manifest contains the permission and the final app exposes the described feature. Remove any permission whose feature is removed. Do not request future-use permissions.

### `android.permission.health.READ_STEPS`

**Draft Play justification:**

> IronDesk reads daily step totals only when the user selects Steps and grants read access. The app shows the totals in the user's activity history and training context, previews the selected date range before transfer, and syncs them to that user's own IronDesk account only after the user presses Sync now. IronDesk does not write steps or read them in the background.

Code behavior:

- Selected by default but user-controllable.
- Uses Health Connect daily aggregation in the user's local timezone to avoid double-counting across source apps.
- Stored as normalized `steps` metrics after manual sync.

### `android.permission.health.READ_SLEEP`

**Draft Play justification:**

> IronDesk reads sleep sessions only when the user selects Sleep and grants read access. Sleep duration and available sleep efficiency help fill missing fields in the user's Recovery view so the athlete can review training readiness. The selected range is previewed before a manual sync; user-entered recovery data for the same day is not silently overwritten. IronDesk does not write sleep data or read it in the background.

Code behavior:

- Selected by default but user-controllable.
- Sync normalizes sleep metrics and can fill missing recovery fields.
- Manual recovery rows take precedence over derived Health Connect data.

### `android.permission.health.READ_RESTING_HEART_RATE`

**Draft Play justification:**

> IronDesk reads resting-heart-rate records only when the user selects Resting heart rate and grants read access. The records can fill a missing resting-heart-rate value in the user's Recovery view and support the user's own training-readiness review. Data is previewed before a manual sync, does not overwrite a manual recovery entry, and is never written back to Health Connect or read in the background.

### `android.permission.health.READ_HEART_RATE_VARIABILITY`

**Draft Play justification:**

> IronDesk reads heart-rate-variability (RMSSD) records only when the user selects HRV and grants read access. The records can fill a missing HRV value in the user's Recovery view so the athlete can review recovery context alongside training. Data is previewed before a manual sync, does not overwrite a manual recovery entry, and is never written back to Health Connect or read in the background.

### `android.permission.health.READ_WEIGHT`

**Draft Play justification:**

> IronDesk reads weight records only when the user selects Weight and grants read access. A synced value can fill a missing body-metric entry and appear in the user's weight/progress view using the user's preferred display units. IronDesk stores weight canonically in kilograms, does not overwrite an existing entry for that day, and does not write weight to Health Connect or read it in the background.

### `android.permission.health.READ_ACTIVE_CALORIES_BURNED`

**Draft Play justification:**

> IronDesk reads active-calorie records only when the user selects Active calories and grants read access. The app uses these records to show the user's activity energy totals and enrich selected workout/activity history after the user previews and manually syncs the selected range. IronDesk does not write calorie records or read them in the background.

### `android.permission.health.READ_DISTANCE`

**Draft Play justification:**

> IronDesk reads distance records only when the user explicitly turns on the optional Distance selection and grants read access. The app uses the records to show distance totals and enrich the user's selected cardio/workout activity history after preview and manual sync. IronDesk does not write distance records, request location permission for this feature, or read them in the background.

Code behavior:

- Off by default.
- Must remain visibly optional.
- Does not justify precise/background location permission.

### `android.permission.health.READ_EXERCISE`

**Draft Play justification:**

> IronDesk reads exercise-session records only when the user selects Workouts and grants read access. The app imports the session type, name, time, duration, and available summary values into the user's own workout/activity history after the user previews the range and presses Sync now. IronDesk does not write exercise sessions or read them in the background.

### `android.permission.health.READ_HEALTH_DATA_HISTORY`

**Draft Play justification:**

> IronDesk requests historical read access separately and only when the installed Health Connect provider supports it and the user chooses a 90-day or one-year import. It allows the same user-selected record types to be read beyond the normal recent-data window for a one-time preview and manual sync. If the user declines or the feature is unavailable, IronDesk limits the read to the recent window and continues to work.

Code behavior:

- Separate from per-type grants.
- Requested only for ranges longer than 30 days and only when the provider reports the feature is supported.
- Declining history must not block 7-/30-day reads.

### `android.permission.INTERNET`

This is not a Health Connect data-type permission, but it must remain explained in internal review:

> Internet access is used to exchange a short-lived single-use pairing code for a scoped device token, manually sync a user-previewed payload to `https://irondeskpro.lovable.app`, and unlink the device. The companion does not store the user's IronDesk password and has no scheduled/background upload.

## Permissions intentionally absent

The final merged manifest should not include any of these unless a separately approved, implemented feature makes them necessary:

- Health Connect write permissions
- `READ_HEALTH_DATA_IN_BACKGROUND`
- location permissions
- activity-recognition permission outside Health Connect
- camera or microphone
- contacts or calendar
- advertising ID
- broad storage/media permissions
- notification permission (unless notifications are actually implemented and declared)

If a library adds one through manifest merging, treat it as a stop-ship discrepancy until removed or fully justified and declared.

## User-facing disclosure alignment

Before every submission, compare these surfaces line by line:

1. Final merged manifest from the signed AAB.
2. Runtime type selector and permission request.
3. Health Connect rationale/onboarding activity in the signed app.
4. In-app privacy/settings text.
5. [Public privacy policy](https://irondeskpro.lovable.app/privacy).
6. Play listing description and screenshots.
7. Data safety form.
8. Health Apps categories and per-type justifications.
9. Reviewer-access instructions and demonstration video.

All nine must describe the same data types, purposes, background behavior, transfer, storage, retention, deletion, and contact route.

## Health Connect reviewer demonstration

Use a synthetic account and synthetic Health Connect records. Never film real health data or an active reusable pairing code.

1. Open the public privacy policy while signed out.
2. Sign into the dedicated review account.
3. Open Connections and create a fresh pairing code (companion scope) or open the integrated Health Connect screen (unified scope).
4. Show the rationale screen before granting access.
5. Select two types, such as Steps and Sleep.
6. Grant one type and deny the other.
7. Return to the app and show that the granted type can be previewed while the denied type is explicitly skipped.
8. Show that nothing syncs until **Sync now** is pressed.
9. Sync once and verify the normalized result in the IronDesk account.
10. Repeat the same sync and show no duplicate record.
11. Demonstrate an offline failed sync, encrypted pending state, and a later user-initiated retry.
12. Revoke Health Connect access and show the app refreshes without crashing.
13. Unlink the device and show the old token no longer works.
14. Show in-app account deletion and the signed-out deletion URL.

## Health-related stop-ship conditions

- Any Health Connect permission has no current, prominent user-facing benefit.
- The app requests all manifest types regardless of the user's current selection.
- Denying one type breaks unrelated functionality or the whole app.
- A type is read, uploaded, logged, or retained before the user's disclosure/permission/manual-sync action.
- A manual recovery/body-metric entry is overwritten silently.
- A sync retry can duplicate a health record.
- A record, token, pairing code, device credential, or raw health value appears in diagnostics, analytics, screenshots, or support logs.
- Background health read/upload occurs without the corresponding permission, declaration, disclosure, and approved product decision.
- The privacy policy, Play forms, rationale, listing, and runtime behavior differ.
- The app makes a medical or guaranteed-outcome claim not reviewed and supported under applicable law/policy.

## Sign-off

| Review | Owner | Date | Evidence/result |
| --- | --- | --- | --- |
| Final package/manifest permission diff | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[LINK]` |
| Per-permission runtime/partial-grant tests | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[LINK]` |
| Health Apps category review | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[LINK]` |
| Privacy/Data safety reconciliation | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[LINK]` |
| Medical-claim/legal review | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[LINK]` |
| Reviewer video and access proof | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[PRIVATE LINK]` |
