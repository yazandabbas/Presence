import type {
  BoardSnapshot,
  PresenceControllerMode,
  PresenceControllerStatus,
  ProjectionHealthRecord,
} from "@t3tools/contracts";

export type PresenceCockpitStatusKind =
  | "paused"
  | "needs-human"
  | "queued-goal"
  | "active-work"
  | "idle";

export type PresenceCockpitViewModel = Readonly<{
  briefingSummary: string;
  statusKind: PresenceCockpitStatusKind;
  statusLine: string;
  controllerLine: string;
  controllerMode: PresenceControllerMode | null;
  controllerStatus: PresenceControllerStatus | null;
  projectionHealth: ProjectionHealthRecord | null;
  counts: Readonly<{
    activeTickets: number;
    queuedGoals: number;
    humanActionTickets: number;
    blockedTickets: number;
  }>;
}>;

export type BuildPresenceCockpitViewModelInput = Readonly<{
  board: BoardSnapshot;
  runSupervisorReason: string;
}>;

function ticketPlural(count: number): string {
  return count === 1 ? "ticket" : "tickets";
}

function goalPlural(count: number): string {
  return count === 1 ? "goal" : "goals";
}

export function buildPresenceCockpitViewModel(
  input: BuildPresenceCockpitViewModelInput,
): PresenceCockpitViewModel {
  const briefing = input.board.missionBriefing;
  const controller = input.board.controllerState;
  const activeTickets = briefing?.activeTicketIds.length ?? 0;
  const humanActionTickets = briefing?.humanActionTicketIds.length ?? 0;
  const blockedTickets = briefing?.blockedTicketIds.length ?? 0;
  const queuedGoals = input.board.goalIntakes.filter(
    (goal) => goal.status === "queued" || goal.status === "planning",
  ).length;

  if (controller?.mode === "paused") {
    return {
      briefingSummary: briefing?.summary ?? "Presence is ready.",
      statusKind: "paused",
      statusLine: "Presence is paused. Resume it when you want me to continue.",
      controllerLine: controller.summary,
      controllerMode: controller.mode,
      controllerStatus: controller.status,
      projectionHealth: input.board.boardProjectionHealth,
      counts: {
        activeTickets,
        queuedGoals,
        humanActionTickets,
        blockedTickets,
      },
    };
  }

  if (humanActionTickets > 0) {
    return {
      briefingSummary: briefing?.summary ?? "Presence is ready.",
      statusKind: "needs-human",
      statusLine: `I need your direction on ${humanActionTickets} ${ticketPlural(
        humanActionTickets,
      )} before I keep moving.`,
      controllerLine: controller?.summary ?? input.runSupervisorReason,
      controllerMode: controller?.mode ?? null,
      controllerStatus: controller?.status ?? null,
      projectionHealth: input.board.boardProjectionHealth,
      counts: {
        activeTickets,
        queuedGoals,
        humanActionTickets,
        blockedTickets,
      },
    };
  }

  if (queuedGoals > 0) {
    return {
      briefingSummary: briefing?.summary ?? "Presence is ready.",
      statusKind: "queued-goal",
      statusLine: `I have ${queuedGoals} queued ${goalPlural(
        queuedGoals,
      )} and will turn them into tickets automatically.`,
      controllerLine: controller?.summary ?? input.runSupervisorReason,
      controllerMode: controller?.mode ?? null,
      controllerStatus: controller?.status ?? null,
      projectionHealth: input.board.boardProjectionHealth,
      counts: {
        activeTickets,
        queuedGoals,
        humanActionTickets,
        blockedTickets,
      },
    };
  }

  if (activeTickets > 0) {
    return {
      briefingSummary: briefing?.summary ?? "Presence is ready.",
      statusKind: "active-work",
      statusLine: `I am handling ${activeTickets} active ${ticketPlural(
        activeTickets,
      )} and will only interrupt you if I get blocked.`,
      controllerLine: controller?.summary ?? input.runSupervisorReason,
      controllerMode: controller?.mode ?? null,
      controllerStatus: controller?.status ?? null,
      projectionHealth: input.board.boardProjectionHealth,
      counts: {
        activeTickets,
        queuedGoals,
        humanActionTickets,
        blockedTickets,
      },
    };
  }

  return {
    briefingSummary: briefing?.summary ?? "Presence is ready.",
    statusKind: "idle",
    statusLine: "Tell me the outcome you want, and I will plan the work from there.",
    controllerLine: controller?.summary ?? input.runSupervisorReason,
    controllerMode: controller?.mode ?? null,
    controllerStatus: controller?.status ?? null,
    projectionHealth: input.board.boardProjectionHealth,
    counts: {
      activeTickets,
      queuedGoals,
      humanActionTickets,
      blockedTickets,
    },
  };
}
