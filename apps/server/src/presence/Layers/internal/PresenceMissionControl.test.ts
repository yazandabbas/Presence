import {
  BoardId,
  MissionEventId,
  TicketId,
  type PresenceMissionEventRecord,
} from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { makePresenceMissionControl } from "./PresenceMissionControl.ts";

const missionEvent = (
  input: Omit<Partial<PresenceMissionEventRecord>, "id" | "boardId" | "ticketId"> & {
    id: string;
    boardId?: string;
    ticketId?: string | null;
    dedupeKey: string;
    summary?: string;
  },
): PresenceMissionEventRecord => ({
  id: MissionEventId.make(input.id),
  boardId: BoardId.make(input.boardId ?? "board_1"),
  ticketId:
    input.ticketId === undefined
      ? TicketId.make("ticket_1")
      : input.ticketId === null
        ? null
        : TicketId.make(input.ticketId),
  attemptId: null,
  reviewArtifactId: null,
  supervisorRunId: null,
  threadId: null,
  kind: input.kind ?? "runtime_error",
  severity: input.severity ?? "error",
  summary: input.summary ?? "Runtime failed.",
  detail: input.detail ?? null,
  retryBehavior: input.retryBehavior ?? "automatic",
  humanAction: input.humanAction ?? null,
  dedupeKey: input.dedupeKey,
  report: null,
  createdAt: input.createdAt ?? "2026-04-24T00:00:00.000Z",
});

describe("PresenceMissionControl", () => {
  it("turns manual runtime failures into human blocker decisions", () => {
    const control = makePresenceMissionControl({
      nowIso: () => "2026-04-24T00:00:00.000Z",
      writeMissionEvent: () => Effect.die("not used"),
    });
    const decision = control.manualRuntimeBlockerDecision({
      ticketId: "ticket_1",
      attemptId: "attempt_1",
      recentEvents: [
        missionEvent({
          id: "mission_event_auth",
          dedupeKey: "runtime:event-auth",
          retryBehavior: "manual",
          humanAction: "Sign in to Codex.",
          detail: "Invalid account/read payload.",
        }),
      ],
    });

    expect(decision?.action.type).toBe("mark_human_blocker");
    expect(decision?.retryBehavior).toBe("manual");
    expect(decision?.summary).toMatch(/harness\/account/i);
  });

  it("allows one restart and then escalates repeated restart reasons", () => {
    const control = makePresenceMissionControl({
      nowIso: () => "2026-04-24T00:00:00.000Z",
      writeMissionEvent: () => Effect.die("not used"),
    });
    const first = control.restartDecision({
      kind: "review",
      ticketId: "ticket_1",
      attemptId: "attempt_1",
      reason: "The previous review thread never started a turn.",
      recentEvents: [],
    });
    expect(first.action.type).toBe("restart_review");

    const second = control.restartDecision({
      kind: "review",
      ticketId: "ticket_1",
      attemptId: "attempt_1",
      reason: "The previous review thread never started a turn.",
      recentEvents: [
        missionEvent({
          id: "mission_event_restart",
          kind: "retry_queued",
          dedupeKey:
            "review-restart:attempt_1:the-previous-review-thread-never-started-a-turn",
        }),
      ],
    });
    expect(second.action.type).toBe("mark_human_blocker");
    expect(second.retryBehavior).toBe("manual");
  });

  it("suppresses duplicate worker continuations for the same feedback", () => {
    const control = makePresenceMissionControl({
      nowIso: () => "2026-04-24T00:00:00.000Z",
      writeMissionEvent: () => Effect.die("not used"),
    });
    const decision = control.workerContinuationDecision({
      ticketId: "ticket_1",
      attemptId: "attempt_1",
      reason: "Review requested changes. Fix the missing file.",
      recentEvents: [
        missionEvent({
          id: "mission_event_continuation",
          kind: "retry_queued",
          dedupeKey: "worker-continuation:attempt_1:review-requested-changes-fix-the-missing-file",
        }),
      ],
    });

    expect(decision.action.type).toBe("mark_human_blocker");
    expect(decision.summary).toMatch(/suppressed/i);
  });
});
