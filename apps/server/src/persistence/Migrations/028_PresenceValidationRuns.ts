import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const migration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_validation_runs (
      validation_run_id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL REFERENCES presence_attempts(attempt_id) ON DELETE CASCADE,
      ticket_id TEXT NOT NULL REFERENCES presence_tickets(ticket_id) ON DELETE CASCADE,
      command_kind TEXT NOT NULL,
      command_text TEXT NOT NULL,
      status TEXT NOT NULL,
      exit_code INTEGER,
      stdout_summary TEXT,
      stderr_summary TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_validation_runs_attempt_idx
      ON presence_validation_runs(attempt_id, started_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_validation_runs_batch_idx
      ON presence_validation_runs(batch_id, started_at DESC)
  `;
});

export default migration;
