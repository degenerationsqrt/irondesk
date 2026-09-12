# IronDesk architecture audit — 2026-09-11

## Outcome and scope

Reviewed the frontend, live database catalog/policies/migration history, MCP tools and authentication boundary, Garmin companion/API, Android Health Connect read/sync/export paths, native Android preview and workout-content sources.

Implemented the confirmed, bounded fixes listed below on `codex/architecture-audit`, based on GitHub main `c20635a`, in `C:/Projects/irondesk-architecture-audit`. Existing worktrees were preserved. The changes are local and have not been pushed, merged, synchronized into Lovable, applied to production PostgreSQL, published or installed on a physical device.

The architectural direction remains a modular monolith with shared domain rules and separate browser, MCP and device clients. The immediate failures were in ownership boundaries, error handling and data semantics. A framework rewrite is not needed to correct them.

The [architecture map](ARCHITECTURE.md) explains the components and data flows.

## Confirmed findings and implemented fixes

| Priority | Finding                                                                                | Implemented behavior                                                                                                                                                            | Evidence                                                                                       |
| -------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| P1       | Private query cache and component drafts survived account changes                      | Each athlete/demo/anonymous scope has a separate QueryClient and mounted route subtree; retired cache cleared, late results contained; durable per-user workout queue preserved | Real QueryClient cancellation/cache/mutation regressions                                       |
| P1       | Child rows could refer to another athlete's parent while passing row-owner RLS         | Restrictive parent ownership checks for import jobs, activities, metrics and cardio-session INSERT/UPDATE                                                                       | Live policy definitions plus PostgreSQL two-athlete tests                                      |
| P1       | Partial MCP recovery writes could erase notes or promote sample metrics into real data | Atomic, auth.uid-scoped SECURITY INVOKER recovery patch; omitted real values preserved; untouched sample values cleared; explicit note clearing retained                        | PostgreSQL sample replacement, field preservation, zero, invalid data and access-control tests |
| P1       | Failed meal reads could overwrite nutrition totals with zero                           | Read errors stop recalculation before writes; aggregate write errors surface; successful meal insert followed by failure is reported as partial success                         | Six nutrition repository tests                                                                 |
| P1       | Android queue overflow deleted old unsent batches                                      | Full queue refuses the new batch; encrypted staged writes preserve old entries; revoked-token replay preserves batches                                                          | Android queue tests                                                                            |
| P1       | Health Connect pagination silently truncated requested data                            | Limit/repeated-token/excess-page failure requires a smaller range; stale preview cleared when a new read starts                                                                 | Android pagination tests and source integration                                                |
| P1       | Daily calories/distance ending inside a workout were treated as that workout's totals  | Unproven workout totals omitted; independent source metrics retained                                                                                                            | Daily 900 kcal / 10 km overlapping-workout regression                                          |
| P1       | Device-derived reads/writes could silently fail or race a manual recovery edit         | Failures surface; update rechecks owner and source; affected-row counts returned                                                                                                | Device-sync failure/race regressions                                                           |
| P2       | MCP measurement limits disagreed with database constraints and silently clamped input  | Valid dates, timezone-bearing timestamps and database-compatible numeric bounds are validated; invalid/empty input rejected                                                     | MCP contract tests                                                                             |
| P2       | Account/library/readiness reads treated failures as defaults or empty data             | Errors propagate; initial account failure has retry UI instead of default-unit rendering                                                                                        | Seven repository read-error cases                                                              |
| P2       | Program cursor position was treated as proof of past completion                        | Cancelled/expired remain truthful; missing earlier work says “No completion recorded”                                                                                           | Program status tests                                                                           |
| P2       | File-import failures left inaccurate counts and stale Connections history              | Acknowledged imported/duplicate counts retained; partial status/message; history invalidated after failure; no claim that unacknowledged rows rolled back                       | Six import commit tests and UI follow-through                                                  |
| P2       | A deployed migration was missing from Git                                              | Restored the exact deployed receipt-access migration, with no schema redesign                                                                                                   | Live migration statement comparison                                                            |
| P2       | Web lacked automated verification and unit tests loaded deployment plugins             | Added pinned Bun/Node web CI and separate Vitest configuration; PGlite test dependency pinned in lock                                                                           | Full suite, typecheck, production build and frozen install                                     |
| P2       | README described obsolete mock-only and read-only companion architecture               | Replaced README and added current architecture/audit documents; historical notes marked as superseded                                                                           | Source and deployed metadata inspection                                                        |

