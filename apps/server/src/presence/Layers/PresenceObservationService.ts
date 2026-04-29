import {
  isToolLifecycleItemType,
  type OrchestrationEvent,
  type PresenceMissionEventKind,
  type PresenceMissionRetryBehavior,
  type PresenceMissionSeverity,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { Effect, Layer, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import {
  PresenceObservationService,
  type PresenceObservationServiceShape,
} from "../Services/PresenceObservationService.ts";
import {
  makePresenceMissionControl,
  type PresenceAgentReportInput,
} from "./internal/PresenceMissionControl.ts";
import { describeUnknownError, nowIso, truncateText } from "./internal/PresenceShared.ts";
import { runtimeEventDedupeKey } from "./internal/PresenceCorrelationKeys.ts";
import { makePresenceStore } from "./internal/PresenceStore.ts";
import { buildPresenceToolBridgeReport } from "./internal/PresenceToolBridge.ts";

type PresenceThreadCorrelation = Readonly<{
  role: "worker" | "review" | "supervisor";
  boardId: string;
  ticketId: string | null;
  attemptId: string | null;
  reviewArtifactId: string | null;
  supervisorRunId: string | null;
}>;

type MissionEventDraft = Readonly<{
  kind: PresenceMissionEventKind;
  severity: PresenceMissionSeverity;
  summary: string;
  detail?: string | null;
  retryBehavior: PresenceMissionRetryBehavior;
  humanAction?: string | null;
}>;

type RuntimeObservationDraft =
  | { readonly _tag: "none" }
  | { readonly _tag: "agent_report"; readonly input: PresenceAgentReportInput }
  | {
      readonly _tag: "mission_event";
      readonly draft: MissionEventDraft;
      readonly dedupeKey: string;
    };

const roleLabel = (correlation: PresenceThreadCorrelation): string => {
  switch (correlation.role) {
    case "worker":
      return "Worker";
    case "review":
      return "Reviewer";
    case "supervisor":
      return "Supervisor";
  }
};

const unknownToDetail = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return truncateText(value, 1_000);
  try {
    return truncateText(JSON.stringify(value), 1_000);
  } catch {
    return truncateText(String(value), 1_000);
  }
};

const runtimeFailureRetry = (
  message: string,
): Pick<MissionEventDraft, "retryBehavior" | "humanAction"> => {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("auth") ||
    normalized.includes("login") ||
    normalized.includes("unauthorized") ||
    normalized.includes("not signed in") ||
    normalized.includes("account") ||
    normalized.includes("api key") ||
    normalized.includes("forbidden") ||
    normalized.includes("permission") ||
    normalized.includes("access denied")
  ) {
    return {
      retryBehavior: "manual",
      humanAction: "Choose an authenticated Presence harness or sign in to the selected provider.",
    };
  }
  return { retryBehavior: "automatic" };
};

const runtimeProviderFailureKind = (
  message: string,
  errorClass?:
    | "provider_error"
    | "transport_error"
    | "permission_error"
    | "validation_error"
    | "unknown",
): Pick<MissionEventDraft, "kind" | "retryBehavior" | "humanAction"> => {
  const retry = runtimeFailureRetry(message);
  if (
    errorClass === "provider_error" ||
    errorClass === "transport_error" ||
    errorClass === "permission_error" ||
    retry.retryBehavior === "manual"
  ) {
    return {
      kind: "provider_unavailable",
      ...retry,
      humanAction:
        retry.humanAction ??
        (errorClass === "transport_error"
          ? null
          : "Check the selected provider harness before Presence retries this lane."),
    };
  }
  return { kind: "runtime_error", ...retry };
};

const detailWithOptionalContext = (message: string | undefined, detail: unknown): string | null => {
  const detailText = unknownToDetail(detail);
  if (!message) return detailText;
  if (!detailText) return message;
  return `${message}\n${detailText}`;
};

