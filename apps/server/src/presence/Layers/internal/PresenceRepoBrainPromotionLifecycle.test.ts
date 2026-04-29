import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  createGitRepository,
  createPresenceSystem,
  removeTempRepo,
} from "../PresenceControlPlaneTestSupport.ts";
import { makePresenceStore } from "./PresenceStore.ts";

const TEST_NOW = "2026-04-29T00:00:00.000Z";

async function createWorkerCandidate() {
  const repoRoot = await createGitRepository("presence-repo-brain-lifecycle-");
  const system = await createPresenceSystem();
  const store = makePresenceStore({ sql: system.sql, nowIso: () => TEST_NOW });

  const repository = await system.presence
    .importRepository({
      workspaceRoot: repoRoot,
      title: "Presence Repo Brain Lifecycle",
    })
    .pipe(Effect.runPromise);
  const ticket = await system.presence
    .createTicket({
      boardId: repository.boardId,
      title: "Capture repo memory",
      description: "Worker handoffs should become reviewable repo-brain candidates.",
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
      completedWork: ["Added repo-brain lifecycle state."],
      currentHypothesis: "Repo-brain candidates must be reviewed before briefing eligibility.",
      changedFiles: ["apps/server/src/presence/Layers/internal/PresenceStore.ts"],
      testsRun: ["bun run --filter t3 test -- PresenceRepoBrainPromotionLifecycle.test.ts"],
      blockers: [],
      nextStep: "Review and promote the candidate.",
      evidenceIds: [],
      confidence: 0.82,
    })
    .pipe(Effect.runPromise);

  await store.refreshRepoBrainReadModelForBoard(repository.boardId).pipe(Effect.runPromise);

  const candidateRows = await system.sql<{ id: string }>`
    SELECT repo_brain_candidate_id as id
    FROM presence_repo_brain_candidates
    WHERE repository_id = ${repository.id}
    LIMIT 1
  `.pipe(Effect.runPromise);
  const candidateId = candidateRows[0]?.id;
  if (!candidateId) throw new Error("Expected repo-brain candidate to be projected.");

  return { repoRoot, system, store, repository, candidateId };
}

