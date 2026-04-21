import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const migration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_merge_operations (
      merge_operation_id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES presence_tickets(ticket_id) ON DELETE CASCADE,
      attempt_id TEXT NOT NULL REFERENCES presence_attempts(attempt_id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      source_branch TEXT NOT NULL,
      source_head_sha TEXT,
      base_head_before TEXT,
      base_head_after TEXT,
      merge_commit_sha TEXT,
      error_summary TEXT,
      git_abort_attempted INTEGER NOT NULL DEFAULT 0,
      cleanup_worktree_done INTEGER NOT NULL DEFAULT 0,
      cleanup_thread_done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS presence_merge_operations_active_attempt_idx
      ON presence_merge_operations(attempt_id)
      WHERE status IN ('pending_git', 'git_applied', 'cleanup_pending')
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_merge_operations_ticket_idx
      ON presence_merge_operations(ticket_id, updated_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_merge_operations_attempt_idx
      ON presence_merge_operations(attempt_id, updated_at DESC)
  `;
});

export default migration;
