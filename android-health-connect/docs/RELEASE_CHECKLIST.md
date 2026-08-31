# IronDesk Health private-beta release checklist

Use this as a hard gate. A checked source build is not a signed beta, and a signed beta is not a
public Play release. Record artifact hashes, certificate fingerprints, device evidence, and the
person/date for each gate in the release ticket.

## 1. Source and service boundary

- [ ] Work from the canonical `degenerationsqrt/irondesk` repository and expected release commit.
- [ ] Confirm the only intended Android package is `app.irondesk.health`; do not package the legacy
      untracked `android/` Capacitor project.
- [ ] Confirm `versionName` is `1.1.0-beta.1`, `versionCode` is `11001`, and target/compile SDK are 36.
- [ ] Confirm the default endpoint is exactly `https://irondeskpro.lovable.app` and no preview,
      localhost, plain-HTTP, or secret-bearing URL appears in the release resources/classes.
- [ ] Verify the production pair, ingest, unpair, linked-device, and account-deletion endpoints are
      deployed against the intended Supabase project.
- [ ] Confirm server-side deduplication and “manual entries win” behavior with automated tests.
- [ ] Review all dependency and Android lint warnings; disposition each remaining warning.

## 2. Reproducible verification build

- [ ] Run `.github/workflows/android-health-connect.yml` at the exact release commit.
- [ ] Confirm lint has zero errors and every JVM test passes.
- [ ] Confirm CI metadata checks report package `app.irondesk.health`, version code `11001`, version
      name `1.1.0-beta.1`, and target SDK 36.
- [ ] Confirm CI uploads only clearly labeled unsigned, short-lived verification artifacts and does
      not publish a GitHub release or Play build.
- [ ] Save the CI run URL in the release ticket.

Recommended local command:

```powershell
Set-Location android-health-connect
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
.\gradlew.bat --no-daemon clean lintDebug testDebugUnitTest assembleDebug assembleRelease bundleRelease
```

## 3. Signing identity and protected release build

- [ ] Decide the controlled distribution path: Google Play internal/closed testing is preferred;
      a direct APK is optional for named testers.
- [ ] Enroll `app.irondesk.health` in Play App Signing before broad distribution.
- [ ] Create or identify a long-lived upload key in an approved secret store. Record owner, backup,
      recovery path, certificate SHA-256 fingerprint, and expiration.
- [ ] Never commit a `.jks`, `.keystore`, password, service-account JSON, or base64 key.
- [ ] Build the signed AAB in an authorized protected environment.
- [ ] If direct sideload testing is approved, build a signed APK from the same commit and signing
      identity. Do not distribute a debug-signed APK.
- [ ] Name direct artifacts unambiguously, for example
      `IronDesk-Health-1.1.0-beta.1-signed.apk`; never reuse the legacy
      `IronDesk-0.9.0-debug.apk` name.

Inspect the exact signed APK, not an earlier local output:

```powershell
$buildTools = "$env:LOCALAPPDATA\Android\Sdk\build-tools\36.0.0"
& "$buildTools\aapt.exe" dump badging .\IronDesk-Health-1.1.0-beta.1-signed.apk
& "$buildTools\apksigner.bat" verify --verbose --print-certs .\IronDesk-Health-1.1.0-beta.1-signed.apk
Get-FileHash .\IronDesk-Health-1.1.0-beta.1-signed.apk -Algorithm SHA256
```

- [ ] Package/version/SDK values match the release ticket.
- [ ] Release certificate matches the recorded private-beta certificate and is not Android Debug.
- [ ] APK signature verification succeeds for supported schemes.
- [ ] Manifest contains only documented permissions and both pre-14/14+ rationale/onboarding
      entry points.
- [ ] APK/AAB contains no token, password, service key, unexpected host, analytics SDK, or cleartext
      endpoint.
- [ ] Publish the SHA-256 and certificate fingerprint through the same authenticated private-test
      channel as the installer.

## 4. Physical-device matrix

At minimum, retain screenshots/video and a written result from:

- [ ] Android 13 or lower with the separate Health Connect APK.
- [ ] Android 14 or higher with framework Health Connect.
- [ ] One Samsung device/Samsung Health path if Samsung Health is advertised in user guidance.
- [ ] A clean install and an update from the preceding signed beta using the same signing identity.