describe("Presence repo-brain promotion lifecycle", () => {
  it("accepts a candidate into compiled memory and records the review", async () => {
    const { repoRoot, system, store, candidateId } = await createWorkerCandidate();

    try {
      const candidate = await store
        .reviewRepoBrainPromotionCandidate({
          candidateId,
          action: "accept",
          reviewerKind: "human",
          reviewer: "test reviewer",
          reason: "The handoff is durable project knowledge.",
        })
        .pipe(Effect.runPromise);

      expect(candidate.status).toBe("accepted");
      expect(candidate.proposedMemoryId).toBeTruthy();

      const memory = await store
        .readRepoBrainMemoryById(candidate.proposedMemoryId!)
        .pipe(Effect.runPromise);
      const reviews = await store
        .readRepoBrainPromotionReviewsForCandidate(candidateId)
        .pipe(Effect.runPromise);
      const evidenceRows = await system.sql<{ memoryId: string | null }>`
        SELECT repo_brain_memory_id as "memoryId"
        FROM presence_repo_brain_evidence
        WHERE repo_brain_memory_id = ${candidate.proposedMemoryId}
      `.pipe(Effect.runPromise);

      expect(memory?.status).toBe("accepted");
      expect(memory?.trustMode).toBe("read_write");
      expect(reviews[0]).toMatchObject({
        action: "accept",
        resultingMemoryId: candidate.proposedMemoryId,
        reason: "The handoff is durable project knowledge.",
      });
      expect(evidenceRows).toHaveLength(1);
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("edit-accepts a candidate with reviewed compiled text", async () => {
    const { repoRoot, system, store, candidateId } = await createWorkerCandidate();

    try {
      const candidate = await store
        .reviewRepoBrainPromotionCandidate({
          candidateId,
          action: "edit_accept",
          reviewerKind: "human",
          reason: "Clarified wording before promotion.",
          finalTitle: "Repo-brain candidates require human review",
          finalBody: "Presence may propose memory, but reviewed memory is the briefing source.",
          finalConfidence: "high",
        })
        .pipe(Effect.runPromise);
      const memory = await store
        .readRepoBrainMemoryById(candidate.proposedMemoryId!)
        .pipe(Effect.runPromise);

      expect(candidate.status).toBe("edited");
      expect(memory).toMatchObject({
        status: "edited",
        title: "Repo-brain candidates require human review",
        confidence: "high",
      });
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("keeps rejected candidates durable and prevents projection replay from reopening them", async () => {
    const { repoRoot, system, store, repository, candidateId } = await createWorkerCandidate();

    try {
      await store
        .reviewRepoBrainPromotionCandidate({
          candidateId,
          action: "reject",
          reviewerKind: "human",
          reason: "The candidate is too attempt-specific for durable memory.",
        })
        .pipe(Effect.runPromise);
      await store.refreshRepoBrainReadModelForBoard(repository.boardId).pipe(Effect.runPromise);

      const candidate = await store.readRepoBrainCandidateById(candidateId).pipe(Effect.runPromise);
      const memoryRows = await system.sql<{ count: number }>`
        SELECT COUNT(*) as count
        FROM presence_repo_brain_memories
        WHERE repository_id = ${repository.id}
      `.pipe(Effect.runPromise);

      expect(candidate?.status).toBe("rejected");
      expect(memoryRows[0]?.count).toBe(0);
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("marks accepted memories stale, disputed, and historical without touching ticket state", async () => {
    const { repoRoot, system, store, candidateId } = await createWorkerCandidate();

    try {
      const candidate = await store
        .reviewRepoBrainPromotionCandidate({
          candidateId,
          action: "accept",
          reviewerKind: "human",
          reason: "Promote before invalidation checks.",
        })
        .pipe(Effect.runPromise);
      const stale = await store
        .updateRepoBrainMemoryStatus({
          memoryId: candidate.proposedMemoryId!,
          status: "stale",
          reason: "The referenced file changed.",
        })
        .pipe(Effect.runPromise);

      expect(stale.status).toBe("stale");
      await expect(
        store
          .updateRepoBrainMemoryStatus({
            memoryId: candidate.proposedMemoryId!,
            status: "disputed",
            reason: "A stale memory cannot be reclassified without a new review candidate.",
          })
          .pipe(Effect.runPromise),
      ).rejects.toThrow(/already stale/);
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("rejects illegal second reviews for the same candidate", async () => {
    const { repoRoot, system, store, candidateId } = await createWorkerCandidate();

    try {
      await store
        .reviewRepoBrainPromotionCandidate({
          candidateId,
          action: "dispute",
          reviewerKind: "human",
          reason: "The claim needs a clearer source.",
        })
        .pipe(Effect.runPromise);

      await expect(
        store
          .reviewRepoBrainPromotionCandidate({
            candidateId,
            action: "accept",
            reviewerKind: "human",
            reason: "Try to accept after dispute.",
          })
          .pipe(Effect.runPromise),
      ).rejects.toThrow(/already disputed/);
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("retrieves only prompt-safe memories by default with evidence citations", async () => {
    const { repoRoot, system, store, candidateId } = await createWorkerCandidate();

    try {
      const candidate = await store
        .reviewRepoBrainPromotionCandidate({
          candidateId,
          action: "accept",
          reviewerKind: "human",
          reason: "Promote for retrieval.",
        })
        .pipe(Effect.runPromise);

      const results = await store
        .retrieveRepoBrainMemories({
          repositoryId: candidate.repositoryId,
          query: "reviewed before briefing",
          sourceFile: "apps/server/src/presence/Layers/internal/PresenceStore.ts",
        })
        .pipe(Effect.runPromise);

      expect(results).toHaveLength(1);
      expect(results[0]?.promptEligible).toBe(true);
      expect(results[0]?.citations[0]).toMatchObject({
        role: "supports",
        source: {
          filePath: "apps/server/src/presence/Layers/internal/PresenceStore.ts",
        },
      });

      await system.sql`
        UPDATE presence_repo_brain_memories
        SET trust_mode = 'deny'
        WHERE repo_brain_memory_id = ${candidate.proposedMemoryId}
      `.pipe(Effect.runPromise);
      const denied = await store
        .retrieveRepoBrainMemories({
          repositoryId: candidate.repositoryId,
        })
        .pipe(Effect.runPromise);
      const explicitlyIncluded = await store
        .retrieveRepoBrainMemories({
          repositoryId: candidate.repositoryId,
          includePromptIneligible: true,
          trustModes: ["deny"],
        })
        .pipe(Effect.runPromise);

      expect(denied).toEqual([]);
      expect(explicitlyIncluded[0]?.promptEligible).toBe(false);
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });
});
