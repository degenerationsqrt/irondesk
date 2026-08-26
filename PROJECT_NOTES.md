# IronDesk 2.0 — Project Notes

Training intelligence platform: training, conditioning, recovery, nutrition, progress analytics and coaching in a single dark, dense, athlete-facing shell.

## Structure

```
src/
  styles.css                       design system: OKLCH tokens, zone colors, panel/numeric utilities
  lib/irondesk/
    types.ts                       domain models (DashboardDay, ActiveWorkout, HistorySession, ...)
    data.ts                        deterministic realistic mock data
    service.ts                     Promise-based service layer (swap for Cloud/Supabase later)
    queries.ts                     TanStack Query options per domain read
  components/irondesk/
    app-shell.tsx                  Sidebar, MobileNav, AppShell, PageHeader, IronDeskLogo
    primitives.tsx                 SectionCard, StatCard, MetricTile, GradeBadge, ScoreBadge,
                                   ProgressBar, ZoneBar/ZoneLegend, InsightCard, ChartCard,
                                   DataRow, EmptyState, LoadingPanel, Pill
    charts.tsx                     HrChart, MacroDonut, ZoneMinutesChart, SimpleBarChart,
                                   MultiLineChart, ChartLegend (Recharts)
  routes/
    __root.tsx                     fonts, base metadata, QueryClientProvider, AppShell
    index.tsx                      Dashboard — Today's Summary
    workout.tsx                    Active workout console
    history.tsx                    Session history: cards + table, filters, detail drawer
    exercises/index.tsx            Exercise library
    exercises/$exerciseId.tsx      Exercise detail: 1RM trend, volume, history, cues
    progress.tsx                   Bodyweight, 1RM, volume, load, cardio fitness, PRs
    nutrition.tsx                  Macros, meals, hydration, adherence, weight goal
    recovery.tsx                   Readiness, sleep, soreness, fatigue/stress, placeholders
    coach.tsx                      Recommendations, plan, observations, risk notes, ask box
    settings.tsx                   Profile, units, goals, equipment, integrations, privacy
```

## Conventions

- All colors come from semantic tokens in `src/styles.css` (`--primary`, `--success`, `--warning`, `--danger`, `--surface-*`, `--zone-*`, `--chart-*`). No hardcoded color utilities in components.
- Every page reads through `queries.ts` → `service.ts`; no page imports `data.ts` directly.
- Route loaders call `ensureQueryData`; components use `useSuspenseQuery`.
- Training math (e1RM, load, tonnage) belongs in the lib layer, not in components.
- Recovery/integration values that would require a wearable are explicitly labeled as placeholders.

## Replacing mocks with Lovable Cloud

Reimplement the methods in `src/lib/irondesk/service.ts` against real queries or server functions. Types and query keys stay identical, so no UI changes are needed.

## Phase 2A — Auth, database, persistence

### Modes
- `AuthProvider` (`src/lib/auth/auth-provider.tsx`) exposes `mode: "live" | "demo"`.
- **Live**: every read/write goes through `src/lib/irondesk/repo.ts` (Supabase, RLS-scoped to `auth.uid()`).
- **Demo**: deterministic mock service only, flagged `DEMO` in the shell, never written to the database.
- `useModeData` (`src/lib/irondesk/use-data.ts`) is the single service boundary used by routes.

### Auth flow
- `/auth` handles sign in, sign up, password reset and demo entry; email confirmation may be required by project settings.
- `AuthGate` (client-side, no SSR redirect) protects all app routes, preserves `?redirect=`, and pushes new accounts to `/onboarding`.
- First read of `getAccount()` calls the idempotent `bootstrap_current_user()` RPC, which creates the `profiles` + `user_preferences` rows.

### Schema
14 tables: `profiles`, `user_preferences`, `equipment_catalog`, `user_equipment`, `exercises`
(system rows have `owner_id is null`), `exercise_favorites`, `workout_templates`,
`template_exercises`, `workout_sessions`, `session_exercises`, `workout_sets`,
`body_metrics`, `cardio_sessions`, `nutrition_days`, `meals`, `recovery_entries`.
UUID keys, timestamptz, `set_updated_at()` triggers, indexes on user/date/status/exercise.

