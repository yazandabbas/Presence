import type { BoardSnapshot, PresenceOperationRecord, TicketRecord } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildPresenceObservabilityViewModel } from "./PresenceObservabilityViewModel";

const now = Date.parse("2026-04-29T12:00:00.000Z");

function operation(
  input: Omit<Partial<PresenceOperationRecord>, "id" | "kind" | "status" | "summary"> &
    Readonly<{
      id: string;
      kind: PresenceOperationRecord["kind"];
      status: PresenceOperationRecord["status"];
      summary: string;
    }>,
): PresenceOperationRecord {
  return {
    parentOperationId: null,
    boardId: "board_1" as never,
    ticketId: null,
    attemptId: null,
    reviewArtifactId: null,
    supervisorRunId: null,
    threadId: null,
    phase: "finish",
    dedupeKey: input.id,
    details: {},
    counters: [],
    error: null,
    startedAt: "2026-04-29T11:59:00.000Z",
    completedAt: input.status === "running" ? null : "2026-04-29T11:59:30.000Z",
    durationMs: input.status === "running" ? null : 30_000,
    createdAt: "2026-04-29T11:59:00.000Z",
    updatedAt: "2026-04-29T11:59:30.000Z",
    ...input,
  } as unknown as PresenceOperationRecord;
}

function board(operationLedger: readonly PresenceOperationRecord[]): BoardSnapshot {
  return {
    operationLedger,
    missionEvents: [],
    ticketBriefings: [],
    missionBriefing: null,
    controllerState: null,
  } as unknown as BoardSnapshot;
}

describe("Presence observability view model", () => {
  it("summarizes active, failed, recent, and ticket-scoped operations", () => {
    const ticket = { id: "ticket_1" } as TicketRecord;
    const model = buildPresenceObservabilityViewModel({
      board: board([
        operation({
          id: "presence_operation_running",
          kind: "worker_attempt",
          status: "running",
          summary: "Worker is streaming a handoff.",
          ticketId: "ticket_1" as never,
        }),
        operation({
          id: "presence_operation_failed",
          kind: "projection_sync",
          status: "failed",
          summary: "Projection sync failed.",
          error: {
            code: "projection_sync_failed",
            message: "Could not write projection.",
            detail: null,
          },
        }),
        operation({
          id: "presence_operation_completed",
          kind: "review_run",
          status: "completed",
          summary: "Review accepted the work.",
          ticketId: "ticket_1" as never,
          details: { reviewerKind: "review_agent", decision: "accept", prompt: "hidden" },
        }),
      ]),
      ticket,
      now,
    });

    expect(model.headline).toBe("1 operation running");
    expect(model.active[0]?.label).toBe("Worker");
    expect(model.failed[0]?.errorSummary).toBe("Could not write projection.");
    expect(model.recent[0]?.durationLabel).toBe("30s");
    expect(model.ticketTrace.map((item) => item.id)).toEqual([
      "presence_operation_running",
      "presence_operation_completed",
    ]);
    expect(model.ticketTrace[1]?.safeDetails).toEqual([
      "reviewerKind: review_agent",
      "decision: accept",
    ]);
  });

  it("surfaces skipped, cancelled, and aged running operations without treating them as failures", () => {
    const model = buildPresenceObservabilityViewModel({
      board: board([
        operation({
          id: "presence_operation_stalled",
          kind: "provider_runtime_observation",
          status: "running",
          summary: "Waiting for the provider stream to resume.",
          startedAt: "2026-04-29T10:00:00.000Z",
          updatedAt: "2026-04-29T10:00:00.000Z",
          completedAt: null,
          durationMs: null,
          details: {
            retryBehavior: "automatic",
            humanAction: "hidden",
            detail: "hidden",
          },
        }),
        operation({
          id: "presence_operation_skipped",
          kind: "repo_brain_projection",
          status: "skipped",
          summary: "Repo-brain projection skipped because no repository exists.",
          details: { retryBehavior: "not_applicable" },
        }),
        operation({
          id: "presence_operation_cancelled",
          kind: "command_dispatch",
          status: "cancelled",
          summary: "Workspace cleanup interrupted the attempt.",
          details: { cleanupWorktreeDone: true, cleanupThreadDone: true },
        }),
      ]),
      now,
    });

    expect(model.headline).toBe("1 operation running");
    expect(model.active[0]).toMatchObject({
      id: "presence_operation_stalled",
      statusLabel: "Running",
      tone: "info",
      timestampLabel: "2h ago",
      durationLabel: null,
      safeDetails: ["retryBehavior: automatic"],
    });
    expect(model.failed).toEqual([]);
    expect(model.recent.map((item) => item.id)).toEqual([
      "presence_operation_skipped",
      "presence_operation_cancelled",
    ]);
    expect(model.recent.map((item) => item.tone)).toEqual(["warning", "neutral"]);
    expect(model.recent[1]?.safeDetails).toEqual([
      "cleanupWorktreeDone: true",
      "cleanupThreadDone: true",
    ]);
  });

  it("returns a useful empty state before the ledger has activity", () => {
    const model = buildPresenceObservabilityViewModel({ board: board([]), now });

    expect(model.headline).toBe("No operations recorded yet");
    expect(model.active).toEqual([]);
    expect(model.failed).toEqual([]);
    expect(model.recent).toEqual([]);
  });
});
