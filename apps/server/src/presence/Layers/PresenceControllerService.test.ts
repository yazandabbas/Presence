import { Effect, Exit, Scope } from "effect";
import { describe, expect, it } from "vitest";

import {
  createGitRepository,
  createPresenceSystem,
  removeTempRepo,
  waitFor,
} from "./PresenceControlPlaneTestSupport.ts";

describe("PresenceControllerService", () => {
  it("persists paused mode, dedupes pause events, and does not wake work after restart", async () => {
    const repoRoot = await createGitRepository("presence-controller-paused-");
    const system = await createPresenceSystem({ includeController: true });
    const scope = await Effect.runPromise(Scope.make("sequential"));

    try {
      const repository = await system.presence
        .importRepository({
          workspaceRoot: repoRoot,
          title: "Presence Controller Paused Repo",
        })
        .pipe(Effect.runPromise);

      await system.presence
        .submitGoalIntake({
          boardId: repository.boardId,
          rawGoal: "Create a durable pause regression task",
          source: "human_goal",
        })
        .pipe(Effect.runPromise);

      const paused = await system.presence
        .setControllerMode({
          boardId: repository.boardId,
          mode: "paused",
        })
        .pipe(Effect.runPromise);
      const repeatedPause = await system.presence
        .setControllerMode({
          boardId: repository.boardId,
          mode: "paused",
        })
        .pipe(Effect.runPromise);

      expect(paused.controllerState.mode).toBe("paused");
      expect(paused.controllerState.status).toBe("paused");
      expect(repeatedPause.controllerState.updatedAt).toBe(paused.controllerState.updatedAt);

      await system.controller?.start().pipe(Scope.provide(scope), Effect.runPromise);
      await new Promise((resolve) => setTimeout(resolve, 250));

      const snapshot = await system.presence
        .getBoardSnapshot({
          boardId: repository.boardId,
        })
        .pipe(Effect.runPromise);
      const pauseEvents = snapshot.missionEvents.filter(
        (event) =>
          event.kind === "controller_action" &&
          event.summary === "Presence is paused for this board.",
      );

      expect(snapshot.controllerState?.mode).toBe("paused");
      expect(snapshot.controllerState?.status).toBe("paused");
      expect(snapshot.goalIntakes[0]?.status).toBe("queued");
      expect(snapshot.supervisorRuns).toHaveLength(0);
      const workCommands = system.commands.filter(
        (command) => command.type === "thread.create" || command.type === "thread.turn.start",
      );
      expect(workCommands).toHaveLength(0);
      expect(pauseEvents).toHaveLength(1);
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("plans queued goals without requiring a visible supervisor planning thread", async () => {
    const repoRoot = await createGitRepository("presence-controller-goal-");
    const system = await createPresenceSystem({ includeController: true });
    const scope = await Effect.runPromise(Scope.make("sequential"));

    try {
      const repository = await system.presence
        .importRepository({
          workspaceRoot: repoRoot,
          title: "Presence Controller Goal Repo",
        })
        .pipe(Effect.runPromise);

      const submitted = await system.presence
        .submitGoalIntake({
          boardId: repository.boardId,
          rawGoal: "Create the repository AGENTS.md guide",
          source: "human_goal",
        })
        .pipe(Effect.runPromise);

      expect(submitted.intake.status).toBe("queued");
      expect(submitted.createdTickets).toEqual([]);

      await system.controller?.start().pipe(Scope.provide(scope), Effect.runPromise);

      await waitFor(
        async () => {
          const snapshot = await system.presence
            .getBoardSnapshot({
              boardId: repository.boardId,
            })
            .pipe(Effect.runPromise);
          return snapshot.goalIntakes[0]?.status === "planned" && snapshot.tickets.length === 1;
        },
        1_500,
        25,
      );

      const snapshot = await system.presence
        .getBoardSnapshot({
          boardId: repository.boardId,
        })
        .pipe(Effect.runPromise);
      expect(snapshot.goalIntakes[0]?.status).toBe("planned");
      expect(snapshot.tickets[0]?.title).toBe("Create the repository AGENTS.md guide");
      expect(system.commands.filter((command) => command.type === "thread.create")).toHaveLength(0);
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });
});
