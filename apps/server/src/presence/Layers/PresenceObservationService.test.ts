import {
  BoardId,
  EventId,
  ProviderItemId,
  RuntimeRequestId,
  ThreadId,
  TicketId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { Effect, PubSub, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { describe, expect, it } from "vitest";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import {
  createGitRepository,
  createPresenceSystem,
  removeTempRepo,
} from "./PresenceControlPlaneTestSupport.ts";
import {
  makePresenceObservationService,
  runtimeEventDedupeKey,
  runtimeObservationForEvent,
} from "./PresenceObservationService.ts";
import { makePresenceStore } from "./internal/PresenceStore.ts";

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

describe("PresenceObservationService", () => {
  it("dedupes replayed runtime events by stable payload when event ids change", () => {
    const first = runtimeErrorEvent("event_1", { message: "Realtime channel failed." });
    const replay = runtimeErrorEvent("event_2", { message: "Realtime channel failed." });

    expect(runtimeEventDedupeKey(first)).toBe(runtimeEventDedupeKey(replay));
  });

  it("keeps repeated payload-fallback failures distinct when time advances", () => {
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

  it("prefers request identity over payload hashes when available", () => {
    const first: ProviderRuntimeEvent = {
      eventId: EventId.make("event_1"),
      provider: "codex",
      threadId: ThreadId.make("thread_1"),
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

  it("prefers provider refs over request identity for replayed provider events", () => {
    const first: ProviderRuntimeEvent = {
      eventId: EventId.make("event_1"),
      provider: "codex",
      threadId: ThreadId.make("thread_1"),
      createdAt: "2026-04-28T00:00:00.000Z",
      requestId: RuntimeRequestId.make("request_1"),
      providerRefs: {
        providerRequestId: "provider_request_1",
        providerItemId: ProviderItemId.make("provider_item_1"),
      },
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
      requestId: RuntimeRequestId.make("request_2"),
    };

    expect(runtimeEventDedupeKey(first)).toBe("runtime:thread_1:request.opened:provider_request_1");
    expect(runtimeEventDedupeKey(replay)).toBe(runtimeEventDedupeKey(first));
  });

  it("dedupes replayed runtime events through the live provider stream consumer", async () => {
    const repoRoot = await createGitRepository("presence-observation-live-replay-");
    const system = await createPresenceSystem();
    const store = makePresenceStore({ sql: system.sql, nowIso: () => "2026-04-28T00:00:00.000Z" });
    const runtimeEvents = Effect.runSync(PubSub.unbounded<ProviderRuntimeEvent>());
    const providerService = {
      startSession: () => Effect.die("unused"),
      sendTurn: () => Effect.die("unused"),
      interruptTurn: () => Effect.die("unused"),
      respondToRequest: () => Effect.die("unused"),
      respondToUserInput: () => Effect.die("unused"),
      stopSession: () => Effect.die("unused"),
      listSessions: () => Effect.succeed([]),
      getCapabilities: () => Effect.succeed({ sessionModelSwitch: "in-session" as const }),
      rollbackConversation: () => Effect.die("unused"),
      get streamEvents() {
        return Stream.fromPubSub(runtimeEvents);
      },
    } satisfies typeof ProviderService.Service;

    try {
      const repository = await system.presence
        .importRepository({
          workspaceRoot: repoRoot,
          title: "Presence Repo",
        })
        .pipe(Effect.runPromise);
      const ticket = await system.presence
        .createTicket({
          boardId: repository.boardId,
          title: "Observe replayed provider runtime event",
          description: "The live Presence observation stream should dedupe provider replay.",
          priority: "p2",
        })
        .pipe(Effect.runPromise);
      const attempt = await system.presence
        .createAttempt({
          ticketId: ticket.id,
        })
        .pipe(Effect.runPromise);
      const threadId = ThreadId.make("presence_live_observation_thread");
      await store
        .upsertPresenceThreadCorrelation({
          threadId,
          boardId: repository.boardId,
          role: "worker",
          ticketId: ticket.id,
          attemptId: attempt.id,
          source: "test_runtime_stream",
        })
        .pipe(Effect.runPromise);

      const event: ProviderRuntimeEvent = {
        eventId: EventId.make("runtime_replay_1"),
        provider: "codex",
        threadId,
        createdAt: "2026-04-28T00:00:00.000Z",
        requestId: RuntimeRequestId.make("request_replay"),
        type: "request.opened",
        payload: {
          requestType: "command_execution_approval",
          detail: "Allow command?",
          args: null,
        },
      };

      await Effect.gen(function* () {
        const observation = yield* makePresenceObservationService;
        yield* observation.start();
        yield* Effect.sleep(50);
        yield* PubSub.publish(runtimeEvents, event);
        yield* PubSub.publish(runtimeEvents, {
          ...event,
          eventId: EventId.make("runtime_replay_2"),
        });
        yield* Effect.sleep(200);
      }).pipe(
        Effect.provideService(SqlClient.SqlClient, system.sql),
        Effect.provideService(ProviderService, providerService),
        Effect.provideService(OrchestrationEngineService, system.orchestration.service),
        Effect.scoped,
        Effect.runPromise,
      );

      const rows = await system.sql<{ dedupeKey: string }>`
        SELECT dedupe_key as "dedupeKey"
        FROM presence_mission_events
        WHERE board_id = ${repository.boardId}
          AND kind = 'approval_requested'
      `.pipe(Effect.runPromise);

      expect(rows).toHaveLength(1);
      expect(rows[0]?.dedupeKey).toBe(
        "runtime:presence_live_observation_thread:request.opened:request_replay",
      );
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
      Effect.runSync(PubSub.shutdown(runtimeEvents));
    }
  });

  it("uses Presence tool reports before generic runtime request fallback", () => {
    const event: ProviderRuntimeEvent = {
      eventId: EventId.make("event_tool"),
      provider: "codex",
      threadId: ThreadId.make("thread_1"),
      createdAt: "2026-04-28T00:00:00.000Z",
      requestId: RuntimeRequestId.make("request_1"),
      type: "request.opened",
      payload: {
        requestType: "dynamic_tool_call",
        detail: "presence.report_progress",
        args: {
          toolName: "presence.report_progress",
          input: {
            summary: "Worker reported structured progress.",
            nextAction: "Continue with validation.",
          },
          toolUseId: "call_progress",
        },
      },
    };

    const observation = runtimeObservationForEvent(event, {
      role: "worker",
      boardId: BoardId.make("board_1"),
      ticketId: TicketId.make("ticket_1"),
      attemptId: "attempt_1",
      reviewArtifactId: null,
      supervisorRunId: null,
    });

    expect(observation._tag).toBe("agent_report");
    if (observation._tag !== "agent_report") return;
    expect(observation.input.kind).toBe("worker_handoff");
    expect(observation.input.summary).toBe("Worker reported structured progress.");
  });

  it("promotes provider runtime errors as provider-unavailable mission events", () => {
    const observation = runtimeObservationForEvent(
      {
        eventId: EventId.make("event_provider_error"),
        provider: "codex",
        threadId: ThreadId.make("thread_1"),
        createdAt: "2026-04-28T00:00:00.000Z",
        type: "runtime.error",
        payload: {
          message: "Codex App Server disconnected.",
          class: "transport_error",
        },
      },
      {
        role: "worker",
        boardId: BoardId.make("board_1"),
        ticketId: TicketId.make("ticket_1"),
        attemptId: "attempt_1",
        reviewArtifactId: null,
        supervisorRunId: null,
      },
    );

    expect(observation._tag).toBe("mission_event");
    if (observation._tag !== "mission_event") return;
    expect(observation.draft.kind).toBe("provider_unavailable");
    expect(observation.draft.severity).toBe("error");
    expect(observation.draft.retryBehavior).toBe("automatic");
    expect(observation.draft.summary).toBe("Worker provider runtime is unavailable.");
  });

  it("promotes auth status failures as manual provider-unavailable events", () => {
    const observation = runtimeObservationForEvent(
      {
        eventId: EventId.make("event_auth_failed"),
        provider: "codex",
        threadId: ThreadId.make("thread_1"),
        createdAt: "2026-04-28T00:00:00.000Z",
        type: "auth.status",
        payload: {
          error: "Not signed in.",
          output: ["Run codex login."],
        },
      },
      {
        role: "supervisor",
        boardId: BoardId.make("board_1"),
        ticketId: null,
        attemptId: null,
        reviewArtifactId: null,
        supervisorRunId: "supervisor_run_1",
      },
    );

    expect(observation._tag).toBe("mission_event");
    if (observation._tag !== "mission_event") return;
    expect(observation.draft.kind).toBe("provider_unavailable");
    expect(observation.draft.retryBehavior).toBe("manual");
    expect(observation.draft.humanAction).toBe(
      "Choose an authenticated Presence harness or sign in to the selected provider.",
    );
  });

  it("promotes session error state into provider-unavailable mission events", () => {
    const observation = runtimeObservationForEvent(
      {
        eventId: EventId.make("event_session_error"),
        provider: "codex",
        threadId: ThreadId.make("thread_1"),
        createdAt: "2026-04-28T00:00:00.000Z",
        type: "session.state.changed",
        payload: {
          state: "error",
          reason: "Selected account is unauthorized.",
        },
      },
      {
        role: "review",
        boardId: BoardId.make("board_1"),
        ticketId: TicketId.make("ticket_1"),
        attemptId: "attempt_1",
        reviewArtifactId: "review_artifact_1",
        supervisorRunId: null,
      },
    );

    expect(observation._tag).toBe("mission_event");
    if (observation._tag !== "mission_event") return;
    expect(observation.draft.kind).toBe("provider_unavailable");
    expect(observation.draft.summary).toBe("Reviewer provider session is unavailable.");
    expect(observation.draft.retryBehavior).toBe("manual");
  });

  it("turns live provider-unavailable events into ticket mission state", async () => {
    const repoRoot = await createGitRepository("presence-observation-provider-unavailable-");
    const system = await createPresenceSystem();
    const store = makePresenceStore({ sql: system.sql, nowIso: () => "2026-04-28T00:00:00.000Z" });
    const runtimeEvents = Effect.runSync(PubSub.unbounded<ProviderRuntimeEvent>());
    const providerService = {
      startSession: () => Effect.die("unused"),
      sendTurn: () => Effect.die("unused"),
      interruptTurn: () => Effect.die("unused"),
      respondToRequest: () => Effect.die("unused"),
      respondToUserInput: () => Effect.die("unused"),
      stopSession: () => Effect.die("unused"),
      listSessions: () => Effect.succeed([]),
      getCapabilities: () => Effect.succeed({ sessionModelSwitch: "in-session" as const }),
      rollbackConversation: () => Effect.die("unused"),
      get streamEvents() {
        return Stream.fromPubSub(runtimeEvents);
      },
    } satisfies typeof ProviderService.Service;

    try {
      const repository = await system.presence
        .importRepository({
          workspaceRoot: repoRoot,
          title: "Presence Repo",
        })
        .pipe(Effect.runPromise);
      const ticket = await system.presence
        .createTicket({
          boardId: repository.boardId,
          title: "Surface provider unavailable state",
          description: "Presence should show provider auth failures as actionable mission state.",
          priority: "p1",
        })
        .pipe(Effect.runPromise);
      const attempt = await system.presence
        .createAttempt({
          ticketId: ticket.id,
        })
        .pipe(Effect.runPromise);
      const threadId = ThreadId.make("presence_provider_unavailable_thread");
      await store
        .upsertPresenceThreadCorrelation({
          threadId,
          boardId: repository.boardId,
          role: "worker",
          ticketId: ticket.id,
          attemptId: attempt.id,
          source: "test_runtime_stream",
        })
        .pipe(Effect.runPromise);

      await Effect.gen(function* () {
        const observation = yield* makePresenceObservationService;
        yield* observation.start();
        yield* Effect.sleep(50);
        yield* PubSub.publish(runtimeEvents, {
          eventId: EventId.make("runtime_auth_failure_1"),
          provider: "codex",
          threadId,
          createdAt: "2026-04-28T00:00:00.000Z",
          type: "auth.status",
          payload: {
            error: "Codex is not signed in.",
          },
        });
        yield* Effect.sleep(200);
      }).pipe(
        Effect.provideService(SqlClient.SqlClient, system.sql),
        Effect.provideService(ProviderService, providerService),
        Effect.provideService(OrchestrationEngineService, system.orchestration.service),
        Effect.scoped,
        Effect.runPromise,
      );

      const missionEvents = await system.sql<{
        kind: string;
        retryBehavior: string;
        humanAction: string | null;
      }>`
        SELECT
          kind,
          retry_behavior as "retryBehavior",
          human_action as "humanAction"
        FROM presence_mission_events
        WHERE board_id = ${repository.boardId}
          AND kind = 'provider_unavailable'
      `.pipe(Effect.runPromise);
      const ticketBriefings = await store
        .readTicketMissionBriefingsForBoard(repository.boardId)
        .pipe(Effect.runPromise);
      const briefing = ticketBriefings.find((entry) => entry.ticketId === ticket.id);

      expect(missionEvents).toHaveLength(1);
      expect(missionEvents[0]?.retryBehavior).toBe("manual");
      expect(missionEvents[0]?.humanAction).toBe(
        "Choose an authenticated Presence harness or sign in to the selected provider.",
      );
      expect(briefing?.needsHuman).toBe(true);
      expect(briefing?.humanAction).toBe(
        "Choose an authenticated Presence harness or sign in to the selected provider.",
      );
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
      Effect.runSync(PubSub.shutdown(runtimeEvents));
    }
  });
});
