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


});
