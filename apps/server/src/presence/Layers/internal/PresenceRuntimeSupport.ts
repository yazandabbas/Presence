import {
  AttemptId,
  CommandId,
  MessageId,
  type ModelSelection,
  PresenceWorkspaceStatus,
  ProviderKind,
  type ServerProvider,
  ThreadId,
  WorkspaceId,
  type WorkspaceRecord,
  type PresenceRpcError,
} from "@t3tools/contracts";
import { resolveAutoFeatureBranchName } from "@t3tools/shared/git";
import { Effect, Result, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql/SqlClient";
import type {
  AttemptWorkspaceContextRow,
  PresenceThreadReadModel,
} from "./PresenceInternalDeps.ts";
import type { GitCoreShape } from "../../../git/Services/GitCore.ts";
import type { OrchestrationEngineShape } from "../../../orchestration/Services/OrchestrationEngine.ts";
import type { ProviderRegistryShape } from "../../../provider/Services/ProviderRegistry.ts";

type PresenceRuntimeSupportDeps = Readonly<{
  sql: SqlClient;
  gitCore: GitCoreShape;
  orchestrationEngine: OrchestrationEngineShape;
  providerRegistry: ProviderRegistryShape;
  makeId: <T extends { make: (value: string) => unknown }>(
    schema: T,
    prefix: string,
  ) => ReturnType<T["make"]>;
  nowIso: () => string;
  readAttemptWorkspaceContext: (
    attemptId: string,
  ) => Effect.Effect<AttemptWorkspaceContextRow | null, unknown, never>;
  chooseDefaultModelSelection: (providers: ReadonlyArray<ServerProvider>) => ModelSelection | null;
  isModelSelectionAvailable: (
    providers: ReadonlyArray<ServerProvider>,
    selection: ModelSelection | null,
  ) => boolean;
  uniqueStrings: (values: ReadonlyArray<string>) => ReadonlyArray<string>;
  decodeJson: <T>(value: string | null, fallback: T) => T;
  presenceError: (message: string, cause?: unknown) => PresenceRpcError;
}>;

const makePresenceRuntimeSupport = (deps: PresenceRuntimeSupportDeps) => {
  const decode = Schema.decodeUnknownSync;
  const waitForWorkspacePreparation = (input: {
    attemptId: string;
    branch: string;
    maxChecks?: number;
  }) =>
    Effect.gen(function* () {
      const maxChecks = input.maxChecks ?? 30;
      for (let attempt = 0; attempt < maxChecks; attempt += 1) {
        const latestWorkspace = yield* deps.readAttemptWorkspaceContext(input.attemptId);
        if (!latestWorkspace) {
          return null;
        }
        const worktreePath = latestWorkspace.workspaceWorktreePath?.trim() ?? null;
        const branch = latestWorkspace.workspaceBranch?.trim() ?? null;
        if (worktreePath && branch === input.branch) {
          return {
            id: WorkspaceId.make(latestWorkspace.workspaceId),
            attemptId: AttemptId.make(latestWorkspace.attemptId),
            status: decode(PresenceWorkspaceStatus)(latestWorkspace.workspaceStatus),
            branch,
            worktreePath,
            createdAt: latestWorkspace.workspaceCreatedAt,
            updatedAt: latestWorkspace.workspaceUpdatedAt,
          } satisfies WorkspaceRecord;
        }
        if (!branch || branch !== input.branch) {
          return null;
        }
        yield* Effect.sleep(50);
      }
      return null;
    });

  const ensureWorkspacePrepared = (input: {
    attemptId: string;
    preferredBranch?: string | undefined;
    nextStatus: typeof PresenceWorkspaceStatus.Type;
  }): Effect.Effect<WorkspaceRecord, unknown, never> =>
    Effect.gen(function* () {
      const context = yield* deps.readAttemptWorkspaceContext(input.attemptId);
      if (!context) {
        return yield* Effect.fail(deps.presenceError(`Attempt '${input.attemptId}' not found.`));
      }

      const existingPath = context.workspaceWorktreePath?.trim() ?? null;
      const existingBranch = context.workspaceBranch?.trim() ?? null;
      const currentStatus = decode(PresenceWorkspaceStatus)(context.workspaceStatus);

      if (
        existingPath &&
        existingBranch &&
        currentStatus !== "cleaned_up" &&
        currentStatus !== "error"
      ) {
        if (currentStatus !== input.nextStatus) {
          const updatedAt = deps.nowIso();
          yield* deps.sql`
            UPDATE presence_workspaces
            SET status = ${input.nextStatus}, updated_at = ${updatedAt}
            WHERE workspace_id = ${context.workspaceId}
          `;
          return {
            id: WorkspaceId.make(context.workspaceId),
            attemptId: AttemptId.make(context.attemptId),
            status: input.nextStatus,
            branch: existingBranch,
            worktreePath: existingPath,
            createdAt: context.workspaceCreatedAt,
            updatedAt,
          } satisfies WorkspaceRecord;
        }

        return {
          id: WorkspaceId.make(context.workspaceId),
          attemptId: AttemptId.make(context.attemptId),
          status: currentStatus,
          branch: existingBranch,
          worktreePath: existingPath,
          createdAt: context.workspaceCreatedAt,
          updatedAt: context.workspaceUpdatedAt,
        } satisfies WorkspaceRecord;
      }

      const availableBranches = yield* deps.gitCore.listLocalBranchNames(context.workspaceRoot);
      const branchListing = yield* deps.gitCore.listBranches({ cwd: context.workspaceRoot });
      const currentBranch = branchListing.branches.find(
        (branch) => branch.current && !branch.isRemote,
      )?.name;

      if (!currentBranch) {
        return yield* Effect.fail(
          deps.presenceError(
            `Workspace root '${context.workspaceRoot}' is missing an active base branch for attempt '${context.attemptId}'.`,
          ),
        );
      }

      const targetBranch =
        existingBranch ??
        resolveAutoFeatureBranchName(
          availableBranches,
          input.preferredBranch?.trim() || context.ticketTitle,
        );

      if (!existingPath && existingBranch && currentStatus === input.nextStatus) {
        const preparedWorkspace = yield* waitForWorkspacePreparation({
          attemptId: input.attemptId,
          branch: existingBranch,
        });
        if (preparedWorkspace) {
          return preparedWorkspace.status === input.nextStatus
            ? preparedWorkspace
            : yield* Effect.gen(function* () {
                const updatedAt = deps.nowIso();
                yield* deps.sql`
                  UPDATE presence_workspaces
                  SET status = ${input.nextStatus}, updated_at = ${updatedAt}
                  WHERE workspace_id = ${context.workspaceId}
                `;
                return {
                  ...preparedWorkspace,
                  status: input.nextStatus,
                  updatedAt,
                } satisfies WorkspaceRecord;
              });
        }
      }

      let ownsPreparation = true;
      if (!existingPath && !existingBranch) {
        const claimUpdatedAt = deps.nowIso();
        yield* deps.sql`
          UPDATE presence_workspaces
          SET
            status = ${input.nextStatus},
            branch = ${targetBranch},
            updated_at = ${claimUpdatedAt}
          WHERE
            workspace_id = ${context.workspaceId} AND
            worktree_path IS NULL AND
            branch IS NULL
        `;
        const claimedContext = yield* deps.readAttemptWorkspaceContext(input.attemptId);
        const claimedPath = claimedContext?.workspaceWorktreePath?.trim() ?? null;
        const claimedBranch = claimedContext?.workspaceBranch?.trim() ?? null;
        if (!claimedContext) {
          return yield* Effect.fail(deps.presenceError(`Attempt '${input.attemptId}' not found.`));
        }
        if (claimedPath && claimedBranch === targetBranch) {
          return {
            id: WorkspaceId.make(claimedContext.workspaceId),
            attemptId: AttemptId.make(claimedContext.attemptId),
            status: decode(PresenceWorkspaceStatus)(claimedContext.workspaceStatus),
            branch: claimedBranch,
            worktreePath: claimedPath,
            createdAt: claimedContext.workspaceCreatedAt,
            updatedAt: claimedContext.workspaceUpdatedAt,
          } satisfies WorkspaceRecord;
        }
        ownsPreparation =
          claimedBranch === targetBranch && claimedContext.workspaceUpdatedAt === claimUpdatedAt;
        if (!ownsPreparation) {
          const preparedWorkspace = yield* waitForWorkspacePreparation({
            attemptId: input.attemptId,
            branch: targetBranch,
          });
          if (preparedWorkspace) {
            return preparedWorkspace.status === input.nextStatus
              ? preparedWorkspace
              : yield* Effect.gen(function* () {
                  const updatedAt = deps.nowIso();
                  yield* deps.sql`
                    UPDATE presence_workspaces
                    SET status = ${input.nextStatus}, updated_at = ${updatedAt}
                    WHERE workspace_id = ${claimedContext.workspaceId}
                  `;
                  return {
                    ...preparedWorkspace,
                    status: input.nextStatus,
                    updatedAt,
                  } satisfies WorkspaceRecord;
                });
          }
          return yield* Effect.fail(
            deps.presenceError(
              `Workspace preparation for attempt '${input.attemptId}' is already in progress. Try again once it settles.`,
            ),
          );
        }
      }

      const createWorktreeEffect = existingBranch
        ? deps.gitCore.createWorktree({
            cwd: context.workspaceRoot,
            branch: existingBranch,
            path: existingPath,
          })
        : deps.gitCore.createWorktree({
            cwd: context.workspaceRoot,
            branch: currentBranch,
            newBranch: targetBranch,
            path: existingPath,
          });

      const createdWorktreeResult = yield* Effect.result(createWorktreeEffect);
      if (Result.isFailure(createdWorktreeResult)) {
        yield* deps.sql`
          UPDATE presence_workspaces
          SET
            status = ${"error"},
            branch = ${null},
            worktree_path = ${null},
            updated_at = ${deps.nowIso()}
          WHERE workspace_id = ${context.workspaceId}
        `;
        return yield* Effect.fail(createdWorktreeResult.failure);
      }
      const createdWorktree = createdWorktreeResult.success as {
        worktree: { branch: string; path: string };
      };

      const updatedAt = deps.nowIso();
      yield* deps.sql`
        UPDATE presence_workspaces
        SET
          status = ${input.nextStatus},
          branch = ${createdWorktree.worktree.branch},
          worktree_path = ${createdWorktree.worktree.path},
          updated_at = ${updatedAt}
        WHERE workspace_id = ${context.workspaceId}
      `;

      return {
        id: WorkspaceId.make(context.workspaceId),
        attemptId: AttemptId.make(context.attemptId),
        status: input.nextStatus,
        branch: createdWorktree.worktree.branch,
        worktreePath: createdWorktree.worktree.path,
        createdAt: context.workspaceCreatedAt,
        updatedAt,
      } satisfies WorkspaceRecord;
    });

  const resolveModelSelectionForAttempt = (
    context: AttemptWorkspaceContextRow,
  ): Effect.Effect<ModelSelection, unknown, never> =>
    Effect.gen(function* () {
      if (context.attemptProvider && context.attemptModel) {
        return {
          provider: decode(ProviderKind)(context.attemptProvider),
          model: context.attemptModel,
        } as ModelSelection;
      }
      const providers = yield* deps.providerRegistry.getProviders;
      const savedRepositorySelection = deps.decodeJson<ModelSelection | null>(
        context.defaultModelSelection,
        null,
      );
      const selection = deps.isModelSelectionAvailable(providers, savedRepositorySelection)
        ? savedRepositorySelection
        : deps.chooseDefaultModelSelection(providers);
      if (!selection) {
        return yield* Effect.fail(
          deps.presenceError("No provider/model is available for the supervisor runtime."),
        );
      }
      return selection;
    });

  const queueTurnStart = (input: {
    threadId: string;
    titleSeed: string;
    selection: ModelSelection;
    text: string;
  }): Effect.Effect<void, unknown, never> =>
    deps.orchestrationEngine.dispatch({
      type: "thread.turn.start",
      commandId: CommandId.make(`presence_turn_start_${crypto.randomUUID()}`),
      threadId: ThreadId.make(input.threadId),
      message: {
        messageId: deps.makeId(MessageId, "presence_message"),
        role: "user",
        text: input.text,
        attachments: [],
      },
      modelSelection: input.selection,
      titleSeed: input.titleSeed,
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: deps.nowIso(),
    });

  const syncThreadWorkspaceMetadata = (input: {
    threadId: string;
    branch: string | null;
    worktreePath: string | null;
  }): Effect.Effect<void, unknown, never> =>
    deps.orchestrationEngine.dispatch({
      type: "thread.meta.update",
      commandId: CommandId.make(`presence_thread_meta_update_${crypto.randomUUID()}`),
      threadId: ThreadId.make(input.threadId),
      branch: input.branch,
      worktreePath: input.worktreePath,
    });

  const readThreadFromModel = (
    threadId: string,
  ): Effect.Effect<(PresenceThreadReadModel & { id: string }) | null, unknown, never> =>
    deps.orchestrationEngine.getReadModel().pipe(
      Effect.map((readModel: { threads: ReadonlyArray<PresenceThreadReadModel & { id: string }> }) =>
        readModel.threads.find((thread) => thread.id === ThreadId.make(threadId)) ?? null,
      ),
    );

  const waitForClaimedThreadAvailability = (input: {
    attemptId: string;
    threadId: string;
    maxChecks?: number;
  }): Effect.Effect<boolean, unknown, never> =>
    Effect.gen(function* () {
      const maxChecks = input.maxChecks ?? 20;
      for (let attempt = 0; attempt < maxChecks; attempt += 1) {
        const thread = yield* readThreadFromModel(input.threadId);
        if (thread) {
          return true;
        }
        const latestAttempt = yield* deps.readAttemptWorkspaceContext(input.attemptId);
        if (!latestAttempt || latestAttempt.attemptThreadId !== input.threadId) {
          return false;
        }
        yield* Effect.sleep(50);
      }
      return false;
    });

  const readChangedFilesForWorkspace = (
    workspacePath: string | null,
  ): Effect.Effect<ReadonlyArray<string>, unknown, never> =>
    workspacePath
      ? deps.gitCore.statusDetailsLocal(workspacePath).pipe(
          Effect.map((status: { workingTree?: { files?: ReadonlyArray<{ path: string }> } }) =>
            deps.uniqueStrings(
              status.workingTree?.files?.map((file: { path: string }) => file.path) ?? [],
            ),
          ),
          Effect.catch(() => Effect.succeed([] as string[])),
        )
      : Effect.succeed([] as string[]);

  return {
    ensureWorkspacePrepared,
    readThreadFromModel,
    readChangedFilesForWorkspace,
    resolveModelSelectionForAttempt,
    syncThreadWorkspaceMetadata,
    queueTurnStart,
    waitForClaimedThreadAvailability,
  };
};

export { makePresenceRuntimeSupport };
