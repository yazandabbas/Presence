import { spawnSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

import { type OrchestrationCommand } from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  createGitRepository,
  createPresenceSystem,
  createUnbornGitRepository,
  removeTempRepo,
  runGit,
} from "../PresenceControlPlaneTestSupport.ts";

describe("PresenceReviewMergeService", () => {
  it("accepts an attempt for merge and only marks the ticket done after merge approval", async () => {
    const repoRoot = await createGitRepository("presence-workspace-merge-normal-");
    const system = await createPresenceSystem();

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify({ name: "presence-merge", scripts: { test: 'node -e "process.exit(0)"' } }, null, 2),
        "utf8",
      );
      await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}", "utf8");
      await runGit(repoRoot, ["add", "package.json", "package-lock.json"]);
      await runGit(repoRoot, ["commit", "-m", "add merge validation scripts"]);

      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Merge normal attempt",
        description: "Promote an approved attempt back into the main branch.",
        priority: "p2",
        acceptanceChecklist: [
          { id: "check-1", label: "Mechanism understood", checked: true },
          { id: "check-2", label: "Evidence attached", checked: true },
          { id: "check-3", label: "Validation recorded", checked: true },
        ],
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      await system.presence.runAttemptValidation({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      const activeSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      const worktreePath = activeSnapshot.workspaces[0]?.worktreePath;
      if (!worktreePath) throw new Error("Expected a prepared worktree.");

      await fs.writeFile(
        path.join(worktreePath, "README.md"),
        "# Presence Test\nmerged from normal attempt\n",
        "utf8",
      );

      await system.presence.submitReviewDecision({
        ticketId: ticket.id,
        attemptId: attempt.id,
        decision: "accept",
        notes: "Approved and ready for merge.",
      }).pipe(Effect.runPromise);

      const acceptedSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(acceptedSnapshot.tickets[0]?.status).toBe("ready_to_merge");
      expect(acceptedSnapshot.attempts[0]?.status).toBe("accepted");

      await system.presence.submitReviewDecision({
        ticketId: ticket.id,
        attemptId: attempt.id,
        decision: "merge_approved",
        notes: "Merge the approved attempt into the base branch.",
      }).pipe(Effect.runPromise);

      const mergedSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(mergedSnapshot.tickets[0]?.status).toBe("done");
      expect(mergedSnapshot.attempts[0]?.status).toBe("merged");
      expect(mergedSnapshot.workspaces[0]?.status).toBe("cleaned_up");
      expect(mergedSnapshot.workspaces[0]?.worktreePath).toBeNull();
      expect(existsSync(worktreePath)).toBe(false);
      expect(await fs.readFile(path.join(repoRoot, "README.md"), "utf8")).toContain(
        "merged from normal attempt",
      );
    } finally {
      await system.dispose();
    }
  }, 60_000);

  it("reconciles a git-applied merge on the next merge approval after DB finalization fails", async () => {
    const repoRoot = await createGitRepository("presence-merge-reconcile-");
    const system = await createPresenceSystem();

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify({ name: "presence-merge-reconcile", scripts: { test: 'node -e "process.exit(0)"' } }, null, 2),
        "utf8",
      );
      await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}", "utf8");
      await runGit(repoRoot, ["add", "package.json", "package-lock.json"]);
      await runGit(repoRoot, ["commit", "-m", "add merge reconcile validation scripts"]);

      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Merge Reconcile Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Recover merge finalization",
        description: "If git merged successfully but DB finalization failed, the next merge action should reconcile.",
        priority: "p2",
        acceptanceChecklist: [
          { id: "check-1", label: "Mechanism understood", checked: true },
          { id: "check-2", label: "Evidence attached", checked: true },
          { id: "check-3", label: "Validation recorded", checked: true },
        ],
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      await system.presence.runAttemptValidation({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      const activeSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      const worktreePath = activeSnapshot.workspaces[0]?.worktreePath;
      if (!worktreePath) throw new Error("Expected a prepared worktree.");

      await fs.writeFile(
        path.join(worktreePath, "README.md"),
        "# Presence Test\nmerged after finalization retry\n",
        "utf8",
      );

      await system.presence.submitReviewDecision({
        ticketId: ticket.id,
        attemptId: attempt.id,
        decision: "accept",
        notes: "Approved and ready for merge.",
      }).pipe(Effect.runPromise);

      await system.sql`
        CREATE TRIGGER presence_block_merge_review_decision
        BEFORE INSERT ON presence_review_decisions
        WHEN NEW.decision = 'merge_approved'
        BEGIN
          SELECT RAISE(ABORT, 'merge finalization blocked');
        END;
      `.pipe(Effect.runPromise);

      await expect(
        system.presence.submitReviewDecision({
          ticketId: ticket.id,
          attemptId: attempt.id,
          decision: "merge_approved",
          notes: "Merge the approved attempt even if DB finalization fails once.",
        }).pipe(Effect.runPromise),
      ).rejects.toMatchObject({
        message: expect.stringContaining("Failed to submit review decision."),
      });

      expect(await fs.readFile(path.join(repoRoot, "README.md"), "utf8")).toContain(
        "merged after finalization retry",
      );
      const headAfterGitApply = await runGit(repoRoot, ["rev-parse", "--verify", "HEAD"]);

      const staleSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      const pendingMergeOperation = staleSnapshot.mergeOperations.find(
        (operation) => operation.attemptId === attempt.id,
      );
      expect(pendingMergeOperation?.status).toBe("git_applied");
      expect(staleSnapshot.tickets[0]?.status).toBe("ready_to_merge");
      expect(staleSnapshot.attempts[0]?.status).toBe("accepted");

      await system.sql`DROP TRIGGER presence_block_merge_review_decision`.pipe(Effect.runPromise);

      await system.presence.submitReviewDecision({
        ticketId: ticket.id,
        attemptId: attempt.id,
        decision: "merge_approved",
        notes: "Retry merge finalization without rerunning git.",
      }).pipe(Effect.runPromise);

      const reconciledSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      const finalMergeOperation = reconciledSnapshot.mergeOperations.find(
        (operation) => operation.attemptId === attempt.id,
      );
      expect(finalMergeOperation?.status).toBe("finalized");
      expect(reconciledSnapshot.tickets[0]?.status).toBe("done");
      expect(reconciledSnapshot.attempts[0]?.status).toBe("merged");
      expect(
        reconciledSnapshot.mergeOperations.filter((operation) => operation.attemptId === attempt.id),
      ).toHaveLength(1);
      expect(await runGit(repoRoot, ["rev-parse", "--verify", "HEAD"])).toBe(headAfterGitApply);
    } finally {
      await system.sql`DROP TRIGGER IF EXISTS presence_block_merge_review_decision`.pipe(Effect.runPromise);
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("marks merged attempts as cleanup pending and retries cleanup without rerunning git", async () => {
    const repoRoot = await createGitRepository("presence-merge-cleanup-pending-");
    const system = await createPresenceSystem({
      failDispatchByTypeOnce: {
        "thread.meta.update": "detach thread metadata failed",
      },
    });

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify({ name: "presence-merge-cleanup", scripts: { test: 'node -e "process.exit(0)"' } }, null, 2),
        "utf8",
      );
      await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}", "utf8");
      await runGit(repoRoot, ["add", "package.json", "package-lock.json"]);
      await runGit(repoRoot, ["commit", "-m", "add merge cleanup validation scripts"]);

      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Cleanup Pending Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Retry merge cleanup",
        description: "A merge should stay durable even if cleanup needs another pass.",
        priority: "p2",
        acceptanceChecklist: [
          { id: "check-1", label: "Mechanism understood", checked: true },
          { id: "check-2", label: "Evidence attached", checked: true },
          { id: "check-3", label: "Validation recorded", checked: true },
        ],
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      const session = await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      await system.presence.runAttemptValidation({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      const activeSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      const worktreePath = activeSnapshot.workspaces[0]?.worktreePath;
      if (!worktreePath) throw new Error("Expected a prepared worktree.");

      await fs.writeFile(path.join(worktreePath, "README.md"), "# Presence Test\ncleanup pending merge\n", "utf8");

      await system.presence.submitReviewDecision({
        ticketId: ticket.id,
        attemptId: attempt.id,
        decision: "accept",
        notes: "Approved and ready for merge.",
      }).pipe(Effect.runPromise);
      await system.presence.submitReviewDecision({
        ticketId: ticket.id,
        attemptId: attempt.id,
        decision: "merge_approved",
        notes: "Merge even if cleanup needs another pass.",
      }).pipe(Effect.runPromise);

      const cleanupPendingSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      const cleanupPendingOperation = cleanupPendingSnapshot.mergeOperations.find(
        (operation) => operation.attemptId === attempt.id,
      );
      expect(cleanupPendingOperation?.status).toBe("cleanup_pending");
      expect(cleanupPendingSnapshot.ticketSummaries[0]?.hasCleanupPending).toBe(true);
      expect(cleanupPendingSnapshot.tickets[0]?.status).toBe("done");
      expect(cleanupPendingSnapshot.attempts[0]?.status).toBe("merged");
      expect(existsSync(worktreePath)).toBe(false);

      await system.presence.submitReviewDecision({
        ticketId: ticket.id,
        attemptId: attempt.id,
        decision: "merge_approved",
        notes: "Retry only the cleanup tail.",
      }).pipe(Effect.runPromise);

      const recoveredSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      const finalizedOperation = recoveredSnapshot.mergeOperations.find(
        (operation) => operation.attemptId === attempt.id,
      );
      expect(finalizedOperation?.status).toBe("finalized");
      expect(recoveredSnapshot.ticketSummaries[0]?.hasCleanupPending).toBe(false);
      expect(
        recoveredSnapshot.mergeOperations.filter((operation) => operation.attemptId === attempt.id),
      ).toHaveLength(1);

      const threadMetaUpdates = system.commands.filter(
        (command): command is Extract<OrchestrationCommand, { type: "thread.meta.update" }> =>
          command.type === "thread.meta.update" && command.threadId === session.threadId,
      );
      expect(threadMetaUpdates.at(-1)?.branch).toBeNull();
      expect(threadMetaUpdates.at(-1)?.worktreePath).toBeNull();
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("records a failed merge operation and auto-aborts conflicts when merge approval hits a content clash", async () => {
    const repoRoot = await createGitRepository("presence-merge-conflict-");
    const system = await createPresenceSystem();

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify({ name: "presence-merge-conflict", scripts: { test: 'node -e "process.exit(0)"' } }, null, 2),
        "utf8",
      );
      await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}", "utf8");
      await runGit(repoRoot, ["add", "package.json", "package-lock.json"]);
      await runGit(repoRoot, ["commit", "-m", "add merge conflict validation scripts"]);

      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Conflict Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Handle merge conflicts",
        description: "Merge approval should record a failed merge and keep the repo recoverable when a conflict happens.",
        priority: "p2",
        acceptanceChecklist: [
          { id: "check-1", label: "Mechanism understood", checked: true },
          { id: "check-2", label: "Evidence attached", checked: true },
          { id: "check-3", label: "Validation recorded", checked: true },
        ],
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      await system.presence.runAttemptValidation({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      const activeSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      const worktreePath = activeSnapshot.workspaces[0]?.worktreePath;
      if (!worktreePath) throw new Error("Expected a prepared worktree.");

      await fs.writeFile(path.join(worktreePath, "README.md"), "# Attempt Side\n", "utf8");
      await fs.writeFile(path.join(repoRoot, "README.md"), "# Base Side\n", "utf8");
      await runGit(repoRoot, ["add", "README.md"]);
      await runGit(repoRoot, ["commit", "-m", "base side conflicting change"]);

      await system.presence.submitReviewDecision({
        ticketId: ticket.id,
        attemptId: attempt.id,
        decision: "accept",
        notes: "Approved and ready for merge.",
      }).pipe(Effect.runPromise);

      await expect(
        system.presence.submitReviewDecision({
          ticketId: ticket.id,
          attemptId: attempt.id,
          decision: "merge_approved",
          notes: "Attempt the merge and surface conflict recovery.",
        }).pipe(Effect.runPromise),
      ).rejects.toMatchObject({
        message: expect.stringContaining("Failed to submit review decision."),
      });

      const mergeHead = spawnSync("git", ["-C", repoRoot, "rev-parse", "-q", "--verify", "MERGE_HEAD"], {
        encoding: "utf8",
      });
      expect(mergeHead.status).not.toBe(0);

      const failureSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      const failedOperation = failureSnapshot.mergeOperations.find(
        (operation) => operation.attemptId === attempt.id,
      );
      expect(failedOperation?.status).toBe("failed");
      expect(failureSnapshot.ticketSummaries[0]?.hasMergeFailure).toBe(true);
      expect(failureSnapshot.tickets[0]?.status).toBe("ready_to_merge");
      expect(failureSnapshot.attempts[0]?.status).toBe("accepted");
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("blocks merge approval when the base workspace branch drifted or has non-Presence dirtiness", async () => {
    const repoRoot = await createGitRepository("presence-merge-safety-");
    const system = await createPresenceSystem();

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify({ name: "presence-merge-safety", scripts: { test: 'node -e "process.exit(0)"' } }, null, 2),
        "utf8",
      );
      await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}", "utf8");
      await runGit(repoRoot, ["add", "package.json", "package-lock.json"]);
      await runGit(repoRoot, ["commit", "-m", "add merge safety validation scripts"]);

      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Merge Safety Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Protect merge approval",
        description: "Merge approval should fail if the base branch drifted or the base workspace is dirty.",
        priority: "p2",
        acceptanceChecklist: [
          { id: "check-1", label: "Mechanism understood", checked: true },
          { id: "check-2", label: "Evidence attached", checked: true },
          { id: "check-3", label: "Validation recorded", checked: true },
        ],
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      await system.presence.runAttemptValidation({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      const activeSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      const worktreePath = activeSnapshot.workspaces[0]?.worktreePath;
      if (!worktreePath) throw new Error("Expected a prepared worktree.");

      await fs.writeFile(path.join(worktreePath, "README.md"), "# Presence Test\nmerge safety\n", "utf8");
      await system.presence.submitReviewDecision({
        ticketId: ticket.id,
        attemptId: attempt.id,
        decision: "accept",
        notes: "Approved and ready for merge.",
      }).pipe(Effect.runPromise);

      await runGit(repoRoot, ["checkout", "-b", "side"]);
      await expect(
        system.presence.submitReviewDecision({
          ticketId: ticket.id,
          attemptId: attempt.id,
          decision: "merge_approved",
          notes: "Try to merge while the base branch is wrong.",
        }).pipe(Effect.runPromise),
      ).rejects.toMatchObject({
        message: expect.stringContaining("Failed to submit review decision."),
        cause: expect.objectContaining({
          message: expect.stringMatching(/expected to merge into 'main'/i),
        }),
      });

      await runGit(repoRoot, ["checkout", "main"]);
      await fs.writeFile(path.join(repoRoot, "LOCAL_NOTES.md"), "dirty base\n", "utf8");
      await expect(
        system.presence.submitReviewDecision({
          ticketId: ticket.id,
          attemptId: attempt.id,
          decision: "merge_approved",
          notes: "Try to merge while the base workspace is dirty.",
        }).pipe(Effect.runPromise),
      ).rejects.toMatchObject({
        message: expect.stringContaining("Failed to submit review decision."),
        cause: expect.objectContaining({
          message: expect.stringMatching(/base workspace must be clean/i),
        }),
      });
    } finally {
      await system.dispose();
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("moves accepted attempts back to in progress when changes are requested", async () => {
    const repoRoot = await createGitRepository("presence-request-changes-");
    const system = await createPresenceSystem();

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify({ name: "presence-node", scripts: { test: 'node -e "process.exit(0)"' } }, null, 2),
        "utf8",
      );
      await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}", "utf8");
      await runGit(repoRoot, ["add", "package.json", "package-lock.json"]);
      await runGit(repoRoot, ["commit", "-m", "add request-change validation scripts"]);

      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Review gating",
        description: "Allow review to send an accepted attempt back for more work.",
        priority: "p2",
        acceptanceChecklist: [
          { id: "check-1", label: "Mechanism understood", checked: true },
          { id: "check-2", label: "Evidence attached", checked: true },
          { id: "check-3", label: "Validation recorded", checked: true },
        ],
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      await system.presence.runAttemptValidation({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      await system.presence.submitReviewDecision({
        ticketId: ticket.id,
        attemptId: attempt.id,
        decision: "accept",
        notes: "Approved first pass.",
      }).pipe(Effect.runPromise);
      await system.presence.submitReviewDecision({
        ticketId: ticket.id,
        attemptId: attempt.id,
        decision: "request_changes",
        notes: "One more iteration needed.",
      }).pipe(Effect.runPromise);

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(snapshot.tickets[0]?.status).toBe("in_progress");
      expect(snapshot.attempts[0]?.status).toBe("in_progress");
    } finally {
      await system.dispose();
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("resolves open review findings after a later accept decision succeeds", async () => {
    const repoRoot = await createGitRepository("presence-review-resolve-");
    const system = await createPresenceSystem();

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify({ name: "presence-review-resolve", scripts: { test: 'node -e "process.exit(0)"' } }, null, 2),
        "utf8",
      );
      await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}", "utf8");
      await runGit(repoRoot, ["add", "package.json", "package-lock.json"]);
      await runGit(repoRoot, ["commit", "-m", "add review resolve validation scripts"]);

      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Review Resolve Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Resolve prior review findings",
        description: "Accepting a later revision should resolve the old open review findings for that attempt.",
        priority: "p2",
        acceptanceChecklist: [
          { id: "check-1", label: "Mechanism understood", checked: true },
          { id: "check-2", label: "Evidence attached", checked: true },
          { id: "check-3", label: "Validation recorded", checked: true },
        ],
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      await system.presence.runAttemptValidation({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      await system.presence.submitReviewDecision({
        ticketId: ticket.id,
        attemptId: attempt.id,
        decision: "request_changes",
        notes: "One more revision is needed before approval.",
      }).pipe(Effect.runPromise);

      const requestChangesSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(
        requestChangesSnapshot.findings.some(
          (finding) =>
            finding.ticketId === ticket.id &&
            finding.attemptId === attempt.id &&
            finding.source === "review" &&
            finding.status === "open",
        ),
      ).toBe(true);

      await system.presence.saveWorkerHandoff({
        attemptId: attempt.id,
        completedWork: ["Updated the implementation after review feedback."],
        currentHypothesis: "The revised behavior now aligns with the intended mechanism.",
        changedFiles: ["README.md"],
        testsRun: ["npm run test"],
        blockers: [],
        nextStep: "Request approval again.",
        openQuestions: [],
        retryCount: 1,
        evidenceIds: [],
      }).pipe(Effect.runPromise);
      await system.presence.submitReviewDecision({
        ticketId: ticket.id,
        attemptId: attempt.id,
        decision: "accept",
        notes: "The follow-up revision addresses the review feedback.",
      }).pipe(Effect.runPromise);

      const acceptedSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(
        acceptedSnapshot.findings.some(
          (finding) =>
            finding.ticketId === ticket.id &&
            finding.attemptId === attempt.id &&
            finding.source === "review" &&
            finding.status === "open",
        ),
      ).toBe(false);
    } finally {
      await system.dispose();
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });


  it("merges an approved attempt back into an unborn base branch", async () => {
    const repoRoot = await createUnbornGitRepository("presence-workspace-merge-unborn-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Merge first attempt",
        description: "Let the first approved attempt become the repository history.",
        priority: "p2",
        acceptanceChecklist: [
          { id: "check-1", label: "Mechanism understood", checked: true },
          { id: "check-2", label: "Evidence attached", checked: true },
          { id: "check-3", label: "Validation recorded", checked: true },
        ],
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      await system.presence.recordValidationWaiver({
        ticketId: ticket.id,
        attemptId: attempt.id,
        reason: "Unborn repository was validated manually before the first commit.",
        grantedBy: "human",
      }).pipe(Effect.runPromise);

      const activeSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      const worktreePath = activeSnapshot.workspaces[0]?.worktreePath;
      if (!worktreePath) throw new Error("Expected a prepared worktree.");

      await fs.writeFile(
        path.join(worktreePath, "README.md"),
        "# Presence Test\nmerged from unborn attempt\n",
        "utf8",
      );

      await system.presence.submitReviewDecision({
        ticketId: ticket.id,
        attemptId: attempt.id,
        decision: "accept",
        notes: "Approved and ready for merge.",
      }).pipe(Effect.runPromise);
      await system.presence.submitReviewDecision({
        ticketId: ticket.id,
        attemptId: attempt.id,
        decision: "merge_approved",
        notes: "Merge the approved attempt into the empty base branch.",
      }).pipe(Effect.runPromise);

      const mergedSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(mergedSnapshot.tickets[0]?.status).toBe("done");
      expect(mergedSnapshot.attempts[0]?.status).toBe("merged");
      expect(mergedSnapshot.workspaces[0]?.status).toBe("cleaned_up");
      expect(await fs.readFile(path.join(repoRoot, "README.md"), "utf8")).toContain(
        "merged from unborn attempt",
      );
      expect((await runGit(repoRoot, ["branch", "--show-current"])).trim()).toBe("main");
      expect((await runGit(repoRoot, ["rev-parse", "--verify", "HEAD"])).trim().length).toBeGreaterThan(0);
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  }, 30_000);

});
