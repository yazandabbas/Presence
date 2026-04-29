import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const migration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_operation_ledger (
      operation_id TEXT PRIMARY KEY,
      scope_key TEXT NOT NULL,
      parent_operation_id TEXT REFERENCES presence_operation_ledger(operation_id) ON DELETE SET NULL,
      board_id TEXT REFERENCES presence_boards(board_id) ON DELETE CASCADE,
      ticket_id TEXT REFERENCES presence_tickets(ticket_id) ON DELETE SET NULL,
      attempt_id TEXT REFERENCES presence_attempts(attempt_id) ON DELETE SET NULL,
      review_artifact_id TEXT REFERENCES presence_review_artifacts(review_artifact_id) ON DELETE SET NULL,
      supervisor_run_id TEXT REFERENCES presence_supervisor_runs(supervisor_run_id) ON DELETE SET NULL,
      thread_id TEXT,
      kind TEXT NOT NULL CHECK (kind IN (
        'controller_tick',
        'goal_planning',
        'supervisor_run',
        'worker_attempt',
        'review_run',
        'command_dispatch',
        'provider_runtime_observation',
        'projection_sync',
        'repo_brain_projection',
        'merge_operation',
        'human_direction'
      )),
      phase TEXT NOT NULL CHECK (phase IN (
        'queued',
        'start',
        'scan',
        'dispatch',
        'execute',
        'persist',
        'project',
        'observe',
        'finish'
      )),
      status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'skipped', 'cancelled')),
      dedupe_key TEXT NOT NULL,
      summary TEXT NOT NULL,
      details_json TEXT NOT NULL,
      counters_json TEXT NOT NULL,
      error_json TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(scope_key, dedupe_key)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_operation_ledger_board_updated_idx
      ON presence_operation_ledger(board_id, updated_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_operation_ledger_parent_idx
      ON presence_operation_ledger(parent_operation_id, updated_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_operation_ledger_status_idx
      ON presence_operation_ledger(status, updated_at DESC)
  `;
});

export default migration;
