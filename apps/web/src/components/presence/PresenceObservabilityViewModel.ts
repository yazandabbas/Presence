import type {
  BoardSnapshot,
  PresenceOperationKind,
  PresenceOperationRecord,
  PresenceOperationStatus,
  TicketRecord,
} from "@t3tools/contracts";

export type PresenceOperationTone = "neutral" | "info" | "success" | "warning" | "error";

export type PresenceOperationSummary = Readonly<{
  id: string;
  ticketId: string | null;
  attemptId: string | null;
  threadId: string | null;
  kind: PresenceOperationKind;
  label: string;
  status: PresenceOperationStatus;
  statusLabel: string;
  tone: PresenceOperationTone;
  summary: string;
  affectedLabel: string;
  timestamp: string;
  timestampLabel: string;
  durationLabel: string | null;
  errorSummary: string | null;
  safeDetails: readonly string[];
}>;

export type PresenceObservabilityViewModel = Readonly<{
  headline: string;
  subline: string;
  active: readonly PresenceOperationSummary[];
  failed: readonly PresenceOperationSummary[];
  recent: readonly PresenceOperationSummary[];
  ticketTrace: readonly PresenceOperationSummary[];
  emptyLabel: string;
}>;

export type BuildPresenceObservabilityViewModelInput = Readonly<{
  board: BoardSnapshot;
  ticket?: TicketRecord | null | undefined;
  now?: number | undefined;
}>;

const OPERATION_LABELS: Record<PresenceOperationKind, string> = {
  controller_tick: "Controller",
  goal_planning: "Goal planning",
  supervisor_run: "Supervisor",
  worker_attempt: "Worker",
  review_run: "Review",
  command_dispatch: "Command",
  provider_runtime_observation: "Runtime",
  projection_sync: "Projection",
  repo_brain_projection: "Repo brain",
  merge_operation: "Merge",
  human_direction: "Human direction",
};

const STATUS_LABELS: Record<PresenceOperationStatus, string> = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
  cancelled: "Cancelled",
};

const SAFE_DETAIL_KEYS = [
  "missionEventKind",
  "severity",
  "retryBehavior",
  "reviewerKind",
  "decision",
  "scopeType",
  "dirtyReason",
  "desiredVersion",
  "projectedVersion",
  "attemptCount",
  "baseBranch",
  "sourceBranch",
  "cleanupWorktreeDone",
  "cleanupThreadDone",
] as const;

function operationTone(status: PresenceOperationStatus): PresenceOperationTone {
  switch (status) {
    case "running":
      return "info";
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "skipped":
      return "warning";
    case "cancelled":
      return "neutral";
  }
}

function formatDuration(durationMs: number | null): string | null {
  if (durationMs === null) return null;
  if (durationMs < 1000) return `${durationMs}ms`;
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return `${minutes}m`;
}

function formatRelative(timestamp: string, now: number): string {
  const delta = Math.max(0, now - Date.parse(timestamp));
  const minutes = Math.max(1, Math.round(delta / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function formatValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function safeDetails(operation: PresenceOperationRecord): readonly string[] {
  return SAFE_DETAIL_KEYS.flatMap((key) => {
    const value = formatValue(operation.details[key]);
    return value ? [`${key}: ${value}`] : [];
  }).slice(0, 5);
}

function affectedLabel(operation: PresenceOperationRecord): string {
  if (operation.ticketId) return `Ticket ${operation.ticketId}`;
  if (operation.attemptId) return `Attempt ${operation.attemptId}`;
  if (operation.threadId) return `Thread ${operation.threadId}`;
  if (operation.boardId) return "Board";
  return "Presence";
}

function summarizeOperation(
  operation: PresenceOperationRecord,
  now: number,
): PresenceOperationSummary {
  const timestamp = operation.completedAt ?? operation.updatedAt ?? operation.startedAt;
  return {
    id: operation.id,
    ticketId: operation.ticketId,
    attemptId: operation.attemptId,
    threadId: operation.threadId,
    kind: operation.kind,
    label: OPERATION_LABELS[operation.kind],
    status: operation.status,
    statusLabel: STATUS_LABELS[operation.status],
    tone: operationTone(operation.status),
    summary: operation.summary,
    affectedLabel: affectedLabel(operation),
    timestamp,
    timestampLabel: formatRelative(timestamp, now),
    durationLabel: formatDuration(operation.durationMs),
    errorSummary: operation.error?.message ?? null,
    safeDetails: safeDetails(operation),
  };
}

export function buildPresenceObservabilityViewModel(
  input: BuildPresenceObservabilityViewModelInput,
): PresenceObservabilityViewModel {
  const now = input.now ?? Date.now();
  const operations = input.board.operationLedger.map((operation) =>
    summarizeOperation(operation, now),
  );
  const active = operations.filter((operation) => operation.status === "running").slice(0, 4);
  const failed = operations.filter((operation) => operation.status === "failed").slice(0, 3);
  const recent = operations
    .filter((operation) => operation.status !== "running" && operation.status !== "failed")
    .slice(0, 5);
  const ticketTrace = input.ticket
    ? operations.filter((operation) => operation.ticketId === input.ticket?.id).slice(0, 5)
    : [];

  const headline =
    active.length > 0
      ? `${active.length} operation${active.length === 1 ? "" : "s"} running`
      : failed.length > 0
        ? `${failed.length} operation${failed.length === 1 ? "" : "s"} need attention`
        : operations.length > 0
          ? "Presence is observable"
          : "No operations recorded yet";

  const subline =
    active[0]?.summary ??
    failed[0]?.errorSummary ??
    failed[0]?.summary ??
    recent[0]?.summary ??
    "The ledger will fill in as Presence plans, runs, reviews, projects, or recovers work.";

  return {
    headline,
    subline,
    active,
    failed,
    recent,
    ticketTrace,
    emptyLabel: "No ledger activity for this scope yet.",
  };
}
