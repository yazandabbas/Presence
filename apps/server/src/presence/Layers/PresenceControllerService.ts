import {
  BoardId,
  GoalIntakeId,
  type PresenceMissionSeverity,
  type ServerProvider,
} from "@t3tools/contracts";
import { Effect, Layer, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { PresenceControlPlane } from "../Services/PresenceControlPlane.ts";
import {
  PresenceControllerService,
  type PresenceControllerServiceShape,
} from "../Services/PresenceControllerService.ts";
import { describeUnknownError, nowIso, truncateText } from "./internal/PresenceShared.ts";
import { makePresenceStore } from "./internal/PresenceStore.ts";

const CONTROLLER_OWNER = "presence-resident-controller";
const CONTROLLER_POLL_INTERVAL_MS = 2_000;
const BOARD_CONCURRENCY = 3;

const providerReady = (provider: ServerProvider): boolean =>
  provider.enabled &&
  provider.installed &&
  provider.status === "ready" &&
  provider.auth.status !== "unauthenticated" &&
  provider.models.length > 0;

const providerLabel = (provider: ServerProvider): string =>
  provider.displayName ?? provider.provider;

const providerProblemSummary = (providers: ReadonlyArray<ServerProvider>): string | null => {
  if (providers.some(providerReady)) return null;
  const enabledProviders = providers.filter((provider) => provider.enabled);
  const unavailable = (enabledProviders.length > 0 ? enabledProviders : providers)[0] ?? null;
  if (!unavailable) return "No Presence harness provider is configured.";
  const label = providerLabel(unavailable);
  if (!unavailable.installed) return `${label} is not installed.`;
  if (unavailable.auth.status === "unauthenticated") return `${label} is not authenticated.`;
  if (unavailable.models.length === 0) return `${label} has no available models.`;
  if (unavailable.status !== "ready") return `${label} is ${unavailable.status}.`;
  return `${label} is not ready for Presence work.`;
};

export const makePresenceControllerService = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const providerRegistry = yield* ProviderRegistry;
  const controlPlane = yield* PresenceControlPlane;
  const store = makePresenceStore({ sql, nowIso });

  const writeControllerEvent = (input: {
    boardId: BoardId;
    kind:
      | "controller_started"
      | "controller_tick"
      | "controller_action"
      | "goal_queued"
      | "goal_planning"
      | "goal_planned"
      | "goal_blocked"
      | "provider_unavailable"
      | "runtime_health";
    severity?: PresenceMissionSeverity;
    summary: string;
    detail?: string | null;
    humanAction?: string | null;
    dedupeKey: string;
  }) =>
    store.writeMissionEvent({
      boardId: input.boardId,
      kind: input.kind,
      severity: input.severity ?? "info",
      summary: input.summary,
      detail: input.detail ?? null,
      retryBehavior: input.kind === "provider_unavailable" ? "manual" : "not_applicable",
      humanAction: input.humanAction ?? null,
      dedupeKey: input.dedupeKey,
    });

  const processQueuedGoal = (boardId: BoardId) =>
    Effect.gen(function* () {
      const pendingGoals = yield* store.readPendingGoalIntakesForController(boardId);
      const goal = pendingGoals[0] ?? null;
      if (!goal) return false;

      if (goal.status === "queued") {
        yield* store.updateGoalIntakeStatus({
          goalIntakeId: goal.id,
          status: "planning",
          summary: "Presence is inspecting the repo and turning this goal into tickets.",
        });
        yield* writeControllerEvent({
          boardId,
          kind: "goal_planning",
          summary: "Presence started planning a queued goal.",
          detail: goal.rawGoal,
          dedupeKey: `goal-planning:${goal.id}`,
        });
      }

      const plan = yield* controlPlane.planGoalIntake({
        boardId,
        goalIntakeId: GoalIntakeId.make(goal.id),
      });
      yield* store.upsertBoardControllerState({
        boardId,
        status: "planning",
        summary: plan.intake.summary,
        leaseOwner: CONTROLLER_OWNER,
        lastTickAt: nowIso(),
      });
      yield* writeControllerEvent({
        boardId,
        kind: "goal_planned",
        severity: "success",
        summary: plan.intake.summary,
        detail:
          plan.createdTickets.length > 0
            ? plan.createdTickets.map((ticket) => ticket.title).join("\n")
            : goal.rawGoal,
        dedupeKey: `goal-planned:${goal.id}:${plan.createdTickets.map((ticket) => ticket.id).join(",")}`,
      });
      return true;
    }).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          const detail = truncateText(describeUnknownError(error), 1_000);
          const pendingGoals = yield* store.readPendingGoalIntakesForController(boardId);
          const goal = pendingGoals[0] ?? null;
          if (goal) {
            yield* store.updateGoalIntakeStatus({
              goalIntakeId: goal.id,
              status: "blocked",
              lastError: detail,
            });
            yield* writeControllerEvent({
              boardId,
              kind: "goal_blocked",
              severity: "error",
              summary: "Presence could not plan the queued goal.",
              detail,
              humanAction: "Check the Presence harness and retry the goal.",
              dedupeKey: `goal-blocked:${goal.id}:${detail}`,
            });
          }
          yield* store.upsertBoardControllerState({
            boardId,
            status: "error",
            summary: "Presence hit an error while planning queued work.",
            leaseOwner: CONTROLLER_OWNER,
            lastTickAt: nowIso(),
          });
          return false;
        }),
      ),
    );

  const processBoard = (boardId: BoardId, providers: ReadonlyArray<ServerProvider>) =>
    Effect.gen(function* () {
      const now = nowIso();
      const state = yield* store.readBoardControllerState(boardId);
      if (state?.mode === "paused") {
        yield* store.upsertBoardControllerState({
          boardId,
          mode: "paused",
          status: "paused",
          summary: "Presence is paused for this board.",
          leaseOwner: null,
          lastTickAt: now,
        });
        return;
      }

      const providerProblem = providerProblemSummary(providers);
      if (providerProblem) {
        yield* store.upsertBoardControllerState({
          boardId,
          status: "harness_unavailable",
          summary: providerProblem,
          leaseOwner: null,
          lastTickAt: now,
        });
        yield* writeControllerEvent({
          boardId,
          kind: "provider_unavailable",
          severity: "error",
          summary: "Presence cannot start work because the harness is unavailable.",
          detail: providerProblem,
          humanAction: "Open settings and choose or authenticate a Presence harness.",
          dedupeKey: `provider-unavailable:${boardId}:${providerProblem}`,
        });
        return;
      }

      const snapshot = yield* controlPlane.getBoardSnapshot({ boardId });
      if (snapshot.missionBriefing?.humanActionTicketIds.length) {
        yield* store.upsertBoardControllerState({
          boardId,
          status: "needs_human",
          summary: "Presence needs your direction before it can continue safely.",
          leaseOwner: null,
          lastTickAt: now,
        });
        return;
      }

      const latestRun = snapshot.supervisorRuns[0] ?? null;
      if (latestRun?.status === "running") {
        yield* store.upsertBoardControllerState({
          boardId,
          status: "running",
          summary: latestRun.summary,
          leaseOwner: CONTROLLER_OWNER,
          lastTickAt: now,
        });
        return;
      }

      const startedGoal = yield* processQueuedGoal(boardId);
      if (startedGoal) return;

      const actionableTickets = snapshot.tickets.filter(
        (ticket) =>
          ticket.status === "todo" ||
          ticket.status === "in_progress" ||
          ticket.status === "in_review",
      );
      if (actionableTickets.length > 0) {
        const run = yield* controlPlane.startSupervisorRun({ boardId }).pipe(
          Effect.catch((error) =>
            Effect.logWarning("Presence controller could not wake supervisor", {
              boardId,
              error: describeUnknownError(error),
            }).pipe(Effect.as(null)),
          ),
        );
        yield* store.upsertBoardControllerState({
          boardId,
          status: run ? "running" : "idle",
          summary: run?.summary ?? "Presence is ready and watching active work.",
          leaseOwner: run ? CONTROLLER_OWNER : null,
          lastTickAt: now,
        });
        if (run) {
          yield* writeControllerEvent({
            boardId,
            kind: "controller_action",
            summary: "Presence woke the supervisor for actionable tickets.",
            detail: run.summary,
            dedupeKey: `controller-wake:${run.id}`,
          });
        }
        return;
      }

      yield* store.upsertBoardControllerState({
        boardId,
        status: "idle",
        summary: "Presence is active and waiting for the next mission.",
        leaseOwner: null,
        lastTickAt: now,
      });
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Presence controller board tick failed", {
          boardId,
          error: describeUnknownError(error),
        }),
      ),
    );

  const sweepBoards = Effect.gen(function* () {
    const boardIds = (yield* store.readControllerWakeBoardIds()).map((boardId) =>
      BoardId.make(boardId),
    );
    if (boardIds.length === 0) return;
    const providers = yield* providerRegistry.getProviders;
    yield* Effect.forEach(boardIds, (boardId) => processBoard(boardId, providers), {
      concurrency: BOARD_CONCURRENCY,
      discard: true,
    });
  });

  const writeProviderHealthForAllBoards = (providers: ReadonlyArray<ServerProvider>) =>
    Effect.gen(function* () {
      const providerProblem = providerProblemSummary(providers);
      if (!providerProblem) return;
      const boardIds = (yield* store.readControllerWakeBoardIds()).map((boardId) =>
        BoardId.make(boardId),
      );
      yield* Effect.forEach(
        boardIds,
        (boardId) =>
          writeControllerEvent({
            boardId,
            kind: "runtime_health",
            severity: "warning",
            summary: "Presence noticed a harness health issue.",
            detail: providerProblem,
            humanAction: "Open Presence settings if work is blocked.",
            dedupeKey: `runtime-health:${boardId}:${providerProblem}`,
          }).pipe(Effect.asVoid),
        { concurrency: BOARD_CONCURRENCY, discard: true },
      );
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Presence controller failed to record provider health", {
          error: describeUnknownError(error),
        }),
      ),
    );

  const start: PresenceControllerServiceShape["start"] = () =>
    Effect.gen(function* () {
      yield* Effect.log("Presence resident controller started");
      yield* Effect.forkScoped(
        sweepBoards.pipe(
          Effect.catch((error) =>
            Effect.logWarning("Presence controller startup sweep failed", {
              error: describeUnknownError(error),
            }),
          ),
        ),
      );
      yield* Effect.forkScoped(
        Stream.runForEach(providerRegistry.streamChanges, writeProviderHealthForAllBoards),
      );
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.sleep(CONTROLLER_POLL_INTERVAL_MS).pipe(
            Effect.andThen(sweepBoards),
            Effect.catch((error) =>
              Effect.logWarning("Presence controller sweep failed", {
                error: describeUnknownError(error),
              }),
            ),
          ),
        ),
      );
    });

  return { start } satisfies PresenceControllerServiceShape;
});

export const PresenceControllerServiceLive = Layer.effect(
  PresenceControllerService,
  makePresenceControllerService,
);
