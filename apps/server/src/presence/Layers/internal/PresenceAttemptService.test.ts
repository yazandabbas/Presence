import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

import {
  type OrchestrationCommand,
  ProjectId,
} from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  CLAUDE_PROVIDER,
  createGitRepository,
  createPresenceSystem,
  createUnbornGitRepository,
  DEFAULT_PROVIDER,
  removeTempRepo,
  runGit,
} from "../PresenceControlPlaneTestSupport.ts";

describe("PresenceAttemptService", () => {
  it("prepares a git worktree for an attempt", async () => {
    const repoRoot = await createGitRepository("presence-workspace-prepare-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Check workspace lifecycle",
        description: "Prepare a worktree for this attempt.",
        priority: "p2",
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      const workspace = await system.presence.prepareWorkspace({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      expect(workspace.status).toBe("ready");
      expect(workspace.branch).toMatch(/^feature\//);
      expect(workspace.worktreePath).not.toBeNull();
      expect(existsSync(workspace.worktreePath ?? "")).toBe(true);
      expect(existsSync(path.join(workspace.worktreePath ?? "", "README.md"))).toBe(true);

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(snapshot.workspaces[0]?.status).toBe("ready");
      expect(snapshot.workspaces[0]?.worktreePath).toBe(workspace.worktreePath);
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("starts one thread per attempt and reuses it on reopen", async () => {
    const repoRoot = await createGitRepository("presence-workspace-session-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Check session reuse",
        description: "Reopening should not create a second thread.",
        priority: "p2",
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      const firstSession = await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      const secondSession = await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      expect(secondSession.threadId).toBe(firstSession.threadId);
      const threadCreates = system.commands.filter((command) => command.type === "thread.create");
      const turnStarts = system.commands.filter((command) => command.type === "thread.turn.start");
      expect(threadCreates).toHaveLength(1);
      expect(turnStarts).toHaveLength(1);

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(snapshot.attempts[0]?.threadId).toBe(firstSession.threadId);
      expect(snapshot.workspaces[0]?.status).toBe("busy");
      expect(snapshot.workspaces[0]?.worktreePath).not.toBeNull();
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("claims one worker thread when two callers start the same attempt session concurrently", async () => {
    const repoRoot = await createGitRepository("presence-workspace-session-race-");
    const system = await createPresenceSystem({
      dispatchDelayMsByType: {
        "thread.create": 200,
      },
    });

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Check concurrent session reuse",
        description: "Concurrent reopeners should converge on one thread instead of bootstrapping twice.",
        priority: "p2",
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      const [firstSession, secondSession] = await Promise.all([
        system.presence.startAttemptSession({
          attemptId: attempt.id,
        }).pipe(Effect.runPromise),
        system.presence.startAttemptSession({
          attemptId: attempt.id,
        }).pipe(Effect.runPromise),
      ]);

      expect(firstSession.threadId).toBe(secondSession.threadId);
      const threadCreates = system.commands.filter((command) => command.type === "thread.create");
      const turnStarts = system.commands.filter((command) => command.type === "thread.turn.start");
      expect(threadCreates).toHaveLength(1);
      expect(turnStarts).toHaveLength(1);

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(snapshot.attempts[0]?.threadId).toBe(firstSession.threadId);
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("reuses the claimed worker thread after kickoff startup fails partway through", async () => {
    const repoRoot = await createGitRepository("presence-workspace-session-kickoff-retry-");
    const system = await createPresenceSystem({
      failDispatchByTypeOnce: {
        "thread.turn.start": "simulated kickoff failure",
      },
    });

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Recover partial worker startup",
        description: "Retrying after a kickoff failure should reuse the claimed thread instead of stalling.",
        priority: "p2",
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      await expect(
        system.presence.startAttemptSession({
          attemptId: attempt.id,
        }).pipe(Effect.runPromise),
      ).rejects.toThrow("simulated kickoff failure");

      const firstCreate = system.commands.find(
        (command): command is Extract<OrchestrationCommand, { type: "thread.create" }> =>
          command.type === "thread.create",
      );
      expect(firstCreate).toBeDefined();
      expect(system.commands.filter((command) => command.type === "thread.create")).toHaveLength(1);
      expect(system.commands.filter((command) => command.type === "thread.turn.start")).toHaveLength(0);

      const retriedSession = await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      expect(retriedSession.threadId).toBe(firstCreate!.threadId);
      expect(system.commands.filter((command) => command.type === "thread.create")).toHaveLength(1);
      expect(system.commands.filter((command) => command.type === "thread.turn.start")).toHaveLength(1);

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(snapshot.attempts[0]?.threadId).toBe(firstCreate!.threadId);
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("recovers a missing claimed worker thread when the attempt session starts again", async () => {
    const repoRoot = await createGitRepository("presence-worker-thread-recovery-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Recover missing worker thread",
        description: "Supervisor should restart a missing claimed worker thread instead of waiting forever.",
        priority: "p2",
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);
      const firstSession = await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      system.orchestration.removeThread(firstSession.threadId);

      const recoveredSession = await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      expect(recoveredSession.threadId).not.toBe(firstSession.threadId);

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(snapshot.attempts[0]?.threadId).toBe(recoveredSession.threadId);
      expect(system.commands.filter((command) => command.type === "thread.create")).toHaveLength(2);
      expect(system.commands.filter((command) => command.type === "thread.turn.start")).toHaveLength(2);
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("bootstraps a fresh attempt session with a worker kickoff packet", async () => {
    const repoRoot = await createGitRepository("presence-workspace-bootstrap-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Investigate renderer spacing",
        description: "Find the main layout issues and tighten the surface without broad redesign.",
        priority: "p1",
        acceptanceChecklist: [
          { id: "check-layout", label: "Layout issues identified", checked: false },
          { id: "check-validation", label: "Validation captured", checked: false },
        ],
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      await system.presence.saveSupervisorHandoff({
        boardId: repository.boardId,
        topPriorities: ["Investigate renderer spacing"],
        activeAttemptIds: [attempt.id],
        blockedTicketIds: [],
        recentDecisions: ["Keep the redesign narrow and preserve current runtime behavior."],
        nextBoardActions: ["Review the first proposed layout pass."],
      }).pipe(Effect.runPromise);

      await system.presence.saveWorkerHandoff({
        attemptId: attempt.id,
        completedWork: ["Reviewed the current board composition and identified oversized empty states."],
        currentHypothesis: "The center board region is too wide for the amount of content shown.",
        changedFiles: ["apps/web/src/components/presence/PresenceDashboard.tsx"],
        testsRun: ["apps/web typecheck"],
        blockers: [],
        nextStep: "Tighten the kanban lane widths and move noisy controls into the inspector.",
        confidence: 0.68,
        evidenceIds: [],
      }).pipe(Effect.runPromise);

      const session = await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      const turnStarts = system.commands.filter(
        (command): command is Extract<OrchestrationCommand, { type: "thread.turn.start" }> =>
          command.type === "thread.turn.start",
      );
      const threadCreates = system.commands.filter(
        (command): command is Extract<OrchestrationCommand, { type: "thread.create" }> =>
          command.type === "thread.create",
      );
      expect(turnStarts).toHaveLength(1);
      expect(threadCreates[0]?.systemPrompt).toContain("Presence worker role");
      expect(threadCreates[0]?.systemPrompt).toContain("Execution loop:");
      expect(threadCreates[0]?.systemPrompt).toContain("Handoff discipline:");
      expect(turnStarts[0]?.threadId).toBe(session.threadId);
      expect(turnStarts[0]?.titleSeed).toBe(ticket.title);
      expect(turnStarts[0]?.message.text).toContain("Investigate renderer spacing");
      expect(turnStarts[0]?.message.text).toContain(ticket.description);
      expect(turnStarts[0]?.message.text).toContain("Layout issues identified");
      expect(turnStarts[0]?.message.text).toContain("Find the main layout issues and tighten the surface");
      expect(turnStarts[0]?.message.text).toContain(
        "Reviewed the current board composition and identified oversized empty states.",
      );
      expect(turnStarts[0]?.message.text).toContain(
        "Keep the redesign narrow and preserve current runtime behavior.",
      );
      expect(turnStarts[0]?.message.text).not.toContain("Top priorities");
      expect(turnStarts[0]?.message.text).not.toContain("Presence worker role");
      expect(turnStarts[0]?.message.text).toContain("Worktree path:");
      expect(turnStarts[0]?.message.text).toContain("[PRESENCE_HANDOFF]");
      expect(turnStarts[0]?.message.text).toContain("Current hypothesis:");
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("reuses the repository default model selection for new attempts", async () => {
    const repoRoot = await createGitRepository("presence-provider-default-");
    const system = await createPresenceSystem({
      providers: [DEFAULT_PROVIDER, CLAUDE_PROVIDER],
      initialProjects: [
        {
          id: ProjectId.make("project-seeded-default"),
          title: "Seeded default",
          workspaceRoot: repoRoot,
          defaultModelSelection: {
            provider: "claudeAgent",
            model: "claude-sonnet-4",
          },
          scripts: [],
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
          deletedAt: null,
        },
      ],
    });

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Keep provider stable",
        description: "New attempts should keep the repository default selection.",
        priority: "p2",
      }).pipe(Effect.runPromise);

      const firstAttempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);
      const firstSession = await system.presence.startAttemptSession({
        attemptId: firstAttempt.id,
      }).pipe(Effect.runPromise);
      expect(firstSession.provider).toBe("claudeAgent");
      expect(firstSession.model).toBe("claude-sonnet-4");

      const secondTicket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Keep provider stable again",
        description: "A second ticket should still inherit the repository default selection.",
        priority: "p2",
      }).pipe(Effect.runPromise);
      const secondAttempt = await system.presence.createAttempt({
        ticketId: secondTicket.id,
      }).pipe(Effect.runPromise);
      const secondSession = await system.presence.startAttemptSession({
        attemptId: secondAttempt.id,
      }).pipe(Effect.runPromise);
      expect(secondSession.provider).toBe("claudeAgent");
      expect(secondSession.model).toBe("claude-sonnet-4");
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("starts an attempt session for repos that have not made their first commit yet", async () => {
    const repoRoot = await createUnbornGitRepository("presence-workspace-unborn-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Investigate setup issues",
        description: "Start work even if the repo has only been initialized and not committed yet.",
        priority: "p2",
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      const session = await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      const workspace = snapshot.workspaces[0];
      const turnStarts = system.commands.filter(
        (command): command is Extract<OrchestrationCommand, { type: "thread.turn.start" }> =>
          command.type === "thread.turn.start",
      );

      expect(session.threadId).toBeDefined();
      expect(workspace?.status).toBe("busy");
      expect(workspace?.branch).toMatch(/^feature\//);
      expect(workspace?.worktreePath).not.toBeNull();
      expect(existsSync(workspace?.worktreePath ?? "")).toBe(true);
      expect(turnStarts).toHaveLength(1);
      expect(turnStarts[0]?.threadId).toBe(session.threadId);
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("rejects approving an attempt that never actually started work", async () => {
    const repoRoot = await createGitRepository("presence-review-guard-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Guard empty attempt",
        description: "Do not approve an attempt before it starts.",
        priority: "p2",
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      await expect(
        system.presence.submitReviewDecision({
          ticketId: ticket.id,
          attemptId: attempt.id,
          decision: "accept",
          notes: "This should fail because the attempt never started.",
        }).pipe(Effect.runPromise),
      ).rejects.toThrow(/Failed to submit review decision\./);

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(snapshot.tickets[0]?.status).toBe("in_progress");
      expect(snapshot.attempts[0]?.status).toBe("planned");
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("runs validation in the attempt workspace and auto-completes evidence-related checklist items", async () => {
    const repoRoot = await createGitRepository("presence-validation-pass-");
    const system = await createPresenceSystem();

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify(
          {
            name: "presence-validation-pass",
            scripts: {
              lint: 'node -e "process.exit(0)"',
              test: 'node -e "process.exit(0)"',
            },
          },
          null,
          2,
        ),
        "utf8",
      );
      await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}", "utf8");
      await runGit(repoRoot, ["add", "package.json", "package-lock.json"]);
      await runGit(repoRoot, ["commit", "-m", "add validation scripts"]);

      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Validation Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Validate attempt output",
        description: "Run validation and capture the result as review evidence.",
        priority: "p2",
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      const validationRuns = await system.presence.runAttemptValidation({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      expect(validationRuns.length).toBeGreaterThanOrEqual(2);
      expect(validationRuns.every((run) => run.status === "passed")).toBe(true);

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      const snapshotTicket = snapshot.tickets.find((candidate) => candidate.id === ticket.id);
      expect(snapshot.validationRuns.length).toBe(validationRuns.length);
      expect(snapshot.evidence.length).toBeGreaterThanOrEqual(validationRuns.length);
      expect(
        snapshotTicket?.acceptanceChecklist.find((item) => /Mechanism understood/i.test(item.label))
          ?.checked,
      ).toBe(false);
      expect(
        snapshotTicket?.acceptanceChecklist.find((item) => /Evidence attached/i.test(item.label))
          ?.checked,
      ).toBe(true);
      expect(
        snapshotTicket?.acceptanceChecklist.find(
          (item) => /Validation recorded|Tests or validation captured/i.test(item.label),
        )?.checked,
      ).toBe(true);

      const blockedDecision = await system.presence.evaluateSupervisorAction({
        action: "approve_attempt",
        ticketId: ticket.id,
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      expect(blockedDecision.allowed).toBe(false);
      expect(blockedDecision.reasons.join(" ")).toMatch(/acceptance checklist items must be completed/i);

      await system.presence.updateTicket({
        ticketId: ticket.id,
        acceptanceChecklist:
          snapshotTicket?.acceptanceChecklist.map((item) =>
            /Mechanism understood/i.test(item.label) ? { ...item, checked: true } : item,
          ) ?? [],
      }).pipe(Effect.runPromise);

      const approvedDecision = await system.presence.evaluateSupervisorAction({
        action: "approve_attempt",
        ticketId: ticket.id,
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      expect(approvedDecision.allowed).toBe(true);
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("blocks approval when the latest validation batch fails", async () => {
    const repoRoot = await createGitRepository("presence-validation-fail-");
    const system = await createPresenceSystem();

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify(
          {
            name: "presence-validation-fail",
            scripts: {
              lint: 'node -e "process.exit(0)"',
              test: 'node -e "process.exit(1)"',
            },
          },
          null,
          2,
        ),
        "utf8",
      );
      await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}", "utf8");
      await runGit(repoRoot, ["add", "package.json", "package-lock.json"]);
      await runGit(repoRoot, ["commit", "-m", "add failing validation scripts"]);

      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Validation Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Reject failed validation",
        description: "Approval should stay blocked when the latest validation batch fails.",
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
      const validationRuns = await system.presence.runAttemptValidation({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      expect(validationRuns.some((run) => run.status === "failed")).toBe(true);

      const decision = await system.presence.evaluateSupervisorAction({
        action: "approve_attempt",
        ticketId: ticket.id,
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      expect(decision.allowed).toBe(false);
      expect(decision.reasons.join(" ")).toMatch(/latest validation run must pass/i);
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("reuses the latest running validation batch instead of starting an overlapping one", async () => {
    const repoRoot = await createGitRepository("presence-validation-running-");
    const system = await createPresenceSystem();

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify(
          {
            name: "presence-validation-running",
            scripts: {
              test: 'node -e "setTimeout(() => process.exit(0), 1200)"',
            },
          },
          null,
          2,
        ),
        "utf8",
      );
      await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}", "utf8");
      await runGit(repoRoot, ["add", "package.json", "package-lock.json"]);
      await runGit(repoRoot, ["commit", "-m", "add slow validation script"]);

      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Validation Running Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Reuse running validation",
        description: "A second validation request should observe the active batch instead of starting a duplicate one.",
        priority: "p2",
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      const firstValidationPromise = system.presence.runAttemptValidation({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const runningBatch = await system.presence.runAttemptValidation({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      const completedBatch = await firstValidationPromise;

      expect(runningBatch.length).toBeGreaterThan(0);
      expect(runningBatch.some((run) => run.status === "running")).toBe(true);
      expect(new Set(runningBatch.map((run) => run.batchId)).size).toBe(1);
      expect(new Set(completedBatch.map((run) => run.batchId)).size).toBe(1);
      expect(runningBatch[0]?.batchId).toBe(completedBatch[0]?.batchId);
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("resolves blocking validation findings when a waiver is recorded for the attempt", async () => {
    const repoRoot = await createGitRepository("presence-validation-waiver-");
    const system = await createPresenceSystem();

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify(
          {
            name: "presence-validation-waiver",
            scripts: {
              test: 'node -e "process.exit(1)"',
            },
          },
          null,
          2,
        ),
        "utf8",
      );
      await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}", "utf8");
      await runGit(repoRoot, ["add", "package.json", "package-lock.json"]);
      await runGit(repoRoot, ["commit", "-m", "add failing waiver scripts"]);

      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Validation Waiver Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Waive failed validation",
        description: "Recording a waiver should resolve the blocking validation findings for the scoped attempt.",
        priority: "p2",
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

      const failedSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(
        failedSnapshot.findings.some(
          (finding) =>
            finding.ticketId === ticket.id &&
            finding.attemptId === attempt.id &&
            finding.source === "validation" &&
            finding.status === "open",
        ),
      ).toBe(true);

      await system.presence.recordValidationWaiver({
        ticketId: ticket.id,
        attemptId: attempt.id,
        reason: "Human approved this validation gap for the scoped attempt.",
        grantedBy: "human",
      }).pipe(Effect.runPromise);

      const waivedSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(
        waivedSnapshot.findings.some(
          (finding) =>
            finding.ticketId === ticket.id &&
            finding.attemptId === attempt.id &&
            finding.source === "validation" &&
            finding.status === "open",
        ),
      ).toBe(false);
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });


  it("creates blocking findings for failed validation and lets humans resolve them explicitly", async () => {
    const repoRoot = await createGitRepository("presence-findings-");
    const system = await createPresenceSystem();

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify({ name: "presence-findings", scripts: { test: 'node -e "process.exit(1)"' } }, null, 2),
        "utf8",
      );
      await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}", "utf8");
      await runGit(repoRoot, ["add", "package.json", "package-lock.json"]);
      await runGit(repoRoot, ["commit", "-m", "add failing findings scripts"]);

      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Findings Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Validation findings",
        description: "Failed validation should become a blocking finding.",
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

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      const finding = snapshot.findings.find(
        (candidate) =>
          candidate.ticketId === ticket.id &&
          candidate.attemptId === attempt.id &&
          candidate.source === "validation" &&
          candidate.status === "open",
      );
      expect(finding?.severity).toBe("blocking");

      const blockedDecision = await system.presence.evaluateSupervisorAction({
        action: "approve_attempt",
        ticketId: ticket.id,
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      expect(blockedDecision.allowed).toBe(false);
      expect(blockedDecision.reasons.join(" ")).toMatch(/blocking findings/i);

      if (!finding) {
        throw new Error("Expected a validation finding to exist.");
      }
      await system.presence.resolveFinding({
        findingId: finding.id,
      }).pipe(Effect.runPromise);

      const resolvedSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(resolvedSnapshot.findings.find((candidate) => candidate.id === finding.id)?.status).toBe(
        "resolved",
      );
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("allows another retry after failed attempts once the earlier attempts are cleaned up", async () => {
    const repoRoot = await createGitRepository("presence-retry-spiral-");
    const system = await createPresenceSystem();

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify({ name: "presence-retry-spiral", scripts: { test: 'node -e "process.exit(1)"' } }, null, 2),
        "utf8",
      );
      await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}", "utf8");
      await runGit(repoRoot, ["add", "package.json", "package-lock.json"]);
      await runGit(repoRoot, ["commit", "-m", "add retry spiral scripts"]);

      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Retry Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Prevent retry spirals",
        description: "Repeated failed validation should escalate before a third retry.",
        priority: "p2",
        acceptanceChecklist: [
          { id: "check-1", label: "Mechanism understood", checked: true },
          { id: "check-2", label: "Evidence attached", checked: true },
          { id: "check-3", label: "Validation recorded", checked: true },
        ],
      }).pipe(Effect.runPromise);

      const attemptOne = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);
      await system.presence.startAttemptSession({
        attemptId: attemptOne.id,
      }).pipe(Effect.runPromise);
      await system.presence.runAttemptValidation({
        attemptId: attemptOne.id,
      }).pipe(Effect.runPromise);
      await system.presence.cleanupWorkspace({
        attemptId: attemptOne.id,
        force: true,
      }).pipe(Effect.runPromise);

      const attemptTwo = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);
      await system.presence.startAttemptSession({
        attemptId: attemptTwo.id,
      }).pipe(Effect.runPromise);
      await system.presence.runAttemptValidation({
        attemptId: attemptTwo.id,
      }).pipe(Effect.runPromise);
      await system.presence.cleanupWorkspace({
        attemptId: attemptTwo.id,
        force: true,
      }).pipe(Effect.runPromise);

      const attemptThree = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);
      await system.presence.startAttemptSession({
        attemptId: attemptThree.id,
      }).pipe(Effect.runPromise);
      await system.presence.runAttemptValidation({
        attemptId: attemptThree.id,
      }).pipe(Effect.runPromise);
      await system.presence.cleanupWorkspace({
        attemptId: attemptThree.id,
        force: true,
      }).pipe(Effect.runPromise);

      const attemptFour = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(snapshot.tickets.find((candidate) => candidate.id === ticket.id)?.status).toBe("in_progress");
      expect(
        snapshot.attempts.some(
          (attempt) => attempt.id === attemptFour.id && attempt.ticketId === ticket.id && attempt.status === "planned",
        ),
      ).toBe(true);
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("rejects creating a new attempt for tickets that are already blocked", async () => {
    const repoRoot = await createGitRepository("presence-blocked-attempt-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Blocked Attempt Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Do not reopen blocked work accidentally",
        description: "Blocked tickets should not move back to in progress through createAttempt.",
        priority: "p2",
      }).pipe(Effect.runPromise);

      await system.presence.updateTicket({
        ticketId: ticket.id,
        status: "blocked",
      }).pipe(Effect.runPromise);

      await expect(
        system.presence.createAttempt({
          ticketId: ticket.id,
        }).pipe(Effect.runPromise),
      ).rejects.toThrow(/cannot accept a new attempt/i);
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("rejects creating a second active attempt for the same ticket", async () => {
    const repoRoot = await createGitRepository("presence-active-attempt-guard-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Active Attempt Guard Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Keep one active attempt",
        description: "A ticket should not accumulate two active attempts at once.",
        priority: "p2",
      }).pipe(Effect.runPromise);

      const firstAttempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      await expect(
        system.presence.createAttempt({
          ticketId: ticket.id,
        }).pipe(Effect.runPromise),
      ).rejects.toThrow(/already has an active attempt/i);

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(snapshot.attempts.filter((attempt) => attempt.ticketId === ticket.id)).toHaveLength(1);
      expect(snapshot.attempts[0]?.id).toBe(firstAttempt.id);
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });
});
