import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const migration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const normalizedNow = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

  // Existing dev databases can already contain multiple active attempts for the same
  // ticket from earlier Presence iterations. Normalize them before adding the new
  // uniqueness invariant so startup can migrate lived-in state instead of crash-looping.
  yield* sql.unsafe(`
    WITH duplicate_tickets AS (
      SELECT ticket_id
      FROM presence_attempts
      WHERE status IN ('planned', 'in_progress', 'in_review')
      GROUP BY ticket_id
      HAVING COUNT(*) > 1
    ),
    ranked_attempts AS (
      SELECT
        attempt_id,
        ticket_id,
        ROW_NUMBER() OVER (
          PARTITION BY ticket_id
          ORDER BY
            CASE
              WHEN attempt_id = (
                SELECT assigned_attempt_id
                FROM presence_tickets
                WHERE ticket_id = presence_attempts.ticket_id
              ) THEN 0
              ELSE 1
            END,
            updated_at DESC,
            created_at DESC,
            attempt_id DESC
        ) AS attempt_rank
      FROM presence_attempts
      WHERE status IN ('planned', 'in_progress', 'in_review')
    )
    UPDATE presence_tickets
    SET
      assigned_attempt_id = (
        SELECT attempt_id
        FROM ranked_attempts
        WHERE ranked_attempts.ticket_id = presence_tickets.ticket_id
          AND attempt_rank = 1
      ),
      updated_at = ${normalizedNow}
    WHERE ticket_id IN (SELECT ticket_id FROM duplicate_tickets)
  `);

  yield* sql.unsafe(`
    WITH duplicate_tickets AS (
      SELECT ticket_id
      FROM presence_attempts
      WHERE status IN ('planned', 'in_progress', 'in_review')
      GROUP BY ticket_id
      HAVING COUNT(*) > 1
    ),
    ranked_attempts AS (
      SELECT
        attempt_id,
        ticket_id,
        ROW_NUMBER() OVER (
          PARTITION BY ticket_id
          ORDER BY
            CASE
              WHEN attempt_id = (
                SELECT assigned_attempt_id
                FROM presence_tickets
                WHERE ticket_id = presence_attempts.ticket_id
              ) THEN 0
              ELSE 1
            END,
            updated_at DESC,
            created_at DESC,
            attempt_id DESC
        ) AS attempt_rank
      FROM presence_attempts
      WHERE status IN ('planned', 'in_progress', 'in_review')
    )
    UPDATE presence_attempts
    SET
      status = 'interrupted',
      updated_at = ${normalizedNow}
    WHERE attempt_id IN (
      SELECT attempt_id
      FROM ranked_attempts
      WHERE ticket_id IN (SELECT ticket_id FROM duplicate_tickets)
        AND attempt_rank > 1
    )
  `);

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS presence_attempts_active_ticket_idx
      ON presence_attempts(ticket_id)
      WHERE status IN ('planned', 'in_progress', 'in_review')
  `;

  yield* sql.unsafe(`
    WITH ranked_runs AS (
      SELECT
        supervisor_run_id,
        ROW_NUMBER() OVER (
          PARTITION BY board_id
          ORDER BY updated_at DESC, created_at DESC, supervisor_run_id DESC
        ) AS run_rank
      FROM presence_supervisor_runs
      WHERE status = 'running'
    )
    UPDATE presence_supervisor_runs
    SET
      status = 'cancelled',
      updated_at = ${normalizedNow}
    WHERE supervisor_run_id IN (
      SELECT supervisor_run_id
      FROM ranked_runs
      WHERE run_rank > 1
    )
  `);

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS presence_supervisor_runs_running_board_idx
      ON presence_supervisor_runs(board_id)
      WHERE status = 'running'
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS presence_validation_batches (
      validation_batch_id TEXT PRIMARY KEY,
      attempt_id TEXT NOT NULL REFERENCES presence_attempts(attempt_id) ON DELETE CASCADE,
      ticket_id TEXT NOT NULL REFERENCES presence_tickets(ticket_id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    )
  `;

  yield* sql.unsafe(`
    WITH ranked_batches AS (
      SELECT
        validation_batch_id,
        ROW_NUMBER() OVER (
          PARTITION BY attempt_id
          ORDER BY updated_at DESC, created_at DESC, validation_batch_id DESC
        ) AS batch_rank
      FROM presence_validation_batches
      WHERE status = 'running'
    )
    UPDATE presence_validation_batches
    SET
      status = 'cancelled',
      updated_at = ${normalizedNow},
      completed_at = COALESCE(completed_at, ${normalizedNow})
    WHERE validation_batch_id IN (
      SELECT validation_batch_id
      FROM ranked_batches
      WHERE batch_rank > 1
    )
  `);

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS presence_validation_batches_running_attempt_idx
      ON presence_validation_batches(attempt_id)
      WHERE status = 'running'
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS presence_validation_batches_attempt_idx
      ON presence_validation_batches(attempt_id, updated_at DESC)
  `;
});

export default migration;
