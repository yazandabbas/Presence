import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const migration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_repository_capability_scans (
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
      has_validation_capability INTEGER NOT NULL,
      risk_signals_json TEXT NOT NULL,
      scanned_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_validation_waivers (
      validation_waiver_id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES presence_tickets(ticket_id) ON DELETE CASCADE,
      attempt_id TEXT REFERENCES presence_attempts(attempt_id) ON DELETE SET NULL,
      reason TEXT NOT NULL,
      granted_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_goal_intakes (
      goal_intake_id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL REFERENCES presence_boards(board_id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      raw_goal TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_ticket_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_validation_waivers_ticket_idx
      ON presence_validation_waivers(ticket_id, created_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_goal_intakes_board_idx
      ON presence_goal_intakes(board_id, created_at DESC)
  `;
});

export default migration;
