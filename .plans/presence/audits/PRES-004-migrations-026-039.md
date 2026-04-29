# PRES-004 Audit: Migrations 026-039

Date: 2026-04-28
Scope: `apps/server/src/persistence/Migrations/026_PresenceDomain.ts` through registered migration `039_PresenceResidentController`, plus nearby registration in `apps/server/src/persistence/Migrations.ts`.

## Summary

The registered migration sequence is numerically contiguous from 026 through 039, but the source file naming is not: registered migration 036 is imported from `026_CanonicalizeModelSelectionOptions.ts`, creating a duplicate `026_` prefix next to `026_PresenceDomain.ts` and hiding the actual 036 slot in file listings. Most Presence migrations are append-style schema additions, but 030, 032, and 033 use `Effect.ignore` around non-idempotent `ALTER TABLE ... ADD COLUMN` statements, and 037 is intentionally destructive.

No runtime code was edited for this audit.

## Findings

### 1. Migration 036 is registered correctly but named like migration 026

- `apps/server/src/persistence/Migrations.ts` imports `Migration0036` from `./Migrations/026_CanonicalizeModelSelectionOptions.ts`.
- `migrationEntries` registers that import as `[36, "CanonicalizeModelSelectionOptions", Migration0036]`.
- The file tree now contains both `026_PresenceDomain.ts` and `026_CanonicalizeModelSelectionOptions.ts`, plus a matching `026_CanonicalizeModelSelectionOptions.test.ts`.

Risk: medium. Runtime ordering is correct because `Migrator.fromRecord` uses the entry key `36_CanonicalizeModelSelectionOptions`, but humans and review tools will misread the migration range. This is especially confusing in PRES-004 because the audit target says 026 through 039 and includes a non-Presence canonical model migration at registered ID 036.

Recommendation: rename `026_CanonicalizeModelSelectionOptions.ts` and its test to `036_CanonicalizeModelSelectionOptions.ts`, update only the static import path, and keep the registered entry exactly `[36, "CanonicalizeModelSelectionOptions", Migration0036]`. This preserves database migration identity while making the filesystem match the canonical ID.

### 2. Non-idempotent `ALTER TABLE` patterns are hidden by `Effect.ignore`

Affected migrations:

- `030_PresenceSupervisorRuns.ts`: adds `presence_review_artifacts.thread_id`.
- `032_PresenceProjectionScopeVersions.ts`: adds `desired_version`, `projected_version`, `lease_owner`, and `lease_expires_at` to `presence_projection_health`.
- `033_PresenceAgenticReviewArtifacts.ts`: adds `decision`, `checklist_assessment_json`, `evidence_json`, and `changed_files_reviewed_json` to `presence_review_artifacts`.

These `ALTER TABLE ... ADD COLUMN` statements are not idempotent by themselves. Wrapping them in `Effect.ignore` avoids duplicate-column failures if a partially migrated local database already has the column, but it also suppresses unrelated SQL failures such as a missing prerequisite table, invalid SQL, foreign-key problems, or storage failures.

Risk: medium. This keeps startup tolerant during local WIP churn, but it can also mark the migration as successful while leaving the schema incomplete.

Recommendation: prefer the `039_PresenceResidentController.ts` pattern for column additions: inspect `PRAGMA table_info(<table>)` and run the `ALTER TABLE` only when the target column is absent. If editing old migrations is considered too much churn, use that helper pattern for all future Presence migrations and add a small migration smoke test that applies through 039 and asserts the expected columns exist.

### 3. Migration 037 is destructive and not retry-clean after partial failure

`037_RemovePresenceDeterministicValidation.ts` deletes validation-derived rows, drops validation tables, rebuilds `presence_repository_capability_scans` without `has_validation_capability`, and rewrites checklist text.

Risk: medium-high. The destructive behavior appears intentional, but it is not append-only and should be treated as a data-removal migration. Its table rebuild also creates `presence_repository_capability_scans_next` without `IF NOT EXISTS` or an initial cleanup. If migration execution fails after creating that intermediate table but before renaming, a rerun can fail on `CREATE TABLE presence_repository_capability_scans_next`.