const draftForRuntimeEvent = (
  event: ProviderRuntimeEvent,
  correlation: PresenceThreadCorrelation,
): MissionEventDraft | null => {
  const actor = roleLabel(correlation);
  switch (event.type) {
    case "auth.status": {
      const message =
        event.payload.error ??
        event.payload.output?.find((line) => /auth|login|account|unauthorized/i.test(line)) ??
        null;
      if (!message) {
        return event.payload.isAuthenticating
          ? {
              kind: "runtime_health",
              severity: "info",
              summary: `${actor} provider authentication is in progress.`,
              detail: event.payload.output?.join("\n") ?? null,
              retryBehavior: "not_applicable",
            }
          : null;
      }
      const retry = runtimeFailureRetry(message);
      return {
        kind: retry.retryBehavior === "manual" ? "provider_unavailable" : "runtime_warning",
        severity: retry.retryBehavior === "manual" ? "error" : "warning",
        summary:
          retry.retryBehavior === "manual"
            ? `${actor} provider authentication needs attention.`
            : `${actor} provider authentication reported a warning.`,
        detail: detailWithOptionalContext(message, event.payload.output),
        retryBehavior: retry.retryBehavior,
        humanAction: retry.humanAction ?? null,
      };
    }
    case "session.state.changed":
      if (event.payload.state !== "error") {
        return null;
      }
      {
        const message = event.payload.reason ?? `${actor} provider session entered error state.`;
        const retry = runtimeProviderFailureKind(message);
        return {
          kind: retry.kind,
          severity: "error",
          summary: `${actor} provider session is unavailable.`,
          detail: detailWithOptionalContext(message, event.payload.detail),
          retryBehavior: retry.retryBehavior,
          humanAction: retry.humanAction ?? null,
        };
      }
    case "session.exited": {
      const reason = event.payload.reason ?? event.payload.exitKind ?? "session exited";
      const providerUnavailable =
        event.payload.recoverable === false || event.payload.exitKind === "error";
      const retry = providerUnavailable
        ? runtimeProviderFailureKind(reason)
        : ({ kind: "runtime_error", retryBehavior: "automatic", humanAction: null } as const);
      return {
        kind: providerUnavailable ? retry.kind : "runtime_error",
        severity: providerUnavailable ? "error" : "warning",
        summary: `${actor} session exited.`,
        detail: reason,
        retryBehavior: retry.retryBehavior,
        humanAction: providerUnavailable ? (retry.humanAction ?? null) : null,
      };
    }
    case "turn.started":
      return {
        kind: "turn_started",
        severity: "info",
        summary: `${actor} turn started.`,
        detail: event.payload.model ? `Model: ${event.payload.model}` : null,
        retryBehavior: "not_applicable",
      };
    case "turn.completed": {
      const failed = event.payload.state !== "completed";
      return {
        kind: failed ? "turn_failed" : "turn_completed",
        severity: failed ? "error" : "success",
        summary: failed
          ? `${actor} turn ended with ${event.payload.state}.`
          : `${actor} turn completed.`,
        detail: event.payload.errorMessage ?? event.payload.stopReason ?? null,
        retryBehavior: failed ? "automatic" : "not_applicable",
      };
    }
    case "turn.aborted":
      return {
        kind: "turn_failed",
        severity: "warning",
        summary: `${actor} turn was aborted.`,
        detail: event.payload.reason,
        retryBehavior: "automatic",
      };
    case "runtime.warning":
      return {
        kind: "runtime_warning",
        severity: "warning",
        summary: `${actor} runtime warning.`,
        detail: event.payload.message,
        retryBehavior: "automatic",
      };
    case "runtime.error": {
      const retry = runtimeProviderFailureKind(event.payload.message, event.payload.class);
      return {
        kind: retry.kind,
        severity: "error",
        summary:
          retry.kind === "provider_unavailable"
            ? `${actor} provider runtime is unavailable.`
            : `${actor} runtime failed.`,
        detail: detailWithOptionalContext(event.payload.message, event.payload.detail),
        retryBehavior: retry.retryBehavior,
        humanAction: retry.humanAction ?? null,
      };
    }
    case "thread.realtime.error":
      return {
        kind: "runtime_error",
        severity: "error",
        summary: `${actor} realtime channel failed.`,
        detail: event.payload.message,
        retryBehavior: "automatic",
      };
    case "request.opened":
      return {
        kind: "approval_requested",
        severity: "warning",
        summary: `${actor} needs approval to continue.`,
        detail: event.payload.detail ?? event.payload.requestType,
        retryBehavior: "manual",
        humanAction: "Review the provider approval request.",
      };
    case "user-input.requested":
      return {
        kind: "user_input_requested",
        severity: "warning",
        summary: `${actor} asked for direction.`,
        detail: event.payload.questions.map((question) => question.question).join("\n"),
        retryBehavior: "manual",
        humanAction: "Answer the requested input so Presence can continue.",
      };
    case "thread.realtime.closed":
      return {
        kind: "runtime_warning",
        severity: "warning",
        summary: `${actor} realtime channel closed.`,
        detail: event.payload.reason ?? null,
        retryBehavior: "automatic",
      };
    case "mcp.oauth.completed":
      if (event.payload.success) return null;
      return {
        kind: "provider_unavailable",
        severity: "error",
        summary: `${actor} MCP authentication needs attention.`,
        detail: event.payload.error ?? event.payload.name ?? null,
        retryBehavior: "manual",
        humanAction: "Complete the requested MCP authentication before Presence retries this lane.",
      };
    case "account.rate-limits.updated": {
      const detail = unknownToDetail(event.payload.rateLimits);
      const exhausted = detail
        ? /(exhaust|deplet|limit reached|rate limit|remaining["'\s:]*0)/i.test(detail)
        : false;
      return {
        kind: exhausted ? "provider_unavailable" : "runtime_health",
        severity: exhausted ? "warning" : "info",
        summary: exhausted
          ? `${actor} provider quota or rate limit needs attention.`
          : `${actor} provider rate limits updated.`,
        detail,
        retryBehavior: exhausted ? "manual" : "not_applicable",
        humanAction: exhausted
          ? "Wait for quota to reset or switch the ticket to another available provider."
          : null,
      };
    }
    case "thread.state.changed":
      if (event.payload.state !== "compacted" && event.payload.state !== "error") {
        return null;
      }
      return {
        kind: event.payload.state === "error" ? "runtime_error" : "runtime_warning",
        severity: event.payload.state === "error" ? "error" : "info",
        summary:
          event.payload.state === "error"
            ? `${actor} thread entered an error state.`
            : `${actor} context was compacted.`,
        detail: unknownToDetail(event.payload.detail),
        retryBehavior: event.payload.state === "error" ? "automatic" : "not_applicable",
      };
    case "item.started":
      if (!isToolLifecycleItemType(event.payload.itemType)) return null;
      return {
        kind: "tool_started",
        severity: "info",
        summary: event.payload.title ?? `${actor} started ${event.payload.itemType}.`,
        detail: event.payload.detail ?? null,
        retryBehavior: "not_applicable",
      };
    case "item.completed":
      if (!isToolLifecycleItemType(event.payload.itemType)) return null;
      return {
        kind: "tool_completed",
        severity: event.payload.status === "failed" ? "warning" : "info",
        summary: event.payload.title ?? `${actor} finished ${event.payload.itemType}.`,
        detail: event.payload.detail ?? null,
        retryBehavior: event.payload.status === "failed" ? "automatic" : "not_applicable",
      };
    default:
      return null;
  }
};

const draftForDomainEvent = (
  event: OrchestrationEvent,
  correlation: PresenceThreadCorrelation,
): MissionEventDraft | null => {
  const actor = roleLabel(correlation);
  switch (event.type) {
    case "thread.turn-start-requested":
      return {
        kind: "turn_started",
        severity: "info",
        summary: `${actor} turn queued.`,
        detail: event.payload.titleSeed ?? null,
        retryBehavior: "not_applicable",
      };
    case "thread.activity-appended":
      if (
        event.payload.activity.kind === "runtime.error" ||
        event.payload.activity.kind === "approval.requested"
      ) {
        return null;
      }
      if (event.payload.activity.tone !== "error" && event.payload.activity.tone !== "approval") {
        return null;
      }
      return {
        kind: event.payload.activity.tone === "approval" ? "approval_requested" : "runtime_error",
        severity: event.payload.activity.tone === "approval" ? "warning" : "error",
        summary: event.payload.activity.summary,
        detail: unknownToDetail(event.payload.activity.payload),
        retryBehavior: event.payload.activity.tone === "approval" ? "manual" : "automatic",
        humanAction:
          event.payload.activity.tone === "approval" ? "Review the requested approval." : null,
      };
    default:
      return null;
  }
};

export { runtimeEventDedupeKey };

export const runtimeObservationForEvent = (
  event: ProviderRuntimeEvent,
  correlation: PresenceThreadCorrelation,
): RuntimeObservationDraft => {
  const bridgeReport = buildPresenceToolBridgeReport(event, correlation);
  if (bridgeReport._tag !== "none") {
    return { _tag: "agent_report", input: bridgeReport.input };
  }
  const draft = draftForRuntimeEvent(event, correlation);
  if (!draft) return { _tag: "none" };
  return {
    _tag: "mission_event",
    draft,
    dedupeKey: runtimeEventDedupeKey(event),
  };
};

export const makePresenceObservationService = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const providerService = yield* ProviderService;
  const store = makePresenceStore({ sql, nowIso });
  const missionControl = makePresenceMissionControl({
    nowIso,
    writeMissionEvent: store.writeMissionEvent,
  });

  const writeFromRuntimeEvent = (event: ProviderRuntimeEvent) =>
    Effect.gen(function* () {
      const correlation = yield* store.readPresenceThreadCorrelation(event.threadId);
      if (!correlation) return;
      const observation = runtimeObservationForEvent(event, correlation);
      if (observation._tag === "agent_report") {
        yield* missionControl.recordAgentReport(observation.input);
        return;
      }
      if (observation._tag === "none") return;
      yield* store.writeMissionEvent({
        boardId: correlation.boardId,
        ticketId: correlation.ticketId,
        attemptId: correlation.attemptId,
        reviewArtifactId: correlation.reviewArtifactId,
        supervisorRunId: correlation.supervisorRunId,
        threadId: event.threadId,
        kind: observation.draft.kind,
        severity: observation.draft.severity,
        summary: observation.draft.summary,
        detail: observation.draft.detail ?? null,
        retryBehavior: observation.draft.retryBehavior,
        humanAction: observation.draft.humanAction ?? null,
        dedupeKey: observation.dedupeKey,
        createdAt: event.createdAt,
      });
    }).pipe(
      Effect.catch((error: unknown) =>
        Effect.logWarning("Presence observation failed to ingest provider event", {
          eventId: event.eventId,
          eventType: event.type,
          error: describeUnknownError(error),
        }),
      ),
    );

  const writeFromDomainEvent = (event: OrchestrationEvent) =>
    Effect.gen(function* () {
      if (event.aggregateKind !== "thread") return;
      const correlation = yield* store.readPresenceThreadCorrelation(String(event.aggregateId));
      if (!correlation) return;
      const draft = draftForDomainEvent(event, correlation);
      if (!draft) return;
      yield* store.writeMissionEvent({
        boardId: correlation.boardId,
        ticketId: correlation.ticketId,
        attemptId: correlation.attemptId,
        reviewArtifactId: correlation.reviewArtifactId,
        supervisorRunId: correlation.supervisorRunId,
        threadId: String(event.aggregateId),
        kind: draft.kind,
        severity: draft.severity,
        summary: draft.summary,
        detail: draft.detail ?? null,
        retryBehavior: draft.retryBehavior,
        humanAction: draft.humanAction ?? null,
        dedupeKey: `domain:${event.eventId}`,
        createdAt: event.occurredAt,
      });
    }).pipe(
      Effect.catch((error: unknown) =>
        Effect.logWarning("Presence observation failed to ingest orchestration event", {
          eventId: event.eventId,
          eventType: event.type,
          error: describeUnknownError(error),
        }),
      ),
    );

  const start: PresenceObservationServiceShape["start"] = () =>
    Effect.gen(function* () {
      yield* Effect.forkScoped(
        Stream.runForEach(providerService.streamEvents, writeFromRuntimeEvent),
      );
      yield* Effect.forkScoped(
        Stream.runForEach(orchestrationEngine.streamDomainEvents, writeFromDomainEvent),
      );
    });

  return { start } satisfies PresenceObservationServiceShape;
});

export const PresenceObservationServiceLive = Layer.effect(
  PresenceObservationService,
  makePresenceObservationService,
);
