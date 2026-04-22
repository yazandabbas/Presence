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
});
