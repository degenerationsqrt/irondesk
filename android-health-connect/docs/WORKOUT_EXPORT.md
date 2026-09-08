# Completed IronDesk workouts to Health Connect

Version 1.2.0-beta.1 adds user-initiated workout export alongside the existing inbound sync.

## Use

1. Finish and sync a workout on irondeskpro.com. Offline pending workouts must reach the account first.
2. Open the updated, paired IronDesk Health Android companion.
3. Under **IronDesk workouts → Health Connect**, choose 7, 30, 90 or 365 days and preview.
4. Grant **Allow writing workouts** when ready. This asks only for `WRITE_EXERCISE`.
5. Press **Write workout(s) to Health Connect**. Permission alone never starts a write.
6. Verify the exercise entry and IronDesk source in Health Connect. Repeat the write and verify one copy.

Only session name, real start/end instants, known workout type and session notes are written.
Strength maps to strength training; mobility to stretching; generic cardio/conditioning to other
workout because a specific sport cannot be inferred. No set timeline, repetitions, weights,
calories, heart-rate measurements or fabricated time zone is supplied. Metadata marks manually
logged records. Other apps' visibility depends on their Health Connect permissions and behavior.

## Service and idempotency

`GET /api/public/health-connect/workouts?from=<ISO>&to=<ISO>&after=<optional UUID>` uses the existing
Android bearer device credential. Owner identity is resolved server-side. A Garmin token is rejected.
The service reads only that owner's completed, non-sample `workout_sessions`; imported activities
are in a different table and are never exported. No database migration is required.

Queries use bounded one-year windows and ascending UUID pagination (100 rows per page). Invalid
timing is counted as skipped; the cursor advances across raw rows so later valid records are not lost.
Responses use `private, no-store`; previews stay in memory and are cleared when unpairing.

Records use `irondesk:workout:<session UUID>` as `clientRecordId` and the server session update/end
timestamp as `clientRecordVersion`. Replaying after partial failure safely retains or updates the
same record. Writes use batches of 100 with permission rechecked before each batch. A later preview
sees edits; older previews cannot overwrite newer record versions. No remote deletion is performed.
Removing sessions/accounts/uninstalling does not delete exported copies; use Health Connect controls.

The inbound reader and mapper exclude records bearing both an IronDesk package origin and the
IronDesk client ID prefix, preventing import loops while retaining other apps' exercise records.

## Release and physical-device verification

Deploy the API route and updated privacy/setup pages before distributing the APK. Keep the same
Android package and signing certificate for an in-place update. Update Play Health Connect and Data
Safety declarations to include exercise writing before a Play distribution; no Play submission is
part of this code change.

- Test auth isolation, revocation, outages, invalid windows, pagination and version mapping.
- Run Android lint, JVM tests and APK assembly; verify package, certificate and `WRITE_EXERCISE`.
- On a paired phone, deny write permission: no record should be written.
- Grant writing, preview one completed account workout, write and inspect its actual Health Connect entry.
- Write twice, then edit and re-preview: one record should remain and reflect the newer version.
- Import the same period back to IronDesk: no duplicate imported activity for that IronDesk export.
- Verify network failure, revoked permissions and a retry after an interrupted batch.

Computer build/tests alone cannot prove Health Connect provider writes on a physical phone.
