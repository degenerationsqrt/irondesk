# IronDesk Health Connect setup

## What the connection does

IronDesk uses an Android companion app as a read-only bridge:

`fēnix 6X → Garmin Connect → Health Connect → IronDesk Android → optional Firebase Personal Cloud → IronDesk website`

The public website cannot ask Android for Health Connect permission. Install the
Android companion on the phone that runs Garmin Connect, then sign in to the
same IronDesk account on the phone and website if cross-device sync is wanted.

IronDesk imports daily summaries for steps, average/minimum/maximum heart rate,
resting heart rate, sleep time, weight, body fat, calories, and exercise time.
It does not import routes or raw sensor samples. Detailed Garmin activities and
strength sets continue to use the existing FIT/CSV importer.

## Phone setup

1. Use an Android phone running Android 14 or newer.
2. Pair and sync the fēnix 6X in Garmin Connect.
3. In Garmin Connect, open **More → Settings → Health Connect**.
4. Enable the Health Connect connection and allow the data categories you want
   Garmin to write.
5. Install and open the IronDesk Android companion.
6. Open **Settings → Health Connect**, choose **Connect Health Connect**, and
   approve the read permissions.
7. Choose **Sync Last 7 Days**. Leave foreground auto-sync on if IronDesk should
   refresh whenever the Android app opens.
8. To see the same summaries on the website, enable **Personal Cloud Sync** and
   sign in with the same Firebase account in both places.

Garmin must finish syncing the watch before Health Connect and IronDesk can see
new watch data. Some Garmin metrics or historical data might not be shared.

## Build and install a local test APK

Install Node.js 20+, JDK 21, and Android Studio with Android SDK 36. Then run:

```bash
npm ci
npm test
npm run android:sync
npm run android:build
```

The debug APK is created at:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Copy it to the Android phone and approve installation from that file source, or
connect the phone by USB and run the app from Android Studio.

## Firebase

No new Firebase collection or Firestore rule is required for Health Connect.
Daily summaries are additive fields inside the signed-in user's existing
`users/{uid}` document, which is already limited to that user by
`firestore.rules`.

Firebase setup is needed only for phone-to-website sync:

1. Enable at least one Firebase Authentication sign-in provider.
2. Create the Firestore database and deploy `firestore.rules`.
3. Put the public Firebase web configuration in the app's normal environment
   variables.
4. Sign in and enable Personal Cloud Sync on each device.

Health Connect itself remains device-controlled. Revoking Health Connect access
does not automatically delete summaries already copied to IronDesk; use
**Remove imported summaries** in Settings for that.

## Google Play release checklist

Before a public release:

1. Create the signed Android App Bundle and Play App Signing release.
2. Host the privacy policy at a stable public URL.
3. Complete Google Play's Health Apps declaration and Data Safety form.
4. Declare only the read permissions used by the app and justify each one.
5. Add a self-service account and hosted-data deletion flow.
6. Test permission denial, partial permissions, revoked permissions, reinstall,
   cloud merge, duplicate sync, and clear-and-resync behavior on a real phone.

Until that review is complete, distribute the debug APK only to trusted testers.
