import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const migration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_repositories (
      repository_id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL UNIQUE,
      project_id TEXT,
      title TEXT NOT NULL,
      workspace_root TEXT NOT NULL UNIQUE,
      default_model_selection_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_boards (
      board_id TEXT PRIMARY KEY,
      repository_id TEXT NOT NULL UNIQUE REFERENCES presence_repositories(repository_id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      sprint_focus TEXT,
      top_priority_summary TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_tickets (
      ticket_id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL REFERENCES presence_boards(board_id) ON DELETE CASCADE,
      parent_ticket_id TEXT REFERENCES presence_tickets(ticket_id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      acceptance_checklist_json TEXT NOT NULL,
      assigned_attempt_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_ticket_dependencies (
      ticket_id TEXT NOT NULL REFERENCES presence_tickets(ticket_id) ON DELETE CASCADE,
      depends_on_ticket_id TEXT NOT NULL REFERENCES presence_tickets(ticket_id) ON DELETE CASCADE,
      PRIMARY KEY (ticket_id, depends_on_ticket_id)
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_attempts (
      attempt_id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES presence_tickets(ticket_id) ON DELETE CASCADE,
      workspace_id TEXT,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      thread_id TEXT,
      summary TEXT,
      confidence REAL,
      last_worker_handoff_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_workspaces (
      workspace_id TEXT PRIMARY KEY,
      attempt_id TEXT NOT NULL UNIQUE REFERENCES presence_attempts(attempt_id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      branch TEXT,
      worktree_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_handoffs (
      handoff_id TEXT PRIMARY KEY,
      board_id TEXT REFERENCES presence_boards(board_id) ON DELETE CASCADE,
      attempt_id TEXT REFERENCES presence_attempts(attempt_id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_attempt_evidence (
      evidence_id TEXT PRIMARY KEY,
      attempt_id TEXT NOT NULL REFERENCES presence_attempts(attempt_id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_knowledge_pages (
      knowledge_page_id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL REFERENCES presence_boards(board_id) ON DELETE CASCADE,
      family TEXT NOT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      compiled_truth TEXT NOT NULL,
      timeline TEXT NOT NULL,
      linked_ticket_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (board_id, family, slug)
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_promotion_candidates (
      promotion_candidate_id TEXT PRIMARY KEY,
      source_ticket_id TEXT NOT NULL REFERENCES presence_tickets(ticket_id) ON DELETE CASCADE,
      source_attempt_id TEXT REFERENCES presence_attempts(attempt_id) ON DELETE SET NULL,
      family TEXT NOT NULL,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      compiled_truth TEXT NOT NULL,
      timeline_entry TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_deterministic_jobs (
      deterministic_job_id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL REFERENCES presence_boards(board_id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL,
      output_summary TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_review_decisions (
      review_decision_id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES presence_tickets(ticket_id) ON DELETE CASCADE,
      attempt_id TEXT REFERENCES presence_attempts(attempt_id) ON DELETE SET NULL,
      decision TEXT NOT NULL,
      notes TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_tickets_board_status_idx
      ON presence_tickets(board_id, status, priority, updated_at DESC)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_attempts_ticket_idx
      ON presence_attempts(ticket_id, created_at DESC)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_handoffs_board_role_idx
      ON presence_handoffs(board_id, role, created_at DESC)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_handoffs_attempt_role_idx
      ON presence_handoffs(attempt_id, role, created_at DESC)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_jobs_board_status_idx
      ON presence_deterministic_jobs(board_id, status, updated_at DESC)
  `;
});

export default migration;

