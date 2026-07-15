# IronDesk Pro

IronDesk is a mobile-first strength training planner and workout logger. It includes generated programs, live set logging, plate calculations, cardio and bodyweight trends, macros, custom workouts, and optional Firebase-backed crew features.

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

Workout, bodyweight, cardio, program, and macro data are stored in the browser. Users should export a JSON backup before clearing site data or moving devices. Crew accounts and shared crew statistics use Firebase Authentication and Firestore.

See [PRIVACY.md](./PRIVACY.md) for the current data-handling summary.
