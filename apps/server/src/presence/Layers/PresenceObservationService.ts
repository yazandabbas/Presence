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
import { makePresenceMissionControl } from "./internal/PresenceMissionControl.ts";
import { describeUnknownError, nowIso, truncateText } from "./internal/PresenceShared.ts";
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

const runtimeFailureRetry = (message: string): Pick<MissionEventDraft, "retryBehavior" | "humanAction"> => {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("auth") ||
    normalized.includes("login") ||
    normalized.includes("unauthorized") ||
    normalized.includes("not signed in") ||
    normalized.includes("account")
  ) {
    return {
      retryBehavior: "manual",
      humanAction: "Choose an authenticated Presence harness or sign in to the selected provider.",
    };
  }
  return { retryBehavior: "automatic" };
};

const draftForRuntimeEvent = (
  event: ProviderRuntimeEvent,
  correlation: PresenceThreadCorrelation,
): MissionEventDraft | null => {
  const actor = roleLabel(correlation);
  switch (event.type) {
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
        summary: failed ? `${actor} turn ended with ${event.payload.state}.` : `${actor} turn completed.`,
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
      const retry = runtimeFailureRetry(event.payload.message);
      return {
        kind: "runtime_error",
        severity: "error",
        summary: `${actor} runtime failed.`,
        detail: event.payload.message,
        ...retry,
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
          event.payload.activity.tone === "approval"
            ? "Review the requested approval."
            : null,
      };
    default:
      return null;
  }
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
      const bridgeReport = buildPresenceToolBridgeReport(event, correlation);
      if (bridgeReport._tag !== "none") {
        yield* missionControl.recordAgentReport(bridgeReport.input);
        return;
      }
      const draft = draftForRuntimeEvent(event, correlation);
      if (!draft) return;
      yield* store.writeMissionEvent({
        boardId: correlation.boardId,
        ticketId: correlation.ticketId,
        attemptId: correlation.attemptId,
        reviewArtifactId: correlation.reviewArtifactId,
        supervisorRunId: correlation.supervisorRunId,
        threadId: event.threadId,
        kind: draft.kind,
        severity: draft.severity,
        summary: draft.summary,
        detail: draft.detail ?? null,
        retryBehavior: draft.retryBehavior,
        humanAction: draft.humanAction ?? null,
        dedupeKey: `runtime:${event.eventId}`,
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
      yield* Effect.forkScoped(Stream.runForEach(providerService.streamEvents, writeFromRuntimeEvent));
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
