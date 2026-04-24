import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const migration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_mission_events (
      mission_event_id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL REFERENCES presence_boards(board_id) ON DELETE CASCADE,
      ticket_id TEXT REFERENCES presence_tickets(ticket_id) ON DELETE CASCADE,
      attempt_id TEXT REFERENCES presence_attempts(attempt_id) ON DELETE SET NULL,
      review_artifact_id TEXT REFERENCES presence_review_artifacts(review_artifact_id) ON DELETE SET NULL,
      supervisor_run_id TEXT REFERENCES presence_supervisor_runs(supervisor_run_id) ON DELETE SET NULL,
      thread_id TEXT,
      kind TEXT NOT NULL,
      severity TEXT NOT NULL,
      summary TEXT NOT NULL,
      detail TEXT,
      retry_behavior TEXT NOT NULL,
      human_action TEXT,
      dedupe_key TEXT NOT NULL,
      report_json TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (board_id, dedupe_key)
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_ticket_mission_state (
      ticket_id TEXT PRIMARY KEY REFERENCES presence_tickets(ticket_id) ON DELETE CASCADE,
      board_id TEXT NOT NULL REFERENCES presence_boards(board_id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      status_line TEXT NOT NULL,
      waiting_on TEXT NOT NULL,
      latest_event_id TEXT REFERENCES presence_mission_events(mission_event_id) ON DELETE SET NULL,
      latest_event_summary TEXT,
      latest_event_at TEXT,
      needs_human INTEGER NOT NULL,
      human_action TEXT,
      retry_behavior TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_board_mission_state (
      board_id TEXT PRIMARY KEY REFERENCES presence_boards(board_id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      active_ticket_ids_json TEXT NOT NULL,
      blocked_ticket_ids_json TEXT NOT NULL,
      human_action_ticket_ids_json TEXT NOT NULL,
      latest_event_id TEXT REFERENCES presence_mission_events(mission_event_id) ON DELETE SET NULL,
      latest_event_summary TEXT,
      latest_event_at TEXT,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_mission_events_board_created_idx
      ON presence_mission_events(board_id, created_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_mission_events_ticket_created_idx
      ON presence_mission_events(ticket_id, created_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_mission_events_thread_idx
      ON presence_mission_events(thread_id, created_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_ticket_mission_state_board_idx
      ON presence_ticket_mission_state(board_id, updated_at DESC)
  `;
});

export default migration;
