# IronDesk Health Connect companion (Android)

Android's Health Connect has **no web API**: a browser cannot read it, and there is no
OAuth-style server flow. The only supported path is an on-device app the user grants read
permission to, which then either exports a file or pushes records to the user's own IronDesk
account. This module is that app.

It is a complete, reproducible Android Studio project: root scripts, version catalog, module
config, resources, manifest, Kotlin sources, JVM unit tests, and a committed Gradle wrapper
(`./gradlew`, Gradle 8.11.1). Verified build: AGP 8.9.1, Kotlin 2.0.21, compileSdk 36,
targetSdk 35, minSdk 28.

## Build

**Android Studio** (Ladybug or newer): *File → Open* → `android-health-connect/`, let it sync,
then *Run* on a device with Health Connect. JDK 17 is required (bundled with recent Studio).

**Command line** (JDK 17 + Android SDK on `ANDROID_HOME`, platform android-36):

```bash
cd android-health-connect
./gradlew --no-daemon clean lintDebug testDebugUnitTest assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk
```

**CI**: `.github/workflows/android-health-connect.yml` installs JDK 17 and the Android SDK with
API 36 / build-tools 36.0.0, runs `lintDebug` and the unit tests first, then assembles and always
uploads the `irondesk-health-debug-apk` artifact. A GitHub prerelease is created only when the
workflow is dispatched with the boolean input `publish_github_release = true`. It holds no
signing secrets.


Point the app at another deployment with `-PirondeskBaseUrl=https://your-host` (default:
`https://irondeskpro.lovable.app`). Release builds intentionally declare **no signing config** —
sign with your own upload key.

## Samsung Health (or any tracker) → Health Connect

1. Install **Health Connect** from Play (pre-installed on Android 14+).
2. Samsung Health → *Settings → Health Connect* → allow it to write steps, sleep, heart rate,
   HRV, weight, calories, distance and exercise.
3. Wait for one Samsung Health sync, then open IronDesk Health.

## Pair, sync, unlink

1. In IronDesk on the web: **Connections & Imports → generate pairing code** (8 characters,
   single-use, expiring).
2. In the app: type the code, name the phone, tap **Pair this phone**. The code is exchanged for
   a device token encrypted with an AES-256/GCM key generated in the AndroidKeyStore (a small
   `Codec` in `Crypto.kt`; `androidx.security:security-crypto` is deliberately not used). No
   IronDesk password or backend key ever reaches the phone. The plaintext token written by the
   very first build is migrated once and wiped; a blob that cannot be decrypted is discarded
   rather than treated as valid.
3. **Grant read access** — the eight record types below, read-only. **Manage Health Connect
   access** opens the system screen, and grants are re-read every time the app returns to the
   foreground.
4. Pick a range (7 / 30 / 90 days / 1 year) and record types, then **Preview data**: per-type
   counts plus step, sleep, workout, calorie and distance totals.
5. **Sync now** posts the payload to `/api/public/health-connect/ingest` under the device token
   and reports new / already-present / skipped records and how many recovery and weight days
   were filled.
6. **Export JSON file instead** writes the same payload through the system file picker for
   manual upload — the offline path is preserved.
7. **Unlink this device** calls `/api/public/health-connect/unpair` with the device token. The
   local token is cleared only on a confirmed revocation or a confirmed already-revoked `401`;
   every other network/server error keeps the token so you can retry. *Forget locally only* is a
   separate, explicitly confirmed action.

Everything is user-initiated. There is no background sync, no analytics and no third-party
sharing in this build.

## Honest behaviour notes

- **History gating.** Health Connect only shares the last 30 days unless the app also holds
  `READ_HEALTH_DATA_HISTORY`. Before offering it, the app checks
  `HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_HISTORY`; when the installed provider does not
  support it the permission is never requested and the 90-day / 1-year choices say the longer
  read is unavailable. Ungranted or unsupported both read 30 days, say so, and stamp
  `history_authorized: false`. It never implies a longer read happened.
- **Deduplication.** `external_id` values are deterministic (`hc:steps:<date>`, `hc:sess:<id>`,
  …), so re-syncing an overlapping range imports zero duplicates — the server dedupes on
  `ext:health_connect:<external_id>`.
- **Daily steps.** Steps are cumulative and arrive from several apps, so raw records are never
  summed. The app calls `aggregateGroupByPeriod` with `StepsRecord.COUNT_TOTAL`,
  `Period.ofDays(1)` and a `LocalDateTime` range, so buckets are real calendar days (DST-safe)
  with no cross-source double counting.
