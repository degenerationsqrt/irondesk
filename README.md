# IronDesk Pro

IronDesk is a mobile-first strength training planner and workout logger. It includes generated programs, live set logging, plate calculations, cardio and bodyweight trends, macros, custom workouts, and optional Firebase-backed crew features.

## Tracking utilities

- The optional automatic rest timer starts when a strength set is logged, supports separate accessory/heavy durations, survives navigation and reloads, and can be extended or skipped.
- Workout History supports exercise search, home/gym/Garmin and date-range filters, four sort orders, summary metrics, expandable set detail, and clean empty states.
- Settings imports original Garmin FIT files and Garmin Activities CSV exports, including fēnix 6X activity metrics and available strength-set detail. Repeat imports are skipped without replacing existing sessions.
- Settings also provides a complete JSON backup/restore flow plus a CSV history export for coaches and spreadsheets. Garmin summary activities remain in that export even when they do not include strength sets.

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

Workout, imported Garmin activity, bodyweight, cardio, program, macro, and timer-preference data are stored under the existing `irondesk:v3` browser key. New fields are additive so older saved histories continue to load. Garmin FIT/CSV files are decoded in the browser and are not uploaded by the importer. Users should export a JSON backup before clearing site data or moving devices; CSV is intended for analysis and sharing, not full restoration. Crew accounts and shared crew statistics use Firebase Authentication and Firestore.

See [PRIVACY.md](./PRIVACY.md) for the current data-handling summary.
