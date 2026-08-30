# IronDesk Connect IQ submission handoff

## Current status

The native watch app and its IronDesk API contract build successfully as a release candidate. The package is configured for `https://irondeskpro.lovable.app`. Do not complete Garmin's final submission until the production deployment, final package, and physical-device gates below are verified.

The public submission becomes safe only after all release gates below are complete.

## Release gates

- [ ] Deploy the Supabase migration `supabase/migrations/20260830051646_connect_iq_workout_events.sql` to staging, then production.
- [ ] Deploy the IronDesk web/API build to a stable HTTPS origin.
- [ ] Replace the blank `apiBaseUrl` default with that exact production origin, or remove the editable setting and compile the origin into the release build.
- [ ] Pair a real watch and exercise the complete path: pair, download, start, edit, complete sets, rest, finish, Garmin FIT sync, IronDesk sync, replay, offline recovery, rejected-event recovery, and unpair.
- [ ] Verify Bluetooth interruption, Wi-Fi/phone reconnection, low-storage behavior, app termination at every finish/FIT boundary, reboot recovery, a failed FIT save, and the explicit uncertain-FIT choices on physical hardware.
- [ ] Verify changing the configured server during pair/fetch/flush never accepts a late response or transmits the prior origin's cached workout/events; test both restore-old-origin and confirmed-discard recovery paths.
- [ ] Confirm the user's actual Garmin model. Remove every manifest product that has not been tested on either that physical product or an equivalent Garmin device family.
- [ ] Capture accurate Store screenshots from each materially different screen shape/resolution being submitted.
- [ ] Publish stable privacy-policy, support, and product/help URLs.
- [ ] Review the listing copy and permission disclosures below.
- [ ] Back up the private developer key in at least two secure locations. Never commit it. The same key is required to publish updates under this app identity.
- [ ] Export the final `.iq`, upload it, resolve every Garmin validator warning, preview the listing, and complete Garmin's approval process.

## Proposed listing

**Name:** IronDesk

**Category:** Health & Fitness

**Short description:** Run your active IronDesk strength workout from your Garmin watch, record a strength FIT activity, and sync confirmed sets back to IronDesk.

**Full description:**

IronDesk brings the active strength session from your IronDesk account to your wrist. Pair the watch with a one-time code, download the current workout, record a Garmin strength activity, confirm each completed set, adjust reps, load, and RPE, and follow the rest timer without returning to your phone.

Confirmed changes are saved on the watch first and synchronized with idempotent event IDs. Temporary phone or network loss does not end the workout. When IronDesk detects a conflicting browser edit or an inactive workout, the watch stops and presents explicit retry or use-server recovery choices instead of silently overwriting data.

IronDesk does not create programs, bypass workout-release gates, or start a session on the user's behalf. Prepare or start the session in IronDesk, then use the watch as its focused training companion.

## User workflow

1. In IronDesk, start or prepare an eligible workout.
2. Open **Connections** and generate a Garmin pairing code.
3. In Garmin Connect or the Connect IQ Store app, enter the one-time code in the IronDesk app settings. The production URL is prefilled.
4. Open IronDesk from the watch activity list and select **START**.
5. Use Up/Down for reps, Menu for load/RPE, and Select to confirm a set.
6. Finish to save the Garmin FIT activity and synchronize IronDesk.

## Permissions and data disclosure

| Permission | Why it is used |
| --- | --- |
| Communications | Download the token-owned active workout and upload explicitly confirmed set/completion events over HTTPS. |
| Fit | Create, lap, stop, save, recover, or explicitly discard the Garmin strength activity. |
| Sensor | Read heart rate while the activity is recording and attach available summary values to workout completion. |

The watch stores a revocable device token, the active workout cache, a recovery checkpoint, and a bounded offline event queue. It does not store the user's Supabase session or any service-role credential. All loads sent to the service use canonical kilograms; the watch converts only for display and editing in the user's Garmin unit system.

## Provisional product matrix

The development manifest currently compiles these products:

- `fenix7`
- `fenix847mm`
- `epix2`
- `enduro3`
- `fr265`
- `fr965`
- `venu3`
- `vivoactive5`

Compilation is not physical-device certification. Keep only the products covered by the final QA matrix.

## Release build

Use Connect IQ SDK 9.2.0 and the private IronDesk developer key:

```powershell
$ciqSdkBin = 'C:\Users\johnm\AppData\Roaming\Garmin\ConnectIQ\Sdks\connectiq-sdk-win-9.2.0-2026-06-09-92a1605b2\bin'
$ciqKey = 'C:\Users\johnm\Documents\Garmin Developer Keys\irondesk-developer-key.der'

& "$ciqSdkBin\monkeyc.bat" `
  -f .\monkey.jungle `
  -o .\bin\IronDesk.iq `
  -y $ciqKey `
  -e -r -w
```

After export, record the package SHA-256, Store version, manifest UUID, exact supported products, SDK version, git commit, production origin, database migration version, and physical-test devices in the release notes.

## Brand asset

The original generated art is in `store-assets/irondesk-icon-source.png`; the Connect IQ launcher resource is in `resources/images/launcher-irondesk.png`. Preserve the source asset for future Store artwork, but verify all final artwork dimensions and branding against Garmin's current submission form before upload.
