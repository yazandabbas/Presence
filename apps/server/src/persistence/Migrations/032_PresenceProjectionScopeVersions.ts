import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const migration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* Effect.ignore(
    sql`
      ALTER TABLE presence_projection_health
        ADD COLUMN desired_version INTEGER NOT NULL DEFAULT 0
    `,
  );

  yield* Effect.ignore(
    sql`
      ALTER TABLE presence_projection_health
        ADD COLUMN projected_version INTEGER NOT NULL DEFAULT 0
    `,
  );

  yield* Effect.ignore(
    sql`
      ALTER TABLE presence_projection_health
        ADD COLUMN lease_owner TEXT
    `,
  );

  yield* Effect.ignore(
    sql`
      ALTER TABLE presence_projection_health
        ADD COLUMN lease_expires_at TEXT
    `,
  );

  yield* sql`
    UPDATE presence_projection_health
    SET
      desired_version = CASE
        WHEN desired_version = 0 AND status = 'healthy' THEN 1
        WHEN desired_version = 0 THEN 1
        ELSE desired_version
      END,
      projected_version = CASE
        WHEN projected_version = 0 AND status = 'healthy' THEN 1
        ELSE projected_version
      END
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_projection_health_scope_version_idx
      ON presence_projection_health(scope_type, desired_version, projected_version, updated_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_projection_health_lease_idx
      ON presence_projection_health(status, retry_after, lease_expires_at, updated_at DESC)
  `;
});

export default migration;
