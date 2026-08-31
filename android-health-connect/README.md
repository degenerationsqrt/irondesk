# IronDesk Health Connect companion (Android)

IronDesk Health is the on-device bridge between Android Health Connect and an athlete's own
IronDesk account. A browser cannot read Health Connect directly. This companion lets the athlete
choose record types and a date range, preview what is available, and then either sync it over
HTTPS or export the same payload as JSON.

## Release status

**Private-beta engineering build — not a public download.**

- Package: `app.irondesk.health`
- Version: `1.1.0-beta.1` (`versionCode 11001`)
- Android: min SDK 28 (Android 9), target/compile SDK 36 (Android 16)
- Distribution: no signed APK or AAB is committed or produced by CI
- Production endpoint: `https://irondeskpro.lovable.app`

The older GitHub asset `IronDesk-0.9.0-debug.apk` is the legacy full Capacitor app
(`com.irondesk.app`). It is **not** this Health Connect companion and must not be offered as the
connector download.

Before inviting testers, complete [the release checklist](docs/RELEASE_CHECKLIST.md) and give
them [the private-beta setup guide](docs/PRIVATE_BETA_SETUP.md). The requested data types and the
Play/privacy preparation are documented in
[Privacy and permissions](docs/PRIVACY_AND_PERMISSIONS.md).

## What the companion does

- Pairs with an eight-character, single-use code generated in IronDesk.
- Stores the resulting device token behind an AES-256/GCM Android Keystore key; it never stores
  an IronDesk password or backend service key.
- Requests read permission only for the record types currently selected by the athlete.
- Handles partial grants: unauthorized selected types are visibly listed and safely skipped;
  authorized types can still be previewed and synced.
- Reads steps, sleep, resting heart rate, HRV, weight, active calories, distance, and exercise
  sessions. Distance is optional and off by default.
- Requests historical access separately and only when the installed Health Connect provider
  supports it. Without it, ranges longer than 30 days are honestly capped to 30 days.
- Shows per-type record counts and totals before anything leaves the phone.
- Syncs only when the athlete presses **Sync now**, or writes a JSON file through Android's system
  document picker.
- Encrypts a maximum five-batch retry outbox at rest. There is no background read or upload.
- Lets the athlete revoke the server token, forget local credentials, and manage system Health
  Connect permissions.
- Disables Android cloud backup and device transfer for tokens and queued health payloads.

The companion is read-only: it declares no Health Connect write permission.

## Build and verify locally

Requirements:

- JDK 17
- Android SDK platform 36 and build-tools 36.0.0
- Android Studio Meerkat 2024.3.1 Patch 1 or newer, or the command-line SDK tools

On Windows PowerShell:

```powershell
Set-Location android-health-connect
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
.\gradlew.bat --no-daemon lintDebug testDebugUnitTest assembleDebug assembleRelease bundleRelease
```

On macOS or Linux:

```bash
cd android-health-connect
./gradlew --no-daemon lintDebug testDebugUnitTest assembleDebug assembleRelease bundleRelease
```

Override the IronDesk service for an authorized preview environment with
`-PirondeskBaseUrl=https://your-host`. The default is the production HTTPS endpoint above.

Important artifact boundaries:

- `app/build/outputs/apk/debug/app-debug.apk` is debug-signed for local developer testing only.
- `app/build/outputs/apk/release/app-release-unsigned.apk` is not installable by ordinary testers.
- `app/build/outputs/bundle/release/app-release.aab` is not ready for Play until it is signed with
  the controlled upload identity.
- Keystores, passwords, and Play credentials must never be committed to this repository.

## Continuous integration

`.github/workflows/android-health-connect.yml` runs for companion changes and manual dispatches.
It installs JDK 17 plus Android SDK 36, runs lint and JVM tests, builds debug and release variants,
checks package/version/target metadata, and uploads short-lived **unsigned verification
artifacts** with checksums.

The workflow intentionally:

- has read-only repository permissions;
- contains no signing secret;
- does not create a GitHub release;
- does not publish to Google Play; and
- labels the uploaded release outputs `UNSIGNED` and `DO NOT DISTRIBUTE`.

A signed private beta is a separate, authorized release operation after the physical-device,
privacy, account-deletion, and Play declaration gates pass.

## Pair, preview, sync, and unlink

The ordinary tester path is maintained in [Private beta setup](docs/PRIVATE_BETA_SETUP.md). In
brief:

1. A tracker such as Samsung Health writes records to Health Connect.
2. The athlete generates a code under **Connections & Imports** in IronDesk.
3. IronDesk Health exchanges that code for a limited device token.
4. The athlete selects record types and grants only the desired read permissions.
5. The athlete previews a range and presses **Sync now** or **Export JSON file instead**.
6. The server deduplicates deterministic external IDs and fills recovery/weight gaps without
   overwriting days logged manually.
7. The athlete can revoke Health Connect permissions and unlink the server token independently.

## Notable data behavior

- Steps use Health Connect daily aggregation instead of summing overlapping raw writers.
- All pages are read, with a defensive cap of 20,000 records per type per sync.
- Exercise types use official `ExerciseSessionRecord.EXERCISE_TYPE_*` constants.
- Source package, device manufacturer/model, recording method, and timezone are retained when
  Health Connect supplies them.
- Exercise sessions can be enriched with selected distance and active-calorie records inside the
  session window.
- Re-syncing an overlapping range is safe because external IDs are deterministic and the server
  deduplicates them.
- Sleep, HRV, resting heart rate, and weight fill missing IronDesk days only. The server protects
  manual entries.

## Project map

- `app/build.gradle.kts` — package, beta version, SDK levels, production endpoint, unsigned
  release boundary.
- `app/src/main/AndroidManifest.xml` — minimum read permissions, package visibility, privacy
  rationale aliases, onboarding aliases, and backup exclusions.
- `MainActivity.kt` — pair → select → grant → preview → sync → unlink flow.
- `HealthRepository.kt` — availability, selected-type permission policy, partial-grant filtering,
  historical feature check, reads, pagination, and aggregated steps.
- `HealthMapper.kt`, `Aggregation.kt`, `Payload.kt` — Health Connect data to deterministic IronDesk
  payloads and preview totals.
- `Crypto.kt`, `TokenStore.kt`, `SyncQueue.kt` — Android Keystore encryption, legacy token
  migration, and encrypted retry queue.
- `SyncClient.kt` — pair, ingest, and unpair HTTPS calls.
- `PrivacyActivity.kt`, `OnboardingActivity.kt` — Health Connect privacy and onboarding entry
  points for Android 13 and Android 14+.
- `app/src/test/...` — JVM tests for permissions, pairing, payloads, aggregation, queue encryption,
  token migration, and exercise mapping.

## Remaining beta gates

Passing Gradle checks proves the source builds; it does not prove a releasable product. The beta
still requires a controlled signing identity, a signed-artifact inspection, physical Android 13
and Android 14+ testing, end-to-end production pairing/sync/revoke evidence, a matching public
privacy policy, Data Safety answers, Health Apps declaration, permission justifications, account
deletion verification, and a reviewer-access/video package.

Current Android references:

- [Get started with Health Connect](https://developer.android.com/health-and-fitness/health-connect/get-started)
- [Publish a Health Connect app](https://developer.android.com/health-and-fitness/health-connect/publish)
- [Google Play Health Content and Services policy](https://support.google.com/googleplay/android-developer/answer/16679511)
