import { promises as fs } from "node:fs";
import path from "node:path";

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  createGitRepository,
  createPresenceSystem,
  createUnbornGitRepository,
  removeTempRepo,
  runGit,
} from "../PresenceControlPlaneTestSupport.ts";

describe("PresenceBoardService", () => {
  it("scans repository capabilities for JavaScript repos and discovers useful commands", async () => {
    const repoRoot = await createGitRepository("presence-capabilities-node-");
    const system = await createPresenceSystem();

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify(
          {
            name: "presence-node-test",
            scripts: {
              test: "vitest run",
              build: "tsc -b",
              lint: "eslint .",
              dev: "vite",
            },
          },
          null,
          2,
        ),
        "utf8",
      );
      await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}", "utf8");
      await runGit(repoRoot, ["add", "package.json", "package-lock.json"]);
      await runGit(repoRoot, ["commit", "-m", "add project scripts"]);

      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Node Repo",
      }).pipe(Effect.runPromise);

      const scan = await system.presence.getRepositoryCapabilities({
        repositoryId: repository.id,
      }).pipe(Effect.runPromise);

      expect(scan).not.toBeNull();
      expect(scan?.ecosystems).toContain("node");
      expect(scan?.discoveredCommands.map((command) => command.command)).toContain("npm run test");
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("scans repository capabilities for Rust and plain repos without requiring waivers", async () => {
    const rustRepo = await createGitRepository("presence-capabilities-rust-");
    const plainRepo = await createGitRepository("presence-capabilities-plain-");
    const system = await createPresenceSystem();

    try {
      await fs.writeFile(
        path.join(rustRepo, "Cargo.toml"),
        ['[package]', 'name = "presence-rust-test"', 'version = "0.1.0"', 'edition = "2021"'].join("\n"),
        "utf8",
      );

      const rustRepository = await system.presence.importRepository({
        workspaceRoot: rustRepo,
        title: "Presence Rust Repo",
      }).pipe(Effect.runPromise);
      const plainRepository = await system.presence.importRepository({
        workspaceRoot: plainRepo,
        title: "Presence Plain Repo",
      }).pipe(Effect.runPromise);

      const rustScan = await system.presence.getRepositoryCapabilities({
        repositoryId: rustRepository.id,
      }).pipe(Effect.runPromise);
      const plainScan = await system.presence.getRepositoryCapabilities({
        repositoryId: plainRepository.id,
      }).pipe(Effect.runPromise);

      expect(rustScan?.ecosystems).toContain("rust");
      expect(rustScan?.discoveredCommands.map((command) => command.command)).toContain("cargo test");

      expect(plainScan?.discoveredCommands).toEqual([]);
    } finally {
      await system.dispose();
      await fs.rm(rustRepo, { recursive: true, force: true });
      await fs.rm(plainRepo, { recursive: true, force: true });
    }
  });

  it("allows approval without automation command discovery", async () => {
    const repoRoot = await createGitRepository("presence-waiver-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Plain Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Investigate undocumented flow",
        description: "This repo intentionally has no automation scripts.",
        priority: "p2",
        acceptanceChecklist: [
          { id: "check-1", label: "Mechanism understood", checked: true },
          { id: "check-2", label: "Evidence attached", checked: true },
          { id: "check-3", label: "Reviewer validation captured", checked: true },
        ],
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      const decision = await system.presence.evaluateSupervisorAction({
        action: "approve_attempt",
        ticketId: ticket.id,
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      expect(decision.allowed).toBe(true);

      await system.presence.submitReviewDecision({
        ticketId: ticket.id,
        attemptId: attempt.id,
        decision: "accept",
        notes: "Reviewer validated this attempt agentically.",
      }).pipe(Effect.runPromise);

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);

      expect(snapshot.tickets[0]?.status).toBe("ready_to_merge");
      expect(snapshot.attempts[0]?.status).toBe("accepted");
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("scans dirty and unborn repositories without crashing", async () => {
    const dirtyRepo = await createGitRepository("presence-capabilities-dirty-");
    const unbornRepo = await createUnbornGitRepository("presence-capabilities-unborn-");
    const system = await createPresenceSystem();

    try {
      await fs.writeFile(path.join(dirtyRepo, "README.md"), "# Presence Test\ndirty\n", "utf8");

      const dirtyRepository = await system.presence.importRepository({
        workspaceRoot: dirtyRepo,
        title: "Dirty Repo",
      }).pipe(Effect.runPromise);
      const unbornRepository = await system.presence.importRepository({
        workspaceRoot: unbornRepo,
        title: "Unborn Repo",
      }).pipe(Effect.runPromise);

      const dirtyScan = await system.presence.getRepositoryCapabilities({
        repositoryId: dirtyRepository.id,
      }).pipe(Effect.runPromise);
      const unbornScan = await system.presence.getRepositoryCapabilities({
        repositoryId: unbornRepository.id,
      }).pipe(Effect.runPromise);

      expect(dirtyScan?.isClean).toBe(false);
      expect(unbornScan).not.toBeNull();
      expect(unbornScan?.baseBranch).toBe("main");
    } finally {
      await system.dispose();
      await fs.rm(dirtyRepo, { recursive: true, force: true });
      await fs.rm(unbornRepo, { recursive: true, force: true });
    }
  });

  it("queues repo-level goal intake for supervisor planning instead of creating literal tickets immediately", async () => {
    const repoRoot = await createGitRepository("presence-goal-simple-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Goal Repo",
      }).pipe(Effect.runPromise);

      const simple = await system.presence.submitGoalIntake({
        boardId: repository.boardId,
        rawGoal: "Audit the onboarding flow and capture the biggest reliability risk.",
        source: "human_goal",
        priorityHint: "p2",
      }).pipe(Effect.runPromise);

      expect(simple.decomposed).toBe(false);
      expect(simple.createdTickets).toHaveLength(0);
      expect(simple.intake.createdTicketIds).toHaveLength(0);
      expect(simple.intake.summary).toMatch(/review the repo before creating tickets/i);

      const decomposed = await system.presence.submitGoalIntake({
        boardId: repository.boardId,
        rawGoal: [
          "- Add a repository AGENTS.md guide",
          "- Tighten the auth validation path",
          "- Capture the new runbook in memory",
        ].join("\n"),
        source: "human_goal",
        priorityHint: "p2",
      }).pipe(Effect.runPromise);

      expect(decomposed.decomposed).toBe(false);
      expect(decomposed.createdTickets).toHaveLength(0);
      expect(decomposed.intake.createdTicketIds).toHaveLength(0);

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(snapshot.goalIntakes).toHaveLength(2);
      expect(snapshot.tickets).toHaveLength(0);
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

});
