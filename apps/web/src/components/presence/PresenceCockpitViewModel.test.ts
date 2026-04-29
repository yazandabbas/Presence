import type { BoardSnapshot, GoalIntakeRecord, ProjectionHealthRecord } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildPresenceCockpitViewModel } from "./PresenceCockpitViewModel";

const now = "2026-04-29T00:00:00.000Z";
const boardId = "board-1" as never;
const ticketId1 = "ticket-1" as never;
const ticketId2 = "ticket-2" as never;
const goalId1 = "goal-1" as never;
const goalId2 = "goal-2" as never;
const goalId3 = "goal-3" as never;

function makeBoard(overrides: Partial<BoardSnapshot> = {}): BoardSnapshot {
  return {
    goalIntakes: [],
    missionBriefing: null,
    controllerState: null,
    boardProjectionHealth: null,
    ...overrides,
  } as BoardSnapshot;
}

function makeProjectionHealth(
  overrides: Partial<ProjectionHealthRecord> = {},
): ProjectionHealthRecord {
  return {
    scopeType: "board",
    scopeId: boardId,
    status: "stale",
    desiredVersion: 2,
    projectedVersion: 1,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastAttemptedAt: now,
    lastSucceededAt: now,
    lastErrorMessage: "Projection lagged",
    lastErrorPath: null,
    staleSince: now,
    nextRetryAt: null,
    retryCount: 1,
    updatedAt: now,
    ...overrides,
  } as ProjectionHealthRecord;
}

function makeGoalIntake(
  overrides: Partial<GoalIntakeRecord> & Pick<GoalIntakeRecord, "id" | "status">,
): GoalIntakeRecord {
  return {
    boardId,
    source: "human_goal",
    rawGoal: "Make Presence reliable.",
    summary: "Presence reliability",
    createdTicketIds: [],
    plannedAt: null,
    blockedAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as GoalIntakeRecord;
}

describe("buildPresenceCockpitViewModel", () => {
  it("prioritizes paused controller state", () => {
    const cockpit = buildPresenceCockpitViewModel({
      board: makeBoard({
        controllerState: {
          boardId,
          mode: "paused",
          status: "paused",
          summary: "Controller paused by human.",
          leaseOwner: null,
          leaseExpiresAt: null,
          lastTickAt: null,
          updatedAt: now,
        },
        missionBriefing: {
          boardId,
          summary: "Presence is moving.",
          activeTicketIds: [ticketId1],
          blockedTicketIds: [],
          humanActionTicketIds: [ticketId1],
          latestEventId: null,
          latestEventSummary: null,
          latestEventAt: null,
          updatedAt: now,
        },
      }),
      runSupervisorReason: "Ready.",
    });

    expect(cockpit.statusKind).toBe("paused");
    expect(cockpit.statusLine).toContain("Presence is paused");
    expect(cockpit.controllerLine).toBe("Controller paused by human.");
    expect(cockpit.counts.humanActionTickets).toBe(1);
  });

  it("asks for human direction before active work status", () => {
    const cockpit = buildPresenceCockpitViewModel({
      board: makeBoard({
        missionBriefing: {
          boardId,
          summary: "Presence needs input.",
          activeTicketIds: [ticketId1, ticketId2],
          blockedTicketIds: [ticketId2],
          humanActionTicketIds: [ticketId1, ticketId2],
          latestEventId: null,
          latestEventSummary: null,
          latestEventAt: null,
          updatedAt: now,
        },
      }),
      runSupervisorReason: "Ready.",
    });

    expect(cockpit.statusKind).toBe("needs-human");
    expect(cockpit.statusLine).toBe("I need your direction on 2 tickets before I keep moving.");
    expect(cockpit.counts.activeTickets).toBe(2);
    expect(cockpit.counts.blockedTickets).toBe(1);
  });

  it("reports queued goals when there is no human action", () => {
    const cockpit = buildPresenceCockpitViewModel({
      board: makeBoard({
        goalIntakes: [
          makeGoalIntake({ id: goalId1, status: "queued" }),
          makeGoalIntake({ id: goalId2, status: "planning" }),
          makeGoalIntake({ id: goalId3, status: "planned" }),
        ],
      }),
      runSupervisorReason: "Supervisor ready.",
    });

    expect(cockpit.statusKind).toBe("queued-goal");
    expect(cockpit.statusLine).toBe(
      "I have 2 queued goals and will turn them into tickets automatically.",
    );
    expect(cockpit.counts.queuedGoals).toBe(2);
  });

  it("reports active work and carries projection health", () => {
    const projectionHealth = makeProjectionHealth();
    const cockpit = buildPresenceCockpitViewModel({
      board: makeBoard({
        boardProjectionHealth: projectionHealth,
        missionBriefing: {
          boardId,
          summary: "Presence is actively moving 1 ticket.",
          activeTicketIds: [ticketId1],
          blockedTicketIds: [],
          humanActionTicketIds: [],
          latestEventId: null,
          latestEventSummary: null,
          latestEventAt: null,
          updatedAt: now,
        },
      }),
      runSupervisorReason: "Ready.",
    });

    expect(cockpit.statusKind).toBe("active-work");
    expect(cockpit.statusLine).toBe(
      "I am handling 1 active ticket and will only interrupt you if I get blocked.",
    );
    expect(cockpit.briefingSummary).toBe("Presence is actively moving 1 ticket.");
    expect(cockpit.projectionHealth).toBe(projectionHealth);
  });

  it("falls back to idle guidance", () => {
    const cockpit = buildPresenceCockpitViewModel({
      board: makeBoard(),
      runSupervisorReason: "Presence is ready and watching active work.",
    });

    expect(cockpit.statusKind).toBe("idle");
    expect(cockpit.statusLine).toBe(
      "Tell me the outcome you want, and I will plan the work from there.",
    );
    expect(cockpit.controllerLine).toBe("Presence is ready and watching active work.");
    expect(cockpit.briefingSummary).toBe("Presence is ready.");
  });
});