### RLS
Every user table is RLS-enabled with `auth.uid()` ownership policies. Nested rows
(`session_exercises`, `workout_sets`, `meals`) are protected through parent ownership
(`exists` sub-selects), not client-supplied ids. System exercises and equipment are
readable by any authenticated user but writable by nobody from the client.

### Units
Kilograms are canonical in the database; display conversion happens in
`src/lib/irondesk/units.ts` + `use-units.ts` from the user's `units` preference.

### Known placeholders
- HRV / wearable sync, account export and account deletion are labelled placeholders.
- AI Coach uses deterministic derived insights, not a live model.

## Phase 2B — Legacy workout templates

### Source of truth
The 12 original IronDesk workouts (6 Home + 6 Gym, 62 prescribed movements) were
recovered from the original `IronDesk.jsx` (`PROGRAM_HOME` + `PROGRAM_GYM`) and
exist in two mirrored places, matched on `sourceKey`:

- `src/lib/irondesk/legacy-templates.ts` — typed local copy used by demo mode.
- `workout_templates` / `template_exercises` rows seeded by the legacy migration.

Exercise names are stored exactly as prescribed ("Incline Barbell / DB Press");
`exercise_id` links to the canonical library row when one matches (all 62 resolve).

### Schema
`workout_templates` now holds both shared and personal templates:
`user_id` nullable, `is_system`, `source_key` (unique), `source_name`,
`source_version`, `environment` (home|gym), `workout_type` (heavy|pump),
`category`, `level`, `estimated_minutes`, `tags[]`, `sort_order`, `legacy_day_id`.
A check constraint enforces "system ⇒ unowned, personal ⇒ owned".
`template_exercises` and `session_exercises` carry the prescription:
`load_guidance`, `source_load_unit`, `is_drop_set`, `is_heavy`, `target_rpe`, `rest_seconds`.

RLS: authenticated users read system templates plus their own; inserts/updates/deletes
are restricted to non-system rows they own, so IronDesk Originals are read-only from
every client. Child rows inherit the parent's visibility via `exists` sub-selects.
Seeding is idempotent (upsert on `source_key`, children rebuilt per template).

### Units
Legacy numeric load guidance is **pounds**, stored verbatim as text with
`source_load_unit = 'lb'`. `formatLoadGuidance()` in `units.ts` appends `lb` for
imperial users and converts parseable numbers/ranges to kg for metric users while
retaining the original source string. Logged weights remain canonical kilograms.

### Flow
`templatesQuery` / `templateQuery` read through the mode-aware service
(`getWorkoutTemplates` / `getWorkoutTemplate`). `repo.startWorkoutFromTemplate()`
verifies readability, refuses to create a second session while one is active,
copies exercises in template order with prescription context, and pre-creates
planned sets with integer rep/RPE prefills and blank weights.
`TemplateLibrary` (`src/components/irondesk/template-library.tsx`) powers the
`/workout` start state: search, Home/Gym, Heavy/Pump and body-area filters, cards
and a full movement preview. Demo mode browses the same 12 templates read-only.

## Connections & Imports

`/connections` (protected, live-only writes) is the import/export surface.
Demo mode shows a read-only notice — it never writes to a real account.

### Supported input
| Format | Read | Notes |
| --- | --- | --- |
| `.tcx` | activity summaries | standards-compliant XML (Garmin TCX v2); DOCTYPE rejected |
| `.gpx` | track summary | duration/distance/elevation derived from trackpoints; no per-point storage |
| `.fit` | session + weight-scale messages | official `@garmin/fitsdk` decoder; per-second series intentionally skipped |
| `.csv` / `.json` | activities or health metrics | auto-mapped when headers are recognized, otherwise the mapping wizard opens |
| `.zip` | container only | supported members are expanded; nested archives refused |

