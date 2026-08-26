# Assigned Programs: from template library to guided program delivery

Today IronDesk lets an athlete *browse* the 12 IronDesk Originals and start any one of them ad hoc. The old app *told* the trainee what to do next. This plan adds a program-delivery layer on top of the existing library without touching the library's role as immutable source material.

Core distinction throughout:

- **Library access** — read-only catalog of templates/movements. Browsing is optional and never dictates training.
- **Assigned program delivery** — an ordered program the athlete is enrolled in, producing dated/sequenced workout instances, one of which is "Today / Next".

## 1. Current state

Verified in the codebase:

Complete
- 12 system templates + 62 movements seeded, mirrored in `src/lib/irondesk/legacy-templates.ts`, matched on `source_key`; metadata already present: `environment` (home|gym), `workout_type` (heavy|pump), `legacy_day_id` (Chest, Arms, Back, Shoulders, Legs, Calves+Abs), `sort_order`, `tags`, `estimated_minutes`.
- Per-movement prescription: `target_sets`, `target_reps`, `target_rpe`, `rest_seconds`, `load_guidance` (+ `source_load_unit`, legacy numerics are lb), `is_drop_set`, `is_heavy`.
- `repo.startWorkoutFromTemplate()` already snapshots template → `session_exercises` (with prescription columns) + pre-created planned `workout_sets` with blank weights, and refuses a second active session.
- Session/set persistence, substitution reference (`original_exercise_id`), RLS scoped to `auth.uid()`, mode-aware service/query boundary, recovery entries with `readiness`.

Missing
- No program concept: nothing groups the 12 templates into an ordered rotation/cycle.
- No enrollment/assignment: nothing links an athlete to a program.
- No scheduled workout instances: no "Today's workout", no "next up", no skip/reschedule, no completion tracking against a plan.
- No progression state: `load_guidance` is static legacy text; nothing records working loads per movement or advances them.
- No readiness-driven adjustment: readiness is displayed, never applied to a prescription.
- No coach/admin surface and **no roles table at all** (confirmed: no `user_roles`, no `has_role`).
- Onboarding collects goal/days/equipment but does not assign a program.

## 2. Data model

New tables (all `public`, uuid PKs, timestamptz, `set_updated_at` triggers, explicit GRANTs).

- `programs` — `owner_id uuid null` (null = IronDesk system program), `is_system`, `source_key unique`, `name`, `description`, `environment`, `level`, `days_per_week`, `cycle_length_weeks`, `schedule_mode` ('rotation' | 'weekly' | 'block'), `version`, `is_active`, `sort_order`, `tags[]`.
- `program_workouts` — ordered slots: `program_id`, `position`, `week_index null`, `day_index null`, `block_label null`, `template_id` (→ `workout_templates`), `template_version`, `label`, `notes`. This is the only place ordering lives; templates stay order-agnostic.
- `program_enrollments` — `user_id`, `program_id`, `assigned_by uuid null`, `status` ('active' | 'paused' | 'completed' | 'cancelled'), `started_on date`, `current_position`, `current_week`, `training_days smallint[] null` (weekday preference), `settings jsonb`. Partial unique index: at most one `active` enrollment per user.
- `scheduled_workouts` — the delivery unit: `enrollment_id`, `user_id` (denormalized for RLS/index), `program_workout_id`, `template_id`, `sequence_index`, `scheduled_for date null`, `status` ('planned' | 'in_progress' | 'completed' | 'skipped' | 'expired'), `session_id null` (→ `workout_sessions`), `adjustment jsonb` (readiness/substitution decisions actually applied), `completed_at`.
- `movement_progression` — per athlete, per movement working state: `user_id`, `exercise_id null`, `movement_key text` (falls back to the exact prescribed name so unresolved legacy names still progress), `working_weight_kg`, `target_reps`, `last_result` ('hit' | 'miss' | 'skipped'), `consecutive_hits`, `consecutive_misses`, `last_performed_at`, `source` ('seed' | 'auto' | 'manual'). Unique on `(user_id, movement_key)`.
- `coach_athletes` — `coach_id`, `athlete_id`, `status` ('pending' | 'accepted' | 'revoked'), `invited_by`, `permissions jsonb` (assign / edit_program / view_logs), unique `(coach_id, athlete_id)`.
- `user_roles` + `app_role` enum ('admin','coach','athlete') + `has_role(uuid, app_role)` security-definer helper — roles live in their own table, never on `profiles`.

