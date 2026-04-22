import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

import {
  AttemptId,
  type OrchestrationCommand,
  SupervisorRunId,
} from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  buildReviewResultBlock,
  createGitRepository,
  createPresenceSystem,
  removeTempRepo,
  runGit,
  waitFor,
} from "../PresenceControlPlaneTestSupport.ts";

describe("PresenceSupervisorRuntime", () => {
  it("rejects supervisor runs that scope tickets outside the selected board", async () => {
    const firstRepo = await createGitRepository("presence-supervisor-scope-a-");
    const secondRepo = await createGitRepository("presence-supervisor-scope-b-");
    const system = await createPresenceSystem();

    try {
      const firstRepository = await system.presence.importRepository({
        workspaceRoot: firstRepo,
        title: "Presence Supervisor Scope A",
      }).pipe(Effect.runPromise);
      const secondRepository = await system.presence.importRepository({
        workspaceRoot: secondRepo,
        title: "Presence Supervisor Scope B",
      }).pipe(Effect.runPromise);
      const foreignTicket = await system.presence.createTicket({
        boardId: secondRepository.boardId,
        title: "Foreign ticket",
        description: "This ticket belongs to another board.",
        priority: "p2",
      }).pipe(Effect.runPromise);

      await expect(
        system.presence.startSupervisorRun({
          boardId: firstRepository.boardId,
          ticketIds: [foreignTicket.id],
        }).pipe(Effect.runPromise),
      ).rejects.toMatchObject({
        message: expect.stringContaining("Failed to start the supervisor runtime."),
        cause: expect.objectContaining({
          message: expect.stringMatching(/belong to the selected board/i),
        }),
      });
    } finally {
      await system.dispose();
      await removeTempRepo(firstRepo);
      await removeTempRepo(secondRepo);
    }
  });

  it("surfaces specific supervisor-start reasons in the top-level error message", async () => {
    const repoRoot = await createGitRepository("presence-supervisor-no-actionable-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence No Actionable Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Blocked ticket",
        description: "Nothing is actionable yet.",
        priority: "p2",
      }).pipe(Effect.runPromise);
      await system.presence.updateTicket({
        ticketId: ticket.id,
        status: "blocked",
      }).pipe(Effect.runPromise);

      await expect(
        system.presence.startSupervisorRun({
          boardId: repository.boardId,
        }).pipe(Effect.runPromise),
      ).rejects.toMatchObject({
        message: expect.stringContaining("Failed to start the supervisor runtime."),
        cause: expect.objectContaining({
          message: expect.stringMatching(/no actionable tickets were available/i),
        }),
      });

      await expect(
        system.presence.startSupervisorRun({
          boardId: repository.boardId,
        }).pipe(Effect.runPromise),
      ).rejects.toMatchObject({
        message: expect.stringMatching(
          /Failed to start the supervisor runtime\..*No actionable tickets were available for the supervisor run\./i,
        ),
      });
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("starts and cancels a supervisor run while exposing it in the board snapshot", async () => {
    const repoRoot = await createGitRepository("presence-supervisor-run-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Supervisor Repo",
      }).pipe(Effect.runPromise);
      const intake = await system.presence.submitGoalIntake({
        boardId: repository.boardId,
        rawGoal: "Add a repository AGENTS.md guide and tighten the validation path.",
        source: "human_goal",
        priorityHint: "p2",
      }).pipe(Effect.runPromise);

      const run = await system.presence.startSupervisorRun({
        boardId: repository.boardId,
        goalIntakeId: intake.intake.id,
      }).pipe(Effect.runPromise);
      expect(run.scopeTicketIds).toHaveLength(intake.createdTickets.length);
      expect(run.status).toBe("running");

      const runningSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(runningSnapshot.supervisorRuns[0]?.id).toBe(run.id);
      expect(runningSnapshot.supervisorHandoff?.currentRunId).toBe(run.id);

      let advancedSnapshot = runningSnapshot;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (
          advancedSnapshot.supervisorRuns[0]?.stage !== "plan" ||
          advancedSnapshot.attempts.some((item) =>
            run.scopeTicketIds.some((ticketId) => ticketId === item.ticketId),
          )
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
        advancedSnapshot = await system.presence.getBoardSnapshot({
          boardId: repository.boardId,
        }).pipe(Effect.runPromise);
      }
      expect(advancedSnapshot.supervisorRuns[0]?.stage).not.toBe("plan");

      const cancelled = await system.presence.cancelSupervisorRun({
        runId: run.id,
      }).pipe(Effect.runPromise);
      expect(cancelled.status).toBe("cancelled");

      const cancelledSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(cancelledSnapshot.supervisorRuns[0]?.status).toBe("cancelled");
      expect(cancelledSnapshot.supervisorHandoff?.currentRunId).toBeNull();
      expect(cancelledSnapshot.supervisorHandoff?.stage).toBeNull();
      expect(existsSync(path.join(repoRoot, ".presence", "board", "supervisor_run.md"))).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  }, 15_000);

  it("waits for a structured review-agent result before accepting a ticket", async () => {
    const repoRoot = await createGitRepository("presence-agentic-review-accept-");
    const system = await createPresenceSystem();
    let attemptId: string | null = null;
    let runId: string | null = null;

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify(
          { name: "presence-agentic-review", scripts: { test: 'node -e "process.exit(0)"' } },
          null,
          2,
        ),
        "utf8",
      );
      await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}", "utf8");
      await runGit(repoRoot, ["add", "package.json", "package-lock.json"]);
      await runGit(repoRoot, ["commit", "-m", "add agentic review validation scripts"]);

      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Agentic Review Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Review worker decides acceptance",
        description: "The supervisor should wait for a structured review result before accepting the ticket.",
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
      attemptId = attempt.id;
      const session = await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      const activeSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      const worktreePath = activeSnapshot.workspaces[0]?.worktreePath;
      if (!worktreePath) throw new Error("Expected a prepared worktree.");

      await fs.writeFile(path.join(worktreePath, "README.md"), "# Presence Test\nagentic review\n", "utf8");
      await system.presence.saveWorkerHandoff({
        attemptId: attempt.id,
        completedWork: ["Updated README.md so the review worker has a concrete diff to inspect."],
        currentHypothesis: "The supervisor should wait for the review worker's structured result before accepting.",
        changedFiles: ["README.md"],
        testsRun: ["npm test"],
        blockers: [],
        nextStep: "Run validation and wait for review.",
        openQuestions: [],
        retryCount: 0,
        evidenceIds: [],
      }).pipe(Effect.runPromise);
      system.orchestration.setCheckpoint({
        threadId: session.threadId,
        files: ["README.md"],
        completedAt: "2026-04-21T00:00:01.000Z",
      });
      system.orchestration.setLatestTurnState({
        threadId: session.threadId,
        state: "completed",
        completedAt: "2026-04-21T00:00:02.000Z",
      });
      await system.presence.runAttemptValidation({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      const run = await system.presence.startSupervisorRun({
        boardId: repository.boardId,
        ticketIds: [ticket.id],
      }).pipe(Effect.runPromise);
      runId = run.id;

      let reviewCreate: Extract<OrchestrationCommand, { type: "thread.create" }> | undefined;
      let reviewStart: Extract<OrchestrationCommand, { type: "thread.turn.start" }> | undefined;
      await waitFor(async () => {
        reviewCreate = system.commands.find(
          (command): command is Extract<OrchestrationCommand, { type: "thread.create" }> =>
            command.type === "thread.create" && command.title === `${ticket.title} - review`,
        );
        reviewStart = system.commands.find(
          (command): command is Extract<OrchestrationCommand, { type: "thread.turn.start" }> =>
            command.type === "thread.turn.start" &&
            reviewCreate !== undefined &&
            command.threadId === reviewCreate.threadId,
        );
        return Boolean(reviewCreate && reviewStart);
      }, 20_000);

      expect(reviewCreate?.systemPrompt).toContain("Presence review worker role");
      expect(reviewCreate?.systemPrompt).toContain("Inputs and evidence:");
      expect(reviewStart?.message.text).toContain(`Repository root: ${repoRoot}`);
      expect(reviewStart?.message.text).toContain("Current ticket summary:");
      expect(reviewStart?.message.text).toContain("[PRESENCE_REVIEW_RESULT]");
      expect(reviewStart?.message.text).not.toContain("Top priorities:");

      const waitingSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(waitingSnapshot.supervisorRuns.find((candidate) => candidate.id === run.id)?.stage).toBe(
        "waiting_on_review",
      );
      expect(
        waitingSnapshot.tickets.find((candidate) => candidate.id === ticket.id)?.status,
      ).not.toBe("ready_to_merge");

      if (!reviewCreate) throw new Error("Expected review thread to exist.");
      system.orchestration.pushAssistantMessage({
        threadId: reviewCreate.threadId,
        updatedAt: "2026-04-21T00:00:03.000Z",
        text: buildReviewResultBlock({
          decision: "accept",
          summary: "The README change matches the ticket intent and validation already passed.",
          checklistAssessment: [
            {
              label: "Mechanism understood",
              satisfied: true,
              notes: "The worker explained the mechanism clearly and the change is narrow and coherent.",
            },
            {
              label: "Evidence attached",
              satisfied: true,
              notes: "Validation evidence and reviewed files support the conclusion.",
            },
            {
              label: "Validation recorded",
              satisfied: true,
              notes: "The latest validation batch passed before review.",
            },
          ],
          findings: [],
          evidence: [
            { summary: "Reviewed README.md in the attempt worktree." },
            { summary: "Observed the passing npm test validation batch." },
          ],
          changedFilesReviewed: ["README.md"],
        }),
      });
      system.orchestration.setLatestTurnState({
        threadId: reviewCreate.threadId,
        state: "completed",
        completedAt: "2026-04-21T00:00:04.000Z",
      });

      await waitFor(async () => {
        const snapshot = await system.presence.getBoardSnapshot({
          boardId: repository.boardId,
        }).pipe(Effect.runPromise);
        return (
          snapshot.tickets.find((candidate) => candidate.id === ticket.id)?.status ===
            "ready_to_merge" &&
          snapshot.supervisorRuns.find((candidate) => candidate.id === run.id)?.status ===
            "completed"
        );
      }, 10_000);

      const acceptedSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(acceptedSnapshot.tickets.find((candidate) => candidate.id === ticket.id)?.status).toBe(
        "ready_to_merge",
      );
      expect(acceptedSnapshot.attempts.find((candidate) => candidate.id === attempt.id)?.status).toBe(
        "accepted",
      );
      expect(
        acceptedSnapshot.supervisorRuns.find((candidate) => candidate.id === run.id)?.status,
      ).toBe("completed");
      expect(acceptedSnapshot.supervisorHandoff?.currentRunId).toBeNull();
      expect(acceptedSnapshot.supervisorHandoff?.stage).toBeNull();
    } finally {
      if (runId) {
        await system.presence
          .cancelSupervisorRun({ runId: SupervisorRunId.make(runId) })
          .pipe(Effect.runPromise)
          .catch(() => undefined);
      }
      if (attemptId) {
        await system.presence
          .cleanupWorkspace({ attemptId: AttemptId.make(attemptId), force: true })
          .pipe(Effect.runPromise)
          .catch(() => undefined);
      }
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  }, 40_000);

  it("blocks the ticket when the review worker settles without a valid structured result", async () => {
    const repoRoot = await createGitRepository("presence-agentic-review-block-");
    const system = await createPresenceSystem();
    let attemptId: string | null = null;

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify(
          { name: "presence-agentic-review-block", scripts: { test: 'node -e "process.exit(0)"' } },
          null,
          2,
        ),
        "utf8",
      );
      await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}", "utf8");
      await runGit(repoRoot, ["add", "package.json", "package-lock.json"]);
      await runGit(repoRoot, ["commit", "-m", "add malformed review validation scripts"]);

      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Review Failure Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Block malformed review output",
        description: "Missing structured review output should block the ticket instead of silently falling back.",
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
      attemptId = attempt.id;
      const session = await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      await system.presence.saveWorkerHandoff({
        attemptId: attempt.id,
        completedWork: ["Prepared the attempt for review."],
        currentHypothesis: "A malformed review result should block the ticket because the supervisor cannot apply it honestly.",
        changedFiles: ["README.md"],
        testsRun: ["npm test"],
        blockers: [],
        nextStep: "Wait for review.",
        openQuestions: [],
        retryCount: 0,
        evidenceIds: [],
      }).pipe(Effect.runPromise);
      system.orchestration.setCheckpoint({
        threadId: session.threadId,
        files: ["README.md"],
        completedAt: "2026-04-21T00:10:01.000Z",
      });
      system.orchestration.setLatestTurnState({
        threadId: session.threadId,
        state: "completed",
        completedAt: "2026-04-21T00:10:02.000Z",
      });
      await system.presence.runAttemptValidation({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      const run = await system.presence.startSupervisorRun({
        boardId: repository.boardId,
        ticketIds: [ticket.id],
      }).pipe(Effect.runPromise);

      let reviewCreate: Extract<OrchestrationCommand, { type: "thread.create" }> | undefined;
      await waitFor(async () => {
        reviewCreate = system.commands.find(
          (command): command is Extract<OrchestrationCommand, { type: "thread.create" }> =>
            command.type === "thread.create" && command.title === `${ticket.title} - review`,
        );
        return Boolean(reviewCreate);
      }, 10_000);

      if (!reviewCreate) throw new Error("Expected review thread to exist.");
      system.orchestration.pushAssistantMessage({
        threadId: reviewCreate.threadId,
        updatedAt: "2026-04-21T00:10:03.000Z",
        text: "I inspected the attempt and it looks mostly fine, but this message intentionally omits the structured review result block.",
      });
      system.orchestration.setLatestTurnState({
        threadId: reviewCreate.threadId,
        state: "completed",
        completedAt: "2026-04-21T00:10:04.000Z",
      });

      await waitFor(async () => {
        const snapshot = await system.presence.getBoardSnapshot({
          boardId: repository.boardId,
        }).pipe(Effect.runPromise);
        return (
          snapshot.tickets.find((candidate) => candidate.id === ticket.id)?.status === "blocked" &&
          snapshot.supervisorRuns.find((candidate) => candidate.id === run.id)?.status ===
            "completed"
        );
      }, 20_000);

      const blockedSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(blockedSnapshot.tickets.find((candidate) => candidate.id === ticket.id)?.status).toBe("blocked");
      expect(
        blockedSnapshot.supervisorRuns.find((candidate) => candidate.id === run.id)?.status,
      ).toBe("completed");
      expect(
        blockedSnapshot.findings.some(
          (finding) =>
            finding.ticketId === ticket.id &&
            finding.attemptId === attempt.id &&
            finding.source === "supervisor" &&
            finding.status === "open" &&
            finding.summary.includes("valid structured review result"),
        ),
      ).toBe(true);
    } finally {
      if (attemptId) {
        await system.presence
          .cleanupWorkspace({ attemptId: AttemptId.make(attemptId), force: true })
          .pipe(Effect.runPromise)
          .catch(() => undefined);
      }
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  }, 40_000);

  it("restarts review when the first review thread never starts a turn", async () => {
    const repoRoot = await createGitRepository("presence-agentic-review-restart-");
    const system = await createPresenceSystem();
    let attemptId: string | null = null;
    let runId: string | null = null;

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify(
          { name: "presence-agentic-review-restart", scripts: { test: 'node -e "process.exit(0)"' } },
          null,
          2,
        ),
        "utf8",
      );
      await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}", "utf8");
      await runGit(repoRoot, ["add", "package.json", "package-lock.json"]);
      await runGit(repoRoot, ["commit", "-m", "add review restart validation scripts"]);

      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Review Restart Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Restart partial review startup",
        description: "A review thread that never starts should be restarted instead of leaving the supervisor stuck.",
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
      attemptId = attempt.id;
      const session = await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      await fs.writeFile(path.join(repoRoot, "README.md"), "# Presence Test\nreview restart\n", "utf8");
      await system.presence.saveWorkerHandoff({
        attemptId: attempt.id,
        completedWork: ["Prepared the attempt for an agentic review restart scenario."],
        currentHypothesis: "The supervisor should recover when review startup fails before the first review turn exists.",
        changedFiles: ["README.md"],
        testsRun: ["npm test"],
        blockers: [],
        nextStep: "Wait for review restart.",
        openQuestions: [],
        retryCount: 0,
        evidenceIds: [],
      }).pipe(Effect.runPromise);
      system.orchestration.setCheckpoint({
        threadId: session.threadId,
        files: ["README.md"],
        completedAt: "2026-04-21T00:20:01.000Z",
      });
      system.orchestration.setLatestTurnState({
        threadId: session.threadId,
        state: "completed",
        completedAt: "2026-04-21T00:20:02.000Z",
      });
      await system.presence.runAttemptValidation({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      system.orchestration.failNextDispatch("thread.turn.start", "simulated review kickoff failure");

      const run = await system.presence.startSupervisorRun({
        boardId: repository.boardId,
        ticketIds: [ticket.id],
      }).pipe(Effect.runPromise);
      runId = run.id;

      let reviewCreates: Array<Extract<OrchestrationCommand, { type: "thread.create" }>> = [];
      await waitFor(async () => {
        reviewCreates = system.commands.filter(
          (command): command is Extract<OrchestrationCommand, { type: "thread.create" }> =>
            command.type === "thread.create" && command.title === `${ticket.title} - review`,
        );
        return reviewCreates.length >= 2;
      }, 20_000);

      const restartedReviewThread = reviewCreates.at(-1);
      if (!restartedReviewThread) throw new Error("Expected restarted review thread.");
      system.orchestration.pushAssistantMessage({
        threadId: restartedReviewThread.threadId,
        updatedAt: "2026-04-21T00:20:05.000Z",
        text: buildReviewResultBlock({
          decision: "accept",
          summary: "The restarted review completed successfully after the first kickoff never started.",
          checklistAssessment: [
            {
              label: "Mechanism understood",
              satisfied: true,
              notes: "The restarted reviewer confirmed the intended mechanism.",
            },
            {
              label: "Evidence attached",
              satisfied: true,
              notes: "The restart still had access to the worker evidence and changed files.",
            },
            {
              label: "Validation recorded",
              satisfied: true,
              notes: "The passing validation batch was preserved across the restart.",
            },
          ],
          findings: [],
          evidence: [{ summary: "Reviewed README.md after restarting the review kickoff." }],
          changedFilesReviewed: ["README.md"],
        }),
      });
      system.orchestration.setLatestTurnState({
        threadId: restartedReviewThread.threadId,
        state: "completed",
        completedAt: "2026-04-21T00:20:06.000Z",
      });

      await waitFor(async () => {
        const snapshot = await system.presence.getBoardSnapshot({
          boardId: repository.boardId,
        }).pipe(Effect.runPromise);
        return snapshot.tickets.find((candidate) => candidate.id === ticket.id)?.status === "ready_to_merge";
      }, 20_000);

      const acceptedSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(
        acceptedSnapshot.tickets.find((candidate) => candidate.id === ticket.id)?.status,
      ).toBe("ready_to_merge");
      expect(reviewCreates).toHaveLength(2);
    } finally {
      if (runId) {
        await system.presence
          .cancelSupervisorRun({ runId: SupervisorRunId.make(runId) })
          .pipe(Effect.runPromise)
          .catch(() => undefined);
      }
      if (attemptId) {
        await system.presence
          .cleanupWorkspace({ attemptId: AttemptId.make(attemptId), force: true })
          .pipe(Effect.runPromise)
          .catch(() => undefined);
      }
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  }, 40_000);
});
