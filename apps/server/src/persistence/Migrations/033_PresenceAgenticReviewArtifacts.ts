import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const migration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* Effect.ignore(
    sql`
      ALTER TABLE presence_review_artifacts
        ADD COLUMN decision TEXT
    `,
  );

  yield* Effect.ignore(
    sql`
      ALTER TABLE presence_review_artifacts
        ADD COLUMN checklist_assessment_json TEXT NOT NULL DEFAULT '[]'
    `,
  );

  yield* Effect.ignore(
    sql`
      ALTER TABLE presence_review_artifacts
        ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '[]'
    `,
  );

  yield* Effect.ignore(
    sql`
      ALTER TABLE presence_review_artifacts
        ADD COLUMN changed_files_reviewed_json TEXT NOT NULL DEFAULT '[]'
    `,
  );
});

export default migration;
