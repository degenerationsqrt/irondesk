# IronDesk Health Connect companion (source only)

Android's Health Connect has **no web API**: a browser cannot read it, and there is no
OAuth-style server flow. The only supported path is an on-device app that the user grants
read permission to, which then writes an export file the user hands to IronDesk.

This directory holds the complete Kotlin/Compose source for that app. **No APK is built or
distributed from this repository** — there is no Android SDK/Gradle toolchain in the build
environment, and shipping an unsigned binary would be worse than shipping none. Build it
yourself with Android Studio (Ladybug or newer) or `./gradlew assembleDebug` after adding a
standard Gradle wrapper.

## What it does

1. Requests read permission for steps, sleep, resting heart rate, HRV, weight, active
   calories, distance and exercise sessions — nothing else, and each is revocable in
   Android settings.
2. Lets the user pick a date range and which record types to include.
3. Shows a count per record type before exporting (no silent full-history dump).
4. Writes `irondesk-health-<date>.json` through the system file picker. The file never
   leaves the device on its own; there is no background upload and no analytics.
5. The user uploads that JSON on IronDesk → Connections & Imports → Health Connect import.

## Export contract

The JSON matches what `src/lib/imports/json.ts` reads without any mapping step:

```json
{
  "source": "irondesk-health-connect",
  "version": 1,
  "exportedAt": "2026-05-01T09:12:00Z",
  "records": [
    { "external_id": "hc:steps:2026-05-01", "metric": "steps", "timestamp": "2026-05-01T00:00:00Z", "value": 11423, "unit": "count" },
    { "external_id": "hc:rhr:2026-05-01", "metric": "resting_heart_rate", "timestamp": "2026-05-01T05:02:00Z", "value": 48, "unit": "bpm" }
  ],
  "activities": [
    { "external_id": "hc:sess:abc", "activity_type": "running", "start_time": "2026-05-01T06:30:00Z", "duration_sec": 2520, "distance_m": 8200, "calories": 540, "average_heart_rate": 151 }
  ]
}
```

`external_id` values are stable per record, so re-exporting an overlapping range imports
zero duplicates — IronDesk dedupes on `ext:health_connect:<external_id>`.

## Files

- `app/build.gradle.kts` — module config and Health Connect client dependency.
- `app/src/main/AndroidManifest.xml` — permissions and the rationale activity Health Connect requires.
- `app/src/main/java/app/irondesk/health/HealthRepository.kt` — permission set and record reads.
- `app/src/main/java/app/irondesk/health/ExportBuilder.kt` — JSON contract above.
- `app/src/main/java/app/irondesk/health/MainActivity.kt` — Compose UI: permissions, range, preview, export.

## Honest limits

- Untested on a physical device from this environment; the code compiles against the
  documented `androidx.health.connect:connect-client` API but has not been run.
- Health Connect is Android 14+ (platform) or Android 8+ with the Health Connect app.
- Only aggregate/summary records are exported; per-second series are deliberately skipped.
