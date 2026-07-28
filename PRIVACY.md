# IronDesk data and privacy

IronDesk stores workout plans, set logs, imported Garmin activity summaries, optional Health Connect daily summaries, bodyweight entries, cardio entries, program settings, macro settings, and preferences in local app storage. That information stays on the device unless the user exports a file or explicitly enables Personal Cloud Sync or a connected Crew feature.

The Garmin importer reads user-selected FIT and Activities CSV files on the device. IronDesk does not upload the selected source files, ask for Garmin credentials, or connect to a Garmin account or API. When Personal Cloud Sync is enabled, decoded Garmin activity records are included in the synchronized IronDesk state. Imported Garmin sessions and their activity metrics are excluded from Crew statistics.

Garmin Bridge creates FIT activity and workout files locally in the browser from sessions the user selects. IronDesk does not send these files to Garmin automatically. Data reaches Garmin only when the user manually imports an activity file into Garmin Connect or copies a workout file to a compatible device. Automatic Garmin account delivery is not enabled and would require a separately approved Garmin Connect Developer Program integration and an updated consent review.

The Android companion can connect to Health Connect on Android 14 or newer. After the user grants access, IronDesk reads daily summaries for steps, heart rate, resting heart rate, sleep duration, weight, body-fat percentage, total calories burned, and exercise duration. Access is read-only. IronDesk does not request medical-record permissions, exercise routes, raw location, or background health access. Health Connect exercise time is not converted into a detailed workout, avoiding duplicates with Garmin FIT/CSV activity imports.

Personal Cloud Sync uses Firebase Authentication and Firestore. It is off by default and can be paused in Settings. On first connection, histories from the current device and cloud copy are merged. A signed-in user's workouts, decoded Garmin activities, Health Connect daily summaries, bodyweight, cardio, maxes, programs, macros, active workout, and app preferences may be stored in that user's Firestore document so the same account can use them on another device. Raw Health Connect sensor records are not synchronized.

Crew features also use Firebase Authentication and Firestore. Account email, display name, group membership, shared strength estimates, weekly session/volume totals, and PR feed entries may be sent to Firebase when a user signs in and joins a crew. Firestore access rules are versioned in `firestore.rules`.

IronDesk does not sell health data, use it for advertising, or share Health Connect summaries with Crew members. Firebase processes opt-in Personal Cloud Sync data as IronDesk's service provider. IronDesk does not currently connect to Apple Health or Garmin account APIs.

Users can revoke Health Connect access, disable foreground auto-sync, remove imported Health Connect summaries, pause Personal Cloud Sync, or remove local information by clearing app/site data. Removing imported summaries also creates a synchronized deletion marker so older cloud copies cannot restore them. JSON backup and restore are available from Settings. Full account and hosted Crew-data deletion is not yet self-service and must be completed before a public Google Play launch.

Questions and deletion requests can be opened through the repository's GitHub Issues page without posting private health information.
