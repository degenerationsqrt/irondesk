# Completed IronDesk workouts to Health Connect

Version 1.2.0-beta.1 adds user-initiated workout export alongside the existing inbound sync.

## Use

1. Finish and sync a workout on irondeskpro.com. Offline pending workouts must reach the account first.
2. Open the updated, paired IronDesk Health Android companion.
3. Under **IronDesk workouts → Health Connect**, choose 7, 30, 90 or 365 days and preview.
4. Grant **Allow writing workouts** when ready. This asks only for `WRITE_EXERCISE`.
5. Press **Write workout(s) to Health Connect**. Permission alone never starts a write.
6. Verify the exercise entry and IronDesk source in Health Connect. Repeat the write and verify one copy.

Session name, real start/end instants, known workout type and session notes are written.
Notes include performed exercise names and each completed set's logged repetitions, load, optional
RPE and warm-up label, in the account's weight units. Planned/incomplete sets are excluded; missing
measurements are labeled as not logged. The server caps notes at 2,000 characters for compatibility
with existing 1.2.0-beta.1 companions and marks shortened breakdowns with "More details in IronDesk."
Open a fresh preview and write again to add the breakdown to an existing Health Connect entry.
Strength maps to strength training; mobility to stretching; generic cardio/conditioning to other
workout because a specific sport cannot be inferred. No timed set segments, calories, heart-rate
measurements or fabricated time zone are supplied. IronDesk records set completion but not set
start times, so a true segment interval cannot be reconstructed. Metadata marks manually logged
records. Other apps' visibility depends on their Health Connect permissions and behavior; writing
notes does not guarantee Samsung Health or another app displays them as a structured exercise list.

## Service and idempotency

`GET /api/public/health-connect/workouts?from=<ISO>&to=<ISO>&after=<optional UUID>` uses the existing
Android bearer device credential. Owner identity is resolved server-side. A Garmin token is rejected.
The service reads only that owner's completed, non-sample `workout_sessions`; imported activities
are in a different table and are never exported. No database migration is required.

Queries use bounded one-year windows and ascending UUID pagination (100 rows per page). Invalid
timing is counted as skipped; the cursor advances across raw rows so later valid records are not lost.
Responses use `private, no-store`; previews stay in memory and are cleared when unpairing.

Records use `irondesk:workout:<session UUID>` as `clientRecordId`. `clientRecordVersion` is the latest
of the server preview timestamp and the session update/end timestamps. Every fresh preview can
therefore refresh set edits, deleted sets and unit changes without relying on a parent timestamp
change. Retries of the same in-memory preview retain its version. Replaying after partial failure retains or updates the
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
- Verify the record notes contain actual exercise names, completed sets and the correct weight units.
- Re-preview after editing or deleting a set: the existing record's notes should reflect the change.
- Import the same period back to IronDesk: no duplicate imported activity for that IronDesk export.
- Verify network failure, revoked permissions and a retry after an interrupted batch.

Computer build/tests alone cannot prove Health Connect provider writes on a physical phone.
