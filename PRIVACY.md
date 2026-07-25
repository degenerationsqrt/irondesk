# IronDesk data and privacy

IronDesk stores workout plans, set logs, imported Garmin activity summaries, bodyweight entries, cardio entries, program settings, and macro settings in the browser's local storage. That information stays on the device unless the user exports a backup or uses a connected Crew feature.

The Garmin importer reads user-selected FIT and Activities CSV files on the device. IronDesk does not upload the selected files, ask for Garmin credentials, or connect to a Garmin account or API. Imported Garmin sessions and their activity metrics are excluded from Crew statistics.

Crew features use Firebase Authentication and Firestore. Account email, display name, group membership, shared strength estimates, weekly session/volume totals, and PR feed entries may be sent to Firebase when a user signs in and joins a crew. Firestore access rules are versioned in `firestore.rules`.

IronDesk does not currently connect to Apple Health, Health Connect, Google Health APIs, or Garmin account APIs. Automatic health and wearable synchronization requires a separate consent, retention, deletion, and security review before launch.

Users can remove local information by clearing site data. JSON backup and restore are available from Settings. Account or hosted Crew-data deletion is not yet self-service and should be completed before public health-data integrations are introduced.

Questions and deletion requests can be opened through the repository's GitHub Issues page without posting private health information.