Limits (`src/lib/imports/types.ts`): 25 MB per file, 200 archive entries,
100 MB uncompressed, 200× compression-ratio guard, 20 000 records per import.
Validation order: extension → declared MIME → size → magic bytes → parser.
Uploaded content is only ever read as data — nothing is evaluated and no
network request is made with it.

### Mapping and preview
Unrecognized CSV/JSON opens the wizard (`MappingWizard` in
`import-panel.tsx`): the user assigns each target field, picks duration/distance/
weight units and a fixed metric type where needed, and can save the mapping per
user (`saved_import_mappings`). Every import shows normalized records, row-level
errors, warnings (including naive timestamps read as UTC) and skipped source
columns before anything is written. Partial import is explicit.

### Persistence, dedupe, rollback
`src/lib/imports/repo.ts` creates an `import_jobs` row, then upserts
`imported_activities` / `health_metrics` in 500-row chunks against the unique
`(user_id, dedupe_hash)` constraint, so a re-uploaded file imports zero
duplicates. Dedupe prefers the provider id (`ext:<source>:<id>`) and otherwise
uses a SHA-256 fingerprint of the normalized identifying fields. Every batch is
listed on `/connections` and can be rolled back by deleting the job, which
cascades its rows. All five tables are RLS-scoped to `auth.uid()`; no anon grants.

### Export
`sessionsToTcx()` emits standards-compliant TCX v2 that Garmin Connect accepts
under "Import Data". Strength sessions use `Sport="Other"` with one lap and no
fabricated GPS. FIT encoding and GPX export are deliberately not offered — a FIT
round-trip has not been verified and IronDesk stores no coordinates.

### Android
Health Connect has no web API. `android-health-connect/` holds the complete
Kotlin/Compose companion source that reads approved records and writes the JSON
this page imports without mapping. No APK is built or distributed, and the app
declares no INTERNET permission. See that directory's README for the contract.

### Tests
`tests/imports.test.ts` (`bunx vitest run`) covers CSV edge cases, mapping and
unit conversion, JSON containers, TCX/GPX parsing, DOCTYPE rejection, extension/
size/magic-byte validation, ZIP expansion and path traversal, dedupe stability
and a TCX export round-trip. Fixtures are synthetic and built inline.

### Known limitations
- No continuous wearable sync and no account deletion job (both labelled honestly in Settings).
- FIT decoding is typechecked against the official SDK but not verified against a real device file.
- `commitImport` writes the job and its children in separate requests; a mid-batch failure marks the job failed and the partial rows stay attached to that job, so rolling it back removes them.

## Assigned programs (Phase 2C)

### Catalog
Six active system programs are assignable: four Legacy Beta programs seeded from
`content/workouts/legacy-beta/program-index.json` plus two IronDesk Original
rotations (Home, Gym), for 34 ordered `program_workouts` slots in total. System
templates (34: 12 Originals + 22 Legacy Beta) and their 213 prescriptions stay
immutable and read-only for authenticated users; personal templates remain
owner-scoped.

### Release gates
`workout_templates` and `programs` carry `release_gate`,
`requires_acknowledgment`, `library_startable`, `warnings` and `source_notes`.
The 22 Legacy Beta templates are assignment-only (`library_startable = false`)
and inherit their program's gate and warnings, so they can never be launched as
free training — a database trigger enforces it and `repo.startWorkoutFromTemplate`
mirrors the rule with a useful message. The 12 Originals stay freely startable.
`TemplateLibrary` splits the two groups and locked cards offer prescription
preview only. Gated programs require an explicit acknowledgment recorded on the
enrollment (`acknowledged_at`, `acknowledged_gate`).

### Enrollment and scheduling
A partial unique index allows at most one active/paused enrollment per athlete.
Lifecycle runs entirely through `SECURITY DEFINER` RPCs granted to
`authenticated` only: `enroll_in_program`, `pause_program_enrollment`,
`resume_program_enrollment`, `skip_current_program_workout`,
`start_assigned_workout`. Enrolling retires any prior enrollment, refuses while
a workout is in progress, and materializes `scheduled_workouts`. Starting an
assigned workout snapshots the template's prescriptions onto the session, so
later content edits never rewrite training history. Completing a session
completes its slot and advances the cycle; cancelling returns the slot to
planned. Enrollments and schedules are private to `auth.uid()`.

