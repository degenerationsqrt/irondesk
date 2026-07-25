# IronDesk Pro

IronDesk is a mobile-first strength training planner and workout logger. It includes generated programs, live set logging, plate calculations, cardio and bodyweight trends, macros, custom workouts, and optional Firebase-backed personal and crew features.

## Tracking utilities

- The optional automatic rest timer starts when a strength set is logged, supports separate accessory/heavy durations, survives navigation and reloads, and can be extended or skipped.
- Workout History supports exercise search, home/gym/Garmin and date-range filters, four sort orders, summary metrics, expandable set detail, and clean empty states.
- Settings imports original Garmin FIT files and Garmin Activities CSV exports, including fēnix 6X activity metrics and available strength-set detail. Repeat imports are skipped without replacing existing sessions.
- Garmin Bridge converts completed IronDesk sessions into integrity-checked FIT activity files for manual Garmin Connect import. It can also turn one completed session into a structured strength-workout FIT with reps, weights, exercise categories, and timed rest steps for manual fēnix 6X installation.
- Personal Cloud Sync is opt-in. Signing into the same IronDesk account merges and synchronizes workouts, decoded Garmin activities, bodyweight, cardio, maxes, programs, macros, and preferences between browsers.
- Settings provides a complete JSON backup/restore flow, a Garmin summary CSV that matches IronDesk's Garmin importer and can be re-imported without duplicates, and a separate detailed set CSV for coaches and spreadsheets.

## Development

Requirements: Node.js 20 or newer.

```bash
npm install
npm run dev
```

## Validation

```bash
npm test
npm run build
```

## Deployment

Merges to `main` build and deploy `dist/` to GitHub Pages through `.github/workflows/pages.yml`. Pull requests run the same install, test, and build checks without deploying.

## Data

Workout, imported Garmin activity, bodyweight, cardio, program, macro, and timer-preference data are stored under the existing `irondesk:v3` browser key. New fields are additive so older saved histories continue to load. When Personal Cloud Sync is enabled, the decoded app state is also stored in the signed-in user's Firebase document. Garmin FIT/CSV source files are decoded in the browser and are never uploaded by IronDesk. Garmin Bridge FIT files are also generated locally and are sent to Garmin only when the user manually imports or copies them. Users should still keep a JSON backup before clearing site data; CSV is intended for IronDesk Garmin-import transfer or analysis, not full restoration or Garmin Connect upload. Accounts, personal sync, and shared crew statistics use Firebase Authentication and Firestore.

See [PRIVACY.md](./PRIVACY.md) for the current data-handling summary.
