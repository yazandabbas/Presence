import type {
  BoardSnapshot,
  GoalIntakeRecord,
  PresenceTicketMissionBriefing,
  PresenceTicketStatus,
  TicketRecord,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildPresenceAttentionQueueViewModel } from "./PresenceAttentionQueueViewModel";

const now = "2026-04-29T00:00:00.000Z";
const older = "2026-04-28T00:00:00.000Z";
const boardId = "board-1" as never;
const ticketId1 = "ticket-1" as never;
const ticketId2 = "ticket-2" as never;
const ticketId3 = "ticket-3" as never;
const ticketId4 = "ticket-4" as never;
const goalId = "goal-1" as never;

function makeTicket(
  id: TicketRecord["id"],
  status: PresenceTicketStatus,
  overrides: Partial<TicketRecord> = {},
): TicketRecord {
  return {
    id,
    boardId,
    parentTicketId: null,
    title: `Ticket ${String(id)}`,
    description: `Description ${String(id)}`,
    status,
    priority: "p2",
    acceptanceChecklist: [],
    assignedAttemptId: null,
    createdAt: older,
    updatedAt: now,
    ...overrides,
  } as TicketRecord;
}

function makeGoalIntake(overrides: Partial<GoalIntakeRecord> = {}): GoalIntakeRecord {
  return {
    id: goalId,
    boardId,
    source: "human_goal",
    rawGoal: "Make Presence reliable.",
    summary: "Presence reliability",
    createdTicketIds: [],
    status: "queued",
    plannedAt: null,
    blockedAt: null,
    lastError: null,
    createdAt: older,
    updatedAt: now,
    ...overrides,
  } as GoalIntakeRecord;
}

function makeTicketBriefing(
  ticketId: TicketRecord["id"],
  overrides: Partial<PresenceTicketMissionBriefing> = {},
): PresenceTicketMissionBriefing {
  return {
    ticketId,
    stage: "Reviewing evidence",
    statusLine: "Needs human input",
    waitingOn: "Human decision",
    latestEventId: null,
    latestEventSummary: "Reviewer blocked",
    latestEventAt: now,
    needsHuman: true,
    humanAction: "Give Presence direction on the blocker.",
    retryBehavior: "manual",
    updatedAt: now,
    ...overrides,
  } as PresenceTicketMissionBriefing;
}

function makeBoard(overrides: Partial<BoardSnapshot> = {}): BoardSnapshot {
  return {
    tickets: [],
    dependencies: [],
    attempts: [],
    workspaces: [],
    attemptSummaries: [],
    supervisorHandoff: null,
    evidence: [],
    knowledgePages: [],
    promotionCandidates: [],
    findings: [],
    reviewArtifacts: [],
    proposedFollowUps: [],
    jobs: [],
    mergeOperations: [],
    ticketSummaries: [],
    attemptOutcomes: [],
    reviewDecisions: [],
    supervisorRuns: [],
    boardProjectionHealth: null,
    ticketProjectionHealth: [],
    hasStaleProjections: false,
    capabilityScan: null,
    goalIntakes: [],
    missionBriefing: null,
    ticketBriefings: [],
    missionEvents: [],
    controllerState: null,
    ...overrides,
  } as BoardSnapshot;
}

describe("buildPresenceAttentionQueueViewModel", () => {
  it("returns queued goal rows before tickets", () => {
    const queue = buildPresenceAttentionQueueViewModel({
      board: makeBoard({
        goalIntakes: [makeGoalIntake()],
        tickets: [makeTicket(ticketId1, "todo")],
      }),
      selectedTicketId: null,
      capabilityScan: null,
    });

    expect(queue.empty).toBe(false);
    expect(queue.totalCount).toBe(2);
    expect(queue.rows[0]).toMatchObject({
      kind: "goal",
      title: "Presence reliability",
      stageLabel: "Queued",
      latestUpdate: "Goal saved",
      attentionTone: "queued",
    });
  });

  it("sorts human-action tickets before routine active work", () => {
    const queue = buildPresenceAttentionQueueViewModel({
      board: makeBoard({
        tickets: [makeTicket(ticketId1, "in_progress"), makeTicket(ticketId2, "in_progress")],
        ticketBriefings: [makeTicketBriefing(ticketId2)],
      }),
      selectedTicketId: null,
      capabilityScan: null,
    });

    expect(queue.rows[0]).toMatchObject({
      kind: "ticket",
      ticketId: ticketId2,
      stageLabel: "Needs direction",
      attentionTone: "needs-human",
      humanAction: "Your direction",
    });
    expect(queue.rows[1]).toMatchObject({
      kind: "ticket",
      ticketId: ticketId1,
      attentionTone: "active",
    });
  });

  it("labels blocked, active, and done ticket tones", () => {
    const queue = buildPresenceAttentionQueueViewModel({
      board: makeBoard({
        tickets: [
          makeTicket(ticketId1, "blocked"),
          makeTicket(ticketId2, "in_review"),
          makeTicket(ticketId3, "done"),
        ],
      }),
      selectedTicketId: null,
      capabilityScan: null,
    });

    const tones = new Map(
      queue.rows
        .filter((row) => row.kind === "ticket")
        .map((row) => [row.ticketId, row.attentionTone]),
    );
    expect(tones.get(ticketId1)).toBe("blocked");
    expect(tones.get(ticketId2)).toBe("active");
    expect(tones.get(ticketId3)).toBe("done");
  });

  it("tracks selected ticket rows", () => {
    const queue = buildPresenceAttentionQueueViewModel({
      board: makeBoard({
        tickets: [makeTicket(ticketId4, "todo")],
      }),
      selectedTicketId: ticketId4,
      capabilityScan: null,
    });

    expect(queue.rows[0]).toMatchObject({
      kind: "ticket",
      ticketId: ticketId4,
      selected: true,
    });
  });

  it("reports empty state when no goal or ticket rows exist", () => {
    const queue = buildPresenceAttentionQueueViewModel({
      board: makeBoard(),
      selectedTicketId: null,
      capabilityScan: null,
    });

    expect(queue.empty).toBe(true);
    expect(queue.rows).toHaveLength(0);
  });
});
