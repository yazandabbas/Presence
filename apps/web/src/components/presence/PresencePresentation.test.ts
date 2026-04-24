import {
  AttemptId,
  BoardId,
  CapabilityScanId,
  FindingId,
  HandoffId,
  MergeOperationId,
  MissionEventId,
  RepositoryId,
  ReviewArtifactId,
  ReviewDecisionId,
  SupervisorRunId,
  ThreadId,
  TicketId,
  WorkspaceId,
  type BoardSnapshot,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildTicketTimeline,
  deriveLatestMeaningfulEvent,
  deriveTicketCallout,
  deriveTicketPrimaryAction,
  deriveTicketStage,
} from "./PresencePresentation";

function makeBoard(overrides: Partial<BoardSnapshot> = {}): BoardSnapshot {
  const repositoryId = RepositoryId.make("repo-1");
  const boardId = BoardId.make("board-1");
  const ticketId = TicketId.make("ticket-1");
  const attemptId = AttemptId.make("attempt-1");
  const workspaceId = WorkspaceId.make("workspace-1");
  const handoffId = HandoffId.make("handoff-1");
  const reviewArtifactId = ReviewArtifactId.make("review-1");
  const mergeOperationId = MergeOperationId.make("merge-1");
  const findingId = FindingId.make("finding-1");
  const reviewDecisionId = ReviewDecisionId.make("review-decision-1");
  const supervisorRunId = SupervisorRunId.make("supervisor-run-1");
  const threadId = ThreadId.make("thread-1");

  const snapshot: BoardSnapshot = {
    repository: {
      id: repositoryId,
      boardId,
      projectId: null,
      title: "Presence repo",
      workspaceRoot: "C:/repo",
      defaultModelSelection: null,
      createdAt: "2026-04-22T09:00:00.000Z",
      updatedAt: "2026-04-22T09:00:00.000Z",
    },
    board: {
      id: boardId,
      repositoryId,
      title: "Presence board",
      sprintFocus: "Keep work moving",
      topPrioritySummary: null,
      createdAt: "2026-04-22T09:00:00.000Z",
      updatedAt: "2026-04-22T09:00:00.000Z",
    },
    tickets: [
      {
        id: ticketId,
        boardId,
        parentTicketId: null,
        title: "Ship guided cockpit",
        description: "Rework Presence UX around next action and state clarity.",
        status: "in_progress",
        priority: "p1",
        acceptanceChecklist: [
          { id: "check-1", label: "Board states are legible", checked: true },
          { id: "check-2", label: "Failures are actionable", checked: false },
        ],
        assignedAttemptId: attemptId,
        createdAt: "2026-04-22T09:00:00.000Z",
        updatedAt: "2026-04-22T10:00:00.000Z",
      },
    ],
    dependencies: [],
    attempts: [
      {
        id: attemptId,
        ticketId,
        workspaceId,
        title: "Guided cockpit attempt",
        status: "in_progress",
        provider: "codex",
        model: "gpt-5.4",
        threadId,
        summary: "Working through the guided cockpit redesign.",
        confidence: 0.8,
        lastWorkerHandoffId: handoffId,
        createdAt: "2026-04-22T09:15:00.000Z",
        updatedAt: "2026-04-22T10:45:00.000Z",
      },
    ],
    workspaces: [
      {
        id: workspaceId,
        attemptId,
        status: "ready",
        branch: "presence-guided-cockpit",
        worktreePath: "C:/repo/.presence/attempt",
        createdAt: "2026-04-22T09:15:00.000Z",
        updatedAt: "2026-04-22T09:15:00.000Z",
      },
    ],
    attemptSummaries: [
      {
        attempt: {
          id: attemptId,
          ticketId,
          workspaceId,
          title: "Guided cockpit attempt",
          status: "in_progress",
          provider: "codex",
          model: "gpt-5.4",
          threadId,
          summary: "Working through the guided cockpit redesign.",
          confidence: 0.8,
          lastWorkerHandoffId: handoffId,
          createdAt: "2026-04-22T09:15:00.000Z",
          updatedAt: "2026-04-22T10:45:00.000Z",
        },
        workspace: {
          id: workspaceId,
          attemptId,
          status: "ready",
          branch: "presence-guided-cockpit",
          worktreePath: "C:/repo/.presence/attempt",
          createdAt: "2026-04-22T09:15:00.000Z",
          updatedAt: "2026-04-22T09:15:00.000Z",
        },
        latestWorkerHandoff: {
          id: handoffId,
          attemptId,
          completedWork: ["Board cards now show stage and next move."],
          currentHypothesis: "A guided ticket workspace will cut cognitive load.",
          changedFiles: ["apps/web/src/components/presence/PresenceDashboard.tsx"],
          testsRun: [],
          blockers: [],
          nextStep: "Wire the ticket workspace sections and collapse advanced actions.",
          openQuestions: [],
          retryCount: 0,
          reasoningSource: "assistant_block",
          reasoningUpdatedAt: "2026-04-22T10:45:00.000Z",
          confidence: 0.82,
          evidenceIds: [],
          createdAt: "2026-04-22T10:45:00.000Z",
        },
      },
    ],
    supervisorHandoff: null,
    evidence: [],
    promotionCandidates: [],
    knowledgePages: [],
    jobs: [],
    findings: [
      {
        id: findingId,
        ticketId,
        attemptId,
        source: "review",
        severity: "warning",
        disposition: "same_ticket",
        status: "open",
        summary: "Board cards still hide the next human decision.",
        rationale: "The board needs to surface the recommended action directly on each ticket.",
        evidenceIds: [],
        createdAt: "2026-04-22T10:20:00.000Z",
        updatedAt: "2026-04-22T10:20:00.000Z",
      },
    ],
    reviewArtifacts: [
      {
        id: reviewArtifactId,
        ticketId,
        attemptId,
        reviewerKind: "review_agent",
        decision: "request_changes",
        summary: "The board still needs a stronger recommended-action treatment.",
        checklistJson: "[]",
        checklistAssessment: [],
        evidence: [
          {
            kind: "file_inspection",
            target: "apps/web/src/components/presence/PresenceDashboard.tsx",
            outcome: "failed",
            relevant: true,
            summary: "Ticket cards do not surface the next action.",
            details: "The reviewer inspected the dashboard component and found the action hierarchy missing.",
          },
        ],
        changedFiles: ["apps/web/src/components/presence/PresenceDashboard.tsx"],
        changedFilesReviewed: ["apps/web/src/components/presence/PresenceDashboard.tsx"],
        findingIds: [findingId],
        threadId,
        createdAt: "2026-04-22T10:30:00.000Z",
      },
    ],
    mergeOperations: [
      {
        id: mergeOperationId,
        ticketId,
        attemptId,
        status: "failed",
        baseBranch: "main",
        sourceBranch: "presence-guided-cockpit",
        sourceHeadSha: "abc123",
        baseHeadBefore: "def456",
        baseHeadAfter: null,
        mergeCommitSha: null,
        errorSummary: "Merge stopped on a conflicting dashboard snapshot.",
        gitAbortAttempted: true,
        cleanupWorktreeDone: false,
        cleanupThreadDone: false,
        createdAt: "2026-04-22T10:40:00.000Z",
        updatedAt: "2026-04-22T10:41:00.000Z",
      },
    ],
    proposedFollowUps: [],
    ticketSummaries: [
      {
        ticketId,
        currentMechanism: "Board cards summarize state while the workspace shows evidence.",
        triedAcrossAttempts: ["Flat board cards", "Dense inspector"],
        failedWhy: ["The previous UI buried the next human action."],
        openFindings: ["Board cards still hide the next human decision."],
        nextStep: "Finish the guided workspace and demote admin tools.",
        activeAttemptId: attemptId,
        blocked: true,
        escalated: false,
        hasFollowUpProposal: false,
        hasMergeFailure: true,
        hasCleanupPending: false,
      },
    ],
    attemptOutcomes: [],
    reviewDecisions: [
      {
        id: reviewDecisionId,
        ticketId,
        attemptId,
        decision: "request_changes",
        notes: "The board still needs clearer action emphasis.",
        createdAt: "2026-04-22T10:31:00.000Z",
      },
    ],
    supervisorRuns: [
      {
        id: supervisorRunId,
        boardId,
        sourceGoalIntakeId: null,
        scopeTicketIds: [ticketId],
        status: "running",
        stage: "waiting_on_review",
        currentTicketId: ticketId,
        activeThreadIds: [threadId],
        summary: "Presence is waiting on the current review loop.",
        createdAt: "2026-04-22T10:00:00.000Z",
        updatedAt: "2026-04-22T10:35:00.000Z",
      },
    ],
    boardProjectionHealth: null,
    ticketProjectionHealth: [],
    hasStaleProjections: false,
    capabilityScan: {
      id: CapabilityScanId.make("capability-scan-1"),
      repositoryId,
      boardId,
      baseBranch: "main",
      upstreamRef: "origin/main",
      hasRemote: true,
      isClean: true,
      ecosystems: ["node"],
      markers: ["package.json"],
      discoveredCommands: [{ kind: "test", command: "npm run test:web", source: "package.json" }],
      riskSignals: [],
      scannedAt: "2026-04-22T09:30:00.000Z",
    },
    goalIntakes: [],
    missionBriefing: null,
    ticketBriefings: [],
    missionEvents: [],
    ...overrides,
  };

  return snapshot;
}

