import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const migration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_repo_brain_evidence (
      repo_brain_evidence_id TEXT PRIMARY KEY,
      repository_id TEXT NOT NULL REFERENCES presence_repositories(repository_id) ON DELETE CASCADE,
      repo_brain_memory_id TEXT,
      role TEXT NOT NULL CHECK (role IN ('supports', 'contradicts', 'supersedes', 'context')),
      source_json TEXT NOT NULL,
      summary TEXT NOT NULL,
      confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
      observed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      dedupe_key TEXT NOT NULL,
      UNIQUE(repository_id, dedupe_key)
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_repo_brain_candidates (
      repo_brain_candidate_id TEXT PRIMARY KEY,
      repository_id TEXT NOT NULL REFERENCES presence_repositories(repository_id) ON DELETE CASCADE,
      proposed_memory_id TEXT,
      predecessor_candidate_id TEXT REFERENCES presence_repo_brain_candidates(repo_brain_candidate_id) ON DELETE SET NULL,
      kind TEXT NOT NULL CHECK (kind IN ('fact', 'decision', 'workflow', 'lesson', 'risk')),
      status TEXT NOT NULL CHECK (status IN ('candidate', 'accepted', 'edited', 'rejected', 'stale', 'disputed', 'historical')),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      scope_json TEXT NOT NULL,
      confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
      proposed_by TEXT NOT NULL CHECK (proposed_by IN ('worker', 'reviewer', 'supervisor', 'human', 'deterministic_projection')),
      source_evidence_ids_json TEXT NOT NULL,
      invalidation_triggers_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      reviewed_at TEXT,
      source_dedupe_key TEXT NOT NULL,
      UNIQUE(repository_id, source_dedupe_key)
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_repo_brain_candidate_sources (
      repository_id TEXT NOT NULL REFERENCES presence_repositories(repository_id) ON DELETE CASCADE,
      source_dedupe_key TEXT NOT NULL,
      evidence_id TEXT NOT NULL REFERENCES presence_repo_brain_evidence(repo_brain_evidence_id) ON DELETE CASCADE,
      candidate_id TEXT REFERENCES presence_repo_brain_candidates(repo_brain_candidate_id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY(repository_id, source_dedupe_key)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_repo_brain_evidence_repository_idx
      ON presence_repo_brain_evidence(repository_id, observed_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_repo_brain_candidates_repository_idx
      ON presence_repo_brain_candidates(repository_id, updated_at DESC)
  `;
});

export default migration;
