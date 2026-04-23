import type {
  AttemptOutcomeRecord,
  FindingRecord,
  MergeOperationRecord,
  ModelSelection,
  PresenceRpcError,
  PresenceReviewDecisionKind,
  PresenceTicketStatus,
  PresenceSubmitReviewDecisionInput,
  RepositoryCapabilityScanRecord,
  ReviewArtifactRecord,
  ReviewChecklistAssessmentItem,
  ReviewDecisionRecord,
  ReviewEvidenceItem,
  SupervisorActionKind,
  SupervisorPolicyDecision,
  TicketRecord,
  TicketSummaryRecord,
  WorkerHandoffRecord,
} from "@t3tools/contracts";
import {
  AttemptId,
  CommandId,
  MergeOperationId,
  PresenceFindingStatus,
  PresenceAttemptStatus,
  ProjectId,
  ReviewDecisionId,
  ThreadId,
  TicketId,
} from "@t3tools/contracts";
import { Effect, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql/SqlClient";

import type { PresenceControlPlaneShape } from "../../Services/PresenceControlPlane.ts";
import { mergeOperationIsNonTerminal, summarizeCommandOutput } from "./PresenceShared.ts";
import type {
  AttemptWorkspaceContextRow,
  PresenceCreateOrUpdateFindingInput,
  PresencePersistMergeOperationInput,
  PresenceResolveOpenFindingsInput,
  PresenceReviewArtifactInput,
  PresenceReviewFindingInput,
  PresenceWriteAttemptOutcomeInput,
  TicketPolicyRow,
} from "./PresenceInternalDeps.ts";
import type { ReviewWorkerPromptInput } from "./PresencePrompting.ts";
import type { GitCoreShape } from "../../../git/Services/GitCore.ts";

type PresenceReviewMergeService = Pick<PresenceControlPlaneShape, "submitReviewDecision"> & {
  startReviewSession: (input: {
    attempt: AttemptWorkspaceContextRow;
    ticketSummary: TicketSummaryRecord | null;
    workerHandoff: WorkerHandoffRecord | null;
    findings: ReadonlyArray<FindingRecord>;
    priorReviewArtifacts: ReadonlyArray<ReviewArtifactRecord>;
    supervisorNote: string;
  }) => Effect.Effect<string, PresenceRpcError, never>;
  blockTicketForReviewFailure: (input: {
    ticketId: string;
    attemptId: string;
    reviewThreadId: string | null;
    summary: string;
    rationale: string;
  }) => Effect.Effect<FindingRecord, PresenceRpcError, never>;
  applyReviewDecisionInternal: (input: {
    ticketId: string;
    attemptId?: string | null;
    decision: PresenceReviewDecisionKind;
    notes: string;
    reviewerKind: "human" | "policy" | "review_agent";
    reviewThreadId?: string | null;
    reviewFindings?: ReadonlyArray<PresenceReviewFindingInput>;
    reviewChecklistAssessment?: ReadonlyArray<ReviewChecklistAssessmentItem>;
    reviewEvidence?: ReadonlyArray<ReviewEvidenceItem>;
    changedFilesReviewed?: ReadonlyArray<string>;
    mechanismChecklistSupported?: boolean;
  }) => Effect.Effect<ReviewDecisionRecord, PresenceRpcError, never>;
};

type MakePresenceReviewMergeServiceDeps = Readonly<{
  presenceError: (message: string, cause?: unknown) => PresenceRpcError;
  gitExecute: (
    input: Parameters<GitCoreShape["execute"]>[0],
  ) => Effect.Effect<{ code: number; stdout: string; stderr: string }, unknown, never>;
  gitStatusDetails: (
    cwd: string,
  ) => Effect.Effect<{ hasWorkingTreeChanges: boolean }, unknown, never>;
  gitPrepareCommitContext: (cwd: string) => Effect.Effect<object | null, unknown, never>;
  gitCommit: (
    cwd: string,
    title: string,
    body?: string,
  ) => Effect.Effect<void, unknown, never>;
  removeWorktree: (input: {
    cwd: string;
    path: string;
    force?: boolean;
  }) => Effect.Effect<void, unknown, never>;
  dispatchOrchestration: (
    command: {
      type: "thread.create";
      commandId: CommandId;
      threadId: ThreadId;
      projectId: ProjectId;
      title: string;
      systemPrompt: string;
      modelSelection: ModelSelection;
      runtimeMode: "full-access";
      interactionMode: "default";
      branch: string | null;
      worktreePath: string | null;
      createdAt: string;
    },
  ) => Effect.Effect<void, unknown, never>;
  resolveModelSelectionForAttempt: (
    context: AttemptWorkspaceContextRow,
  ) => Effect.Effect<ModelSelection, unknown, never>;
  makeId: <T extends { make: (value: string) => unknown }>(
    schema: T,
    prefix: string,
  ) => ReturnType<T["make"]>;
  nowIso: () => string;
  buildReviewWorkerSystemPrompt: () => string;
  buildReviewWorkerPrompt: (input: ReviewWorkerPromptInput) => string;
  queueTurnStart: (input: {
    threadId: string;
    titleSeed: string;
    selection: ModelSelection;
    text: string;
  }) => Effect.Effect<void, unknown, never>;
  readTicketForPolicy: (ticketId: string) => Effect.Effect<TicketPolicyRow | null, unknown, never>;
  readLatestWorkerHandoffForAttempt: (
    attemptId: string,
  ) => Effect.Effect<WorkerHandoffRecord | null, unknown, never>;
  createOrUpdateFinding: (
    input: PresenceCreateOrUpdateFindingInput,
  ) => Effect.Effect<FindingRecord, unknown, never>;
  sql: SqlClient;
  createReviewArtifact: (
    input: PresenceReviewArtifactInput,
  ) => Effect.Effect<ReviewArtifactRecord, unknown, never>;
  syncTicketProjectionBestEffort: (
    ticketId: string,
    dirtyReason: string,
  ) => Effect.Effect<void, unknown, never>;
  readLatestCapabilityScan: (
    repositoryId: string,
  ) => Effect.Effect<RepositoryCapabilityScanRecord | null, unknown, never>;
  readLatestMergeApprovedDecisionForAttempt: (
    attemptId: string,
  ) => Effect.Effect<ReviewDecisionRecord | null, unknown, never>;
  readAttemptWorkspaceContext: (
    attemptId: string,
  ) => Effect.Effect<AttemptWorkspaceContextRow | null, unknown, never>;
  readLatestMergeOperationForAttempt: (
    attemptId: string,
  ) => Effect.Effect<MergeOperationRecord | null, unknown, never>;
  evaluateSupervisorActionInternal: (input: {
    action: SupervisorActionKind;
    ticketId: string;
    attemptId?: string | null;
  }) => Effect.Effect<SupervisorPolicyDecision, PresenceRpcError, never>;
  persistMergeOperation: (
    input: PresencePersistMergeOperationInput,
  ) => Effect.Effect<MergeOperationRecord, unknown, never>;
  readMergeOperationById: (
    mergeOperationId: string,
  ) => Effect.Effect<MergeOperationRecord | null, unknown, never>;
  updateFindingStatus: (
    findingId: string,
    status: typeof PresenceFindingStatus.Type,
  ) => Effect.Effect<FindingRecord, unknown, never>;
  writeAttemptOutcome: (
    input: PresenceWriteAttemptOutcomeInput,
  ) => Effect.Effect<AttemptOutcomeRecord, unknown, never>;
  resolveOpenFindings: (
    input: PresenceResolveOpenFindingsInput,
  ) => Effect.Effect<ReadonlyArray<FindingRecord>, unknown, never>;
  materializeReviewFindings: (input: {
    ticketId: string;
    attemptId: string;
    findings: ReadonlyArray<PresenceReviewFindingInput>;
  }) => Effect.Effect<ReadonlyArray<FindingRecord>, unknown, never>;
  markTicketMechanismChecklist: (ticketId: string) => Effect.Effect<void, unknown, never>;
  syncThreadWorkspaceMetadata: (input: {
    threadId: string;
    branch: string | null;
    worktreePath: string | null;
  }) => Effect.Effect<void, unknown, never>;
}>;

const makePresenceReviewMergeService = (
  deps: MakePresenceReviewMergeServiceDeps,
): PresenceReviewMergeService => {
  const decode = Schema.decodeUnknownSync;
  const readCurrentBranchName = (cwd: string) =>
    deps.gitExecute({
        operation: "Presence.readCurrentBranchName",
        cwd,
        args: ["branch", "--show-current"],
        allowNonZeroExit: true,
        timeoutMs: 5_000,
        maxOutputBytes: 4_096,
      })
      .pipe(
        Effect.map((result: { code: number; stdout: string }) => {
          const branch = result.stdout.trim();
          return result.code === 0 && branch.length > 0 ? branch : null;
        }),
        Effect.mapError((cause) =>
          deps.presenceError("Failed to read the repository base branch.", cause),
        ),
      );

  const readDirtyPaths = (cwd: string) =>
    deps.gitExecute({
        operation: "Presence.readDirtyPaths",
        cwd,
        args: ["status", "--porcelain", "--untracked-files=all"],
        allowNonZeroExit: true,
        timeoutMs: 5_000,
        maxOutputBytes: 16_384,
      })
      .pipe(
        Effect.map((result: { stdout: string }) =>
          result.stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => line.slice(3).split(" -> ").at(-1)?.trim() ?? "")
            .filter(Boolean),
        ),
        Effect.mapError((cause) =>
          deps.presenceError("Failed to inspect repository dirtiness.", cause),
        ),
      );

  const isPresenceProjectionPath = (value: string) => {
    const normalized = value.replace(/\\/g, "/");
    return normalized === ".presence" || normalized.startsWith(".presence/");
  };

  const hasHeadCommit = (cwd: string) =>
    deps.gitExecute({
        operation: "Presence.hasHeadCommit",
        cwd,
        args: ["rev-parse", "--verify", "HEAD"],
        allowNonZeroExit: true,
        timeoutMs: 5_000,
        maxOutputBytes: 4_096,
      })
      .pipe(
        Effect.map((result: { code: number }) => result.code === 0),
        Effect.mapError((cause) =>
          deps.presenceError("Failed to inspect repository history.", cause),
        ),
      );

  const isMergeInProgress = (cwd: string) =>
    deps.gitExecute({
        operation: "Presence.isMergeInProgress",
        cwd,
        args: ["rev-parse", "--verify", "MERGE_HEAD"],
        allowNonZeroExit: true,
        timeoutMs: 5_000,
        maxOutputBytes: 4_096,
      })
      .pipe(
        Effect.map((result: { code: number }) => result.code === 0),
        Effect.mapError((cause) => deps.presenceError("Failed to inspect merge state.", cause)),
      );

  const readRefHeadSha = (
    cwd: string,
    ref: string,
  ): Effect.Effect<string | null, PresenceRpcError, never> =>
    deps.gitExecute({
        operation: "Presence.readRefHeadSha",
        cwd,
        args: ["rev-parse", "--verify", ref],
        allowNonZeroExit: true,
        timeoutMs: 5_000,
        maxOutputBytes: 4_096,
      })
      .pipe(
        Effect.map((result: { code: number; stdout: string }) => {
          const value = result.stdout.trim();
          return result.code === 0 && value.length > 0 ? value : null;
        }),
        Effect.mapError((cause) =>
          deps.presenceError(`Failed to read git ref '${ref}'.`, cause),
        ),
      );

  const isBranchMergedIntoBase = (cwd: string, sourceBranch: string, baseBranch: string) =>
    deps.gitExecute({
        operation: "Presence.isBranchMergedIntoBase",
        cwd,
        args: ["merge-base", "--is-ancestor", sourceBranch, baseBranch],
        allowNonZeroExit: true,
        timeoutMs: 5_000,
        maxOutputBytes: 4_096,
      })
      .pipe(
        Effect.map((result: { code: number }) => result.code === 0),
        Effect.mapError((cause) =>
          deps.presenceError("Failed to inspect merge ancestry.", cause),
        ),
      );

  const ensureAttemptWorkspaceCommitted = (context: AttemptWorkspaceContextRow) =>
    Effect.gen(function* () {
      const worktreePath = context.workspaceWorktreePath?.trim() ?? null;
      if (!worktreePath) {
        return yield* Effect.fail(
          deps.presenceError(`Attempt '${context.attemptId}' does not have an active worktree to merge.`),
        );
      }

      const workspaceDetails = yield* deps.gitStatusDetails(worktreePath).pipe(
        Effect.mapError((cause) =>
          deps.presenceError("Failed to inspect the attempt workspace.", cause),
        ),
      );

      if (workspaceDetails.hasWorkingTreeChanges) {
        const prepared = yield* deps.gitPrepareCommitContext(worktreePath).pipe(
          Effect.mapError((cause) =>
            deps.presenceError("Failed to stage the attempt workspace before merge.", cause),
          ),
        );
        if (!prepared) {
          return yield* Effect.fail(
            deps.presenceError("The attempt workspace has no staged changes to commit before merge."),
          );
        }

        yield* deps.gitCommit(
            worktreePath,
            `presence: complete ${context.ticketTitle}`,
            [
              `Attempt: ${context.attemptTitle}`,
              `Ticket: ${context.ticketId}`,
              "Committed automatically during Presence merge approval.",
            ].join("\n"),
          ).pipe(
            Effect.mapError((cause) =>
              deps.presenceError("Failed to commit the attempt workspace before merge.", cause),
            ),
          );
      }

      const workspaceHasCommit = yield* hasHeadCommit(worktreePath);
      if (!workspaceHasCommit) {
        return yield* Effect.fail(
          deps.presenceError(
            `Attempt '${context.attemptId}' has no committed work yet. Commit changes in the attempt workspace before merging.`,
          ),
        );
      }
    });

  const readMergePreflightState = (
    context: AttemptWorkspaceContextRow,
  ): Effect.Effect<
    {
      readonly baseBranch: string;
      readonly sourceBranch: string;
      readonly baseHeadBefore: string | null;
      readonly sourceHeadSha: string | null;
      readonly expectedBaseBranch: string | null;
    },
    PresenceRpcError,
    never
  > =>
    Effect.gen(function* () {
      const sourceBranch = context.workspaceBranch?.trim() ?? null;
      if (!sourceBranch) {
        return yield* Effect.fail(
          deps.presenceError(`Attempt '${context.attemptId}' does not have a workspace branch to merge.`),
        );
      }

      const baseBranch = yield* readCurrentBranchName(context.workspaceRoot);
      if (!baseBranch) {
        return yield* Effect.fail(
          deps.presenceError(
            `Workspace root '${context.workspaceRoot}' is missing an active base branch for merge.`,
          ),
        );
      }
      const expectedBaseBranch =
        (yield* deps.readLatestCapabilityScan(context.repositoryId))?.baseBranch ?? null;
      if (expectedBaseBranch && baseBranch !== expectedBaseBranch) {
        return yield* Effect.fail(
          deps.presenceError(
            `Presence expected to merge into '${expectedBaseBranch}', but '${baseBranch}' is currently checked out in the base workspace.`,
          ),
        );
      }

      const rootHasCommit = yield* hasHeadCommit(context.workspaceRoot);
      if (rootHasCommit) {
        const dirtyPaths = (yield* readDirtyPaths(context.workspaceRoot)).filter(
          (candidate: string) => !isPresenceProjectionPath(candidate),
        );
        if (dirtyPaths.length > 0) {
          return yield* Effect.fail(
            deps.presenceError(
              `The base workspace must be clean before merge approval. Dirty paths: ${dirtyPaths.join(", ")}.`,
            ),
          );
        }
      }

      const [baseHeadBefore, sourceHeadSha] = yield* Effect.all([
        readRefHeadSha(context.workspaceRoot, baseBranch),
        readRefHeadSha(context.workspaceRoot, sourceBranch),
      ]);

      return {
        baseBranch,
        sourceBranch,
        baseHeadBefore,
        sourceHeadSha,
        expectedBaseBranch,
      } as const;
    }).pipe(
      Effect.mapError((cause) =>
        deps.presenceError("Failed to prepare merge state.", cause),
      ),
    );

  const tryAbortBaseMerge = (cwd: string) =>
    Effect.gen(function* () {
      const mergeRunning = yield* isMergeInProgress(cwd);
      if (!mergeRunning) {
        return false;
      }
      yield* deps.gitExecute({
          operation: "Presence.abortMergeAttemptIntoBase",
          cwd,
          args: ["merge", "--abort"],
          allowNonZeroExit: false,
          timeoutMs: 15_000,
        }).pipe(
          Effect.mapError((cause) =>
            deps.presenceError("Failed to abort the in-progress merge.", cause),
          ),
        );
      return true;
    });

  const mergeAttemptIntoBase = (
    context: AttemptWorkspaceContextRow,
    preflight: {
      baseBranch: string;
      sourceBranch: string;
      sourceHeadSha: string | null;
      baseHeadBefore: string | null;
      expectedBaseBranch: string | null;
    },
  ) =>
    Effect.gen(function* () {
      if (preflight.baseBranch === preflight.sourceBranch) {
        const head = yield* readRefHeadSha(context.workspaceRoot, preflight.baseBranch);
        return {
          ok: true as const,
          baseBranch: preflight.baseBranch,
          sourceBranch: preflight.sourceBranch,
          baseHeadBefore: preflight.baseHeadBefore,
          sourceHeadSha: preflight.sourceHeadSha,
          baseHeadAfter: head,
          mergeCommitSha: head,
          gitAbortAttempted: false,
          repositoryLeftMidMerge: false,
          errorSummary: null,
        };
      }

      const rootHasCommit = yield* hasHeadCommit(context.workspaceRoot);
      if (rootHasCommit) {
        const mergeResult = yield* deps.gitExecute({
            operation: "Presence.mergeAttemptIntoBase",
            cwd: context.workspaceRoot,
            args: ["merge", "--no-ff", "--no-edit", preflight.sourceBranch],
            allowNonZeroExit: true,
            timeoutMs: 30_000,
          }).pipe(
            Effect.mapError((cause) =>
              deps.presenceError("Failed to merge the accepted attempt.", cause),
            ),
          );
        if (mergeResult.code !== 0) {
          const abortOutcome = yield* Effect.exit(tryAbortBaseMerge(context.workspaceRoot));
          const gitAbortAttempted = abortOutcome._tag === "Success" ? abortOutcome.value : true;
          const repositoryLeftMidMerge = yield* isMergeInProgress(context.workspaceRoot);
          const stderrSummary = summarizeCommandOutput(mergeResult.stderr);
          const stdoutSummary = summarizeCommandOutput(mergeResult.stdout);
          const errorSummaryParts = [
            "Failed to merge the accepted attempt into the base branch.",
            stderrSummary,
            stdoutSummary,
            abortOutcome._tag === "Failure"
              ? "Presence also failed to abort the in-progress merge automatically."
              : repositoryLeftMidMerge
                ? "Git still reports an in-progress merge in the base workspace."
                : null,
          ].filter((value): value is string => Boolean(value));
          return {
            ok: false as const,
            baseBranch: preflight.baseBranch,
            sourceBranch: preflight.sourceBranch,
            baseHeadBefore: preflight.baseHeadBefore,
            sourceHeadSha: preflight.sourceHeadSha,
            baseHeadAfter: yield* readRefHeadSha(context.workspaceRoot, preflight.baseBranch),
            mergeCommitSha: null,
            gitAbortAttempted,
            repositoryLeftMidMerge:
              repositoryLeftMidMerge || abortOutcome._tag === "Failure",
            errorSummary: errorSummaryParts.join(" "),
          };
        }
      } else {
        const resetResult = yield* deps.gitExecute({
            operation: "Presence.mergeAttemptIntoBase.emptyHead",
            cwd: context.workspaceRoot,
            args: ["reset", "--hard", preflight.sourceBranch],
            allowNonZeroExit: true,
            timeoutMs: 15_000,
          }).pipe(
            Effect.mapError((cause) =>
              deps.presenceError(
                "Failed to materialize the accepted attempt into the empty base branch.",
                cause,
              ),
            ),
          );
        if (resetResult.code !== 0) {
          const stderrSummary = summarizeCommandOutput(resetResult.stderr);
          const stdoutSummary = summarizeCommandOutput(resetResult.stdout);
          return {
            ok: false as const,
            baseBranch: preflight.baseBranch,
            sourceBranch: preflight.sourceBranch,
            baseHeadBefore: preflight.baseHeadBefore,
            sourceHeadSha: preflight.sourceHeadSha,
            baseHeadAfter: yield* readRefHeadSha(context.workspaceRoot, preflight.baseBranch),
            mergeCommitSha: null,
            gitAbortAttempted: false,
            repositoryLeftMidMerge: false,
            errorSummary: [
              "Failed to materialize the accepted attempt into the empty base branch.",
              stderrSummary,
              stdoutSummary,
            ]
              .filter((value): value is string => Boolean(value))
              .join(" "),
          };
        }
      }

      const baseHeadAfter = yield* readRefHeadSha(context.workspaceRoot, preflight.baseBranch);
      return {
        ok: true as const,
        baseBranch: preflight.baseBranch,
        sourceBranch: preflight.sourceBranch,
        baseHeadBefore: preflight.baseHeadBefore,
        sourceHeadSha: preflight.sourceHeadSha,
        baseHeadAfter,
        mergeCommitSha: baseHeadAfter,
        gitAbortAttempted: false,
        repositoryLeftMidMerge: false,
        errorSummary: null,
      };
    });

  const resolveOpenMergeFailureFindingsExplicit = (ticketId: string, attemptId: string) =>
    Effect.gen(function* () {
      const findings = yield* deps.sql<{
        id: string;
        summary: string;
        attemptId: string | null;
        source: string;
        status: string;
      }>`
        SELECT
          finding_id as id,
          summary,
          attempt_id as "attemptId",
          source,
          status
        FROM presence_findings
        WHERE ticket_id = ${ticketId}
      `.pipe(
        Effect.map(
          (
            rows: ReadonlyArray<{
              id: string;
              summary: string;
              attemptId: string | null;
              source: string;
              status: string;
            }>,
          ) => rows,
        ),
      );
      for (const finding of findings) {
        if (
          finding.status === "open" &&
          finding.attemptId === attemptId &&
          finding.source === "supervisor" &&
          /^Merge approval failed/i.test(finding.summary)
        ) {
          yield* deps.updateFindingStatus(finding.id, "resolved");
        }
      }
    });

  const cleanupMergedAttemptResources = (input: {
    context: AttemptWorkspaceContextRow;
    operation: MergeOperationRecord;
  }) =>
    Effect.gen(function* () {
      const updatedAt = deps.nowIso();
      let cleanupWorktreeDone =
        input.operation.cleanupWorktreeDone || !input.context.workspaceWorktreePath;
      let cleanupThreadDone =
        input.operation.cleanupThreadDone || !input.context.attemptThreadId;
      const cleanupErrors: string[] = [];

      if (!cleanupWorktreeDone && input.context.workspaceWorktreePath) {
        const removeOutcome = yield* Effect.exit(
          deps.removeWorktree({
            cwd: input.context.workspaceRoot,
            path: input.context.workspaceWorktreePath,
            force: true,
          }),
        );
        if (removeOutcome._tag === "Success") {
          cleanupWorktreeDone = true;
          yield* deps.sql`
            UPDATE presence_workspaces
            SET
              status = ${"cleaned_up"},
              worktree_path = ${null},
              updated_at = ${updatedAt}
            WHERE workspace_id = ${input.context.workspaceId}
          `;
        } else {
          cleanupErrors.push("Presence could not remove the merged attempt worktree yet.");
        }
      } else if (cleanupWorktreeDone) {
        yield* deps.sql`
          UPDATE presence_workspaces
          SET
            status = ${"cleaned_up"},
            worktree_path = ${null},
            updated_at = ${updatedAt}
          WHERE workspace_id = ${input.context.workspaceId}
        `;
      }

      if (!cleanupThreadDone && input.context.attemptThreadId) {
        const threadOutcome = yield* Effect.exit(
          deps.syncThreadWorkspaceMetadata({
            threadId: input.context.attemptThreadId,
            branch: null,
            worktreePath: null,
          }),
        );
        if (threadOutcome._tag === "Success") {
          cleanupThreadDone = true;
        } else {
          cleanupErrors.push(
            "Presence could not detach the worker session from its merged worktree yet.",
          );
        }
      }

      const nextStatus =
        cleanupWorktreeDone && cleanupThreadDone ? "finalized" : "cleanup_pending";
      const updatedOperation = yield* deps.persistMergeOperation({
        id: input.operation.id,
        ticketId: input.operation.ticketId,
        attemptId: input.operation.attemptId,
        status: nextStatus,
        baseBranch: input.operation.baseBranch,
        sourceBranch: input.operation.sourceBranch,
        sourceHeadSha: input.operation.sourceHeadSha,
        baseHeadBefore: input.operation.baseHeadBefore,
        baseHeadAfter: input.operation.baseHeadAfter,
        mergeCommitSha: input.operation.mergeCommitSha,
        errorSummary: cleanupErrors.length > 0 ? cleanupErrors.join(" ") : null,
        gitAbortAttempted: input.operation.gitAbortAttempted,
        cleanupWorktreeDone,
        cleanupThreadDone,
        createdAt: input.operation.createdAt,
      });

      return {
        operation: updatedOperation,
        cleanupPending: nextStatus === "cleanup_pending",
      };
    });

  const startReviewSession = (input: {
    attempt: AttemptWorkspaceContextRow;
    ticketSummary: TicketSummaryRecord | null;
    workerHandoff: WorkerHandoffRecord | null;
    findings: ReadonlyArray<FindingRecord>;
    priorReviewArtifacts: ReadonlyArray<ReviewArtifactRecord>;
    supervisorNote: string;
  }) =>
    Effect.gen(function* () {
      if (!input.attempt.projectId) {
        return yield* Effect.fail(
          deps.presenceError("Cannot start a review session without a project context."),
        );
      }
      const selection = yield* deps.resolveModelSelectionForAttempt(input.attempt);
      const reviewThreadId = deps.makeId(ThreadId, "presence_review_thread");
      yield* deps.dispatchOrchestration({
        type: "thread.create",
        commandId: CommandId.make(`presence_review_thread_create_${crypto.randomUUID()}`),
        threadId: reviewThreadId,
        projectId: ProjectId.make(input.attempt.projectId),
        title: `${input.attempt.ticketTitle} - review`,
        systemPrompt: deps.buildReviewWorkerSystemPrompt(),
        modelSelection: selection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: input.attempt.workspaceBranch,
        worktreePath: input.attempt.workspaceWorktreePath,
        createdAt: deps.nowIso(),
      }).pipe(
        Effect.catch((cause) =>
          Effect.fail(deps.presenceError("Failed to create the review thread.", cause)),
        ),
      );
      const kickoffOutcome = yield* Effect.exit(
        deps.queueTurnStart({
        threadId: reviewThreadId,
        titleSeed: `${input.attempt.ticketTitle} review`,
        selection,
        text: deps.buildReviewWorkerPrompt({
          ticketTitle: input.attempt.ticketTitle,
          ticketDescription: input.attempt.ticketDescription,
          acceptanceChecklist: input.attempt.ticketAcceptanceChecklist,
          ticketSummary: input.ticketSummary,
          attemptId: input.attempt.attemptId,
          attemptStatus: decode(PresenceAttemptStatus)(input.attempt.attemptStatus),
          workerHandoff: input.workerHandoff,
          findings: input.findings,
          priorReviewArtifacts: input.priorReviewArtifacts,
          repoRoot: input.attempt.workspaceRoot,
          worktreePath: input.attempt.workspaceWorktreePath,
          branch: input.attempt.workspaceBranch,
          supervisorNote: input.supervisorNote,
        }),
      }),
      );
      if (kickoffOutcome._tag === "Failure") {
        return reviewThreadId;
      }
      return reviewThreadId;
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(deps.presenceError("Failed to start the review session.", cause)),
      ),
    );

  const blockTicketForReviewFailure = (input: {
    ticketId: string;
    attemptId: string;
    reviewThreadId: string | null;
    summary: string;
    rationale: string;
  }) =>
    Effect.gen(function* () {
      const ticket = yield* deps.readTicketForPolicy(input.ticketId);
      if (!ticket) {
        return yield* Effect.fail(deps.presenceError(`Ticket '${input.ticketId}' not found.`));
      }
      const latestWorkerHandoff = yield* deps.readLatestWorkerHandoffForAttempt(input.attemptId);
      const finding = yield* deps.createOrUpdateFinding({
        ticketId: input.ticketId,
        attemptId: input.attemptId,
        source: "supervisor",
        severity: "blocking",
        disposition: "escalate",
        summary: input.summary,
        rationale: input.rationale,
      });
      yield* deps.sql`
        UPDATE presence_tickets
        SET status = ${"blocked"}, updated_at = ${deps.nowIso()}
        WHERE ticket_id = ${input.ticketId}
      `;
      yield* deps.createReviewArtifact({
        ticketId: input.ticketId,
        attemptId: input.attemptId,
        reviewerKind: "review_agent",
        decision: null,
        summary: input.summary,
        checklistJson: ticket.acceptanceChecklist,
        checklistAssessment: [],
        evidence: [
          {
            kind: "reasoning",
            target: null,
            outcome: "inconclusive",
            relevant: true,
            summary: input.rationale,
            details: "Supervisor recorded this artifact because the review output failed or was malformed.",
          },
        ],
        changedFiles: latestWorkerHandoff?.changedFiles ?? [],
        changedFilesReviewed: [],
        findingIds: [finding.id],
        threadId: input.reviewThreadId,
      });
      yield* deps.syncTicketProjectionBestEffort(
        input.ticketId,
        "Review output failed or was malformed.",
      );
      return finding;
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(deps.presenceError("Failed to block the ticket for review failure.", cause)),
      ),
    );

  const handleMergeApprovedDecision = (input: {
    ticketId: string;
    attemptId: string;
    notes: string;
    reviewerKind: "human" | "policy" | "review_agent";
    ticketForReview: TicketPolicyRow;
    latestWorkerHandoff: WorkerHandoffRecord | null;
  }) =>
    Effect.gen(function* () {
      const existingDecision = yield* deps.readLatestMergeApprovedDecisionForAttempt(input.attemptId);
      const context = yield* deps.readAttemptWorkspaceContext(input.attemptId);
      if (!context) {
        return yield* Effect.fail(deps.presenceError(`Attempt '${input.attemptId}' not found.`));
      }

      let mergeOperation = yield* deps.readLatestMergeOperationForAttempt(input.attemptId);
      if (
        mergeOperation?.status === "finalized" &&
        decode(PresenceAttemptStatus)(context.attemptStatus) === "merged" &&
        input.ticketForReview.status === "done"
      ) {
        if (existingDecision) {
          return existingDecision;
        }
        return {
          id: deps.makeId(ReviewDecisionId, "review"),
          ticketId: TicketId.make(input.ticketId),
          attemptId: AttemptId.make(input.attemptId),
          decision: "merge_approved",
          notes: input.notes,
          createdAt: mergeOperation.updatedAt,
        } satisfies ReviewDecisionRecord;
      }

      if (mergeOperation?.status === "cleanup_pending") {
        const cleanupResult = yield* cleanupMergedAttemptResources({
          context,
          operation: mergeOperation,
        });
        yield* deps.syncTicketProjectionBestEffort(
          input.ticketId,
          cleanupResult.cleanupPending
            ? "Merged attempt still has cleanup pending."
            : "Merged attempt cleanup completed.",
        );
        if (existingDecision) {
          return existingDecision;
        }
        return yield* Effect.fail(
          deps.presenceError(
            "Presence recovered merge cleanup state, but the original merge approval decision record is missing.",
          ),
        );
      }

      const policy = yield* deps.evaluateSupervisorActionInternal({
        action: "merge_attempt",
        ticketId: input.ticketId,
        attemptId: input.attemptId,
      });
      if (!policy.allowed) {
        const blockedFinding = yield* deps.createOrUpdateFinding({
          ticketId: input.ticketId,
          attemptId: input.attemptId,
          source: "supervisor",
          severity: "blocking",
          disposition: "same_ticket",
          summary: "Merge blocked by supervisor policy.",
          rationale: policy.reasons.join(" "),
        });
        yield* deps.createReviewArtifact({
          ticketId: input.ticketId,
          attemptId: input.attemptId,
          reviewerKind: "policy",
          decision: null,
          summary: "Merge was blocked by supervisor policy.",
          checklistJson: input.ticketForReview.acceptanceChecklist,
          checklistAssessment: [],
          evidence: [],
          changedFiles: input.latestWorkerHandoff?.changedFiles ?? [],
          changedFilesReviewed: [],
          findingIds: [blockedFinding.id],
        });
        yield* deps.syncTicketProjectionBestEffort(input.ticketId, "Merge approval blocked by policy.");
        return yield* Effect.fail(deps.presenceError(policy.reasons.join(" ")));
      }

      if (!mergeOperation || !mergeOperationIsNonTerminal(mergeOperation.status)) {
        const preflight = yield* readMergePreflightState(context);
        mergeOperation = yield* deps.persistMergeOperation({
          id: deps.makeId(MergeOperationId, "merge_operation"),
          ticketId: input.ticketId,
          attemptId: input.attemptId,
          status: "pending_git",
          baseBranch: preflight.baseBranch,
          sourceBranch: preflight.sourceBranch,
          sourceHeadSha: preflight.sourceHeadSha,
          baseHeadBefore: preflight.baseHeadBefore,
        });
      }

      if (mergeOperation.status === "pending_git") {
        yield* ensureAttemptWorkspaceCommitted(context);
        const preflight = yield* readMergePreflightState(context);
        mergeOperation = yield* deps.persistMergeOperation({
          id: mergeOperation.id,
          ticketId: mergeOperation.ticketId,
          attemptId: mergeOperation.attemptId,
          status: "pending_git",
          baseBranch: preflight.baseBranch,
          sourceBranch: preflight.sourceBranch,
          sourceHeadSha: preflight.sourceHeadSha,
          baseHeadBefore: preflight.baseHeadBefore,
          baseHeadAfter: mergeOperation.baseHeadAfter,
          mergeCommitSha: mergeOperation.mergeCommitSha,
          errorSummary: null,
          gitAbortAttempted: mergeOperation.gitAbortAttempted,
          cleanupWorktreeDone: mergeOperation.cleanupWorktreeDone,
          cleanupThreadDone: mergeOperation.cleanupThreadDone,
          createdAt: mergeOperation.createdAt,
        });
        const alreadyMerged =
          mergeOperation.baseBranch === mergeOperation.sourceBranch
            ? true
            : yield* isBranchMergedIntoBase(
                context.workspaceRoot,
                mergeOperation.sourceBranch,
                mergeOperation.baseBranch,
              );
        if (alreadyMerged) {
          const baseHeadAfter = yield* readRefHeadSha(
            context.workspaceRoot,
            mergeOperation.baseBranch,
          );
          mergeOperation = yield* deps.persistMergeOperation({
            id: mergeOperation.id,
            ticketId: mergeOperation.ticketId,
            attemptId: mergeOperation.attemptId,
            status: "git_applied",
            baseBranch: mergeOperation.baseBranch,
            sourceBranch: mergeOperation.sourceBranch,
            sourceHeadSha: mergeOperation.sourceHeadSha,
            baseHeadBefore: mergeOperation.baseHeadBefore,
            baseHeadAfter,
            mergeCommitSha: baseHeadAfter,
            errorSummary: null,
            gitAbortAttempted: mergeOperation.gitAbortAttempted,
            cleanupWorktreeDone: mergeOperation.cleanupWorktreeDone,
            cleanupThreadDone: mergeOperation.cleanupThreadDone,
            createdAt: mergeOperation.createdAt,
          });
        } else {
          const mergeResult = yield* mergeAttemptIntoBase(context, preflight);
          if (!mergeResult.ok) {
            mergeOperation = yield* deps.persistMergeOperation({
              id: mergeOperation.id,
              ticketId: mergeOperation.ticketId,
              attemptId: mergeOperation.attemptId,
              status: "failed",
              baseBranch: mergeOperation.baseBranch,
              sourceBranch: mergeOperation.sourceBranch,
              sourceHeadSha: mergeOperation.sourceHeadSha,
              baseHeadBefore: mergeResult.baseHeadBefore,
              baseHeadAfter: mergeResult.baseHeadAfter,
              mergeCommitSha: mergeResult.mergeCommitSha,
              errorSummary: mergeResult.errorSummary,
              gitAbortAttempted: mergeResult.gitAbortAttempted,
              cleanupWorktreeDone: mergeOperation.cleanupWorktreeDone,
              cleanupThreadDone: mergeOperation.cleanupThreadDone,
              createdAt: mergeOperation.createdAt,
            });
            const mergeFailureFinding = yield* deps.createOrUpdateFinding({
              ticketId: input.ticketId,
              attemptId: input.attemptId,
              source: "supervisor",
              severity: "blocking",
              disposition: mergeResult.repositoryLeftMidMerge ? "escalate" : "same_ticket",
              summary: "Merge approval failed for this accepted attempt.",
              rationale: mergeResult.errorSummary,
            });
            if (mergeResult.repositoryLeftMidMerge) {
              yield* deps.sql`
                UPDATE presence_tickets
                SET status = ${"blocked"}, updated_at = ${deps.nowIso()}
                WHERE ticket_id = ${input.ticketId}
              `;
            }
            yield* deps.createReviewArtifact({
              ticketId: input.ticketId,
              attemptId: input.attemptId,
              reviewerKind: input.reviewerKind,
              decision: null,
              summary: mergeResult.errorSummary,
              checklistJson: input.ticketForReview.acceptanceChecklist,
              checklistAssessment: [],
              evidence: [],
              changedFiles: input.latestWorkerHandoff?.changedFiles ?? [],
              changedFilesReviewed: [],
              findingIds: [mergeFailureFinding.id],
            });
            yield* deps.syncTicketProjectionBestEffort(input.ticketId, "Merge approval failed.");
            return yield* Effect.fail(deps.presenceError(mergeResult.errorSummary));
          }

          mergeOperation = yield* deps.persistMergeOperation({
            id: mergeOperation.id,
            ticketId: mergeOperation.ticketId,
            attemptId: mergeOperation.attemptId,
            status: "git_applied",
            baseBranch: mergeResult.baseBranch,
            sourceBranch: mergeResult.sourceBranch,
            sourceHeadSha: mergeResult.sourceHeadSha,
            baseHeadBefore: mergeResult.baseHeadBefore,
            baseHeadAfter: mergeResult.baseHeadAfter,
            mergeCommitSha: mergeResult.mergeCommitSha,
            errorSummary: null,
            gitAbortAttempted: false,
            cleanupWorktreeDone: false,
            cleanupThreadDone: false,
            createdAt: mergeOperation.createdAt,
          });
        }
      }

      if (mergeOperation.status !== "git_applied") {
        return yield* Effect.fail(
          deps.presenceError(
            `Presence expected merge operation '${mergeOperation.id}' to be in git_applied state before finalization.`,
          ),
        );
      }

      const decisionId = deps.makeId(ReviewDecisionId, "review");
      const createdAt = deps.nowIso();
      yield* deps.sql.withTransaction(
        Effect.gen(function* () {
          yield* deps.sql`
            INSERT INTO presence_review_decisions (
              review_decision_id, ticket_id, attempt_id, decision, notes, created_at
            ) VALUES (
              ${decisionId},
              ${input.ticketId},
              ${input.attemptId},
              ${"merge_approved"},
              ${input.notes},
              ${createdAt}
            )
          `;
          yield* deps.sql`
            UPDATE presence_attempts
            SET status = ${"merged"}, updated_at = ${createdAt}
            WHERE attempt_id = ${input.attemptId}
          `;
          yield* deps.sql`
            UPDATE presence_tickets
            SET status = ${policy.recommendedTicketStatus ?? "done"}, updated_at = ${createdAt}
            WHERE ticket_id = ${input.ticketId}
          `;
          yield* deps.sql`
            UPDATE presence_merge_operations
            SET status = ${"finalized"}, error_summary = ${null}, updated_at = ${createdAt}
            WHERE merge_operation_id = ${mergeOperation.id}
          `;
          yield* deps.writeAttemptOutcome({
            attemptId: input.attemptId,
            kind: "merged",
            summary: "The approved attempt was merged into the base branch.",
          });
          yield* resolveOpenMergeFailureFindingsExplicit(input.ticketId, input.attemptId);
          yield* deps.createReviewArtifact({
            ticketId: input.ticketId,
            attemptId: input.attemptId,
            reviewerKind: input.reviewerKind,
            decision: null,
            summary: input.notes.trim() || "Merge approval completed.",
            checklistJson: input.ticketForReview.acceptanceChecklist,
            checklistAssessment: [],
            evidence: [],
            changedFiles: input.latestWorkerHandoff?.changedFiles ?? [],
            changedFilesReviewed: [],
            findingIds: [],
          });
        }),
      );

      const finalizedOperation = yield* deps.readMergeOperationById(mergeOperation.id);
      if (!finalizedOperation) {
        return yield* Effect.fail(
          deps.presenceError(
            `Merge operation '${mergeOperation.id}' could not be reloaded after finalization.`,
          ),
        );
      }
      const cleanupResult = yield* cleanupMergedAttemptResources({
        context,
        operation: finalizedOperation,
      });
      yield* deps.syncTicketProjectionBestEffort(
        input.ticketId,
        cleanupResult.cleanupPending
          ? "Merge finalized with cleanup still pending."
          : "Merge finalized and cleanup completed.",
      );

      return {
        id: ReviewDecisionId.make(decisionId),
        ticketId: TicketId.make(input.ticketId),
        attemptId: AttemptId.make(input.attemptId),
        decision: "merge_approved",
        notes: input.notes,
        createdAt,
      } satisfies ReviewDecisionRecord;
    });

  const applyReviewDecisionInternal = (input: {
    ticketId: string;
    attemptId?: string | null;
    decision: PresenceReviewDecisionKind;
    notes: string;
    reviewerKind: "human" | "policy" | "review_agent";
    reviewThreadId?: string | null;
    reviewFindings?: ReadonlyArray<PresenceReviewFindingInput>;
    reviewChecklistAssessment?: ReadonlyArray<ReviewChecklistAssessmentItem>;
    reviewEvidence?: ReadonlyArray<ReviewEvidenceItem>;
    changedFilesReviewed?: ReadonlyArray<string>;
    mechanismChecklistSupported?: boolean;
  }) =>
    Effect.gen(function* () {
      const decisionId = deps.makeId(ReviewDecisionId, "review");
      const createdAt = deps.nowIso();
      const ticketForReview = yield* deps.readTicketForPolicy(input.ticketId);
      if (!ticketForReview) {
        return yield* Effect.fail(deps.presenceError(`Ticket '${input.ticketId}' not found.`));
      }
      const latestWorkerHandoff =
        input.attemptId && input.attemptId.trim().length > 0
          ? yield* deps.readLatestWorkerHandoffForAttempt(input.attemptId)
          : null;
      const reviewFindingIds: string[] = [];
      let nextTicketStatus: PresenceTicketStatus = "in_review";
      let nextAttemptStatus: PresenceAttemptStatus | null = null;
      const reviewFindings = [...(input.reviewFindings ?? [])];

      if (input.decision === "accept" && reviewFindings.some((finding) => finding.severity === "blocking")) {
        return yield* Effect.fail(
          deps.presenceError("Accepted review results cannot include blocking review findings."),
        );
      }

      if (input.decision === "merge_approved") {
        if (!input.attemptId) {
          return yield* Effect.fail(
            deps.presenceError("Merge approval requires a specific attempt to merge."),
          );
        }
        return yield* handleMergeApprovedDecision({
          ticketId: input.ticketId,
          attemptId: input.attemptId,
          notes: input.notes,
          reviewerKind: input.reviewerKind,
          ticketForReview,
          latestWorkerHandoff,
        });
      }

      if (input.decision === "accept") {
        if (!input.attemptId) {
          return yield* Effect.fail(
            deps.presenceError("Approving a ticket requires a specific attempt."),
          );
        }
        yield* deps.resolveOpenFindings({
          ticketId: input.ticketId,
          attemptId: input.attemptId,
          source: "review",
        });
        const policy = yield* deps.evaluateSupervisorActionInternal({
          action: "approve_attempt",
          ticketId: input.ticketId,
          attemptId: input.attemptId,
        });
        if (!policy.allowed) {
          const blockedFinding = yield* deps.createOrUpdateFinding({
            ticketId: input.ticketId,
            attemptId: input.attemptId,
            source: "supervisor",
            severity: "blocking",
            disposition: "same_ticket",
            summary: "Approval blocked by supervisor policy.",
            rationale: policy.reasons.join(" "),
          });
          yield* deps.createReviewArtifact({
            ticketId: input.ticketId,
            attemptId: input.attemptId,
            reviewerKind: "policy",
            decision: null,
            summary: "Approval was blocked by supervisor policy.",
            checklistJson: ticketForReview.acceptanceChecklist,
            checklistAssessment: [],
            evidence: [],
            changedFiles: latestWorkerHandoff?.changedFiles ?? [],
            changedFilesReviewed: [],
            findingIds: [blockedFinding.id],
          });
          yield* deps.syncTicketProjectionBestEffort(
            input.ticketId,
            "Review policy blocked acceptance.",
          );
          return yield* Effect.fail(deps.presenceError(policy.reasons.join(" ")));
        }
        const acceptedReviewFindings = yield* deps.materializeReviewFindings({
          ticketId: input.ticketId,
          attemptId: input.attemptId,
          findings: reviewFindings,
        });
        reviewFindingIds.push(...acceptedReviewFindings.map((finding) => finding.id));
        nextTicketStatus = policy.recommendedTicketStatus ?? "ready_to_merge";
        nextAttemptStatus = policy.recommendedAttemptStatus ?? "accepted";
      } else if (input.decision === "request_changes") {
        if (!input.attemptId) {
          return yield* Effect.fail(
            deps.presenceError("Requesting changes requires a specific attempt."),
          );
        }
        const policy = yield* deps.evaluateSupervisorActionInternal({
          action: "request_changes",
          ticketId: input.ticketId,
          attemptId: input.attemptId,
        });
        if (!policy.allowed) {
          return yield* Effect.fail(deps.presenceError(policy.reasons.join(" ")));
        }
        nextTicketStatus = policy.recommendedTicketStatus ?? "in_progress";
        nextAttemptStatus = policy.recommendedAttemptStatus ?? "in_progress";
        if (reviewFindings.length > 0) {
          const materialized = yield* deps.materializeReviewFindings({
            ticketId: input.ticketId,
            attemptId: input.attemptId!,
            findings: reviewFindings,
          });
          reviewFindingIds.push(...materialized.map((finding) => finding.id));
        } else {
          const finding = yield* deps.createOrUpdateFinding({
            ticketId: input.ticketId,
            attemptId: input.attemptId,
            source: "review",
            severity: "blocking",
            disposition: "same_ticket",
            summary: input.notes.trim() || "Review requested changes before approval.",
            rationale: "A reviewer requested more work on this attempt before approval.",
          });
          reviewFindingIds.push(finding.id);
        }
      } else if (input.decision === "reject") {
        nextTicketStatus = "blocked";
        nextAttemptStatus = "rejected";
        if (reviewFindings.length > 0) {
          const materialized = yield* deps.materializeReviewFindings({
            ticketId: input.ticketId,
            attemptId: input.attemptId!,
            findings: reviewFindings,
          });
          reviewFindingIds.push(...materialized.map((finding) => finding.id));
        } else {
          const finding = yield* deps.createOrUpdateFinding({
            ticketId: input.ticketId,
            attemptId: input.attemptId,
            source: "review",
            severity: "blocking",
            disposition: "escalate",
            summary: input.notes.trim() || "The attempt was rejected during review.",
            rationale: "Review rejected this attempt and escalated the ticket for intervention.",
          });
          reviewFindingIds.push(finding.id);
        }
      } else if (input.decision === "escalate") {
        nextTicketStatus = "blocked";
        if (reviewFindings.length > 0) {
          const materialized = yield* deps.materializeReviewFindings({
            ticketId: input.ticketId,
            attemptId: input.attemptId!,
            findings: reviewFindings,
          });
          reviewFindingIds.push(...materialized.map((finding) => finding.id));
        } else {
          const finding = yield* deps.createOrUpdateFinding({
            ticketId: input.ticketId,
            attemptId: input.attemptId,
            source: "review",
            severity: "blocking",
            disposition: "escalate",
            summary: input.notes.trim() || "The ticket was escalated during review.",
            rationale: "Review escalated this work instead of approving or retrying it directly.",
          });
          reviewFindingIds.push(finding.id);
        }
      }

      yield* deps.sql.withTransaction(
        Effect.gen(function* () {
          yield* deps.sql`
            INSERT INTO presence_review_decisions (
              review_decision_id, ticket_id, attempt_id, decision, notes, created_at
            ) VALUES (
              ${decisionId},
              ${input.ticketId},
              ${input.attemptId ?? null},
              ${input.decision},
              ${input.notes},
              ${createdAt}
            )
          `;
          if (input.attemptId && nextAttemptStatus) {
            yield* deps.sql`
              UPDATE presence_attempts
              SET status = ${nextAttemptStatus}, updated_at = ${createdAt}
              WHERE attempt_id = ${input.attemptId}
            `;
          }
          yield* deps.sql`
            UPDATE presence_tickets
            SET status = ${nextTicketStatus}, updated_at = ${createdAt}
            WHERE ticket_id = ${input.ticketId}
          `;
        }),
      );

      if (input.attemptId && nextAttemptStatus === "merged") {
        yield* deps.writeAttemptOutcome({
          attemptId: input.attemptId,
          kind: "merged",
          summary: "The attempt was accepted and merged into the base branch.",
        });
      } else if (
        input.attemptId &&
        input.decision === "accept" &&
        input.mechanismChecklistSupported === true &&
        latestWorkerHandoff?.currentHypothesis &&
        latestWorkerHandoff.changedFiles.length > 0
      ) {
        yield* deps.markTicketMechanismChecklist(input.ticketId);
      } else if (input.attemptId && input.decision === "request_changes") {
        yield* deps.writeAttemptOutcome({
          attemptId: input.attemptId,
          kind: "wrong_mechanism",
          summary: input.notes.trim() || "Review requested a materially different fix.",
        });
      } else if (input.attemptId && input.decision === "reject") {
        yield* deps.writeAttemptOutcome({
          attemptId: input.attemptId,
          kind: "rejected_review",
          summary: input.notes.trim() || "The attempt was rejected during review.",
        });
      }

      yield* deps.createReviewArtifact({
        ticketId: input.ticketId,
        attemptId: input.attemptId ?? null,
        reviewerKind: input.reviewerKind,
        decision:
          input.decision === "accept" ||
          input.decision === "request_changes" ||
          input.decision === "escalate"
            ? input.decision
            : null,
        summary: input.notes.trim() || `Review decision recorded: ${input.decision}.`,
        checklistJson: ticketForReview.acceptanceChecklist,
        checklistAssessment: [...(input.reviewChecklistAssessment ?? [])],
        evidence: [...(input.reviewEvidence ?? [])],
        changedFiles: latestWorkerHandoff?.changedFiles ?? [],
        changedFilesReviewed: [...(input.changedFilesReviewed ?? [])],
        findingIds: reviewFindingIds,
        threadId: input.reviewThreadId ?? null,
      });
      yield* deps.syncTicketProjectionBestEffort(input.ticketId, "Review decision recorded.");

      return {
        id: ReviewDecisionId.make(decisionId),
        ticketId: TicketId.make(input.ticketId),
        attemptId: input.attemptId ? AttemptId.make(input.attemptId) : null,
        decision: input.decision,
        notes: input.notes,
        createdAt,
      } satisfies ReviewDecisionRecord;
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(deps.presenceError("Failed to apply review decision.", cause)),
      ),
    );

  return {
    submitReviewDecision: (
      input: PresenceSubmitReviewDecisionInput,
    ): Effect.Effect<ReviewDecisionRecord, PresenceRpcError, never> =>
      applyReviewDecisionInternal({
        ticketId: input.ticketId,
        attemptId: input.attemptId ?? null,
        decision: input.decision,
        notes: input.notes,
        reviewerKind: "human",
        reviewThreadId: null,
      }).pipe(
        Effect.catch((cause) =>
          Effect.fail(deps.presenceError("Failed to submit review decision.", cause)),
        ),
      ),
    startReviewSession,
    blockTicketForReviewFailure,
    applyReviewDecisionInternal,
  };
};

export { makePresenceReviewMergeService };
export type { PresenceReviewMergeService };
