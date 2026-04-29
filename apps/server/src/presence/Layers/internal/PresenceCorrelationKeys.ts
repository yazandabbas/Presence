import type { ProviderRuntimeEvent } from "@t3tools/contracts";

import { stableHash } from "./PresenceShared.ts";

type PresenceCorrelationContext = Readonly<{
  boardId?: string | null;
  ticketId?: string | null;
  attemptId?: string | null;
  reviewArtifactId?: string | null;
  supervisorRunId?: string | null;
  threadId?: string | null;
}>;

type PresenceCorrelationPart =
  | string
  | number
  | boolean
  | null
  | undefined
  | ReadonlyArray<string | number | boolean | null | undefined>;

const normalizeCorrelationPart = (value: PresenceCorrelationPart): string => {
  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => normalizeCorrelationPart(item))
      .filter((item) => item !== "none")
      .join("+");
    return normalized || "none";
  }
  if (value === null || value === undefined) return "none";
  const raw = String(value).trim();
  if (!raw) return "none";
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9_.:-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 128) || "none"
  );
};

const correlationKey = (
  namespace: string,
  ...parts: ReadonlyArray<PresenceCorrelationPart>
): string =>
  [normalizeCorrelationPart(namespace), ...parts.map(normalizeCorrelationPart)].join(":");

const providerRuntimeEventSourceId = (event: ProviderRuntimeEvent): string =>
  String(
    event.providerRefs?.providerRequestId ??
      event.providerRefs?.providerItemId ??
      event.requestId ??
      event.itemId ??
      event.turnId ??
      `payload-${stableHash({
        createdAt: event.createdAt,
        payload: event.payload,
        type: event.type,
      })}`,
  );

const runtimeEventDedupeKey = (event: ProviderRuntimeEvent): string =>
  correlationKey("runtime", event.threadId, event.type, providerRuntimeEventSourceId(event));

const missionEventDedupeKey = (
  namespace: string,
  ...parts: ReadonlyArray<PresenceCorrelationPart>
): string => correlationKey(namespace, ...parts);

const operationLedgerDedupeKey = (
  namespace: string,
  ...parts: ReadonlyArray<PresenceCorrelationPart>
): string => correlationKey(namespace, ...parts);

const operationScopeKey = (boardId?: string | null): string =>
  boardId ? correlationKey("board", boardId) : "global";

const missionRuntimeBlockerKey = (ticketId: string, missionEventId: string): string =>
  missionEventDedupeKey("manual-runtime-blocker", ticketId, missionEventId);

const missionRestartKey = (kind: "worker" | "review", attemptId: string, reason: string): string =>
  missionEventDedupeKey(`${kind}-restart`, attemptId, normalizeCorrelationPart(reason));

const missionWorkerContinuationKey = (attemptId: string, reason: string): string =>
  missionEventDedupeKey("worker-continuation", attemptId, normalizeCorrelationPart(reason));

const operationMissionEventKey = (missionEventDedupe: string): string =>
  operationLedgerDedupeKey("mission-event", missionEventDedupe);

const operationMergeKey = (mergeOperationId: string): string =>
  operationLedgerDedupeKey("merge-operation", mergeOperationId);

const operationReviewArtifactKey = (reviewArtifactId: string): string =>
  operationLedgerDedupeKey("review-artifact", reviewArtifactId);

const operationWorkspaceCleanupKey = (attemptId: string): string =>
  operationLedgerDedupeKey("workspace-cleanup", attemptId);

const threadCorrelationSource = (
  source:
    | "attempt_session_created"
    | "attempt_session_reused"
    | "attempt_thread_attached"
    | "review_session_queued"
    | "review_session_created"
    | "review_failure_artifact"
    | "review_result_artifact"
    | "supervisor_active_thread",
): string => source;

export {
  correlationKey,
  missionEventDedupeKey,
  missionRestartKey,
  missionRuntimeBlockerKey,
  missionWorkerContinuationKey,
  normalizeCorrelationPart,
  operationLedgerDedupeKey,
  operationMergeKey,
  operationMissionEventKey,
  operationReviewArtifactKey,
  operationScopeKey,
  operationWorkspaceCleanupKey,
  runtimeEventDedupeKey,
  threadCorrelationSource,
};
export type { PresenceCorrelationContext };
