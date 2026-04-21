import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const migration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_projection_health (
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      status TEXT NOT NULL,
      last_attempted_at TEXT,
      last_succeeded_at TEXT,
      last_error_message TEXT,
      last_error_path TEXT,
      dirty_reason TEXT,
      retry_after TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scope_type, scope_id)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_projection_health_status_idx
      ON presence_projection_health(scope_type, status, updated_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_projection_health_retry_idx
      ON presence_projection_health(status, retry_after, updated_at DESC)
  `;
});

export default migration;