## Database and content evidence

Read-only production inspection established:

- 30 public tables; every table has RLS enabled.
- The four affected child-parent policy pairs checked row ownership without checking parent ownership.
- **Zero existing cross-owner links** were found across those four relationships at inspection time. This is evidence about current rows, not proof that the old policy was safe.
- All 16 previously checked-in migrations match deployed statements after line-ending/outer-whitespace normalization.
- The deployed `20260908074623_5a93b108-f7a6-43b5-be99-8c6d2ed51656.sql` was absent from Git and has been recovered exactly.
- Live system content: 48 exercises, 34 templates, 213 prescriptions, 6 programs and 34 program slots. Personal content was not enumerated.
- The static no-gym library contains 12 separate follow-along choices. It does not persist its checklist as a workout.

The public functions reviewed use explicit auth ownership for privileged program operations. New recovery logic uses SECURITY INVOKER and authenticated-only execution. The new parent checks retain service-role ingestion, so server-side owner checks remain essential.

## Verification

| Check                             | Result and boundary                                                                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full Vitest suite                 | **38 files / 520 tests passed**                                                                                                                                       |
| PostgreSQL regression tests       | **38 tests passed** within the full suite, using PGlite and selected actual migrations with Supabase-like roles                                                       |
| MCP focused tests                 | **35 tests passed**, including sample-data and invalid-input contracts                                                                                                |
| TypeScript                        | `tsc --noEmit --pretty false` passed                                                                                                                                  |
| Production web build              | Vite/Nitro client/server build passed; local source compilation, not a deployment                                                                                     |
| Scoped ESLint / Prettier          | Changed TypeScript/TSX source and tests pass                                                                                                                          |
| Android Health Connect            | JDK 17 / SDK 36: `testDebugUnitTest assembleDebug lintDebug` passed; **47 JVM tests**, **0 lint errors / 18 existing warnings**                                       |
| Garmin                            | SDK 9.2.0 fenix7 test build passed; **13 simulator tests passed**; existing dynamic-container/icon warnings                                                           |
| Local browser                     | Demo entry; 10 feature routes rendered at 390px with no horizontal overflow or page exceptions; Speed → Change of Direction → Build → two completed checks showed 50% |
| Existing production public routes | /health-connect and /privacy returned 200; missing-token export and /mcp returned 401 with no-store caching                                                           |
| Git                               | Diff whitespace check passed; isolated branch, no existing edits overwritten                                                                                          |

The database harness executes actual available core/library/import migrations plus the new policy/RPC migrations. It does **not** emulate hosted PostgREST or OAuth. PGlite serializes one connection, so partial-call tests do not prove live multi-connection contention. QueryClient tests prove identity-cache behavior; a real authenticated athlete-A → athlete-B browser session was not exercised.

The Android build is a local debug validation. No Health Connect provider write, receiving-app rendering, physical Garmin sync, production migration, store upload or publish happened during this audit. Browser tests used local demo configuration and did not submit athlete data.

## Remaining debt, in recommended order