- **Exercise types.** Mapped through the official `ExerciseSessionRecord.EXERCISE_TYPE_*`
  constants in connect-client 1.1.0 — no hard-coded numeric ids.
- **Provenance.** Source package, device manufacturer/model and recording method are sent when
  Health Connect supplies them, and the server keeps them in `raw_metadata`.
- **Manual data is protected.** Derived recovery (sleep, HRV, resting HR) and bodyweight rows
  fill gaps only; a day the athlete logged by hand is never overwritten. That rule lives on the
  server, so it holds for file upload and device sync alike.
- **Outbox.** A network or 5xx failure keeps the prepared payload in a small file-backed queue
  (max 5 batches, identical payloads deduped on the plaintext) and drains it on the next
  **Sync now**. Queued bodies are encrypted at rest with the same Keystore key; an unreadable
  entry is dropped instead of retried forever. Nothing reads health data in the background.
- **Day boundaries.** Derived recovery/bodyweight rows are grouped by the record's own timezone
  (UTC only as a fallback), so an evening reading is not pushed onto the wrong day.
- **Pagination.** Reads follow page tokens, capped at 20,000 records per type per sync.
- **Enrichment.** Sessions carry distance and active calories that fall inside the session
  window. Average heart rate is not exported because that would need a broader permission.

## Files

- `settings.gradle.kts`, `build.gradle.kts`, `gradle.properties`, `gradle/libs.versions.toml`,
  `gradlew`, `gradlew.bat`, `gradle/wrapper/*` — project skeleton, pinned versions, wrapper.
- `app/build.gradle.kts`, `app/proguard-rules.pro` — module config, `IRONDESK_BASE_URL`, shrinker.
- `app/src/main/AndroidManifest.xml` — eight read permissions plus `READ_HEALTH_DATA_HISTORY`
  (only requested when supported), INTERNET for user-initiated sync, rationale/data-usage activity.
- `Theme.kt` — IronDesk dark palette and condensed type.
- `PairingCode.kt` — pairing-code and device-name rules (pure, tested).
- `Payload.kt`, `Aggregation.kt` — wire format, locale-pinned serializer (NaN/∞ refused), daily
  step points, preview totals (pure, tested).
- `ExerciseTypes.kt` — official exercise-type and recording-method constants (tested).
- `Crypto.kt` — `Codec`, `PlainCodec`, AndroidKeyStore AES-256/GCM `KeystoreCodec`.
- `HealthRepository.kt` — availability, permission set, history feature check, aggregated steps,
  paginated reads for the raw types, ranges.
- `HealthMapper.kt` — Health Connect records → wire model, including provenance.
- `TokenStore.kt` — `SecureStore`/`CodecStore`/`TokenVault` and legacy-token migration (tested).
- `SyncQueue.kt` — encrypted file-backed retry outbox with injectable codec (tested).
- `SyncClient.kt` — pair, ingest, unpair; transient vs revoked vs definite failures.
- `MainActivity.kt` — pair → grant → range → preview → sync → linked device.
- `PrivacyActivity.kt` — permission rationale / data-usage screen.
- `app/src/test/...` — JVM unit tests: pairing codes, payload/serializer/locale/provenance,
  queue (codec, dedupe, corruption), token vault migration, exercise types.

## Troubleshooting

- *"Health Connect not found" / "needs updating"* — install or update Health Connect, then reopen.
- *Preview shows 0 records* — your tracker is not writing to Health Connect yet (step 2 above),
  or the range predates what the provider has.
- *"That pairing code is not valid any more"* — codes are single-use and expire; generate a new one.
- *"IronDesk rejected this device"* — the link was revoked on the web. Unlink locally and pair again.
- *Sync fails offline* — the batch stays in the outbox; press **Sync now** when back online.
- *Longer ranges look short* — grant historical access, or accept the 30-day window.

## Remaining limits

- Verified with `./gradlew clean lintDebug testDebugUnitTest assembleDebug`: lint clean (0 errors,
  23 warnings), 33 unit tests passing, debug APK produced. Not run on a physical device here.
- No Changes-API incremental sync and no WorkManager background sync yet.
- Sleep is exported as total minutes; sleep stages are not exported.
- Play Store distribution additionally needs a health-app declaration, hosted privacy policy,
  data-safety answers and a review video. Sideloading needs none of that.
