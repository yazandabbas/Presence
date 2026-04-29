import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  createGitRepository,
  createPresenceSystem,
  removeTempRepo,
} from "../PresenceControlPlaneTestSupport.ts";
import { makePresenceStore } from "./PresenceStore.ts";

const TEST_NOW = "2026-04-29T00:00:00.000Z";

describe("Presence repo-brain read model", () => {
  it("projects mission events and worker handoffs into idempotent repo-brain evidence and candidates", async () => {
    const repoRoot = await createGitRepository("presence-repo-brain-worker-");
    const system = await createPresenceSystem();
    const store = makePresenceStore({ sql: system.sql, nowIso: () => TEST_NOW });

    try {
      const repository = await system.presence
        .importRepository({
          workspaceRoot: repoRoot,
          title: "Presence Repo Brain Worker",
        })
        .pipe(Effect.runPromise);
      const ticket = await system.presence
        .createTicket({
          boardId: repository.boardId,
          title: "Project worker memory",
          description: "Worker handoffs should become read-only memory candidates.",
          priority: "p2",
        })
        .pipe(Effect.runPromise);
      const attempt = await system.presence
        .createAttempt({
          ticketId: ticket.id,
        })
        .pipe(Effect.runPromise);

      await system.presence
        .saveWorkerHandoff({
          attemptId: attempt.id,
          completedWork: ["Added the projection read model."],
          currentHypothesis: "Repo-brain memory should remain candidate-only until reviewed.",
          changedFiles: ["apps/server/src/presence/Layers/internal/PresenceStore.ts"],
          testsRun: ["bun run --filter t3 test -- PresenceRepoBrainReadModel.test.ts"],
          blockers: [],
          nextStep: "Run focused projection tests.",
          evidenceIds: [],
          confidence: 0.7,
        })
        .pipe(Effect.runPromise);

      await store.refreshRepoBrainReadModelForBoard(repository.boardId).pipe(Effect.runPromise);
      await store.refreshRepoBrainReadModelForBoard(repository.boardId).pipe(Effect.runPromise);

      const evidenceRows = await system.sql<{
        dedupeKey: string;
        role: string;
        sourceJson: string;
      }>`
        SELECT dedupe_key as "dedupeKey", role, source_json as "sourceJson"
        FROM presence_repo_brain_evidence
        WHERE repository_id = ${repository.id}
        ORDER BY dedupe_key ASC
      `.pipe(Effect.runPromise);
      const candidateRows = await system.sql<{
        kind: string;
        status: string;
        proposedBy: string;
        sourceEvidenceIdsJson: string;
        scopeJson: string;
      }>`
        SELECT
          kind,
          status,
          proposed_by as "proposedBy",
          source_evidence_ids_json as "sourceEvidenceIdsJson",
          scope_json as "scopeJson"
        FROM presence_repo_brain_candidates
        WHERE repository_id = ${repository.id}
      `.pipe(Effect.runPromise);

      expect(evidenceRows).toHaveLength(2);
      expect(evidenceRows.map((row) => row.dedupeKey)).toEqual([
        expect.stringContaining("mission:worker-handoff:"),
        expect.stringContaining("worker-handoff:"),
      ]);
      const workerEvidence = evidenceRows.find((row) =>
        row.dedupeKey.startsWith("worker-handoff:"),
      );
      expect(workerEvidence?.role).toBe("supports");
      expect(JSON.parse(workerEvidence?.sourceJson ?? "{}")).toMatchObject({
        ticketId: ticket.id,
        attemptId: attempt.id,
        filePath: "apps/server/src/presence/Layers/internal/PresenceStore.ts",
        command: "bun run --filter t3 test -- PresenceRepoBrainReadModel.test.ts",
      });
      expect(candidateRows).toHaveLength(1);
      expect(candidateRows[0]).toMatchObject({
        kind: "lesson",
        status: "candidate",
        proposedBy: "worker",
      });
      expect(JSON.parse(candidateRows[0]?.scopeJson ?? "{}")).toEqual({
        type: "attempt",
        target: attempt.id,
      });
      expect(JSON.parse(candidateRows[0]?.sourceEvidenceIdsJson ?? "[]")).toHaveLength(1);
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("projects accepted review artifacts as unpromoted fact candidates with review provenance", async () => {
    const repoRoot = await createGitRepository("presence-repo-brain-review-");
    const system = await createPresenceSystem();
    const store = makePresenceStore({ sql: system.sql, nowIso: () => TEST_NOW });

    try {
      const repository = await system.presence
        .importRepository({
          workspaceRoot: repoRoot,
          title: "Presence Repo Brain Review",
        })
        .pipe(Effect.runPromise);
      const ticket = await system.presence
        .createTicket({
          boardId: repository.boardId,
          title: "Project review memory",
          description: "Accepted reviews can propose current-state facts.",
          priority: "p2",
        })
        .pipe(Effect.runPromise);
      const attempt = await system.presence
        .createAttempt({
          ticketId: ticket.id,
        })
        .pipe(Effect.runPromise);

      const review = await store
        .createReviewArtifact({
          ticketId: ticket.id,
          attemptId: attempt.id,
          reviewerKind: "review_agent",
          decision: "accept",
          summary: "The implementation satisfies the ticket.",
          checklistJson: "[]",
          evidence: [
            {
              kind: "file_inspection",
              target: "apps/server/src/presence/Layers/internal/PresenceStore.ts",
              outcome: "passed",
              relevant: true,
              summary: "Reviewed the repo-brain projection implementation.",
              details: null,
            },
            {
              kind: "command",
              target: "bun run --filter t3 test -- PresenceRepoBrainReadModel.test.ts",
              outcome: "passed",
              relevant: true,
              summary: "Focused repo-brain projection tests passed.",
              details: null,
            },
          ],
          changedFiles: ["apps/server/src/presence/Layers/internal/PresenceStore.ts"],
          changedFilesReviewed: ["apps/server/src/presence/Layers/internal/PresenceStore.ts"],
          findingIds: [],
        })
        .pipe(Effect.runPromise);

      await store.refreshRepoBrainReadModelForBoard(repository.boardId).pipe(Effect.runPromise);

      const evidenceRows = await system.sql<{
        dedupeKey: string;
        role: string;
        confidence: string;
        sourceJson: string;
      }>`
        SELECT
          dedupe_key as "dedupeKey",
          role,
          confidence,
          source_json as "sourceJson"
        FROM presence_repo_brain_evidence
        WHERE repository_id = ${repository.id}
          AND dedupe_key = ${`review-artifact:${review.id}`}
      `.pipe(Effect.runPromise);
      const candidateRows = await system.sql<{
        kind: string;
        status: string;
        proposedBy: string;
        title: string;
      }>`
        SELECT kind, status, proposed_by as "proposedBy", title
        FROM presence_repo_brain_candidates
        WHERE repository_id = ${repository.id}
          AND source_dedupe_key = ${`review-artifact:${review.id}`}
      `.pipe(Effect.runPromise);

      expect(evidenceRows).toHaveLength(1);
      expect(evidenceRows[0]).toMatchObject({
        role: "supports",
        confidence: "high",
      });
      expect(JSON.parse(evidenceRows[0]?.sourceJson ?? "{}")).toMatchObject({
        ticketId: ticket.id,
        attemptId: attempt.id,
        reviewArtifactId: review.id,
        filePath: "apps/server/src/presence/Layers/internal/PresenceStore.ts",
        command: "bun run --filter t3 test -- PresenceRepoBrainReadModel.test.ts",
      });
      expect(candidateRows).toEqual([
        {
          kind: "fact",
          status: "candidate",
          proposedBy: "reviewer",
          title: `Review accepted ${ticket.id}`,
        },
      ]);
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("preserves finding and merge commit provenance as read-only repo-brain evidence", async () => {
    const repoRoot = await createGitRepository("presence-repo-brain-commit-");
    const system = await createPresenceSystem();
    const store = makePresenceStore({ sql: system.sql, nowIso: () => TEST_NOW });

    try {
      const repository = await system.presence
        .importRepository({
          workspaceRoot: repoRoot,
          title: "Presence Repo Brain Commit",
        })
        .pipe(Effect.runPromise);
      const ticket = await system.presence
        .createTicket({
          boardId: repository.boardId,
          title: "Project commit memory",
          description: "Findings and merge operations should retain durable provenance.",
          priority: "p2",
        })
        .pipe(Effect.runPromise);
      const attempt = await system.presence
        .createAttempt({
          ticketId: ticket.id,
        })
        .pipe(Effect.runPromise);

      const finding = await store
        .createOrUpdateFinding({
          ticketId: ticket.id,
          attemptId: attempt.id,
          source: "review",
          severity: "blocking",
          disposition: "escalate",
          summary: "Merge path is unsafe without cleanup.",
          rationale: "The review found a repository state risk that must be resolved.",
          evidenceIds: [],
        })
        .pipe(Effect.runPromise);
      const merge = await store
        .persistMergeOperation({
          id: "merge_operation_repo_brain",
          ticketId: ticket.id,
          attemptId: attempt.id,
          status: "finalized",
          baseBranch: "main",
          sourceBranch: "presence/read-model",
          sourceHeadSha: "source-sha-123",
          baseHeadBefore: "base-before-123",
          baseHeadAfter: "base-after-123",
          mergeCommitSha: "merge-sha-123",
          createdAt: TEST_NOW,
        })
        .pipe(Effect.runPromise);

      await store.refreshRepoBrainReadModelForBoard(repository.boardId).pipe(Effect.runPromise);

      const evidenceRows = await system.sql<{
        dedupeKey: string;
        role: string;
        sourceJson: string;
      }>`
        SELECT dedupe_key as "dedupeKey", role, source_json as "sourceJson"
        FROM presence_repo_brain_evidence
        WHERE repository_id = ${repository.id}
          AND dedupe_key IN (${`finding:${finding.id}`}, ${`merge-operation:${merge.id}`})
        ORDER BY dedupe_key ASC
      `.pipe(Effect.runPromise);
      const riskCandidateRows = await system.sql<{
        kind: string;
        status: string;
        title: string;
      }>`
        SELECT kind, status, title
        FROM presence_repo_brain_candidates
        WHERE repository_id = ${repository.id}
          AND source_dedupe_key = ${`finding:${finding.id}`}
      `.pipe(Effect.runPromise);

      expect(evidenceRows).toHaveLength(2);
      const findingEvidence = evidenceRows.find((row) => row.dedupeKey === `finding:${finding.id}`);
      const mergeEvidence = evidenceRows.find(
        (row) => row.dedupeKey === `merge-operation:${merge.id}`,
      );
      expect(findingEvidence?.role).toBe("contradicts");
      expect(JSON.parse(findingEvidence?.sourceJson ?? "{}")).toMatchObject({
        ticketId: ticket.id,
        attemptId: attempt.id,
        findingId: finding.id,
      });
      expect(JSON.parse(mergeEvidence?.sourceJson ?? "{}")).toMatchObject({
        ticketId: ticket.id,
        attemptId: attempt.id,
        mergeOperationId: merge.id,
        commitSha: "merge-sha-123",
      });
      expect(riskCandidateRows).toEqual([
        {
          kind: "risk",
          status: "candidate",
          title: "Merge path is unsafe without cleanup.",
        },
      ]);
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });
});
