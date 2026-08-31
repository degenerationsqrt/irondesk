# IronDesk Health privacy and permissions

This document describes the `app.irondesk.health` private beta and provides a review draft for the
Google Play Health Apps declaration and Data Safety answers. It is technical/product documentation,
not legal advice. The final Play answers, public privacy policy, in-app rationale, and implemented
behavior must agree exactly before submission.

## Product purpose

IronDesk Health is a read-only, athlete-initiated connector. It lets an adult athlete bring selected
fitness, recovery, and body-metric records from Android Health Connect into that athlete's own
IronDesk training journal. It is not a medical device, does not diagnose or treat a condition, does
not write to Health Connect, and does not operate in the background.

## Requested Health Connect access

The manifest declares the data types the user-facing selector can support. At runtime, the app asks
only for currently selected types. A denial does not block the whole app: denied selected types are
listed and skipped while authorized types remain usable.

| Permission                    |           Default | Athlete-facing use                                                                                                                  |
| ----------------------------- | ----------------: | ----------------------------------------------------------------------------------------------------------------------------------- |
| `READ_STEPS`                  |                On | Show daily activity volume and include step totals in IronDesk history.                                                             |
| `READ_SLEEP`                  |                On | Fill missing sleep duration in Recovery and help the athlete review training readiness.                                             |
| `READ_RESTING_HEART_RATE`     |                On | Fill missing resting-heart-rate recovery metrics.                                                                                   |
| `READ_HEART_RATE_VARIABILITY` |                On | Fill missing HRV recovery metrics.                                                                                                  |
| `READ_WEIGHT`                 |                On | Fill missing Body Metrics weight entries; values are stored canonically and displayed using the athlete's IronDesk unit preference. |
| `READ_ACTIVE_CALORIES_BURNED` |                On | Add active-energy totals to fitness history and enrich selected workout summaries.                                                  |
| `READ_DISTANCE`               |               Off | Add optional distance records and enrich selected workout summaries.                                                                |
| `READ_EXERCISE`               |                On | Import Health Connect exercise sessions into workout/activity history.                                                              |
| `READ_HEALTH_DATA_HISTORY`    | Separate/optional | Read more than the standard recent window for a user-selected 90-day or one-year import, only when the provider supports it.        |

The app also declares `INTERNET` solely for user-initiated pairing, sync, and unlink requests over
HTTPS. It does not declare location, contacts, camera, microphone, advertising ID, background
Health Connect access, or any Health Connect write permission. `ACCESS_NETWORK_STATE` was removed
because the app does not inspect network state.

## Data flow and user control

1. The athlete chooses record types and a range.
2. Android Health Connect displays and controls the permissions.
3. IronDesk Health reads the authorized selected records into memory.
4. The athlete sees counts and totals before export.
5. Nothing leaves the phone until the athlete selects **Sync now** or **Export JSON file instead**.
6. **Sync now** sends the prepared payload over HTTPS to the paired athlete's IronDesk account.
7. **Export JSON file instead** sends the payload only to a location selected through Android's
   system document picker.

There is no scheduled/background read, background upload, advertising, analytics SDK, sale of
health data, or sharing with a third-party advertising/data-broker service in this companion.

## Security and local retention

- A single-use web pairing code is exchanged for a scoped device token. The IronDesk password and
  backend keys are never stored on the phone.
- The device token and a maximum five failed-sync payloads are encrypted with AES-256/GCM using a
  non-exportable Android Keystore key.
- Failed batches retry only when the athlete presses **Sync now** again. An unreadable encrypted
  batch is discarded instead of transmitted or retried indefinitely.
- Android backup and device-to-device transfer are disabled. A new phone must be paired separately.
- Confirmed server unlink clears the token and outbox. **Forget locally only** clears local data but
  clearly warns that the server device link may remain until removed in IronDesk.
- Uninstalling deletes the app's local token and outbox, but it does not delete records already
  synced to IronDesk.

## Server retention and deletion statements to verify before Play review

The public policy and Data Safety form must accurately explain:

- how long imported metrics, activity records, device audit rows, and security logs remain;
- how an athlete deletes individual imported records, a connected device, all health-derived data,
  and the entire IronDesk account;
- whether deletion is immediate or queued, and any legal/security retention exception;
- the public web URL for requesting account deletion without reinstalling the Android app; and
- what remains after account deletion.

Do not submit the Play listing until the implemented account-deletion path and external deletion
URL have been tested from a signed-out browser. Health Connect revocation and local uninstall are
not substitutes for deleting server-side IronDesk data.

## Play Console preparation draft

Expected Health Apps categories based on current behavior:

- Activity and fitness
- Nutrition and weight management (weight only)
- Sleep management

For each Health Connect data type, the final declaration should restate the specific user-facing
benefit from the table above. Avoid broad language such as “improve the experience.” Google asks
for a concrete justification per requested type and expects minimum scope.

Data Safety requires careful terminology: health data sent to the user's IronDesk account normally
counts as data collected by the app even when it is not sold or shared for advertising. The final
answers must be generated from the shipped artifact and backend behavior, not copied mechanically
from this draft.

Prepare reviewer access and a short video that demonstrates:

1. signing into the test IronDesk account;
2. generating and consuming a pairing code;
3. choosing a minimal subset of Health Connect types;
4. granting one type and denying another;
5. previewing and syncing only the authorized type;
6. viewing the imported record in IronDesk;
7. revoking Health Connect access and unlinking the device; and
8. locating account/data deletion controls and the public privacy policy.

## Policy/document synchronization gate

Before every Play submission, compare these four surfaces line by line:

- `PrivacyActivity.kt` in the signed Android artifact;
- the public non-PDF IronDesk privacy-policy URL opened by that activity;
- the Google Play listing privacy-policy URL and Data Safety form; and
- the Health Apps declaration and per-permission justifications.

The public policy URL currently linked in the app is
`https://irondeskpro.lovable.app/privacy`. Verify that the deployed page contains
the Health Connect details, deletion instructions, and current contact identity before signing a
release. The same URL must be accessible without an account, geofencing, or a PDF viewer.

Authoritative references:

- [Health Connect setup and manifest configuration](https://developer.android.com/health-and-fitness/health-connect/get-started)
- [Publishing a Health Connect app](https://developer.android.com/health-and-fitness/health-connect/publish)
- [Google Play permissions and sensitive APIs policy](https://support.google.com/googleplay/android-developer/answer/16558241)
- [Google Play Health Content and Services policy](https://support.google.com/googleplay/android-developer/answer/16679511)
- [Google Play account-deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111)
