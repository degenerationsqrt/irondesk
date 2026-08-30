# IronDesk for Garmin Connect IQ

This directory contains the native IronDesk Connect IQ device app. It is a separate Monkey C application, not a wrapper around the React web app.

## MVP workflow

1. Start or prepare a workout in IronDesk.
2. In IronDesk **Connections**, generate a Garmin pairing code.
3. In Garmin Connect or the Connect IQ Store app, open IronDesk app settings and enter the pairing code. The production IronDesk server is prefilled.
4. Launch IronDesk from the watch activity list. The app downloads and caches the active session.
5. Select to start the strength FIT activity. Up/down changes reps; the menu changes load/RPE, syncs, finishes, or discards.
6. Each confirmed set is stored locally first and sent to IronDesk with an idempotent event ID. Temporary connectivity loss does not stop the workout.
7. Finishing saves the Garmin FIT activity and queues the IronDesk completion event.

The watch stores only a revocable device token. It never receives a Supabase user session or service-role key. The token and every in-flight request are bound to the exact HTTPS origin used during pairing. Cached recovery state and pending events are also bound to their original origin: changing servers cannot send the previous server's workout data to the new one. The watch instead requires the old URL to be restored or presents a confirmed local-data discard that first safely closes any open FIT session. IronDesk remains the source of truth for programs, templates, gated acknowledgments, exercise substitutions, and history edits.

Confirmed events are kept in a bounded local queue until the server acknowledges every event ID exactly once. Permanent server rejections are quarantined and shown as a blocking conflict with explicit retry and **Use server workout** choices. An interrupted session fetches the current server snapshot before resuming online; offline resume remains available from the last valid cache.

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
- The release default is `https://irondeskpro.lovable.app`. The server setting remains editable for controlled development or support migrations, and origin-bound cached data is never silently sent to a replacement server.
- Manual set confirmation is authoritative. Garmin's strength sub-sport tag does not provide automatic exercise or rep recognition.
- The app records one Garmin lap per confirmed set but does not yet add custom FIT developer fields.
- Real-device behavior, store settings delivery, optical HR, vibration, Bluetooth interruption, and Garmin Connect FIT presentation must be verified on the user's actual watch before public submission.
