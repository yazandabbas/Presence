import {
  type PresenceAgentReport,
  type PresenceMissionEventKind,
  type PresenceMissionEventRecord,
  type PresenceMissionRetryBehavior,
  type PresenceMissionSeverity,
} from "@t3tools/contracts";
import { Effect } from "effect";

import { truncateText } from "./PresenceShared.ts";
import {
  missionRestartKey,
  missionRuntimeBlockerKey,
  missionWorkerContinuationKey,
} from "./PresenceCorrelationKeys.ts";

type PresenceMissionAction =
  | { readonly type: "plan_goal"; readonly goalIntakeId: string }
  | { readonly type: "create_attempt"; readonly ticketId: string }
  | {
      readonly type: "start_attempt_session";
      readonly ticketId: string;
      readonly attemptId: string;
    }
  | {
      readonly type: "refresh_worker_handoff";
      readonly ticketId: string;
      readonly attemptId: string;
    }
  | { readonly type: "start_review"; readonly ticketId: string; readonly attemptId: string }
  | {
      readonly type: "restart_worker";
      readonly ticketId: string;
      readonly attemptId: string;
      readonly reason: string;
      readonly dedupeKey: string;
    }
  | {
      readonly type: "restart_review";
      readonly ticketId: string;
      readonly attemptId: string;
      readonly reason: string;
      readonly dedupeKey: string;
    }
  | {
      readonly type: "queue_worker_continuation";
      readonly ticketId: string;
      readonly attemptId: string;
      readonly reason: string;
      readonly dedupeKey: string;
    }
  | {
      readonly type: "mark_human_blocker";
      readonly ticketId: string | null;
      readonly attemptId: string | null;
      readonly reason: string;
      readonly humanAction: string;
      readonly dedupeKey: string;
    }
  | { readonly type: "repair_projection"; readonly scopeId: string }
  | { readonly type: "stop_stable"; readonly reason: string }
  | { readonly type: "no_op"; readonly reason: string };

type PresenceMissionDecision = Readonly<{
  action: PresenceMissionAction;
  summary: string;
  detail?: string | null;
  severity?: PresenceMissionSeverity;
  retryBehavior?: PresenceMissionRetryBehavior;
}>;

type PresenceAgentReportInput = Readonly<{
  boardId: string;
  ticketId?: string | null;
  attemptId?: string | null;
  reviewArtifactId?: string | null;
  supervisorRunId?: string | null;
  threadId?: string | null;
  kind: PresenceMissionEventKind;
  severity?: PresenceMissionSeverity;
  summary: string;
  detail?: string | null;
  retryBehavior?: PresenceMissionRetryBehavior;
  humanAction?: string | null;
  dedupeKey: string;
  report: PresenceAgentReport;
  createdAt?: string;
}>;

type PresenceMissionControlDeps = Readonly<{
  nowIso: () => string;
  writeMissionEvent: (input: {
    boardId: string;
    ticketId?: string | null;
    attemptId?: string | null;
    reviewArtifactId?: string | null;
    supervisorRunId?: string | null;
    threadId?: string | null;
    kind: PresenceMissionEventKind;
    severity?: PresenceMissionSeverity;
    summary: string;
    detail?: string | null;
    retryBehavior?: PresenceMissionRetryBehavior;
    humanAction?: string | null;
    dedupeKey: string;
    report?: PresenceAgentReport | null;
    createdAt?: string;
  }) => Effect.Effect<PresenceMissionEventRecord, Error, never>;
}>;

const eventsMatchingDedupeKey = (
  events: ReadonlyArray<PresenceMissionEventRecord>,
  dedupeKey: string,
) => events.filter((event) => event.dedupeKey === dedupeKey);

const latestManualRuntimeBlocker = (
  events: ReadonlyArray<PresenceMissionEventRecord>,
  ticketId: string,
) =>
  events.find(
    (event) =>
      event.ticketId === ticketId &&
      (event.kind === "runtime_error" ||
        event.kind === "provider_unavailable" ||
        event.kind === "human_blocker") &&
      event.retryBehavior === "manual" &&
      event.humanAction !== null,
  ) ?? null;

const classifyRetryBehavior = (
  message: string,
): {
  retryBehavior: PresenceMissionRetryBehavior;
  humanAction: string | null;
} => {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("auth") ||
    normalized.includes("login") ||
    normalized.includes("not signed in") ||
    normalized.includes("unauthorized") ||
    normalized.includes("account") ||
    normalized.includes("invalid account")
  ) {
    return {
      retryBehavior: "manual",
      humanAction: "Choose an authenticated Presence harness or sign in to the selected provider.",
    };
  }
  return { retryBehavior: "automatic", humanAction: null };
};

