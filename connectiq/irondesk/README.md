# IronDesk for Garmin Connect IQ

This directory contains the native IronDesk Connect IQ device app. It is a separate Monkey C application, not a wrapper around the React web app.

## MVP workflow

1. Start or prepare a workout in IronDesk.
2. In IronDesk **Connections**, generate a Garmin pairing code.
3. In Garmin Connect or the Connect IQ Store app, open IronDesk app settings and enter the pairing code. New configurations prefill the direct production server, `https://irondeskpro.com`.
4. Launch IronDesk from the watch activity list. The app downloads and caches the active session.
5. Select to start the strength FIT activity. Up/down changes reps. Hold Menu and choose **Edit weight** to open the on-watch weight editor; use up/down for repeated changes, Select to save, Back to cancel, and hold Menu to toggle coarse/fine increments. The workout menu also changes RPE, syncs, finishes, or discards.
6. Each confirmed set is stored locally first and sent to IronDesk with an idempotent event ID. Temporary connectivity loss does not stop the workout.
7. Finishing saves the Garmin FIT activity and queues the IronDesk completion event.

The watch stores only a revocable device token. It never receives a Supabase user session or service-role key. The token and every in-flight request are bound to the exact HTTPS origin used during pairing. Cached recovery state and pending events are also bound to their original origin: changing servers cannot send the previous server's workout data to the new one. The watch instead requires the old URL to be restored or presents a confirmed local-data discard that first safely closes any open FIT session. IronDesk remains the source of truth for programs, templates, gated acknowledgments, exercise substitutions, and history edits.

Confirmed events are kept in a bounded local queue until the server acknowledges every event ID exactly once. Permanent server rejections are quarantined and shown as a blocking conflict with explicit retry and **Use server workout** choices. An interrupted session fetches the current server snapshot before resuming online; offline resume remains available from the last valid cache.

During a visible ready, active, rest, or all-sets-done screen, the watch refreshes the current workout approximately every 15 seconds. Failed requests back off to at most one attempt every two minutes. **Sync — Send + refresh** sends pending confirmed events first, then fetches the latest saved website values. Website edits must finish saving before they can appear on the watch.

Hold MENU to inspect **Refresh status** without sending anything or changing a set. The informational item shows the latest outcome, such as `Snapshot applied (200)`, `GET network -104`, or `HTTP 401`; network codes are Garmin response codes, not HTTP statuses. `Response skipped (200)` means a response arrived while the screen was hidden or no longer eligible; it does not claim the snapshot was applied. `Server workout changed` indicates reconciliation is blocked. The active workout controls remain unchanged. Selecting this status item has no action; use BACK to return. The displayed menu text is captured when the menu opens, so reopen it to read a later result. Selecting **Sync** still sends pending confirmed events before fetching.

Refresh preserves the live FIT recorder and rest timer. Only fields actually edited on the watch and unacknowledged confirmed sets override incoming planned values; acknowledged sets become server-authoritative again. Saving a weight edit stores a local draft; confirming its set sends it. A remotely completed current set advances the watch without creating a new FIT lap, unless doing so would pass an unsent watch draft; that case requires explicit reconciliation. Responses received while a menu/editor is open, or after finishing, cannot replace the active screen. The same session and ordered exercise/set IDs are required: a changed or ended server workout keeps the recording and local cache until an explicit recovery choice. **Use server workout** saves an open partial FIT before discarding local changes and accepting that server state.

A rejected startup snapshot displays **Workout not compatible**. Hold MENU and read **Refresh status** for the server's specific reason, such as rep-guidance length or an invalid RPE. The reason is normalized and limited to 120 characters; an unavailable reason uses a generic compatibility label. A compatibility rejection does not necessarily mean the workout has too many sets. After correcting the workout in IronDesk, START on this error screen retries its download.

Upgrade only after the current workout is finished, saved and synchronized. Older cached workouts have no field-edit provenance; when recovering such a cache, the current incomplete set's values are conservatively retained until that real set is explicitly confirmed and acknowledged. Do not confirm a synthetic or incorrect set to clear this compatibility boundary. Verify new refresh behavior with the next clean workout.

Existing saved server settings are preserved by an app update. The former default, `https://irondeskpro.lovable.app`, redirects to `https://irondeskpro.com` in the September 12, 2026 production checks; a browser redirect does not establish that Garmin's authenticated GET/POST follows it successfully. Do not change the URL during a recording: the app deliberately invalidates pairing for a changed origin and attempts to save the partial FIT. Finish the real workout, save its FIT, and confirm all pending IronDesk changes have synchronized using the existing server first. Then change the setting to the direct origin and pair again with a fresh Garmin code. Credentials and cached data are never silently migrated. If the old server cannot synchronize or protected data remains, preserve it and use the existing recovery choices with support rather than clearing data or changing origins to bypass the block.

FIT save/discard failures are non-terminal. Before closing Garmin's activity session, the watch durably checkpoints the exact completion event and whether a FIT activity is expected. On restart it checks Garmin's timer state before reacquiring an unclosed session, so it never creates and saves an empty recovery activity. The IronDesk completion event is not queued until FIT save succeeds, no new FIT was expected, or the user explicitly resolves an uncertain/failed FIT. The explicit uncertainty screen covers the unavoidable crash window between Garmin closing its FIT file and the app persisting that outcome.

If the active server workout already has every set completed before the watch starts, IronDesk clearly finishes the server session without creating a new empty Garmin activity.

## Build

The current project is validated with Connect IQ SDK 9.2.0. Use a private 4096-bit RSA PKCS#8 DER developer key and never commit it.

```powershell
$ciqSdkBin = 'C:\Users\johnm\AppData\Roaming\Garmin\ConnectIQ\Sdks\connectiq-sdk-win-9.2.0-2026-06-09-92a1605b2\bin'
$ciqKey = 'C:\Users\johnm\Documents\Garmin Developer Keys\irondesk-developer-key.der'

& "$ciqSdkBin\monkeyc.bat" `
  -f .\monkey.jungle `
  -o .\bin\IronDesk.prg `
  -y $ciqKey `
  -d fenix7 `
  -w
```

For the Garmin Store package, export only after simulator and physical-device testing for every product listed in `manifest.xml`:

```powershell
& "$ciqSdkBin\monkeyc.bat" `
  -f .\monkey.jungle `
  -o .\bin\IronDesk.iq `
  -y $ciqKey `
  -e -r -w
```

See `STORE_SUBMISSION.md` for the release gates, proposed listing, permission disclosures, device matrix, and production handoff.

## Current boundaries

- The first release operates on an already-active IronDesk session; it cannot bypass program enrollment or warning acknowledgments.
- The release default for new configurations is `https://irondeskpro.com`. The server setting remains editable for controlled development or support migrations, and origin-bound cached data is never silently sent to a replacement server.
- Manual set confirmation is authoritative. Garmin's strength sub-sport tag does not provide automatic exercise or rep recognition.
- Weight editing stays in the user's Garmin unit system while the editor is open. Coarse steps are 5 lb or 2.5 kg, fine steps are 0.5 lb/kg, and only the saved result is converted to canonical kilograms for IronDesk.
- The app records one Garmin lap per confirmed set but does not yet add custom FIT developer fields.
- Real-device behavior, store settings delivery, optical HR, vibration, Bluetooth interruption, and Garmin Connect FIT presentation must be verified on the user's actual watch before public submission.