Recommendation: document 037 as intentional data removal in the migration history. If compatibility fixes to old migrations are allowed, make the rebuild retry-clean by dropping `presence_repository_capability_scans_next` before creating it or by using an explicitly scoped temporary table strategy. Add a focused regression test for a seeded pre-037 database that verifies validation artifacts are removed, capability scans survive without `has_validation_capability`, and the migration can recover from the expected pre-037 shape.

### 4. Migration 039 is mostly idempotent, but `updated_at` remains nullable

`039_PresenceResidentController.ts` uses an explicit `addColumnIfMissing` helper for `presence_goal_intakes`, which is safer than `Effect.ignore`. The created controller table and indexes use `IF NOT EXISTS`.

The added `presence_goal_intakes.updated_at` column is nullable because SQLite cannot add a `NOT NULL` column without a default in the current form. Existing rows are backfilled with `COALESCE(updated_at, created_at)`, but future direct SQL inserts could omit it unless runtime paths always set it.

Risk: low. This is likely acceptable if service code owns writes, but it is a schema looseness worth tracking.

Recommendation: if `updated_at` is part of the durable contract for goal intakes, either add a default-bearing column in a follow-up migration or document that application writes, not SQLite constraints, enforce it.

### 5. Old migration file churn should be reverted

`git diff` shows `026_PresenceDomain.ts` has only a trailing blank-line removal. There is no schema or behavior change.

Risk: low, but noisy. This creates unnecessary churn in an old migration and makes future migration audits harder.

Recommendation: revert the whitespace-only change to `026_PresenceDomain.ts` unless another in-flight branch already depends on that exact formatting.

## Migration-by-Migration Notes

- 026 `PresenceDomain`: creates core Presence tables and indexes with `IF NOT EXISTS`; append-style. Current diff is whitespace-only and should be reverted.
- 027 `PresenceSupervisorPolicy`: creates capability scan, waiver, and goal intake tables with indexes; append-style.
- 028 `PresenceValidationRuns`: creates validation run table and indexes; append-style, later removed by 037.
- 029 `PresenceFindingsAndProjections`: creates outcome, finding, review artifact, and follow-up tables; append-style.
- 030 `PresenceSupervisorRuns`: creates supervisor run table and indexes; adds `thread_id` through ignored `ALTER TABLE`.
- 031 `PresenceProjectionHealth`: creates projection health table and indexes; append-style.
- 032 `PresenceProjectionScopeVersions`: ignored `ALTER TABLE` column additions plus backfill and indexes.
- 033 `PresenceAgenticReviewArtifacts`: ignored `ALTER TABLE` column additions.
- 034 `PresenceConcurrencyInvariants`: normalizes duplicate active attempts/runs before adding partial unique indexes; includes data mutation but is compatibility-oriented.
- 035 `PresenceMergeOperations`: creates merge operation table and partial unique/index coverage; append-style.
- 036 `CanonicalizeModelSelectionOptions`: registered as 036 but file/test are named `026_*`; non-Presence data canonicalization in the Presence-numbered range.
- 037 `RemovePresenceDeterministicValidation`: destructive cleanup/removal migration; not append-only and not fully retry-clean after partial failure.
- 038 `PresenceMissionRuntime`: creates mission event/state tables and indexes; append-style.
- 039 `PresenceResidentController`: creates board controller state and adds goal intake controller columns using explicit column existence checks; mostly idempotent.

## Test Gap

There is a focused test for registered migration 036 canonicalization, but no Presence migration smoke test covering 026-039 as a range. The smallest useful gap to fill later is a server migration test that runs through 039 on an in-memory database and asserts:

- registered migration 36 is reachable despite the current filename mismatch,
- all expected Presence tables and indexes exist,
- the 030/032/033/039 added columns exist,
- 037 preserves capability scan rows while removing deterministic validation storage.

Do not add that test as part of this audit unless the migration implementation itself changes.