const makePresenceMissionControl = (deps: PresenceMissionControlDeps) => {
  const recordAgentReport = (input: PresenceAgentReportInput) =>
    deps.writeMissionEvent({
      ...input,
      report: input.report,
      createdAt: input.createdAt ?? deps.nowIso(),
    });

  const recordSupervisorDecision = (input: {
    boardId: string;
    ticketId?: string | null;
    attemptId?: string | null;
    supervisorRunId?: string | null;
    threadId?: string | null;
    decision: PresenceMissionDecision;
    dedupeKey: string;
    humanAction?: string | null;
  }) =>
    recordAgentReport({
      boardId: input.boardId,
      ticketId: input.ticketId ?? null,
      attemptId: input.attemptId ?? null,
      supervisorRunId: input.supervisorRunId ?? null,
      threadId: input.threadId ?? null,
      kind:
        input.decision.action.type === "mark_human_blocker"
          ? "human_blocker"
          : input.decision.action.type === "queue_worker_continuation" ||
              input.decision.action.type === "restart_worker" ||
              input.decision.action.type === "restart_review"
            ? "retry_queued"
            : "supervisor_decision",
      severity:
        input.decision.severity ??
        (input.decision.action.type === "mark_human_blocker" ? "warning" : "info"),
      summary: input.decision.summary,
      detail: input.decision.detail ?? null,
      retryBehavior:
        input.decision.retryBehavior ??
        (input.decision.action.type === "mark_human_blocker" ? "manual" : "not_applicable"),
      humanAction:
        input.humanAction ??
        (input.decision.action.type === "mark_human_blocker"
          ? input.decision.action.humanAction
          : null),
      dedupeKey: input.dedupeKey,
      report: {
        kind:
          input.decision.action.type === "mark_human_blocker" ? "blocker" : "supervisor_decision",
        summary: input.decision.summary,
        details: input.decision.detail ?? null,
        evidence: [],
        blockers:
          input.decision.action.type === "mark_human_blocker" ? [input.decision.action.reason] : [],
        nextAction:
          input.decision.action.type === "mark_human_blocker"
            ? input.decision.action.humanAction
            : null,
      },
    }).pipe(Effect.catch(() => Effect.void));

  const manualRuntimeBlockerDecision = (input: {
    ticketId: string;
    attemptId: string | null;
    recentEvents: ReadonlyArray<PresenceMissionEventRecord>;
  }): PresenceMissionDecision | null => {
    const event = latestManualRuntimeBlocker(input.recentEvents, input.ticketId);
    if (!event) return null;
    const action = {
      type: "mark_human_blocker" as const,
      ticketId: input.ticketId,
      attemptId: input.attemptId,
      reason: truncateText(event.detail ?? event.summary, 500),
      humanAction:
        event.humanAction ??
        "Choose an authenticated Presence harness or sign in to the selected provider.",
      dedupeKey: missionRuntimeBlockerKey(input.ticketId, event.id),
    };
    return {
      action,
      summary: "Presence needs a harness/account fix before continuing.",
      detail: action.reason,
      severity: "warning",
      retryBehavior: "manual",
    };
  };

  const restartDecision = (input: {
    kind: "worker" | "review";
    ticketId: string;
    attemptId: string;
    reason: string;
    recentEvents: ReadonlyArray<PresenceMissionEventRecord>;
    maxRetries?: number;
  }): PresenceMissionDecision => {
    const dedupeKey = missionRestartKey(input.kind, input.attemptId, input.reason);
    const priorAttempts = eventsMatchingDedupeKey(input.recentEvents, dedupeKey).length;
    if (priorAttempts >= (input.maxRetries ?? 1)) {
      const action = {
        type: "mark_human_blocker" as const,
        ticketId: input.ticketId,
        attemptId: input.attemptId,
        reason: input.reason,
        humanAction: "Inspect the failed session before asking Presence to retry it again.",
        dedupeKey: `${dedupeKey}:blocked`,
      };
      return {
        action,
        summary: `Presence stopped retrying the ${input.kind} session.`,
        detail: input.reason,
        severity: "warning",
        retryBehavior: "manual",
      };
    }
    return {
      action: {
        type: input.kind === "worker" ? "restart_worker" : "restart_review",
        ticketId: input.ticketId,
        attemptId: input.attemptId,
        reason: input.reason,
        dedupeKey,
      },
      summary: `Presence queued a bounded ${input.kind} restart.`,
      detail: input.reason,
      severity: "info",
      retryBehavior: "automatic",
    };
  };

  const workerContinuationDecision = (input: {
    ticketId: string;
    attemptId: string;
    reason: string;
    recentEvents: ReadonlyArray<PresenceMissionEventRecord>;
  }): PresenceMissionDecision => {
    const dedupeKey = missionWorkerContinuationKey(input.attemptId, input.reason);
    const priorAttempts = eventsMatchingDedupeKey(input.recentEvents, dedupeKey).length;
    if (priorAttempts > 0) {
      const action = {
        type: "mark_human_blocker" as const,
        ticketId: input.ticketId,
        attemptId: input.attemptId,
        reason: input.reason,
        humanAction:
          "Presence already sent this worker continuation. Inspect the worker session before retrying.",
        dedupeKey: `${dedupeKey}:duplicate-blocked`,
      };
      return {
        action,
        summary: "Presence suppressed a duplicate worker continuation.",
        detail: input.reason,
        severity: "warning",
        retryBehavior: "manual",
      };
    }
    return {
      action: {
        type: "queue_worker_continuation",
        ticketId: input.ticketId,
        attemptId: input.attemptId,
        reason: input.reason,
        dedupeKey,
      },
      summary: "Presence queued worker continuation from reviewer feedback.",
      detail: input.reason,
      severity: "info",
      retryBehavior: "automatic",
    };
  };

  return {
    classifyRetryBehavior,
    manualRuntimeBlockerDecision,
    recordAgentReport,
    recordSupervisorDecision,
    restartDecision,
    workerContinuationDecision,
  };
};

export { makePresenceMissionControl };
export type {
  PresenceAgentReportInput,
  PresenceMissionAction,
  PresenceMissionControlDeps,
  PresenceMissionDecision,
};
