import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

import {
  AttemptId,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  createGitRepository,
  createPresenceSystem,
  normalizeProjectionPath,
  removeTempRepo,
  runGit,
  waitFor,
} from "../PresenceControlPlaneTestSupport.ts";

describe("PresenceProjectionRuntime", () => {
  it("records GLM-style supervisor and worker handoff details in repo projections", async () => {
    const repoRoot = await createGitRepository("presence-glm-handoff-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence GLM Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Capture GLM handoff protocol",
        description: "Project the stricter supervisor and worker handoff state into the repo.",
        priority: "p2",
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);
      await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      const run = await system.presence.startSupervisorRun({
        boardId: repository.boardId,
        ticketIds: [ticket.id],
      }).pipe(Effect.runPromise);

      await system.presence.saveSupervisorHandoff({
        boardId: repository.boardId,
        topPriorities: [ticket.title],
        activeAttemptIds: [attempt.id],
        blockedTicketIds: [],
        recentDecisions: ["Use work -> test -> log -> advance for this ticket."],
        nextBoardActions: ["Read the current summary, then continue orchestration."],
        currentRunId: run.id,
        stage: "waiting_on_worker",
      }).pipe(Effect.runPromise);
      await system.presence.saveWorkerHandoff({
        attemptId: attempt.id,
        completedWork: ["Captured the latest worker state for GLM projection coverage."],
        currentHypothesis: "The resume order should stay visible in the repo projection.",
        changedFiles: ["README.md"],
        testsRun: ["npm test"],
        blockers: ["Waiting for reviewer evidence."],
        nextStep: "Re-read progress, decisions, blockers, and findings before continuing.",
        openQuestions: ["Should the next worker change strategy after reviewer feedback?"],
        retryCount: 2,
        confidence: 0.71,
        evidenceIds: [],
      }).pipe(Effect.runPromise);

      const progressPath = path.join(
        repoRoot,
        ".presence",
        "tickets",
        ticket.id,
        "attempts",
        attempt.id,
        "progress.md",
      );
      await waitFor(async () =>
        existsSync(progressPath) &&
        (await fs.readFile(progressPath, "utf8")).includes("Retry count: 2"),
      );
      const progressMarkdown = await fs.readFile(progressPath, "utf8");
      const supervisorMarkdown = await fs.readFile(
        path.join(repoRoot, ".presence", "board", "supervisor_handoff.md"),
        "utf8",
      );
      const supervisorPromptMarkdown = await fs.readFile(
        path.join(repoRoot, ".presence", "board", "supervisor_prompt.md"),
        "utf8",
      );

      expect(progressMarkdown).toContain("Retry count: 2");
      expect(progressMarkdown).toContain("Open Questions");
      expect(supervisorMarkdown).toContain("Operating Contract");
      expect(supervisorMarkdown).toContain("### Memory model");
      expect(supervisorMarkdown).toContain("### Available executors");
      expect(supervisorMarkdown).toContain("Resume Protocol");
      expect(supervisorMarkdown).toContain(run.id);
      expect(supervisorPromptMarkdown).toContain("Presence supervisor role");
      expect(supervisorPromptMarkdown).toContain("Read order:");
      expect(supervisorPromptMarkdown).toContain("Ticket lifecycle:");
      expect(supervisorPromptMarkdown).toContain("Stop conditions:");
      await system.presence.cleanupWorkspace({
        attemptId: attempt.id,
        force: true,
      }).pipe(Effect.runPromise);
    } finally {
      await system.dispose();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await removeTempRepo(repoRoot);
    }
  }, 45_000);

  it("refreshes worker handoff and activity projections while a worker thread is still running", async () => {
    const repoRoot = await createGitRepository("presence-live-handoff-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Live Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Keep active handoff warm",
        description: "Update the handoff while the worker is still running.",
        priority: "p2",
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);
      const session = await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      system.orchestration.setCheckpoint({
        threadId: session.threadId,
        files: ["NOTES.md"],
        completedAt: "2026-04-21T00:00:01.000Z",
      });
      system.orchestration.appendActivity({
        threadId: session.threadId,
        kind: "tool.completed",
        summary: "command: npm test",
        createdAt: "2026-04-21T00:00:02.000Z",
      });
      system.orchestration.pushAssistantMessage({
        threadId: session.threadId,
        updatedAt: "2026-04-21T00:00:03.000Z",
        text: [
          "Progress update.",
          "",
          "[PRESENCE_HANDOFF]",
          "Completed work:",
          "- Inspected the repo and updated the live notes file.",
          "Current hypothesis:",
          "The worker can keep the active handoff current without waiting for the turn to settle.",
          "Next step:",
          "Collect reviewer evidence after one more code pass.",
          "Open questions:",
          "- Should the activity log keep the latest tool milestone?",
          "[/PRESENCE_HANDOFF]",
        ].join("\n"),
      });

      const refreshed = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      const liveHandoff = refreshed.attemptSummaries.find(
        (summaryItem) => summaryItem.attempt.id === attempt.id,
      )?.latestWorkerHandoff;
      expect(liveHandoff?.reasoningSource).toBe("assistant_block");
      expect(liveHandoff?.currentHypothesis).toContain("keep the active handoff current");
      expect(liveHandoff?.changedFiles).toContain("NOTES.md");
      const ticketSummary = refreshed.ticketSummaries.find(
        (summaryItem) => summaryItem.ticketId === ticket.id,
      );
      expect(ticketSummary?.nextStep).toContain("Collect reviewer evidence");
      expect(ticketSummary?.currentMechanism).toContain("keep the active handoff current");
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  }, 45_000);

  it("ignores malformed assistant handoff blocks and keeps newer manual reasoning", async () => {
    const repoRoot = await createGitRepository("presence-handoff-override-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Override Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Preserve manual reasoning",
        description: "Malformed assistant handoff blocks should not overwrite manual state.",
        priority: "p2",
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);
      const session = await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      await system.presence.saveWorkerHandoff({
        attemptId: attempt.id,
        completedWork: ["Recorded a manual override before the assistant resumed."],
        currentHypothesis: "The saved manual hypothesis should survive malformed assistant output.",
        changedFiles: [],
        testsRun: [],
        blockers: [],
        nextStep: "Wait for a valid structured assistant update.",
        openQuestions: [],
        retryCount: 0,
        evidenceIds: [],
      }).pipe(Effect.runPromise);

      system.orchestration.pushAssistantMessage({
        threadId: session.threadId,
        updatedAt: "2026-04-20T23:59:00.000Z",
        text: [
          "[PRESENCE_HANDOFF]",
          "Completed work:",
          "- This block is malformed because it skips the required next-step heading.",
          "Current hypothesis:",
          "This should be ignored.",
          "Open questions:",
          "- Missing a required section.",
          "[/PRESENCE_HANDOFF]",
        ].join("\n"),
      });

      const refreshed = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      const liveHandoff = refreshed.attemptSummaries.find(
        (summaryItem) => summaryItem.attempt.id === attempt.id,
      )?.latestWorkerHandoff;
      expect(liveHandoff?.reasoningSource).toBe("manual_override");
      expect(liveHandoff?.currentHypothesis).toContain("manual hypothesis should survive");
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  }, 45_000);

  it("classifies repeated environment blockers and keeps blocker projections concise", async () => {
    const repoRoot = await createGitRepository("presence-env-blocker-");
    const system = await createPresenceSystem();

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify(
          {
            name: "presence-env-blocker",
            version: "0.0.0",
            scripts: {
              test: "node -e \"console.error('database or disk is full'); process.exit(1)\"",
            },
          },
          null,
          2,
        ),
        "utf8",
      );
      await runGit(repoRoot, ["add", "package.json"]);
      await runGit(repoRoot, ["commit", "-m", "add failing env validation"]);

      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Env Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Classify environment blocker",
        description: "Summarize repeated environment failures without dumping raw stderr walls.",
        priority: "p2",
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);
      await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      await system.presence.saveWorkerHandoff({
        attemptId: attempt.id,
        completedWork: ["Discovered the current environment cannot complete the attempt."],
        currentHypothesis: "The failure is environmental rather than a code-path issue.",
        changedFiles: [],
        testsRun: [],
        blockers: ["database or disk is full"],
        nextStep: "Free disk space or move the repo to a healthy environment before retrying.",
        confidence: 0.62,
        evidenceIds: [],
      }).pipe(Effect.runPromise);

      const blockersPath = path.join(repoRoot, ".presence", "tickets", ticket.id, "attempts", attempt.id, "blockers.md");
      await waitFor(async () =>
        existsSync(blockersPath) &&
        (await fs.readFile(blockersPath, "utf8")).includes("disk_space"),
      );
      const blockersMarkdown = await fs.readFile(blockersPath, "utf8");
      const summaryMarkdown = await fs.readFile(
        path.join(repoRoot, ".presence", "tickets", ticket.id, "current_summary.md"),
        "utf8",
      );

      expect(blockersMarkdown).toContain("disk_space: Environment blocker: insufficient disk space is preventing progress.");
      expect(blockersMarkdown).not.toContain("database or disk is full database or disk is full");
      expect(blockersMarkdown).toContain("## Repeated Failure Patterns");
      expect(blockersMarkdown).toContain("None recorded.");
      expect(summaryMarkdown).toContain("## Current Blocker Classes");
      expect(summaryMarkdown).toContain("disk_space");
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  }, 35_000);

  it("cleans up the worktree and clears thread workspace metadata", async () => {
    const repoRoot = await createGitRepository("presence-workspace-cleanup-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Clean up workspace",
        description: "Remove the prepared worktree after the session exists.",
        priority: "p2",
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      const session = await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      const snapshotBeforeCleanup = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      const worktreePath = snapshotBeforeCleanup.workspaces[0]?.worktreePath;

      const workspace = await system.presence.cleanupWorkspace({
        attemptId: attempt.id,
        force: true,
      }).pipe(Effect.runPromise);

      expect(workspace.status).toBe("cleaned_up");
      expect(workspace.worktreePath).toBeNull();
      expect(existsSync(worktreePath ?? "")).toBe(false);

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(snapshot.workspaces[0]?.status).toBe("cleaned_up");
      expect(snapshot.attempts[0]?.status).toBe("interrupted");

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

  it("keeps ticket creation authoritative when ticket projection sync fails", async () => {
    const repoRoot = await createGitRepository("presence-projection-ticket-stale-");
    const system = await createPresenceSystem();
    const originalWriteFile = fs.writeFile.bind(fs);
    const writeSpy = vi.spyOn(fs, "writeFile").mockImplementation(async (file, data, options) => {
      const normalized = normalizeProjectionPath(file);
      if (normalized.includes("/.presence/tickets/")) {
        throw new Error("ticket projection unavailable");
      }
      return originalWriteFile(
        file as Parameters<typeof fs.writeFile>[0],
        data,
        options as Parameters<typeof fs.writeFile>[2],
      );
    });

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Projection Repo",
      }).pipe(Effect.runPromise);

      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Persist despite projection failure",
        description: "The ticket row should still commit when markdown projection writes fail.",
        priority: "p2",
      }).pipe(Effect.runPromise);

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);

      expect(snapshot.tickets.some((candidate) => candidate.id === ticket.id)).toBe(true);
      await waitFor(async () => {
        const current = await system.presence.getBoardSnapshot({
          boardId: repository.boardId,
        }).pipe(Effect.runPromise);
        const currentHealth = current.ticketProjectionHealth.find(
          (candidate) => candidate.scopeId === ticket.id,
        );
        return Boolean(currentHealth?.status === "stale" && currentHealth.lastErrorMessage);
      }, 8_000);

      const refreshedSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      const health = refreshedSnapshot.ticketProjectionHealth.find(
        (candidate) => candidate.scopeId === ticket.id,
      );
      expect(health?.status).toBe("stale");
      expect(health?.desiredVersion).toBeGreaterThanOrEqual(1);
      expect(health?.projectedVersion).toBe(0);
      expect(health?.lastErrorMessage).toContain("Failed to write Presence projection");
    } finally {
      writeSpy.mockRestore();
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("repairs stale board projections asynchronously after the filesystem recovers", async () => {
    const repoRoot = await createGitRepository("presence-projection-board-repair-");
    const system = await createPresenceSystem();
    const originalWriteFile = fs.writeFile.bind(fs);
    let failBoardProjection = true;
    const writeSpy = vi.spyOn(fs, "writeFile").mockImplementation(async (file, data, options) => {
      const normalized = normalizeProjectionPath(file);
      if (failBoardProjection && normalized.includes("/.presence/board/")) {
        throw new Error("board projection unavailable");
      }
      return originalWriteFile(
        file as Parameters<typeof fs.writeFile>[0],
        data,
        options as Parameters<typeof fs.writeFile>[2],
      );
    });

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Projection Repair Repo",
      }).pipe(Effect.runPromise);

      const staleSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(staleSnapshot.boardProjectionHealth?.status).toBe("stale");
      expect(staleSnapshot.boardProjectionHealth?.desiredVersion).toBeGreaterThanOrEqual(1);
      expect(staleSnapshot.boardProjectionHealth?.projectedVersion).toBe(0);

      failBoardProjection = false;
      await system.sql`
        UPDATE presence_projection_health
        SET retry_after = ${"1970-01-01T00:00:00.000Z"}
        WHERE scope_type = 'board' AND scope_id = ${repository.boardId}
      `.pipe(Effect.runPromise);

      await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);

      await waitFor(async () => {
        const snapshot = await system.presence.getBoardSnapshot({
          boardId: repository.boardId,
        }).pipe(Effect.runPromise);
        return snapshot.boardProjectionHealth?.status === "healthy";
      }, 8_000);

      const healthySnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(healthySnapshot.boardProjectionHealth?.status).toBe("healthy");
      expect(healthySnapshot.boardProjectionHealth?.projectedVersion).toBe(
        healthySnapshot.boardProjectionHealth?.desiredVersion,
      );
      expect(healthySnapshot.boardProjectionHealth?.lastErrorMessage).toBeNull();
    } finally {
      writeSpy.mockRestore();
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("coalesces repeated ticket dirtiness into the latest desired projection version", async () => {
    const repoRoot = await createGitRepository("presence-projection-ticket-versioned-");
    const system = await createPresenceSystem();
    const originalWriteFile = fs.writeFile.bind(fs);
    let failTicketProjection = true;
    const writeSpy = vi.spyOn(fs, "writeFile").mockImplementation(async (file, data, options) => {
      const normalized = normalizeProjectionPath(file);
      if (failTicketProjection && normalized.includes("/.presence/tickets/")) {
        throw new Error("ticket projection unavailable");
      }
      return originalWriteFile(
        file as Parameters<typeof fs.writeFile>[0],
        data,
        options as Parameters<typeof fs.writeFile>[2],
      );
    });

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Projection Version Repo",
      }).pipe(Effect.runPromise);

      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Versioned ticket mirror",
        description: "Repeated changes should collapse into the newest desired ticket projection.",
        priority: "p2",
      }).pipe(Effect.runPromise);

      await system.presence.updateTicket({
        ticketId: ticket.id,
        description: "Updated while the ticket projection is still failing.",
      }).pipe(Effect.runPromise);

      const staleHealthRow = await system.sql<{
        desiredVersion: number;
        projectedVersion: number;
        status: string;
      }>`
        SELECT
          desired_version as "desiredVersion",
          projected_version as "projectedVersion",
          status
        FROM presence_projection_health
        WHERE scope_type = 'ticket' AND scope_id = ${ticket.id}
      `.pipe(Effect.map((rows) => rows[0] ?? null), Effect.runPromise);

      expect(staleHealthRow?.status).toBe("stale");
      expect(staleHealthRow?.desiredVersion).toBeGreaterThanOrEqual(2);
      expect(staleHealthRow?.projectedVersion).toBe(0);

      failTicketProjection = false;
      await system.sql`
        UPDATE presence_projection_health
        SET retry_after = ${"1970-01-01T00:00:00.000Z"}
        WHERE scope_type = 'ticket' AND scope_id = ${ticket.id}
      `.pipe(Effect.runPromise);

      await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);

      await waitFor(async () => {
        const row = await system.sql<{
          desiredVersion: number;
          projectedVersion: number;
          status: string;
        }>`
          SELECT
            desired_version as "desiredVersion",
            projected_version as "projectedVersion",
            status
          FROM presence_projection_health
          WHERE scope_type = 'ticket' AND scope_id = ${ticket.id}
        `.pipe(Effect.map((rows) => rows[0] ?? null), Effect.runPromise);
        return Boolean(
          row &&
            row.status === "healthy" &&
            row.projectedVersion === row.desiredVersion &&
            row.projectedVersion >= 2,
        );
      }, 8_000);
    } finally {
      writeSpy.mockRestore();
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });
});
