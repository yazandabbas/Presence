import { EventId, type ProviderRuntimeEvent, TurnId } from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  createGitRepository,
  createPresenceSystem,
  removeTempRepo,
} from "../PresenceControlPlaneTestSupport.ts";
import { runtimeObservationForEvent } from "../PresenceObservationService.ts";
import { threadCorrelationSource } from "./PresenceCorrelationKeys.ts";
import { makePresenceStore } from "./PresenceStore.ts";

const TEST_NOW = "2026-04-28T00:00:00.000Z";

describe("Presence thread correlations", () => {
  it("records worker thread ownership when an attempt session starts", async () => {
    const repoRoot = await createGitRepository("presence-thread-correlation-worker-");
    const system = await createPresenceSystem();
    const store = makePresenceStore({ sql: system.sql, nowIso: () => TEST_NOW });

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
          title: "Correlate worker thread",
          description: "The worker runtime thread should have durable ownership.",
          priority: "p2",
        })
        .pipe(Effect.runPromise);
      const attempt = await system.presence
        .createAttempt({
          ticketId: ticket.id,
        })
        .pipe(Effect.runPromise);

      const session = await system.presence
        .startAttemptSession({
          attemptId: attempt.id,
        })
        .pipe(Effect.runPromise);

      const correlation = await store
        .readPresenceThreadCorrelation(session.threadId)
        .pipe(Effect.runPromise);
      expect(correlation).toEqual({
        role: "worker",
        boardId: repository.boardId,
        ticketId: ticket.id,
        attemptId: attempt.id,
        reviewArtifactId: null,
        supervisorRunId: null,
      });

      const persisted = await system.sql<{ source: string }>`
        SELECT source
        FROM presence_thread_correlations
        WHERE thread_id = ${session.threadId}
      `.pipe(Effect.runPromise);
      expect(persisted[0]?.source).toBe("attempt_session_created");
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("does not false-match supervisor active thread id substrings", async () => {
    const repoRoot = await createGitRepository("presence-thread-correlation-supervisor-");
    const system = await createPresenceSystem();
    const store = makePresenceStore({ sql: system.sql, nowIso: () => TEST_NOW });

    try {
      const repository = await system.presence
        .importRepository({
          workspaceRoot: repoRoot,
          title: "Presence Repo",
        })
        .pipe(Effect.runPromise);

      await system.sql`
        INSERT INTO presence_supervisor_runs (
          supervisor_run_id, board_id, source_goal_intake_id, scope_ticket_ids_json,
          status, stage, current_ticket_id, active_thread_ids_json, summary,
          created_at, updated_at
        ) VALUES (
          ${"supervisor_run_substring"},
          ${repository.boardId},
          ${null},
          ${"[]"},
          ${"running"},
          ${"waiting_on_worker"},
          ${null},
          ${JSON.stringify(["presence_thread_1234"])},
          ${"Waiting on a longer thread id."},
          ${TEST_NOW},
          ${TEST_NOW}
        )
      `.pipe(Effect.runPromise);

      await expect(
        store.readPresenceThreadCorrelation("presence_thread_123").pipe(Effect.runPromise),
      ).resolves.toBeNull();
      await expect(
        store.readPresenceThreadCorrelation("presence_thread_1234").pipe(Effect.runPromise),
      ).resolves.toMatchObject({
        role: "supervisor",
        boardId: repository.boardId,
        supervisorRunId: "supervisor_run_substring",
      });
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("correlates replayed runtime events through the registry without duplicate mission events", async () => {
    const repoRoot = await createGitRepository("presence-thread-correlation-dedupe-");
    const system = await createPresenceSystem();
    const store = makePresenceStore({ sql: system.sql, nowIso: () => TEST_NOW });

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
          title: "Dedupe runtime replay",
          description: "The same runtime event should only surface once.",
          priority: "p2",
        })
        .pipe(Effect.runPromise);
      const attempt = await system.presence
        .createAttempt({
          ticketId: ticket.id,
        })
        .pipe(Effect.runPromise);
      const session = await system.presence
        .startAttemptSession({
          attemptId: attempt.id,
        })
        .pipe(Effect.runPromise);

      const correlation = await store
        .readPresenceThreadCorrelation(session.threadId)
        .pipe(Effect.runPromise);
      expect(correlation).not.toBeNull();

      const event = {
        eventId: EventId.make("runtime_event_replayed"),
        provider: "codex",
        threadId: session.threadId,
        turnId: TurnId.make("turn_replayed"),
        createdAt: TEST_NOW,
        type: "turn.completed",
        payload: {
          state: "completed",
          stopReason: null,
        },
      } satisfies ProviderRuntimeEvent;
      const observation = runtimeObservationForEvent(event, correlation!);
      expect(observation._tag).toBe("mission_event");
      if (observation._tag !== "mission_event") return;

      const writeObservedEvent = () =>
        store.writeMissionEvent({
          boardId: correlation!.boardId,
          ticketId: correlation!.ticketId,
          attemptId: correlation!.attemptId,
          reviewArtifactId: correlation!.reviewArtifactId,
          supervisorRunId: correlation!.supervisorRunId,
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
      await writeObservedEvent().pipe(Effect.runPromise);
      await writeObservedEvent().pipe(Effect.runPromise);

      const rows = await system.sql<{ count: number }>`
        SELECT COUNT(*) as count
        FROM presence_mission_events
        WHERE board_id = ${repository.boardId}
          AND dedupe_key = ${observation.dedupeKey}
      `.pipe(Effect.runPromise);
      expect(rows[0]?.count).toBe(1);
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("dedupes replayed payload-fallback failures without hiding later repeats", async () => {
    const repoRoot = await createGitRepository("presence-thread-correlation-repeated-failure-");
    const system = await createPresenceSystem();
    const store = makePresenceStore({ sql: system.sql, nowIso: () => TEST_NOW });

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
          title: "Dedupe replay but retain repeated failures",
          description: "Presence should not flatten a later identical runtime failure.",
          priority: "p2",
        })
        .pipe(Effect.runPromise);
      const attempt = await system.presence
        .createAttempt({
          ticketId: ticket.id,
        })
        .pipe(Effect.runPromise);
      const session = await system.presence
        .startAttemptSession({
          attemptId: attempt.id,
        })
        .pipe(Effect.runPromise);
      const correlation = await store
        .readPresenceThreadCorrelation(session.threadId)
        .pipe(Effect.runPromise);
      expect(correlation).not.toBeNull();

      const runtimeError = (eventId: string, createdAt: string) =>
        ({
          eventId: EventId.make(eventId),
          provider: "codex",
          threadId: session.threadId,
          createdAt,
          type: "runtime.error",
          payload: {
            message: "Realtime channel failed.",
          },
        }) satisfies ProviderRuntimeEvent;
      const first = runtimeObservationForEvent(
        runtimeError("runtime_error_first", "2026-04-28T00:00:00.000Z"),
        correlation!,
      );
      const replay = runtimeObservationForEvent(
        runtimeError("runtime_error_replay", "2026-04-28T00:00:00.000Z"),
        correlation!,
      );
      const later = runtimeObservationForEvent(
        runtimeError("runtime_error_later", "2026-04-28T00:01:00.000Z"),
        correlation!,
      );
      expect(first._tag).toBe("mission_event");
      expect(replay._tag).toBe("mission_event");
      expect(later._tag).toBe("mission_event");
      if (first._tag !== "mission_event" || replay._tag !== "mission_event") return;
      if (later._tag !== "mission_event") return;
      expect(first.dedupeKey).toBe(replay.dedupeKey);
      expect(later.dedupeKey).not.toBe(first.dedupeKey);

      const writeObservation = (event: ProviderRuntimeEvent, dedupeKey: string) =>
        store.writeMissionEvent({
          boardId: correlation!.boardId,
          ticketId: correlation!.ticketId,
          attemptId: correlation!.attemptId,
          reviewArtifactId: correlation!.reviewArtifactId,
          supervisorRunId: correlation!.supervisorRunId,
          threadId: event.threadId,
          kind: "runtime_error",
          severity: "error",
          summary: "Worker runtime failed.",
          detail: "Realtime channel failed.",
          retryBehavior: "automatic",
          humanAction: null,
          dedupeKey,
          createdAt: event.createdAt,
        });
      const firstEvent = runtimeError("runtime_error_first", "2026-04-28T00:00:00.000Z");
      const replayEvent = runtimeError("runtime_error_replay", "2026-04-28T00:00:00.000Z");
      const laterEvent = runtimeError("runtime_error_later", "2026-04-28T00:01:00.000Z");
      await writeObservation(firstEvent, first.dedupeKey).pipe(Effect.runPromise);
      await writeObservation(replayEvent, replay.dedupeKey).pipe(Effect.runPromise);
      await writeObservation(laterEvent, later.dedupeKey).pipe(Effect.runPromise);

      const rows = await system.sql<{ dedupeKey: string }>`
        SELECT dedupe_key as "dedupeKey"
        FROM presence_mission_events
        WHERE board_id = ${repository.boardId}
          AND kind = 'runtime_error'
        ORDER BY created_at ASC
      `.pipe(Effect.runPromise);

      expect(rows.map((row) => row.dedupeKey)).toEqual([first.dedupeKey, later.dedupeKey]);
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("keeps review artifact ownership sticky across later review thread requeues", async () => {
    const repoRoot = await createGitRepository("presence-thread-correlation-review-");
    const system = await createPresenceSystem();
    const store = makePresenceStore({ sql: system.sql, nowIso: () => TEST_NOW });

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
          title: "Correlate review thread",
          description: "Review threads should retain artifact ownership after requeues.",
          priority: "p2",
        })
        .pipe(Effect.runPromise);
      const attempt = await system.presence
        .createAttempt({
          ticketId: ticket.id,
        })
        .pipe(Effect.runPromise);
      const reviewArtifact = await store
        .createReviewArtifact({
          ticketId: ticket.id,
          attemptId: attempt.id,
          reviewerKind: "review_agent",
          decision: "request_changes",
          summary: "Reviewer found follow-up work.",
          checklistJson: "[]",
          changedFiles: [],
          findingIds: [],
        })
        .pipe(Effect.runPromise);
      const reviewThreadId = "presence_review_thread_sticky";

      await store
        .upsertPresenceThreadCorrelation({
          threadId: reviewThreadId,
          boardId: repository.boardId,
          role: "review",
          ticketId: ticket.id,
          attemptId: attempt.id,
          reviewArtifactId: reviewArtifact.id,
          source: threadCorrelationSource("review_result_artifact"),
        })
        .pipe(Effect.runPromise);
      await store
        .upsertPresenceThreadCorrelation({
          threadId: reviewThreadId,
          boardId: repository.boardId,
          role: "review",
          ticketId: ticket.id,
          attemptId: attempt.id,
          reviewArtifactId: null,
          source: threadCorrelationSource("review_session_queued"),
        })
        .pipe(Effect.runPromise);

      await expect(
        store.readPresenceThreadCorrelation(reviewThreadId).pipe(Effect.runPromise),
      ).resolves.toEqual({
        role: "review",
        boardId: repository.boardId,
        ticketId: ticket.id,
        attemptId: attempt.id,
        reviewArtifactId: reviewArtifact.id,
        supervisorRunId: null,
      });
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });
});
