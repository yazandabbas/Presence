import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

const addColumnIfMissing = (
  column: string,
  statement: Effect.Effect<unknown, SqlError, never>,
): Effect.Effect<void, SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const columns = yield* sql<{ readonly name: string }>`
      PRAGMA table_info(presence_goal_intakes)
    `;
    if (!columns.some((existing) => existing.name === column)) {
      yield* statement;
    }
  });

const migration: Effect.Effect<void, SqlError, SqlClient.SqlClient> = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_board_controller_state (
      board_id TEXT PRIMARY KEY REFERENCES presence_boards(board_id) ON DELETE CASCADE,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      lease_owner TEXT,
      lease_expires_at TEXT,
      last_tick_at TEXT,
      updated_at TEXT NOT NULL
    )
  `;

  yield* addColumnIfMissing(
    "status",
    sql`ALTER TABLE presence_goal_intakes ADD COLUMN status TEXT NOT NULL DEFAULT 'queued'`,
  );
  yield* addColumnIfMissing(
    "planned_at",
    sql`ALTER TABLE presence_goal_intakes ADD COLUMN planned_at TEXT`,
  );
  yield* addColumnIfMissing(
    "blocked_at",
    sql`ALTER TABLE presence_goal_intakes ADD COLUMN blocked_at TEXT`,
  );
  yield* addColumnIfMissing(
    "last_error",
    sql`ALTER TABLE presence_goal_intakes ADD COLUMN last_error TEXT`,
  );
  yield* addColumnIfMissing(
    "updated_at",
    sql`ALTER TABLE presence_goal_intakes ADD COLUMN updated_at TEXT`,
  );

  yield* sql`
    UPDATE presence_goal_intakes
    SET status = CASE
      WHEN created_ticket_ids_json IS NOT NULL AND created_ticket_ids_json != '[]' THEN 'planned'
      ELSE 'queued'
    END,
    planned_at = CASE
      WHEN created_ticket_ids_json IS NOT NULL AND created_ticket_ids_json != '[]' THEN created_at
      ELSE planned_at
    END,
    updated_at = COALESCE(updated_at, created_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_goal_intakes_board_status_idx
      ON presence_goal_intakes(board_id, status, created_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_board_controller_state_mode_idx
      ON presence_board_controller_state(mode, status, updated_at)
  `;
});

export default migration;
