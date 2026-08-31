# IronDesk Health private-beta setup

This guide is for invited Android testers after a maintainer supplies either a Google Play
internal/closed-test invitation or a signed private-beta APK. CI's `UNSIGNED` files and the old
`IronDesk-0.9.0-debug.apk` are not tester installers.

## Before you start

You need:

- An Android 9 or newer phone. Android 14+ includes Health Connect in the operating system;
  Android 13 and lower use the Health Connect app from Google Play.
- An IronDesk account you can sign into at `https://irondeskpro.lovable.app`.
- A tracker source that already writes records into Health Connect. Samsung Health is one
  example.
- The signed `app.irondesk.health` beta supplied by the maintainer.

This connector is Android-only. It cannot read Apple Health on an iPhone.

## 1. Confirm your tracker is writing to Health Connect

1. On Android 14+, open **Settings → Security and privacy → Privacy controls → Health Connect**.
   The exact labels can vary slightly by manufacturer. On Android 13 or lower, install/update
   **Health Connect** from Google Play, then open it from **Settings → Apps → Health Connect**.
2. Open **App permissions** in Health Connect.
3. Allow Samsung Health or your tracker app to write only the record types you intend to import.
4. Open the tracker and complete one normal sync.
5. Return to Health Connect and confirm that at least one expected record is present.

If Health Connect has no records, IronDesk Health has nothing to preview even when its permissions
are correct.

## 2. Install the private beta

Preferred: accept the maintainer's Google Play testing invitation and install **IronDesk Health**
from the test listing.

If the maintainer provides a direct APK:

1. Confirm the exact filename, version, SHA-256 checksum, and release-certificate fingerprint
   match the values the maintainer published through the private test channel.
2. Install the signed APK. Android may ask you to allow that one installer to install unknown
   apps; turn that allowance back off after installation.
3. Open **IronDesk Health** and confirm the header shows `PRIVATE BETA · 1.1.0-beta.1`.

Do not install an unsigned build, an APK from an unverified message, or the legacy
`IronDesk-0.9.0-debug.apk`.

## 3. Pair your phone

1. Sign into IronDesk in a browser.
2. Open **Connections & Imports**.
3. Under **Health Connect companion**, select **Generate Android code**.
4. Open IronDesk Health on the phone.
5. Enter the eight-character code and choose a recognizable device name.
6. Select **Pair this phone**.

The code is single-use and expires after 15 minutes. Generate a new code if it expires; never send
a pairing code to another person.

## 4. Choose and grant data access

1. In **Health Connect access**, select only the record types you want IronDesk to import.
2. Select **Grant selected access**.
3. In Android's Health Connect permission screen, approve or deny each type deliberately.
4. Return to IronDesk Health. The app reports how many selected types are authorized and lists
   any still missing.

A partial grant is valid. Authorized selected types can be previewed and synced; denied types are
listed and skipped. To add a denied type later, select it and use **Grant remaining selected
access**. To revoke access, use **Manage Health Connect access**.

Historical access is separate. It is needed only for 90-day or one-year reads, is requested only
when supported by the installed provider, and may be declined. Without it, IronDesk honestly reads
the most recent 30 days.

## 5. Preview before syncing

1. Select 7, 30, 90, or 365 days.
2. Confirm the desired record types remain selected.
3. Select **Preview data** or **Preview authorized data**.
4. Review the date range, totals, and per-type record counts.

If the preview is empty, stop and troubleshoot. Do not repeatedly press Sync hoping records will
appear.

## 6. Sync and verify in IronDesk

1. Select **Sync now** once.
2. Record the success message, including new/already-present/skipped counts.
3. Return to IronDesk in the browser and refresh.
4. Verify:
   - sleep, resting heart rate, and HRV appear in Recovery where manual entries were absent;
   - weight appears in Body Metrics where a manual entry was absent;
   - imported cardio/workout activity is visible where supported; and
   - the linked device shows a recent last-sync time.
5. Sync the same range a second time and confirm duplicates are reported as already present, not
   added again.

Manual IronDesk entries should not be overwritten. Capture the date and expected record if this
rule appears to fail, and stop testing that account.

## Offline export and retry

- **Export JSON file instead** writes the prepared payload to a location you choose through the
  Android document picker. Treat that JSON as sensitive health information.
- A transient network or server failure keeps up to five encrypted batches in a local outbox. No
  background job uploads them. Press **Sync now** again after connectivity returns.

## Stop access or leave the beta

Use both controls when you want a full disconnect:

1. In IronDesk Health, select **Unlink this device** and confirm. This revokes the server token.
2. In Android Health Connect, open **App permissions → IronDesk Health** and remove access.

Uninstalling removes local app data, but it cannot prove the IronDesk server token was revoked if
the phone was offline. If server unlink fails, remove the device under IronDesk **Connections &
Imports** before uninstalling.

Already-imported records remain in the IronDesk account until the athlete deletes those records or
uses IronDesk's account/data deletion controls.

## Troubleshooting

- **Health Connect not found** — install/update Health Connect on Android 13 or lower; on Android
  14+, install current system updates.
- **Preview shows zero records** — verify the source tracker has written records into Health
  Connect, the selected range includes them, and IronDesk Health has the corresponding permission.
- **Only some types appear** — this is normally a partial permission grant or the source tracker
  does not write those types.
- **Long range stops at 30 days** — grant historical access if supported, or accept the 30-day
  limit.
- **Pairing code rejected** — codes expire and are single-use; generate a new one.
- **Device rejected after previously working** — unlink locally, remove the stale web device, and
  pair again with a new code.
- **Sync queued** — restore connectivity and press **Sync now**; no background retry occurs.
- **Anything looks assigned to the wrong account** — stop immediately, revoke Health Connect
  access, unlink the device, and report the beta version plus time of the incident. Never include
  the device token or pairing code in a report.

## What to send in a beta report

Include Android version, phone model, IronDesk Health version, Health Connect availability, source
tracker, selected types, range, exact on-screen error, approximate time/timezone, and whether the
same step worked after reopening the app. Do not include health-record contents, tokens, passwords,
or an active pairing code unless the tester explicitly intends to share that health information.
