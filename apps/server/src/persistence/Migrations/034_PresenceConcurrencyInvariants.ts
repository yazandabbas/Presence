import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const migration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS presence_attempts_active_ticket_idx
      ON presence_attempts(ticket_id)
      WHERE status IN ('planned', 'in_progress', 'in_review')
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS presence_supervisor_runs_running_board_idx
      ON presence_supervisor_runs(board_id)
      WHERE status = 'running'
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_validation_batches (
      validation_batch_id TEXT PRIMARY KEY,
      attempt_id TEXT NOT NULL REFERENCES presence_attempts(attempt_id) ON DELETE CASCADE,
      ticket_id TEXT NOT NULL REFERENCES presence_tickets(ticket_id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS presence_validation_batches_running_attempt_idx
      ON presence_validation_batches(attempt_id)
      WHERE status = 'running'
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_validation_batches_attempt_idx
      ON presence_validation_batches(attempt_id, updated_at DESC)
  `;
});

export default migration;
