import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const migration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_repo_brain_memories (
      repo_brain_memory_id TEXT PRIMARY KEY,
      repository_id TEXT NOT NULL REFERENCES presence_repositories(repository_id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('fact', 'decision', 'workflow', 'lesson', 'risk')),
      status TEXT NOT NULL CHECK (status IN ('candidate', 'accepted', 'edited', 'rejected', 'stale', 'disputed', 'historical')),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      scope_json TEXT NOT NULL,
      confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
      trust_mode TEXT NOT NULL CHECK (trust_mode IN ('deny', 'read_only', 'read_write')),
      source_evidence_ids_json TEXT NOT NULL,
      invalidation_triggers_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      reviewed_at TEXT
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_repo_brain_promotion_reviews (
      repo_brain_memory_review_id TEXT PRIMARY KEY,
      repo_brain_candidate_id TEXT NOT NULL REFERENCES presence_repo_brain_candidates(repo_brain_candidate_id) ON DELETE CASCADE,
      resulting_memory_id TEXT REFERENCES presence_repo_brain_memories(repo_brain_memory_id) ON DELETE SET NULL,
      action TEXT NOT NULL CHECK (action IN ('accept', 'edit_accept', 'reject', 'dispute', 'mark_stale', 'mark_historical')),
      reviewer_kind TEXT CHECK (reviewer_kind IN ('human', 'policy', 'review_agent')),
      reviewer TEXT,
      reason TEXT NOT NULL,
      final_title TEXT,
      final_body TEXT,
      final_scope_json TEXT,
      final_confidence TEXT CHECK (final_confidence IS NULL OR final_confidence IN ('low', 'medium', 'high')),
      final_invalidation_triggers_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_repo_brain_memories_repository_idx
      ON presence_repo_brain_memories(repository_id, status, updated_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_repo_brain_promotion_reviews_candidate_idx
      ON presence_repo_brain_promotion_reviews(repo_brain_candidate_id, created_at DESC)
  `;
});

export default migration;