Existing tables: unchanged except `workout_sessions` gains `scheduled_workout_id uuid null` (and keeps `template_id`), so a session knows which planned slot it satisfied. No destructive changes.

## 3. RLS and ownership

- `programs`: authenticated read where `is_system` or `owner_id = auth.uid()`; write only own non-system rows. Check constraint mirrors templates: system ⇒ unowned, personal ⇒ owned.
- `program_workouts`: visibility inherited from parent program via `exists` sub-select; writes only for owned non-system parents. IronDesk Originals stay read-only from every client.
- `program_enrollments` / `scheduled_workouts` / `movement_progression`: read+write where `user_id = auth.uid()`; additionally readable/insertable by an accepted coach via `exists` on `coach_athletes` with the matching permission. Coaches never get set-level write access to `workout_sets`.
- `coach_athletes`: each side reads rows naming them; the athlete alone may move `status` to `accepted` or `revoked`. No self-granted coaching.
- `user_roles`: `select` for the owning user; role grants only via privileged/admin path, never client-writable.
- Every new table: `GRANT SELECT, INSERT, UPDATE, DELETE ... TO authenticated`, `GRANT ALL ... TO service_role`, no `anon` grants (system programs are still auth-only, consistent with templates).

## 4. Trainee UX

- **Onboarding** gains a final step: "Your program" — recommends a system program from environment (home/gym equipment answers) and training days, with "Start this program" / "Choose later". Choosing creates the enrollment and materializes the first N scheduled workouts.
- **Dashboard "Today"** becomes program-aware: Today's assigned workout card (title, focus, movement count, estimated minutes, heavy/pump badge) with a primary **Start** action; if today is a rest day, show "Next: <workout> · <date>". No enrollment → a single "Choose a program" CTA plus the existing free-training path.
- **My Program** (new route `/program`): the full cycle as an ordered list — completed / today / upcoming, week and block labels, per-slot preview, skip, reschedule, swap slot template (personal programs only), pause/restart, and progress ("Week 2 of 6 · 7 of 18 workouts").
- **Start** from Today or My Program calls a program-aware start that snapshots the template into a session *and* links `scheduled_workout_id`, marking the slot `in_progress`. Ad hoc library starts remain available and unlinked.
- **Substitutions** stay session-local (existing `original_exercise_id`), and additionally record the choice on `scheduled_workouts.adjustment` so history explains what was actually trained.
- **Readiness adjustment** (phase 2): on start, if today's readiness is low, offer an explicit, dismissible adjustment (reduce top sets, cap RPE, downshift heavy→pump) — always shown, never silently applied, and stamped into `adjustment`.
- **Progression**: working weights are prefilled from `movement_progression` instead of blank, with the legacy `load_guidance` still displayed as source text. On finish, hit/miss is evaluated per movement and working weight advanced per rule.
- **Completing** a workout marks the slot `completed`, advances `current_position`/`current_week`, and updates progression. **History** shows sessions with their program context ("Week 2 · Day 3 · Legs · Gym Heavy").

## 5. Coach/admin UX

- `/coach-tools` (gated by `has_role(auth.uid(),'coach'|'admin')`): athlete list from accepted `coach_athletes`, per-athlete assign/replace program, pause, adjust training days, and read-only view of adherence and recent sessions.
- Athlete linking is invite-then-accept; a coach can never attach themselves to an athlete unilaterally.
- Coaches build programs by cloning a system program into a personal (owned) program and reordering slots. System programs remain read-only — no fake "edit" affordance on IronDesk Originals.

## 6. Preserving the library as immutable source

