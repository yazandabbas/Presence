import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const migration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_attempt_outcomes (
      attempt_id TEXT PRIMARY KEY REFERENCES presence_attempts(attempt_id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_findings (
      finding_id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES presence_tickets(ticket_id) ON DELETE CASCADE,
      attempt_id TEXT REFERENCES presence_attempts(attempt_id) ON DELETE SET NULL,
      source TEXT NOT NULL,
      severity TEXT NOT NULL,
      disposition TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      rationale TEXT NOT NULL,
      evidence_ids_json TEXT NOT NULL,
      validation_batch_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_review_artifacts (
      review_artifact_id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES presence_tickets(ticket_id) ON DELETE CASCADE,
      attempt_id TEXT REFERENCES presence_attempts(attempt_id) ON DELETE SET NULL,
      reviewer_kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      checklist_json TEXT NOT NULL,
      changed_files_json TEXT NOT NULL,
      finding_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_follow_up_proposals (
      proposed_follow_up_id TEXT PRIMARY KEY,
      parent_ticket_id TEXT NOT NULL REFERENCES presence_tickets(ticket_id) ON DELETE CASCADE,
      originating_attempt_id TEXT REFERENCES presence_attempts(attempt_id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      priority TEXT NOT NULL,
      status TEXT NOT NULL,
      finding_ids_json TEXT NOT NULL,
      requires_human_confirmation INTEGER NOT NULL,
      created_ticket_id TEXT REFERENCES presence_tickets(ticket_id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_attempt_outcomes_kind_idx
      ON presence_attempt_outcomes(kind, updated_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_findings_ticket_idx
      ON presence_findings(ticket_id, status, severity, updated_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_findings_attempt_idx
      ON presence_findings(attempt_id, status, updated_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_review_artifacts_attempt_idx
      ON presence_review_artifacts(attempt_id, created_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_follow_up_proposals_parent_idx
      ON presence_follow_up_proposals(parent_ticket_id, status, updated_at DESC)
  `;
});

export default migration;