### Surfaces
`/program` (My Program) shows the active assignment, cycle progress, current
workout, pause/resume and skip-with-reason plus the catalog with acknowledgment
dialogs. Dashboard and `/workout` show a Today/Next assigned card above free
training; `/history` labels sessions with their program and slot position. Demo
mode is read-only and never enrolls — program data is live-only.

### Tests
`tests/programs.test.ts` validates the committed legacy-beta content (22
templates, 151 movements, 4 programs, 22 slots, resolvable references) and the
pure gating/progress rules (acknowledgment, free-start locks, slot state per
cycle, progress percentages).

### Known limitations
- Coach assignment tooling and roles are not implemented; all six programs are self-assigned.
- Automated end-to-end verification of the authenticated enroll → start → complete flow was not possible in this environment (no preview session could be minted); the flow is covered by database constraints, RPC checks and unit tests.
- The pre-existing linter warning that `authenticated` may execute `bootstrap_current_user` remains; the new trigger helpers have execute revoked.

## Assigned programs — security hardening follow-up

Audit of the live database after the Phase 2C release found three real defects,
all corrected by an additive migration (`20260826202358_*`):

1. `program_enrollments` / `scheduled_workouts` still granted authenticated
   INSERT/UPDATE/DELETE with owner-scoped policies, so a client could rewrite
   `status`, `current_position`, `current_cycle` or whole schedule rows.
2. `scheduled_workouts_insert_own` / `_update_own` contained the tautology
   `pw.template_id = pw.template_id` instead of validating the row's template.
3. The five lifecycle RPCs were SECURITY INVOKER despite the comments.

Current invariants:

- Both tables are **read-only to clients**: only `*_select_own` (auth.uid())
  remains, authenticated holds `SELECT` only, `anon` holds nothing. Every write
  happens inside a lifecycle RPC or a database trigger.
- `enroll_in_program`, `pause_program_enrollment`, `resume_program_enrollment`,
  `skip_current_program_workout`, `start_assigned_workout` are
  `SECURITY DEFINER` with `search_path = public, pg_temp`, derive identity only
  from `auth.uid()`, take no user-id argument, and are executable by
  `authenticated` only (PUBLIC/anon revoked).
- `skip_current_program_workout(_enrollment_id, _reason)` trims `_reason`,
  bounds it to 500 chars and merges `{skippedBy, skippedAt, skipReason}` into
  `adjustment` server-side. `programs.ts` no longer writes schedules at all.
- Assigned session linkage is RPC-only: `start_assigned_workout` sets the
  transaction-local GUC `irondesk.assigned_schedule_id`, and
  `enforce_session_start_policy` rejects any insert whose
  `scheduled_workout_id` was not announced by that call. It also revalidates
  ownership, `planned` status, template match (session ↔ schedule ↔ program
  slot), active enrollment, current position/sequence index and acknowledgment.
- `workout_sessions_link_immutable` freezes `user_id`, `template_id` and
  `scheduled_workout_id` after insert; the only permitted transition is the
  cancel-unlink performed by the completion handler.
- Pausing is refused while an `active`/`draft` session exists, so the cursor
  cannot drift from a live workout.
- The duplicate `sync_assigned_session_status` trigger/function was dropped;
  `irondesk_internal.handle_assigned_session_status` (definer, no authenticated
  execute) is the single completion/cancellation handler, so a slot completes
  and the cycle advances exactly once.
- Trigger helpers (`enforce_session_start_policy`,
  `enforce_session_link_immutable`, `handle_assigned_session_status`) have no
  execute privilege for PUBLIC/anon/authenticated.

Catalog counts are unchanged by this migration: 6 active system programs, 34
program slots, 34 system templates, 213 system prescriptions, 22 locked
Legacy Beta templates. No source prescription rows were touched.

`tests/program-hardening.test.ts` asserts these invariants statically against
the shipped migration SQL and `src/lib/irondesk/programs.ts` (48 tests total).
