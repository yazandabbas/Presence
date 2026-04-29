import {
  AttemptId,
  BoardId,
  EventId,
  MissionEventId,
  type PresenceMissionEventRecord,
  ThreadId,
  type ProviderRuntimeEvent,
  RuntimeItemId,
  RuntimeRequestId,
  TicketId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildPresenceToolBridgeReport,
  extractPresenceToolCall,
  latestToolReviewResultForThread,
  latestToolWorkerHandoffForThread,
  type PresenceToolThreadCorrelation,
} from "./PresenceToolBridge.ts";

const correlation: PresenceToolThreadCorrelation = {
  role: "worker",
  boardId: BoardId.make("board_1"),
  ticketId: TicketId.make("ticket_1"),
  attemptId: "attempt_1",
  reviewArtifactId: null,
  supervisorRunId: null,
};

const baseRuntimeEvent = {
  eventId: EventId.make("event_1"),
  provider: "codex",
  threadId: ThreadId.make("thread_1"),
  createdAt: "2026-04-24T00:00:00.000Z",
} as const;

const requestEvent = (
  args: unknown,
  detail = "presence.report_progress",
): ProviderRuntimeEvent => ({
  ...baseRuntimeEvent,
  eventId: EventId.make("event_request"),
  requestId: RuntimeRequestId.make("request_1"),
  type: "request.opened",
  payload: {
    requestType: "dynamic_tool_call",
    detail,
    args,
  },
});

const requestEventWithoutRuntimeIdentity = (
  args: unknown,
  eventId: string,
): ProviderRuntimeEvent => ({
  ...baseRuntimeEvent,
  eventId: EventId.make(eventId),
  type: "request.opened",
  payload: {
    requestType: "dynamic_tool_call",
    detail: "presence.report_progress",
    args,
  },
});

const itemEvent = (data: unknown): ProviderRuntimeEvent => ({
  ...baseRuntimeEvent,
  eventId: EventId.make("event_item"),
  itemId: RuntimeItemId.make("item_1"),
  type: "item.completed",
  payload: {
    itemType: "dynamic_tool_call",
    status: "completed",
    title: "presence.submit_review_result",
    data,
  },
});

