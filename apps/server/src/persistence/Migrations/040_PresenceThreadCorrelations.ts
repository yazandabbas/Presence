import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const migration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_thread_correlations (
      thread_id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL REFERENCES presence_boards(board_id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('worker', 'review', 'supervisor')),
      ticket_id TEXT REFERENCES presence_tickets(ticket_id) ON DELETE SET NULL,
      attempt_id TEXT REFERENCES presence_attempts(attempt_id) ON DELETE SET NULL,
      review_artifact_id TEXT REFERENCES presence_review_artifacts(review_artifact_id) ON DELETE SET NULL,
      supervisor_run_id TEXT REFERENCES presence_supervisor_runs(supervisor_run_id) ON DELETE SET NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_thread_correlations_board_role_idx
      ON presence_thread_correlations(board_id, role, updated_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_thread_correlations_ticket_idx
      ON presence_thread_correlations(ticket_id, updated_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_thread_correlations_attempt_idx
      ON presence_thread_correlations(attempt_id, updated_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_thread_correlations_supervisor_idx
      ON presence_thread_correlations(supervisor_run_id, updated_at DESC)
  `;
});

export default migration;