For each device, test:

- [ ] Health Connect absent, update-required, empty-data, and available states.
- [ ] Launch from the normal icon and from Health Connect's onboarding connection surface.
- [ ] Privacy-policy link from both pre-Android-14 and Android-14+ Health Connect surfaces.
- [ ] Correct eight-character code, expired code, reused code, malformed code, and wrong-account
      code.
- [ ] Minimal one-type grant.
- [ ] Partial grant: approve one selected type and deny another; preview/sync succeeds for only the
      authorized type and identifies the skipped type.
- [ ] Grant, revoke in system settings, return to foreground, and verify the UI refreshes.
- [ ] 7/30-day reads without history and 90/365-day behavior with history granted, denied, and
      unsupported.
- [ ] Preview counts/totals match source records within documented aggregation rules.
- [ ] Sync creates the correct IronDesk Recovery, Body Metrics, and activity records.
- [ ] Imperial IronDesk profiles display imported weight in pounds while stored values remain
      canonical.
- [ ] A manual recovery/weight entry is not overwritten.
- [ ] Repeating the same sync imports no duplicate records.
- [ ] Offline sync queues exactly one encrypted batch and a later user-initiated retry drains it.
- [ ] App force-stop/relaunch retains pairing without exposing plaintext token/outbox files.
- [ ] Server unlink revokes the token; an attempted later sync is rejected.
- [ ] **Forget locally only** clears local state but leaves a clearly removable web device.
- [ ] Removing the web device makes the old phone token unusable.
- [ ] Account deletion removes/revokes device access and the signed-out deletion URL works.

Do not claim physical end-to-end success from a screenshot of a populated preview alone. The proof
must cover pair → permission → preview → sync → web verification → duplicate sync → offline retry →
revoke/unlink.

## 5. Privacy, policy, and Play Console

- [ ] Public privacy policy is an active, non-PDF, non-geofenced URL viewable while signed out.
- [ ] The signed app's in-app rationale and Health Connect privacy link match that public policy.
- [ ] Policy names every requested type, purpose, collection/transfer, encryption, retention,
      deletion, and contact path.
- [ ] In-app account deletion and external signed-out deletion/request URL are live and tested.
- [ ] Data Safety form is completed from the shipped app and backend facts.
- [ ] Health Apps declaration includes only the current categories and data types.
- [ ] Every requested Health Connect permission has a concrete minimum-scope justification.
- [ ] Store listing and screenshots do not make medical/diagnostic claims.
- [ ] Reviewer credentials/instructions are current and least-privileged.
- [ ] Review video shows the core sync flow, partial grant handling, privacy policy, unlink, and
      account deletion.

## 6. Controlled beta publication

- [ ] Upload the signed AAB to a Google Play internal test first.
- [ ] Resolve every automated/pre-launch report, policy warning, permission declaration, and tester
      access problem before closed testing.
- [ ] Restrict the direct signed APK, if any, to named testers and an authenticated channel.
- [ ] Publish [the tester setup guide](PRIVATE_BETA_SETUP.md) beside the invitation.
- [ ] Add the web download button only after a real installer URL exists. Until then, keep the web
      UI labeled **Developer preview** or **Private beta — invitation required**.
- [ ] The button must identify Android-only support, minimum Android version, beta status, and the
      privacy/setup links.
- [ ] Monitor pairing, sync, duplicate, queue, and revoke outcomes without logging raw health
      records, device tokens, passwords, or pairing codes.

## 7. Promotion and rollback

- [ ] Define pass/fail thresholds and a named beta owner before inviting testers.
- [ ] Keep a server-side method to revoke a compromised device token or disable new pairing without
      deleting athlete data.
- [ ] A compromised signing/upload key, wrong endpoint, cross-account result, data overwrite,
      plaintext health-data leak, or broken deletion/revocation path is a stop-ship event.
- [ ] For a bad beta, halt invitations/download links, revoke affected tokens as needed, preserve
      audit evidence without sensitive payloads, fix with a higher version code, and retest the
      entire flow. Do not overwrite an already distributed artifact under the same filename/hash.
- [ ] Promote to a public Play listing only after closed-beta evidence, policy approval, deletion,
      and support ownership are complete.