| Priority | Debt                                                                          | Concrete next step and acceptance test                                                                                                                                                                                                                                         |
| -------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1       | **Database cannot be rebuilt from migration history**                         | Capture an authoritative, reviewed schema baseline from the deployed database, reconcile the untracked program foundation, and prove clean replay plus schema diff equality in a disposable database. Do not fabricate old DDL or mark migrations applied to hide the failure. |
| P1       | **Free-template workout creation spans multiple requests**                    | Move session/exercise/planned-set creation into an RLS-aware transaction with a retry ID, preserving training-method validation and library gates. Inject failures between child inserts and prove no partial active session remains.                                          |
| P1       | **Device ingest is not atomic across archive, derived rows and job metadata** | Define commit/checkpoint and acknowledged-count semantics; add crash/retry tests between every stage. Existing dedupe does not make the whole operation transactional. Concurrent bodyweight derivation also needs a stable uniqueness contract.                               |
| P1       | **Provider edits remain stale under insert-ignore dedupe**                    | Design source record IDs plus version/update rules, preserving manual changes and import provenance. Replay an edited provider activity and changed daily total; verify one updated record and correct derived views.                                                          |
| P2       | **Nutrition aggregate concurrency remains client managed**                    | Derive totals transactionally in PostgreSQL or query them directly. Concurrent meal additions must never leave a stale aggregate. The implemented failure checks prevent silent zero overwrite but do not serialize writes.                                                    |
| P2       | **Content has multiple publication paths**                                    | Use a versioned manifest to generate demo/seed outputs with stable source keys, warnings and provenance. Compare all 34 system templates/213 prescriptions against the published catalog and keep static no-gym completion distinct.                                           |
| P2       | **Large modules and unbounded nested reads**                                  | Incrementally split the approximately 3,000-line repository and workout route by domain. Add bounded/paginated history reads and query-count budgets before changing caching. The Connections build chunk remains approximately 553 kB before gzip.                            |
| P2       | **Additional Health Connect semantics need correction**                       | Distinguish awake intervals from sleep time, use evidenced historical offsets, and define provider-priority/interval aggregation. Verify with real provider records; do not infer workout attribution from timestamp coincidence.                                              |
| P2       | **Auth restoration/sign-out errors need an explicit lifecycle**               | Add stale-initial-session and failed-sign-out browser tests. The new cache boundary fixes cross-identity cache reuse but does not redesign session restoration.                                                                                                                |
| P2       | **Configuration and release parity can drift**                                | Verify GitHub → Lovable exact source independently, unify intentional origin configuration, and run purpose-bound pairing checks before changing Garmin's origin.                                                                                                              |
| P2       | **Native mobile preview is not a connected client**                           | Add authenticated replay/acknowledgment and distinct transient/corrupt-storage handling before permitting real athlete data. Preserve its current sample-only/no-network boundary until then.                                                                                  |

A full historical replay was attempted. It fails at `20260826200646_6dcb0782-9425-4e3d-95d3-14c1f329a8ce.sql` with `relation "public.program_workouts" does not exist`. Neither repository SQL nor deployed migration history contains the foundational CREATE TABLE statements. This remains an explicit recovery limitation.

## Release prerequisites

The new database migrations are:

1. `20260912061347_enforce_user_owned_parent_links.sql`
2. `20260912061758_patch_recovery_entry_atomically.sql`

Apply and verify them on the intended database before publishing the new MCP recovery code. The restored September 8 receipt migration is already recorded in production; do not apply it again as a new migration.

Next validate the tested source in a staged deployment, authenticated MCP reads/partial recovery patches, athlete account switching, and physical phone/watch flows. Health Connect gates include first write, repeat-write deduplication, edited-workout update, revoked permission and receiving-app display. Garmin gates include physical sync/FIT behavior and declared target-device builds. Distribution versions/signing were not changed by this audit.

At inspection, GitHub main was `c20635a` and Lovable reported published source `41ef530655077c77084b83bc2abef255dff73b74`. Those are independent source histories; this audit did not certify full current parity or update either remote.

## Documentation references

The implementation follows Supabase's [RLS ownership guidance](https://supabase.com/docs/guides/database/postgres/row-level-security), Bun's [frozen-lockfile CI workflow](https://bun.sh/docs/pm/cli/install), and PGlite's [PostgreSQL test runtime](https://pglite.dev/docs/about). These explain the tools and boundaries; actual fix evidence comes from the repository tests and read-only catalog inspection described above.
