import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const migration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    DELETE FROM presence_findings
    WHERE source = 'validation'
  `;

  yield* sql`
    DELETE FROM presence_attempt_outcomes
    WHERE kind = 'failed_validation'
  `;

  yield* sql`
    DELETE FROM presence_attempt_evidence
    WHERE kind = 'validation'
  `;

  yield* sql`
    DROP TABLE IF EXISTS presence_validation_runs
  `;

  yield* sql`
    DROP TABLE IF EXISTS presence_validation_batches
  `;

  yield* sql`
    DROP TABLE IF EXISTS presence_validation_waivers
  `;

  yield* sql`
    CREATE TABLE presence_repository_capability_scans_next (
      capability_scan_id TEXT PRIMARY KEY,
      repository_id TEXT NOT NULL UNIQUE REFERENCES presence_repositories(repository_id) ON DELETE CASCADE,
      board_id TEXT NOT NULL REFERENCES presence_boards(board_id) ON DELETE CASCADE,
      base_branch TEXT,
      upstream_ref TEXT,
      has_remote INTEGER NOT NULL,
      is_clean INTEGER NOT NULL,
      ecosystems_json TEXT NOT NULL,
      markers_json TEXT NOT NULL,
      discovered_commands_json TEXT NOT NULL,
      risk_signals_json TEXT NOT NULL,
      scanned_at TEXT NOT NULL
    )
  `;

  yield* sql`
    INSERT INTO presence_repository_capability_scans_next (
      capability_scan_id, repository_id, board_id, base_branch, upstream_ref,
      has_remote, is_clean, ecosystems_json, markers_json, discovered_commands_json,
      risk_signals_json, scanned_at
    )
    SELECT
      capability_scan_id, repository_id, board_id, base_branch, upstream_ref,
      has_remote, is_clean, ecosystems_json, markers_json, discovered_commands_json,
      risk_signals_json, scanned_at
    FROM presence_repository_capability_scans
  `;

  yield* sql`
    DROP TABLE presence_repository_capability_scans
  `;

  yield* sql`
    ALTER TABLE presence_repository_capability_scans_next
    RENAME TO presence_repository_capability_scans
  `;

  yield* sql`
    UPDATE presence_tickets
    SET acceptance_checklist_json = replace(
      replace(acceptance_checklist_json, 'Tests or validation captured', 'Reviewer validation captured'),
      'Validation recorded',
      'Reviewer validation captured'
    )
  `;
});

export default migration;
