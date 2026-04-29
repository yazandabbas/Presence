import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  createGitRepository,
  createPresenceSystem,
  removeTempRepo,
} from "../PresenceControlPlaneTestSupport.ts";
import { makePresenceStore } from "./PresenceStore.ts";

const TEST_NOW = "2026-04-29T00:00:00.000Z";

describe("Presence operation ledger", () => {
  it("upserts correlated operations with stable dedupe keys", async () => {
    const repoRoot = await createGitRepository("presence-operation-ledger-idempotent-");
    const system = await createPresenceSystem();
    const store = makePresenceStore({ sql: system.sql, nowIso: () => TEST_NOW });

    try {
      const repository = await system.presence
        .importRepository({
          workspaceRoot: repoRoot,
          title: "Presence Operation Ledger",
        })
        .pipe(Effect.runPromise);
      const ticket = await system.presence
        .createTicket({
          boardId: repository.boardId,
          title: "Trace operation ledger",
          description: "Presence should preserve operation correlation.",
          priority: "p2",
        })
        .pipe(Effect.runPromise);

      const parent = await store
        .upsertOperationLedger({
          boardId: repository.boardId,
          ticketId: ticket.id,
          kind: "controller_tick",
          phase: "start",
          status: "running",
          dedupeKey: "controller:tick:1",
          summary: "Controller tick started.",
          details: { mode: "active" },
          startedAt: TEST_NOW,
        })
        .pipe(Effect.runPromise);

      await store
        .upsertOperationLedger({
          parentOperationId: parent.id,
          boardId: repository.boardId,
          ticketId: ticket.id,
          kind: "goal_planning",
          phase: "finish",
          status: "completed",
          dedupeKey: "goal-planning:goal_1",
          summary: "Goal planned.",
          details: { goalIntakeId: "goal_1" },
          counters: [{ name: "ticketsCreated", value: 1 }],
          startedAt: TEST_NOW,
          completedAt: TEST_NOW,
        })
        .pipe(Effect.runPromise);

      await store
        .upsertOperationLedger({
          parentOperationId: parent.id,
          boardId: repository.boardId,
          ticketId: ticket.id,
          kind: "goal_planning",
          phase: "finish",
          status: "completed",
          dedupeKey: "goal-planning:goal_1",
          summary: "Goal planned after replay.",
          details: { goalIntakeId: "goal_1", replayed: true },
          counters: [{ name: "ticketsCreated", value: 1 }],
          startedAt: TEST_NOW,
          completedAt: TEST_NOW,
        })
        .pipe(Effect.runPromise);

      const rows = await store
        .readRecentOperationLedgerForBoard(repository.boardId)
        .pipe(Effect.runPromise);

      expect(rows).toHaveLength(2);
      const child = rows.find((row) => row.dedupeKey === "goal-planning:goal_1");
      expect(child).toMatchObject({
        parentOperationId: parent.id,
        kind: "goal_planning",
        status: "completed",
        summary: "Goal planned after replay.",
      });
      expect(child?.details).toMatchObject({ replayed: true });
      expect(child?.counters).toEqual([{ name: "ticketsCreated", value: 1 }]);
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("records mission, review, merge, and repo-brain operations", async () => {
    const repoRoot = await createGitRepository("presence-operation-ledger-flows-");
    const system = await createPresenceSystem();
    const store = makePresenceStore({ sql: system.sql, nowIso: () => TEST_NOW });

    try {
      const repository = await system.presence
        .importRepository({
          workspaceRoot: repoRoot,
          title: "Presence Operation Ledger Flows",
        })
        .pipe(Effect.runPromise);
      const ticket = await system.presence
        .createTicket({
          boardId: repository.boardId,
          title: "Trace flow operations",
          description: "Existing Presence events should write ledger rows.",
          priority: "p2",
        })
        .pipe(Effect.runPromise);
      const attempt = await system.presence
        .createAttempt({
          ticketId: ticket.id,
        })
        .pipe(Effect.runPromise);

      await store
        .writeMissionEvent({
          boardId: repository.boardId,
          ticketId: ticket.id,
          attemptId: attempt.id,
          kind: "worker_handoff",
          severity: "success",
          summary: "Worker reported completed work.",
          dedupeKey: "worker-handoff:test",
        })
        .pipe(Effect.runPromise);

      const review = await store
        .createReviewArtifact({
          ticketId: ticket.id,
          attemptId: attempt.id,
          reviewerKind: "review_agent",
          decision: "accept",
          summary: "Review accepted the attempt.",
          checklistJson: "[]",
          evidence: [],
          changedFiles: ["apps/server/src/presence/Layers/internal/PresenceStore.ts"],
          changedFilesReviewed: ["apps/server/src/presence/Layers/internal/PresenceStore.ts"],
          findingIds: [],
        })
        .pipe(Effect.runPromise);

      await store
        .persistMergeOperation({
          id: "merge_operation_ledger",
          ticketId: ticket.id,
          attemptId: attempt.id,
          status: "finalized",
          baseBranch: "main",
          sourceBranch: "presence/operation-ledger",
          sourceHeadSha: "source-sha",
          mergeCommitSha: "merge-sha",
          createdAt: TEST_NOW,
        })
        .pipe(Effect.runPromise);

      await store.refreshRepoBrainReadModelForBoard(repository.boardId).pipe(Effect.runPromise);

      const rows = await store
        .readRecentOperationLedgerForBoard(repository.boardId)
        .pipe(Effect.runPromise);
      const kinds = new Set(rows.map((row) => row.kind));

      expect(kinds.has("worker_attempt")).toBe(true);
      expect(kinds.has("review_run")).toBe(true);
      expect(kinds.has("merge_operation")).toBe(true);
      expect(kinds.has("repo_brain_projection")).toBe(true);
      expect(rows.find((row) => row.reviewArtifactId === review.id)?.summary).toBe(
        "Review accepted the attempt.",
      );
      expect(
        rows.find((row) => row.dedupeKey === "merge-operation:merge_operation_ledger"),
      ).toMatchObject({
        status: "completed",
        kind: "merge_operation",
      });

      const snapshot = await system.presence
        .getBoardSnapshot({ boardId: repository.boardId })
        .pipe(Effect.runPromise);
      expect(snapshot.operationLedger.some((operation) => operation.kind === "review_run")).toBe(
        true,
      );
      expect(
        snapshot.operationLedger.some(
          (operation) => operation.dedupeKey === "merge-operation:merge_operation_ledger",
        ),
      ).toBe(true);
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("keeps runtime failure and replay evidence deduped and actionable", async () => {
    const repoRoot = await createGitRepository("presence-operation-ledger-runtime-");
    const system = await createPresenceSystem();
    const store = makePresenceStore({ sql: system.sql, nowIso: () => TEST_NOW });

    try {
      const repository = await system.presence
        .importRepository({
          workspaceRoot: repoRoot,
          title: "Presence Operation Runtime",
        })
        .pipe(Effect.runPromise);
      const ticket = await system.presence
        .createTicket({
          boardId: repository.boardId,
          title: "Trace provider failure",
          description: "Provider failures should be visible without duplicate replay rows.",
          priority: "p1",
        })
        .pipe(Effect.runPromise);
      const attempt = await system.presence
        .createAttempt({
          ticketId: ticket.id,
        })
        .pipe(Effect.runPromise);

      const eventInput = {
        boardId: repository.boardId,
        ticketId: ticket.id,
        attemptId: attempt.id,
        threadId: "presence_thread_provider_unavailable",
        kind: "provider_unavailable" as const,
        severity: "error" as const,
        summary: "Codex is not authenticated.",
        detail: "Run codex login before retrying this ticket.",
        retryBehavior: "manual" as const,
        humanAction: "Authenticate Codex, then retry the worker.",
        dedupeKey: "provider-unavailable:codex:ticket_1",
        createdAt: TEST_NOW,
      };
      await store.writeMissionEvent(eventInput).pipe(Effect.runPromise);
      await store.writeMissionEvent(eventInput).pipe(Effect.runPromise);

      const rows = await store
        .readRecentOperationLedgerForBoard(repository.boardId)
        .pipe(Effect.runPromise);
      const runtimeRows = rows.filter(
        (row) => row.dedupeKey === "mission-event:provider-unavailable:codex:ticket_1",
      );

      expect(runtimeRows).toHaveLength(1);
      expect(runtimeRows[0]).toMatchObject({
        ticketId: ticket.id,
        attemptId: attempt.id,
        threadId: "presence_thread_provider_unavailable",
        kind: "provider_runtime_observation",
        status: "failed",
        summary: "Codex is not authenticated.",
        error: {
          code: "provider_unavailable",
          message: "Codex is not authenticated.",
          detail: "Run codex login before retrying this ticket.",
        },
      });
      expect(runtimeRows[0]?.details).toMatchObject({
        missionEventKind: "provider_unavailable",
        retryBehavior: "manual",
      });
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("records workspace cleanup as a terminal cancelled operation", async () => {
    const repoRoot = await createGitRepository("presence-operation-ledger-cleanup-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence
        .importRepository({
          workspaceRoot: repoRoot,
          title: "Presence Operation Cleanup",
        })
        .pipe(Effect.runPromise);
      const ticket = await system.presence
        .createTicket({
          boardId: repository.boardId,
          title: "Trace cleanup",
          description: "Cleanup should leave a terminal operation instead of a hanging action.",
          priority: "p2",
        })
        .pipe(Effect.runPromise);
      const attempt = await system.presence
        .createAttempt({
          ticketId: ticket.id,
        })
        .pipe(Effect.runPromise);
      await system.presence
        .startAttemptSession({
          attemptId: attempt.id,
        })
        .pipe(Effect.runPromise);

      await system.presence
        .cleanupWorkspace({
          attemptId: attempt.id,
          force: true,
        })
        .pipe(Effect.runPromise);

      const snapshot = await system.presence
        .getBoardSnapshot({ boardId: repository.boardId })
        .pipe(Effect.runPromise);
      const cleanup = snapshot.operationLedger.find(
        (operation) => operation.dedupeKey === `workspace-cleanup:${attempt.id}`,
      );

      expect(cleanup).toMatchObject({
        ticketId: ticket.id,
        attemptId: attempt.id,
        kind: "command_dispatch",
        status: "cancelled",
        summary: "Workspace cleanup interrupted the attempt.",
        completedAt: expect.any(String),
      });
      expect(cleanup?.durationMs).toBe(0);
      expect(cleanup?.details).toMatchObject({
        cleanupWorktreeDone: true,
        cleanupThreadDone: true,
      });
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });
});
