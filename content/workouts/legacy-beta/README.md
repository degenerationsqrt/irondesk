# IronDesk legacy beta content

Normalized content ingested from the owner's legacy IronDesk source archive. These files are
**data only** — no runtime code, migration, or database row is derived from them yet.

## Files

| File | Contents |
| --- | --- |
| `workout-templates.json` | 22 legacy beta workout templates, 151 prescribed movements total |
| `program-index.json` | Ordered program definitions whose slots reference template `sourceKey`s |
| `exercise-aliases.json` | Alias map used to resolve prescribed movement names to canonical library exercises |

## Rules

- **Source wording and ambiguity are preserved intentionally.** Prescribed exercise names, rep
  schemes, and load guidance are stored verbatim as they appear in the legacy source. Do not
  "clean up", rename, or reinterpret them. Legacy numeric load guidance is pounds unless the
  record states otherwise.
- **System templates are versioned by `sourceKey` + `sourceVersion`.** `sourceKey` is the stable
  identity; a content change is a new `sourceVersion`, never an in-place rewrite. Seeding must be
  idempotent on `sourceKey`.
- **These files are canonical import inputs, not runtime state.** A live workout session must
  **snapshot** its prescriptions into `session_exercises` / `workout_sets` at start time, so
  re-seeding or bumping a version can never rewrite logged history.
- **The existing 12 IronDesk Originals are separate content and must not be overwritten.** They
  keep their own `legacy-home-*` / `legacy-gym-*` source keys. This beta set is additive; any
  future seed must not touch, merge into, or renumber the Originals.
- Programs reference templates by `sourceKey` only. Ordering and scheduling live in the program
  index; templates stay order-agnostic and reusable.