describe("PresencePresentation", () => {
  it("maps blocked merge failures to a blocked stage and merge callout", () => {
    const board = makeBoard();
    const ticket = board.tickets[0]!;

    const stage = deriveTicketStage(board, ticket);
    const callout = deriveTicketCallout(board, ticket);

    expect(stage.bucket).toBe("Blocked");
    expect(stage.label).toBe("Merge failed");
    expect(callout?.title).toBe("Merge failed");
    expect(callout?.recommendedAction).toContain("merge again");
  });

  it("maps merge-ready tickets to a merge primary action", () => {
    const board = makeBoard({
      tickets: [{ ...makeBoard().tickets[0]!, status: "ready_to_merge" }],
      attempts: [{ ...makeBoard().attempts[0]!, status: "accepted" }],
      attemptSummaries: [
        {
          ...makeBoard().attemptSummaries[0]!,
          attempt: { ...makeBoard().attemptSummaries[0]!.attempt, status: "accepted" },
        },
      ],
      mergeOperations: [],
      reviewArtifacts: [],
      reviewDecisions: [],
      ticketSummaries: [{ ...makeBoard().ticketSummaries[0]!, blocked: false, hasMergeFailure: false }],
    });
    const ticket = board.tickets[0]!;
    const attempt = board.attemptSummaries[0]!;

    const action = deriveTicketPrimaryAction(board, ticket, attempt, board.capabilityScan);

    expect(action.kind).toBe("merge");
    expect(action.label).toBe("Merge");
  });

  it("maps review tickets to the review-result action", () => {
    const board = makeBoard({
      tickets: [{ ...makeBoard().tickets[0]!, status: "in_review" }],
      attempts: [{ ...makeBoard().attempts[0]!, status: "in_review" }],
      attemptSummaries: [
        {
          ...makeBoard().attemptSummaries[0]!,
          attempt: { ...makeBoard().attemptSummaries[0]!.attempt, status: "in_review" },
          latestWorkerHandoff: null,
        },
      ],
      reviewArtifacts: [],
      reviewDecisions: [],
      mergeOperations: [],
      ticketSummaries: [{ ...makeBoard().ticketSummaries[0]!, blocked: false, hasMergeFailure: false }],
    });
    const ticket = board.tickets[0]!;
    const attempt = board.attemptSummaries[0]!;

    const stage = deriveTicketStage(board, ticket);
    const action = deriveTicketPrimaryAction(board, ticket, attempt, board.capabilityScan);
    const callout = deriveTicketCallout(board, ticket);

    expect(stage.bucket).toBe("Needs review");
    expect(action.kind).toBe("review_result");
    expect(callout?.title).toBe("Review is waiting on evidence");
  });

  it("surfaces the latest meaningful event from the timeline", () => {
    const board = makeBoard();
    const ticket = board.tickets[0]!;

    const event = deriveLatestMeaningfulEvent(board, ticket);
    const timeline = buildTicketTimeline(board, ticket);

    expect(event?.label).toBe(timeline[0]?.title);
    expect(event?.label).toBe("Worker handoff recorded");
  });

  it("prefers mission briefing state over raw ticket internals", () => {
    const base = makeBoard();
    const ticket = base.tickets[0]!;
    const missionEventId = MissionEventId.make("mission-event-1");
    const board = makeBoard({
      ticketBriefings: [
        {
          ticketId: ticket.id,
          stage: "Blocked",
          statusLine: "Provider authentication failed before the worker could continue.",
          waitingOn: "Choose an authenticated Presence harness.",
          latestEventId: missionEventId,
          latestEventSummary: "Worker runtime failed.",
          latestEventAt: "2026-04-22T11:30:00.000Z",
          needsHuman: true,
          humanAction: "Choose an authenticated Presence harness.",
          retryBehavior: "manual",
          updatedAt: "2026-04-22T11:30:00.000Z",
        },
      ],
      missionEvents: [
        {
          id: missionEventId,
          boardId: base.board.id,
          ticketId: ticket.id,
          attemptId: base.attempts[0]!.id,
          reviewArtifactId: null,
          supervisorRunId: null,
          threadId: base.attempts[0]!.threadId,
          kind: "runtime_error",
          severity: "error",
          summary: "Worker runtime failed.",
          detail: "Provider is not signed in.",
          retryBehavior: "manual",
          humanAction: "Choose an authenticated Presence harness.",
          dedupeKey: "runtime:event-1",
          report: null,
          createdAt: "2026-04-22T11:30:00.000Z",
        },
      ],
    });

    const stage = deriveTicketStage(board, ticket);
    const reason = deriveLatestMeaningfulEvent(board, ticket);
    const callout = deriveTicketCallout(board, ticket);

    expect(stage.label).toBe("Blocked");
    expect(stage.waitingOn).toBe("Choose an authenticated Presence harness.");
    expect(reason?.label).toBe("Worker runtime failed.");
    expect(callout?.recommendedAction).toBe("Choose an authenticated Presence harness.");
    expect(callout?.retryBehavior).toContain("human decision");
  });
});
