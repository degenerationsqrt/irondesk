# IronDesk data and privacy

IronDesk stores workout plans, set logs, imported Garmin activity summaries, bodyweight entries, cardio entries, program settings, macro settings, and preferences in the browser's local storage. That information stays on the device unless the user exports a file or explicitly enables Personal Cloud Sync or a connected Crew feature.

The Garmin importer reads user-selected FIT and Activities CSV files on the device. IronDesk does not upload the selected source files, ask for Garmin credentials, or connect to a Garmin account or API. When Personal Cloud Sync is enabled, decoded Garmin activity records are included in the synchronized IronDesk state. Imported Garmin sessions and their activity metrics are excluded from Crew statistics.

Garmin Bridge creates FIT activity and workout files locally in the browser from sessions the user selects. IronDesk does not send these files to Garmin automatically. Data reaches Garmin only when the user manually imports an activity file into Garmin Connect or copies a workout file to a compatible device. Automatic Garmin account delivery is not enabled and would require a separately approved Garmin Connect Developer Program integration and an updated consent review.

Personal Cloud Sync uses Firebase Authentication and Firestore. It is off by default and can be paused in Settings. On first connection, histories from the current device and cloud copy are merged. A signed-in user's workouts, decoded Garmin activities, bodyweight, cardio, maxes, programs, macros, active workout, and app preferences may be stored in that user's Firestore document so the same account can use them on another device.

Crew features also use Firebase Authentication and Firestore. Account email, display name, group membership, shared strength estimates, weekly session/volume totals, and PR feed entries may be sent to Firebase when a user signs in and joins a crew. Firestore access rules are versioned in `firestore.rules`.

IronDesk does not currently connect to Apple Health, Health Connect, Google Health APIs, or Garmin account APIs. Automatic health and wearable synchronization requires a separate consent, retention, deletion, and security review before launch.

Users can pause Personal Cloud Sync or remove local information by clearing site data. JSON backup and restore are available from Settings. Account, synchronized personal-data, or hosted Crew-data deletion is not yet self-service and should be completed before public health-data integrations are introduced.

Questions and deletion requests can be opened through the repository's GitHub Issues page without posting private health information.