- `workout_templates` / `template_exercises` remain the versioned catalog; system rows stay unowned and client-read-only, seeded idempotently on `source_key`.
- Programs reference templates by id **plus** `template_version`; they never copy prescription rows.
- Sessions always snapshot (already the behavior): `session_exercises` + `workout_sets` carry their own copies, so re-seeding or bumping a template never rewrites logged history.
- A template edit is a new `source_version`; existing enrollments keep referencing the version they were assigned unless explicitly upgraded.

## 7. Phased rollout

**Phase 1 — assigned programs usable with the existing 12 templates**
`programs`, `program_workouts`, `program_enrollments`, `scheduled_workouts`; seed 2–3 system rotation programs from the existing templates (Home 6-day, Gym 6-day, Hybrid), keyed on the existing `legacy_day_id` / `workout_type` metadata; onboarding assignment step; Today's Workout card; `/program`; program-linked start/complete/skip; history context. Demo mode gets the same programs from a typed local mirror.

**Phase 2 — legacy engine, readiness, progression**
Week/day/block schedule mode with `cycle_length_weeks`, per-week intent; `movement_progression` with seed → auto-advance rules; readiness-driven suggested adjustment at start; deload/repeat-week handling.

**Phase 3 — coach tooling**
`user_roles` + `has_role`, `coach_athletes` invite/accept, coach console, program cloning and slot editing for personal programs.

## 8. Migration and backfill

- All new tables are additive; no existing column is dropped or retyped. `workout_sessions.scheduled_workout_id` is nullable, so every existing session stays valid and simply reads as "free training".
- Existing users: no auto-enrollment. On next visit they see a one-time "Choose your program" prompt; Start Clean and sample-data accounts behave identically.
- Sample data (`is_sample`) is untouched; the sample path may optionally create a sample enrollment, still flagged and still idempotent.
- Backfill: optional one-off inference of `movement_progression` seeds from each user's heaviest completed set per movement — read-only derivation, safe to re-run.
- **Legacy/local workout folder not yet inventoried**: this plan does not assume its contents. Step 0 of Phase 2 is an inventory pass (what program/week/block/progression logic exists in the original source, expressed as a written spec) before any engine code is written. If the legacy rotation rules turn out to differ from the metadata-derived Phase 1 programs, Phase 2 corrects the seed via a new `source_version` rather than rewriting history.

## 9. Testing and acceptance

- Data: exactly the seeded programs exist, each slot resolves to a real template, positions contiguous, no duplicate `source_key`, still exactly 12 templates / 62 movements after migration.
- RLS: an athlete cannot read another athlete's enrollments, scheduled workouts or progression; anon reads return empty; a non-accepted coach sees nothing; system programs reject client writes.
- Flow: onboarding assignment → Today shows the right workout → Start creates a linked session with snapshotted prescriptions and correct set counts → finish marks the slot completed and advances the cycle → skip advances without a session → rest day shows "Next".
- Idempotence/concurrency: double-tapping Start does not create two sessions or two slots; re-running the seed changes nothing.
- Units: legacy lb guidance still renders correctly for metric and imperial users; stored loads remain kg.
- Regression: ad hoc library start, substitutions, autosave, cancel/resume, demo read-only, mobile bottom nav and one-handed logging all unchanged.

## 10. Risks and what not to do

- **Do not** mutate `workout_templates` / `template_exercises` prescriptions to implement progression — progression state belongs in `movement_progression`, prescriptions in the snapshot.
- **Do not** store roles on `profiles` or check coach/admin status client-side; use `user_roles` + `has_role`.
- **Do not** let a program silently overwrite an athlete's in-progress session, or auto-apply readiness adjustments without showing them.
- **Do not** materialize an unbounded schedule; generate a rolling window and extend on demand, otherwise cycle edits require mass rewrites.
- **Do not** invent legacy week/block/progression rules before the legacy source is inventoried — Phase 1 deliberately ships a rotation derived only from metadata that already exists.
- Watch: single-active-enrollment enforcement (partial unique index, not app logic), timezone handling for `scheduled_for` (use the profile timezone already stored), and `scheduled_workouts` ↔ session linkage staying consistent when a session is cancelled (slot must return to `planned`).
