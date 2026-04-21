import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const migration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_supervisor_runs (
      supervisor_run_id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL REFERENCES presence_boards(board_id) ON DELETE CASCADE,
      source_goal_intake_id TEXT REFERENCES presence_goal_intakes(goal_intake_id) ON DELETE SET NULL,
      scope_ticket_ids_json TEXT NOT NULL,
      status TEXT NOT NULL,
      stage TEXT NOT NULL,
      current_ticket_id TEXT REFERENCES presence_tickets(ticket_id) ON DELETE SET NULL,
      active_thread_ids_json TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* Effect.ignore(
    sql`
      ALTER TABLE presence_review_artifacts
        ADD COLUMN thread_id TEXT REFERENCES projection_threads(thread_id) ON DELETE SET NULL
    `,
  );

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_supervisor_runs_board_idx
      ON presence_supervisor_runs(board_id, status, updated_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_supervisor_runs_goal_idx
      ON presence_supervisor_runs(source_goal_intake_id, updated_at DESC)
  `;
});

export default migration;