describe("PresenceToolBridge", () => {
  it("extracts Presence tool calls from provider request payloads", () => {
    const event = requestEvent({
      toolName: "presence.report_progress",
      input: {
        summary: "Implemented the next concrete change.",
        nextAction: "Review the diff.",
      },
      toolUseId: "call_1",
    });

    const call = extractPresenceToolCall(event);

    expect(call?.toolName).toBe("presence.report_progress");
    expect(call?.callId).toBe("call_1");
  });

  it("turns worker progress tools into typed mission reports", () => {
    const result = buildPresenceToolBridgeReport(
      requestEvent({
        toolName: "presence.report_progress",
        input: {
          summary: "Worker updated the repository guide.",
          details: "Inspected the existing docs first.",
          evidence: [
            {
              kind: "file_inspection",
              target: "README.md",
              outcome: "passed",
              relevant: true,
              summary: "README contains the documented workflow.",
              details: null,
            },
          ],
          nextAction: "Ask for review.",
        },
        toolUseId: "call_progress",
      }),
      correlation,
    );

    expect(result._tag).toBe("record");
    if (result._tag !== "record") return;
    expect(result.input.kind).toBe("worker_handoff");
    expect(result.input.report.kind).toBe("worker_progress");
    expect(result.input.dedupeKey).toContain("call_progress");
    expect(result.input.report.evidence).toHaveLength(1);
  });

  it("turns blocker tools into manual mission blockers", () => {
    const result = buildPresenceToolBridgeReport(
      requestEvent({
        toolName: "presence.report_blocker",
        input: {
          summary: "Provider account needs attention.",
          details: "The selected harness is not signed in.",
          blockers: ["Authentication is missing."],
          humanAction: "Sign in to the selected provider before retrying.",
          retryBehavior: "manual",
        },
        toolUseId: "call_blocker",
      }),
      correlation,
    );

    expect(result._tag).toBe("record");
    if (result._tag !== "record") return;
    expect(result.input.kind).toBe("human_blocker");
    expect(result.input.retryBehavior).toBe("manual");
    expect(result.input.humanAction).toBe("Sign in to the selected provider before retrying.");
    expect(result.input.report.kind).toBe("blocker");
    expect(result.input.report.blockers).toEqual(["Authentication is missing."]);
  });

  it("turns evidence tools into typed evidence reports", () => {
    const result = buildPresenceToolBridgeReport(
      requestEvent({
        toolName: "presence.record_evidence",
        input: {
          summary: "Validated the changed command path.",
          details: "Focused test passed.",
          evidence: [
            {
              kind: "command",
              target: "bun run test src/presence/example.test.ts",
              outcome: "passed",
              relevant: true,
              summary: "Focused Presence test passed.",
              details: null,
            },
          ],
          nextAction: "Hand off for review.",
        },
        toolUseId: "call_evidence",
      }),
      correlation,
    );

    expect(result._tag).toBe("record");
    if (result._tag !== "record") return;
    expect(result.input.kind).toBe("tool_completed");
    expect(result.input.report.kind).toBe("evidence");
    expect(result.input.report.evidence[0]?.kind).toBe("command");
    expect(result.input.report.nextAction).toBe("Hand off for review.");
  });

  it("dedupes replayed Presence tool payloads without provider call IDs", () => {
    const args = {
      toolName: "presence.report_progress",
      input: {
        summary: "Worker updated the repository guide.",
        details: "Inspected the existing docs first.",
        nextAction: "Ask for review.",
      },
    };
    const first = buildPresenceToolBridgeReport(
      requestEventWithoutRuntimeIdentity(args, "event_replay_1"),
      correlation,
    );
    const replay = buildPresenceToolBridgeReport(
      requestEventWithoutRuntimeIdentity(
        {
          input: {
            nextAction: "Ask for review.",
            details: "Inspected the existing docs first.",
            summary: "Worker updated the repository guide.",
          },
          toolName: "presence.report_progress",
        },
        "event_replay_2",
      ),
      correlation,
    );

    expect(first._tag).toBe("record");
    expect(replay._tag).toBe("record");
    if (first._tag !== "record" || replay._tag !== "record") return;
    expect(first.input.dedupeKey).toBe(replay.input.dedupeKey);
    expect(first.input.dedupeKey).toContain("payload-");
  });

  it("turns review-result tools into reviewer decision reports", () => {
    const result = buildPresenceToolBridgeReport(
      itemEvent({
        tool: "presence.submit_review_result",
        state: {
          input: {
            decision: "accept",
            summary: "The implementation satisfies the ticket.",
            checklistAssessment: [
              {
                label: "Mechanism understood",
                satisfied: true,
                notes: "The changed file was inspected.",
              },
            ],
            evidence: [
              {
                kind: "file_inspection",
                target: "src/example.ts",
                outcome: "passed",
                relevant: true,
                summary: "The changed code matches the ticket intent.",
                details: null,
              },
            ],
            changedFilesReviewed: ["src/example.ts"],
          },
        },
      }),
      { ...correlation, role: "review" },
    );

    expect(result._tag).toBe("record");
    if (result._tag !== "record") return;
    expect(result.input.kind).toBe("review_result");
    expect(result.input.severity).toBe("success");
    expect(result.input.report.kind).toBe("reviewer_decision");
    expect(result.input.report.decision).toBe("accept");
  });

  it("reconstructs review results from typed mission events for supervisor fallback", () => {
    const result = buildPresenceToolBridgeReport(
      itemEvent({
        tool: "presence.submit_review_result",
        state: {
          input: {
            decision: "request_changes",
            summary: "The attempt needs one correction.",
            checklistAssessment: [
              {
                label: "Evidence attached",
                satisfied: false,
                notes: "The changed file was not reviewed deeply enough.",
              },
            ],
            findings: [
              {
                severity: "blocking",
                disposition: "same_ticket",
                summary: "Missing evidence for the changed behavior.",
                rationale: "The reviewer could not verify the behavior from the diff.",
              },
            ],
            evidence: [
              {
                kind: "diff_review",
                target: "src/example.ts",
                outcome: "failed",
                relevant: true,
                summary: "Diff review found missing coverage.",
                details: null,
              },
            ],
            changedFilesReviewed: ["src/example.ts"],
          },
        },
      }),
      { ...correlation, role: "review" },
    );
    expect(result._tag).toBe("record");
    if (result._tag !== "record") return;
    const event: PresenceMissionEventRecord = {
      id: MissionEventId.make("mission_event_1"),
      boardId: BoardId.make(result.input.boardId),
      ticketId: TicketId.make(result.input.ticketId ?? "ticket_1"),
      attemptId: null,
      reviewArtifactId: null,
      supervisorRunId: null,
      threadId: ThreadId.make(result.input.threadId ?? "thread_1"),
      kind: result.input.kind,
      severity: result.input.severity ?? "info",
      summary: result.input.summary,
      detail: result.input.detail ?? null,
      retryBehavior: result.input.retryBehavior ?? "not_applicable",
      humanAction: result.input.humanAction ?? null,
      dedupeKey: result.input.dedupeKey,
      report: result.input.report,
      createdAt: result.input.createdAt ?? "2026-04-24T00:00:00.000Z",
    };

    const parsed = latestToolReviewResultForThread([event], "thread_1");

    expect(parsed?.decision).toBe("request_changes");
    expect(parsed?.findings[0]?.summary).toBe("Missing evidence for the changed behavior.");
    expect(parsed?.changedFilesReviewed).toEqual(["src/example.ts"]);
  });

  it("reconstructs worker handoffs from typed mission events for assistant-block fallback", () => {
    const result = buildPresenceToolBridgeReport(
      requestEvent({
        toolName: "presence.report_progress",
        input: {
          summary: "Implemented the repository guide update.",
          details: "The worker inspected the existing docs and updated README.md.",
          evidence: [
            {
              kind: "command",
              target: "bun run test PresenceAttemptService.test.ts",
              outcome: "passed",
              relevant: true,
              summary: "Focused Presence attempt test passed.",
              details: null,
            },
          ],
          nextAction: "Request reviewer validation.",
        },
        toolUseId: "call_worker_handoff",
      }),
      correlation,
    );
    expect(result._tag).toBe("record");
    if (result._tag !== "record") return;
    const event: PresenceMissionEventRecord = {
      id: MissionEventId.make("mission_event_worker_handoff"),
      boardId: BoardId.make(result.input.boardId),
      ticketId: TicketId.make(result.input.ticketId ?? "ticket_1"),
      attemptId: AttemptId.make(result.input.attemptId ?? "attempt_1"),
      reviewArtifactId: null,
      supervisorRunId: null,
      threadId: ThreadId.make(result.input.threadId ?? "thread_1"),
      kind: result.input.kind,
      severity: result.input.severity ?? "info",
      summary: result.input.summary,
      detail: result.input.detail ?? null,
      retryBehavior: result.input.retryBehavior ?? "not_applicable",
      humanAction: result.input.humanAction ?? null,
      dedupeKey: "worker-handoff:handoff_legacy",
      report: result.input.report,
      createdAt: result.input.createdAt ?? "2026-04-24T00:00:00.000Z",
    };

    expect(
      latestToolWorkerHandoffForThread([event], {
        threadId: "thread_1",
        attemptId: "attempt_1",
      }),
    ).toBeNull();

    const parsed = latestToolWorkerHandoffForThread(
      [{ ...event, dedupeKey: result.input.dedupeKey }],
      {
        threadId: "thread_1",
        attemptId: "attempt_1",
      },
    );

    expect(parsed?.source).toBe("tool_report");
    expect(parsed?.completedWork).toEqual(["Implemented the repository guide update."]);
    expect(parsed?.currentHypothesis).toBe(
      "The worker inspected the existing docs and updated README.md.",
    );
    expect(parsed?.testsRun).toEqual(["bun run test PresenceAttemptService.test.ts"]);
    expect(parsed?.nextStep).toBe("Request reviewer validation.");
  });

  it("creates actionable malformed reports for invalid Presence tool payloads", () => {
    const result = buildPresenceToolBridgeReport(
      requestEvent({
        toolName: "presence.report_blocker",
        input: {
          details: "Missing required summary.",
        },
        toolUseId: "call_bad",
      }),
      correlation,
    );

    expect(result._tag).toBe("malformed");
    if (result._tag !== "malformed") return;
    expect(result.input.kind).toBe("runtime_warning");
    expect(result.input.retryBehavior).toBe("manual");
    expect(result.input.humanAction).toMatch(/resend/i);
    expect(result.input.report.kind).toBe("blocker");
  });

  it("ignores non-Presence runtime tool calls", () => {
    const result = buildPresenceToolBridgeReport(
      requestEvent(
        {
          toolName: "shell.run",
          input: {
            command: "git status",
          },
        },
        "shell.run",
      ),
      correlation,
    );

    expect(result._tag).toBe("none");
  });
});
