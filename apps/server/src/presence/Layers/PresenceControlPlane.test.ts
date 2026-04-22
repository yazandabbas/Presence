import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

import { AttemptId } from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  createGitRepository,
  createPresenceSystem,
  createUnbornGitRepository,
  removeTempRepo,
  runGit,
  waitFor,
} from "./PresenceControlPlaneTestSupport.ts";

describe("PresenceControlPlaneLive workspace lifecycle", () => {
  it("scans repository capabilities for JavaScript repos and discovers validation commands", async () => {
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
      await runGit(repoRoot, ["commit", "-m", "add validation scripts"]);

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
      expect(scan?.hasValidationCapability).toBe(true);
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("scans repository capabilities for Rust repos and marks repos without automation as needing a waiver", async () => {
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
      expect(rustScan?.hasValidationCapability).toBe(true);

      expect(plainScan?.hasValidationCapability).toBe(false);
      expect(plainScan?.riskSignals).toContain("No obvious validation command was discovered.");
    } finally {
      await system.dispose();
      await fs.rm(rustRepo, { recursive: true, force: true });
      await fs.rm(plainRepo, { recursive: true, force: true });
    }
  });

  it("blocks approval without validation capability and allows it after a human waiver", async () => {
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
        description: "This repo intentionally has no validation scripts.",
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

      const decision = await system.presence.evaluateSupervisorAction({
        action: "approve_attempt",
        ticketId: ticket.id,
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      expect(decision.allowed).toBe(false);
      expect(decision.requiresHumanValidationWaiver).toBe(true);
      expect(decision.reasons.join(" ")).toMatch(/human validation waiver is required/i);

      await expect(
        system.presence.submitReviewDecision({
          ticketId: ticket.id,
          attemptId: attempt.id,
          decision: "accept",
          notes: "This should require a waiver first.",
        }).pipe(Effect.runPromise),
      ).rejects.toThrow(/Failed to submit review decision\./);

      const waiver = await system.presence.recordValidationWaiver({
        ticketId: ticket.id,
        attemptId: attempt.id,
        reason: "Validated manually against the repo's current behavior.",
        grantedBy: "human",
      }).pipe(Effect.runPromise);

      expect(waiver.reason).toContain("Validated manually");

      await system.presence.submitReviewDecision({
        ticketId: ticket.id,
        attemptId: attempt.id,
        decision: "accept",
        notes: "Human waiver recorded.",
      }).pipe(Effect.runPromise);

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);

      expect(snapshot.tickets[0]?.status).toBe("ready_to_merge");
      expect(snapshot.attempts[0]?.status).toBe("accepted");
      expect(snapshot.validationWaivers).toHaveLength(1);
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

  it("creates tickets from repo-level goal intake without over-decomposing a simple request", async () => {
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
      expect(simple.createdTickets).toHaveLength(1);

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

      expect(decomposed.decomposed).toBe(true);
      expect(decomposed.createdTickets).toHaveLength(3);

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(snapshot.goalIntakes).toHaveLength(2);
      expect(snapshot.tickets).toHaveLength(4);
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("creates findings, follow-up proposals, and repo projections for Presence memory", async () => {
    const repoRoot = await createGitRepository("presence-projections-");
    const system = await createPresenceSystem();

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify({ name: "presence-projections", scripts: { test: 'node -e "process.exit(0)"' } }, null, 2),
        "utf8",
      );
      await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}", "utf8");
      await runGit(repoRoot, ["add", "package.json", "package-lock.json"]);
      await runGit(repoRoot, ["commit", "-m", "add projection validation scripts"]);

      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Projection Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Projection coverage",
        description: "Write the visible Presence memory files into the repository.",
        priority: "p2",
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      await system.presence.saveSupervisorHandoff({
        boardId: repository.boardId,
        topPriorities: ["Projection coverage"],
        activeAttemptIds: [attempt.id],
        blockedTicketIds: [],
        recentDecisions: ["Keep attempt-local memory separate from board memory."],
        nextBoardActions: ["Validate the attempt and inspect follow-up state."],
      }).pipe(Effect.runPromise);
      await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      await system.presence.saveWorkerHandoff({
        attemptId: attempt.id,
        completedWork: ["Captured the current execution state for projection coverage."],
        currentHypothesis: "The .presence folder should mirror ticket and attempt state.",
        changedFiles: ["README.md"],
        testsRun: ["npm test"],
        blockers: [],
        nextStep: "Run validation and create a follow-up proposal.",
        confidence: 0.74,
        evidenceIds: [],
      }).pipe(Effect.runPromise);
      await system.presence.runAttemptValidation({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      const proposal = await system.presence.createFollowUpProposal({
        parentTicketId: ticket.id,
        originatingAttemptId: attempt.id,
        kind: "child_ticket",
        title: "Follow up projection note",
        description: "Materialize a child ticket from the proposal.",
        priority: "p2",
        findingIds: [],
      }).pipe(Effect.runPromise);
      const childTicket = await system.presence.materializeFollowUp({
        proposalId: proposal.id,
      }).pipe(Effect.runPromise);
      await system.presence.upsertKnowledgePage({
        boardId: repository.boardId,
        family: "runbooks",
        slug: "projection-coverage",
        title: "Projection coverage",
        compiledTruth: "Presence should sync ticket and brain projections into the repo.",
        timeline: "2026-04-21 - Projection test updated the runbook.",
        linkedTicketIds: [ticket.id],
      }).pipe(Effect.runPromise);

      const projectionRoot = path.join(repoRoot, ".presence");
      await waitFor(async () =>
        existsSync(path.join(projectionRoot, "tickets", ticket.id, "attempts", attempt.id, "progress.md")) &&
        existsSync(path.join(projectionRoot, "brain", "runbooks", "projection-coverage.md")),
      );
      expect(existsSync(path.join(projectionRoot, "board", "supervisor_handoff.md"))).toBe(true);
      expect(existsSync(path.join(projectionRoot, "tickets", ticket.id, "ticket.md"))).toBe(true);
      expect(existsSync(path.join(projectionRoot, "tickets", ticket.id, "current_summary.md"))).toBe(true);
      expect(
        existsSync(path.join(projectionRoot, "tickets", ticket.id, "attempts", attempt.id, "progress.md")),
      ).toBe(true);
      expect(existsSync(path.join(projectionRoot, "brain", "runbooks", "projection-coverage.md"))).toBe(true);
      expect(await fs.readFile(path.join(projectionRoot, "tickets", ticket.id, "ticket.md"), "utf8")).toContain(
        ticket.title,
      );
      expect(
        await fs.readFile(
          path.join(projectionRoot, "tickets", ticket.id, "attempts", attempt.id, "progress.md"),
          "utf8",
        ),
      ).toContain("Captured the current execution state");
      expect(
        await fs.readFile(path.join(projectionRoot, "brain", "runbooks", "projection-coverage.md"), "utf8"),
      ).toContain("Compiled Truth");

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(snapshot.ticketSummaries.find((summary) => summary.ticketId === ticket.id)).toBeTruthy();
      expect(snapshot.proposedFollowUps.find((candidate) => candidate.id === proposal.id)?.createdTicketId).toBe(
        childTicket.id,
      );
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
