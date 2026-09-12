# IronDesk

IronDesk combines workout logging, program assignments, recovery, nutrition and training analytics in a React/TanStack Start web app backed by Supabase. Garmin Connect IQ and Android Health Connect are separate clients. The AI Coach currently derives deterministic guidance; it does not call a live language model.

See [Architecture](docs/ARCHITECTURE.md) for the current system and [September 2026 audit](docs/ARCHITECTURE_AUDIT_2026-09-11.md) for findings, fixes, validation and remaining debt. [PROJECT_NOTES.md](PROJECT_NOTES.md) retains historical implementation notes.

## Repository map

| Location                                      | Responsibility                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/routes`, `src/components/irondesk`       | Web routes, athlete UI, auth/data boundaries and PWA lifecycle                     |
| `src/lib/irondesk`                            | Mode-aware service, repository, workout outbox, analytics, units and program rules |
| `src/lib/mcp`                                 | Five authenticated IronDesk Command MCP tools                                      |
| `src/lib/imports`                             | File parsing, provenance, import persistence and Health Connect synchronization    |
| `src/lib/connect-iq`, `src/routes/api/public` | Token-authenticated device APIs                                                    |
| `supabase/migrations`                         | Versioned PostgreSQL schema, RLS policies and transactional functions              |
| `content/workouts`                            | Versioned Legacy Beta workout content and provenance                               |
| `android-health-connect`                      | Kotlin companion: approved reads, explicit sync and preview-first workout export   |
| `connectiq/irondesk`                          | Monkey C watch companion, durable queue, FIT recording and simulator tests         |
| `mobile-android`                              | Native engineering preview with sample data and no network permission              |

## Development and verification

Use Node.js 24 and Bun 1.4.2, as selected in web CI. Bun installs the committed lock; Node runs the application tools.

```sh
bun install --frozen-lockfile
bun run dev
bun run test
bun run typecheck
bun run build
```

Copy `.env.example` to `.env.local` and fill the required Supabase URL and publishable-key variables. Server API routes additionally require the server-only service-role credential. Never put that credential in a `VITE_` variable. A local demo can use nonfunctional placeholder client configuration; authenticated workflows require real project configuration.

`vitest.config.ts` isolates tests from application/deployment plugins. Tests include a PGlite PostgreSQL harness for selected committed migrations and cross-account policies. It does not emulate hosted Supabase auth or prove a complete database rebuild. See the audit's migration-history gap before creating a new database.

Web CI runs locked install, typecheck, regression tests and production build for pull requests and main pushes. Separate workflows validate the Android companion and native preview. Full-repository lint contains legacy formatting debt; use scoped ESLint/Prettier checks for touched files.

## Device development

- Health Connect uses JDK 17 and Android SDK 36. Start at [its README](android-health-connect/README.md) and run `gradlew --no-daemon lintDebug testDebugUnitTest assembleDebug` in that directory.
- Garmin uses the Connect IQ SDK. Follow [its README](connectiq/irondesk/README.md) for device-specific builds and simulator tests.
- The native preview has [its own constraints and build instructions](mobile-android/README.md). It is not the production mobile app.

The Health Connect flow is explicit: preview completed workouts, grant exercise-write permission, then choose to write. Simulator/build success does not establish physical watch sync, Health Connect writes, deduplication or receiving-app display.

## Deployment

The canonical repository is [degenerationsqrt/irondesk](https://github.com/degenerationsqrt/irondesk). The web project is [IronDesk Command in Lovable](https://lovable.dev/projects/eed18f2c-5219-4d27-b990-ff314dde9ed8), with canonical web/Android origin [irondeskpro.com](https://irondeskpro.com). Garmin's existing packaged default still uses the Lovable origin; its origin-bound pairing requires separate verification before changing it.

A tested Git branch, merged main, matching Lovable source, database migration application, published web assets and physical-device verification are separate states. Verify each state when releasing. Do not rewrite published Git history.
