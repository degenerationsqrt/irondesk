# IronDesk mobile Android foundation

This directory is an **internal engineering preview**, not the public IronDesk app and not a
Play-upload candidate.

It establishes one release-critical native behavior: workout actions are validated, assigned stable
client mutation IDs, encrypted with an AndroidKeyStore AES-256/GCM key, and committed through an
atomic same-directory file replacement before the UI advances. If the filesystem cannot honor the
atomic move, the mutation fails and the previous journal remains authoritative. Exact event replays
are idempotent; reusing an ID with different data is a conflict; and an unreadable journal is surfaced
instead of silently replaced. The encrypted journal is capped at 8 MiB both before commit and during
load, so an oversized mutation cannot replace the last valid journal.

Separate Activity or worker instances serialize their read-modify-write cycle with a process lock and
an OS file lock, preventing an atomic-but-stale writer from dropping another saved event.

## Deliberate safety boundaries

- Native Jetpack Compose; there is no `WebView` and no hosted-site wrapper.
- The manifest has no `INTERNET` permission. Only sample data can be used.
- The disposable package is `app.irondesk.mobile.preview.debug`. Do not register it in Play.
- The Gradle release variant is disabled. This project only exposes debug preview artifacts; it cannot
  produce a release APK or release app bundle.
- Android backup and device transfer are disabled for the journal.
- Supabase remains the authoritative IronDesk backend, but auth and synchronization are not faked in
  this preview.
- The existing `android-health-connect/` companion remains unchanged. Its reviewed permission,
  mapping, encrypted-token, and retry behavior should be extracted into a shared module rather than
  copied wholesale into the public app.

The existing Lovable/TanStack Start build cannot be used as a local Android bundle as-is. A verified
`pnpm run build` produces client assets under `.output/public/assets` and a required Nitro server at
`.output/server/index.mjs`, but no `.output/public/index.html`. Loading the production URL inside a
WebView would therefore be a thin remote wrapper and is explicitly not this project's architecture.

## Build and test

The launchers delegate to the already tracked Gradle wrapper in `android-health-connect/`; no second
wrapper binary is copied into the repository.

PowerShell:

```powershell
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
.\gradlew.bat lintDebug testDebugUnitTest assembleDebug
```

Linux CI:

```bash
chmod +x gradlew ../android-health-connect/gradlew
./gradlew --no-daemon lintDebug testDebugUnitTest assembleDebug
```

The local APK is written to `app/build/outputs/apk/debug/app-debug.apk`.

## Gates before this can become the public app

1. Choose and verify the permanent package and Play App Signing/upload-key identity.
2. Add secure native Supabase authentication, refresh-token rotation, and recovery/deletion flows.
3. Define a replay-safe server contract for workout mutations and acknowledge each client mutation ID
   only after Supabase commits it under RLS.
4. Add an outbox acknowledgment/checkpoint model; this preview intentionally retains every mutation
   as pending because no backend adapter exists.
5. Extract Health Connect code into a shared native module and integrate it without broadening the
   existing read-only permissions.
6. Replace sample-only UI with the complete start/log/rest/finish/history flow, preserving server-side
   assignment and progression gates.
7. Test process death, storage exhaustion, clock changes, offline recovery, duplicate replay, session
   expiry, account switching, and sign-out cleanup on physical Android 13 and Android 14+ devices.
8. Add Play billing/entitlements only after the free core workout loop is reliable.
9. Complete Play policy declarations, reviewer access, signed AAB inspection, and staged release QA.

Before accepting real user data, the AndroidKeyStore codec contract must also distinguish confirmed
authentication/corruption failures from temporary provider or I/O unavailability. The preview fails
closed, but production recovery UI must never offer destructive reset based on an ambiguous codec
failure.
