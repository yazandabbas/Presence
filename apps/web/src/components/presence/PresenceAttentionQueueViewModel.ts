import type {
  BoardSnapshot,
  PresenceTicketStatus,
  RepositoryCapabilityScanRecord,
  TicketRecord,
} from "@t3tools/contracts";

import {
  deriveLatestMeaningfulEvent,
  deriveTicketReasonLine,
  deriveTicketStage,
  STATUS_COLUMNS,
  type PresenceTicketStageTone,
} from "./PresencePresentation";

export type PresenceAttentionTone =
  | "queued"
  | "planning"
  | "needs-human"
  | "blocked"
  | "active"
  | "done"
  | "routine";

export type PresenceAttentionQueueGoalRow = Readonly<{
  kind: "goal";
  id: string;
  title: string;
  detail: string;
  stageLabel: string;
  stageTone: PresenceTicketStageTone;
  latestUpdate: string;
  latestUpdateAt: string | null;
  waitingFor: string;
  selected: false;
  attentionTone: PresenceAttentionTone;
}>;

export type PresenceAttentionQueueTicketRow = Readonly<{
  kind: "ticket";
  id: string;
  ticketId: TicketRecord["id"];
  title: string;
  detail: string;
  stageLabel: string;
  stageTone: PresenceTicketStageTone;
  latestUpdate: string;
  latestUpdateAt: string | null;
  waitingFor: string;
  selected: boolean;
  attentionTone: PresenceAttentionTone;
  humanAction: string | null;
}>;

export type PresenceAttentionQueueRow =
  | PresenceAttentionQueueGoalRow
  | PresenceAttentionQueueTicketRow;

export type PresenceAttentionQueueViewModel = Readonly<{
  rows: readonly PresenceAttentionQueueRow[];
  empty: boolean;
  totalCount: number;
}>;

export type BuildPresenceAttentionQueueViewModelInput = Readonly<{
  board: BoardSnapshot;
  selectedTicketId: string | null;
  capabilityScan: RepositoryCapabilityScanRecord | null | undefined;
}>;

function ticketStatusOrder(status: PresenceTicketStatus): number {
  const index = STATUS_COLUMNS.indexOf(status);
  return index === -1 ? STATUS_COLUMNS.length : index;
}

function ticketBriefingFor(board: BoardSnapshot, ticket: TicketRecord) {
  return board.ticketBriefings.find((briefing) => briefing.ticketId === ticket.id) ?? null;
}

function latestAttemptForTicket(board: BoardSnapshot, ticket: TicketRecord) {
  return (
    board.attemptSummaries
      .filter((summary) => summary.attempt.ticketId === ticket.id)
      .toSorted((left, right) =>
        right.attempt.createdAt.localeCompare(left.attempt.createdAt),
      )[0] ?? null
  );
}

function attentionToneForTicket(ticket: TicketRecord, needsHuman: boolean): PresenceAttentionTone {
  if (needsHuman) return "needs-human";
  if (ticket.status === "blocked") return "blocked";
  if (ticket.status === "done") return "done";
  if (ticket.status === "in_progress" || ticket.status === "in_review") return "active";
  return "routine";
}

function humanActionLabel(value: string): string {
  return value.replace("Give Presence direction on the blocker.", "Your direction");
}

export function buildPresenceAttentionQueueViewModel(
  input: BuildPresenceAttentionQueueViewModelInput,
): PresenceAttentionQueueViewModel {
  const queuedGoalRows: PresenceAttentionQueueGoalRow[] = input.board.goalIntakes
    .filter((goal) => goal.status === "queued" || goal.status === "planning")
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map((goal) => {
      const planning = goal.status === "planning";
      return {
        kind: "goal",
        id: goal.id,
        title: goal.summary,
        detail: goal.rawGoal,
        stageLabel: planning ? "Planning" : "Queued",
        stageTone: "info",
        latestUpdate: planning ? "Inspecting repo context" : "Goal saved",
        latestUpdateAt: goal.updatedAt,
        waitingFor: planning
          ? "Presence is turning this into actionable tickets."
          : "Waiting for the resident controller tick.",
        selected: false,
        attentionTone: planning ? "planning" : "queued",
      };
    });

  const ticketRows: PresenceAttentionQueueTicketRow[] = input.board.tickets
    .toSorted((left, right) => {
      const leftBriefing = ticketBriefingFor(input.board, left);
      const rightBriefing = ticketBriefingFor(input.board, right);
      if (Boolean(leftBriefing?.needsHuman) !== Boolean(rightBriefing?.needsHuman)) {
        return leftBriefing?.needsHuman ? -1 : 1;
      }
      if (left.status !== right.status) {
        return ticketStatusOrder(left.status) - ticketStatusOrder(right.status);
      }
      return right.updatedAt.localeCompare(left.updatedAt);
    })
    .map((ticket) => {
      const briefing = ticketBriefingFor(input.board, ticket);
      const latestAttempt = latestAttemptForTicket(input.board, ticket);
      const derivedLatestEvent = deriveLatestMeaningfulEvent(input.board, ticket);
      const stage = briefing
        ? {
            label: briefing.stage,
            tone: briefing.needsHuman ? ("warning" as const) : ("info" as const),
          }
        : deriveTicketStage(input.board, ticket, {
            capabilityScan: input.capabilityScan ?? null,
            primaryAttempt: latestAttempt,
          });
      return {
        kind: "ticket",
        id: ticket.id,
        ticketId: ticket.id,
        title: ticket.title,
        detail: ticket.description || "No description yet.",
        stageLabel: briefing?.needsHuman ? "Needs direction" : stage.label,
        stageTone: briefing?.needsHuman ? "warning" : stage.tone,
        latestUpdate: briefing?.latestEventSummary ?? derivedLatestEvent?.label ?? "No updates yet",
        latestUpdateAt: briefing?.latestEventAt ?? derivedLatestEvent?.timestamp ?? null,
        waitingFor:
          briefing?.waitingOn ??
          deriveTicketReasonLine(input.board, ticket, { primaryAttempt: latestAttempt }),
        selected: input.selectedTicketId === ticket.id,
        attentionTone: attentionToneForTicket(ticket, Boolean(briefing?.needsHuman)),
        humanAction: briefing?.humanAction ? humanActionLabel(briefing.humanAction) : null,
      };
    });

  const rows = [...queuedGoalRows, ...ticketRows];
  return {
    rows,
    empty: rows.length === 0,
    totalCount: rows.length,
  };
}
