import {
  EventId,
  RuntimeRequestId,
  ThreadId,
  TurnId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  correlationKey,
  missionEventDedupeKey,
  missionRestartKey,
  missionRuntimeBlockerKey,
  missionWorkerContinuationKey,
  normalizeCorrelationPart,
  operationMergeKey,
  operationMissionEventKey,
  operationReviewArtifactKey,
  operationScopeKey,
  operationWorkspaceCleanupKey,
  runtimeEventDedupeKey,
  threadCorrelationSource,
} from "./PresenceCorrelationKeys.ts";

const runtimeErrorEvent = (
  eventId: string,
  payload: { readonly message: string },
  createdAt = "2026-04-28T00:00:00.000Z",
): ProviderRuntimeEvent => ({
  eventId: EventId.make(eventId),
  provider: "codex",
  threadId: ThreadId.make("thread_1"),
  createdAt,
  type: "runtime.error",
  payload,
});

describe("PresenceCorrelationKeys", () => {
  it("normalizes arbitrary labels into stable low-cardinality key parts", () => {
    expect(normalizeCorrelationPart(" Retry review with Codex! ")).toBe("retry-review-with-codex");
    expect(normalizeCorrelationPart(["Ticket 1", null, "Attempt 2"])).toBe("ticket-1+attempt-2");
    expect(correlationKey("Review Result", "Ticket 1", "Attempt 2")).toBe(
      "review-result:ticket-1:attempt-2",
    );
  });

  it("keeps runtime replay keys stable when event ids change", () => {
    const first = runtimeErrorEvent("event_1", { message: "Realtime channel failed." });
    const replay = runtimeErrorEvent("event_2", { message: "Realtime channel failed." });

    expect(runtimeEventDedupeKey(first)).toBe(runtimeEventDedupeKey(replay));
  });

  it("does not collapse repeated fallback events that happen at different times", () => {
    const first = runtimeErrorEvent(
      "event_1",
      { message: "Realtime channel failed." },
      "2026-04-28T00:00:00.000Z",
    );
    const later = runtimeErrorEvent(
      "event_2",
      { message: "Realtime channel failed." },
      "2026-04-28T00:01:00.000Z",
    );

    expect(runtimeEventDedupeKey(first)).not.toBe(runtimeEventDedupeKey(later));
  });

  it("prefers provider/request identity over payload hashes", () => {
    const first: ProviderRuntimeEvent = {
      eventId: EventId.make("event_1"),
      provider: "codex",
      threadId: ThreadId.make("thread_1"),
      turnId: TurnId.make("turn_1"),
      createdAt: "2026-04-28T00:00:00.000Z",
      requestId: RuntimeRequestId.make("request_1"),
      type: "request.opened",
      payload: {
        requestType: "command_execution_approval",
        detail: "Allow command?",
        args: null,
      },
    };
    const replay = {
      ...first,
      eventId: EventId.make("event_2"),
    };

    expect(runtimeEventDedupeKey(first)).toBe("runtime:thread_1:request.opened:request_1");
    expect(runtimeEventDedupeKey(replay)).toBe(runtimeEventDedupeKey(first));
  });

  it("shares canonical builders for mission, operation, and thread source keys", () => {
    expect(missionEventDedupeKey("review-result", "artifact_1")).toBe("review-result:artifact_1");
    expect(missionRuntimeBlockerKey("ticket_1", "mission_event_1")).toBe(
      "manual-runtime-blocker:ticket_1:mission_event_1",
    );
    expect(missionRestartKey("review", "attempt_1", "Reviewer timed out!")).toBe(
      "review-restart:attempt_1:reviewer-timed-out",
    );
    expect(missionWorkerContinuationKey("attempt_1", "Fix failing test")).toBe(
      "worker-continuation:attempt_1:fix-failing-test",
    );
    expect(operationScopeKey(null)).toBe("global");
    expect(operationScopeKey("board_1")).toBe("board:board_1");
    expect(operationMissionEventKey("runtime:thread_1:turn.completed:turn_1")).toBe(
      "mission-event:runtime:thread_1:turn.completed:turn_1",
    );
    expect(operationMergeKey("merge_1")).toBe("merge-operation:merge_1");
    expect(operationReviewArtifactKey("review_artifact_1")).toBe(
      "review-artifact:review_artifact_1",
    );
    expect(operationWorkspaceCleanupKey("attempt_1")).toBe("workspace-cleanup:attempt_1");
    expect(threadCorrelationSource("attempt_session_created")).toBe("attempt_session_created");
    expect(threadCorrelationSource("attempt_session_reused")).toBe("attempt_session_reused");
    expect(threadCorrelationSource("attempt_thread_attached")).toBe("attempt_thread_attached");
    expect(threadCorrelationSource("review_session_queued")).toBe("review_session_queued");
    expect(threadCorrelationSource("review_failure_artifact")).toBe("review_failure_artifact");
    expect(threadCorrelationSource("review_result_artifact")).toBe("review_result_artifact");
    expect(threadCorrelationSource("review_session_created")).toBe("review_session_created");
    expect(threadCorrelationSource("supervisor_active_thread")).toBe("supervisor_active_thread");
  });
});
