import {
  AttemptId,
  CommandId,
  DEFAULT_PRESENCE_RESUME_PROTOCOL,
  EvidenceId,
  HandoffId,
  type FindingRecord,
  MessageId,
  ProjectId,
  ThreadId,
  TicketId,
  ValidationRunId,
  WorkspaceId,
  type AttemptEvidenceRecord,
  type AttemptOutcomeRecord,
  type ModelSelection,
  type PresenceRpcError,
  type RepositoryCapabilityCommand,
  type RepositoryCapabilityScanRecord,
  type ServerProvider,
  type SupervisorHandoffRecord,
  type ValidationRunRecord,
  type WorkerHandoffRecord,
  type WorkspaceRecord,
} from "@t3tools/contracts";
import { Effect } from "effect";
import type { SqlClient } from "effect/unstable/sql/SqlClient";

import type { PresenceControlPlaneShape } from "../../Services/PresenceControlPlane.ts";
import type { ProcessRunResult, runProcess } from "../../../processRunner.ts";
import type {
  AttemptWorkspaceContextRow,
  PresenceCreateOrUpdateFindingInput,
  PresenceThreadReadModel,
  PresenceWriteAttemptOutcomeInput,
} from "./PresenceInternalDeps.ts";
import type { BlockerSummary, ParsedPresenceHandoffBlock } from "./PresenceShared.ts";
import type { AttemptBootstrapPromptInput } from "./PresencePrompting.ts";

type PresenceAttemptService = Pick<
  PresenceControlPlaneShape,
  | "createAttempt"
  | "prepareWorkspace"
  | "cleanupWorkspace"
  | "startAttemptSession"
  | "attachThreadToAttempt"
  | "saveWorkerHandoff"
  | "saveAttemptEvidence"
  | "runAttemptValidation"
  | "resolveFinding"
  | "dismissFinding"
> & {
  buildWorkerHandoffCandidate: (input: {
    attemptId: string;
    attemptTitle: string;
    attemptStatus: string;
    previousHandoff: WorkerHandoffRecord | null;
    thread: {
      latestTurn: {
        turnId: string;
        state: "running" | "interrupted" | "completed" | "error";
        requestedAt: string | null;
        completedAt: string | null;
      } | null;
      checkpoints: ReadonlyArray<{ turnId: string; files: ReadonlyArray<{ path: string }> }>;
      messages: ReadonlyArray<{
        role: string;
        text: string;
        createdAt: string;
        updatedAt: string;
      }>;
      activities: ReadonlyArray<{
        kind: string;
        summary: string;
        createdAt: string;
      }>;
    } | null;
    changedFiles: ReadonlyArray<string>;
    validationRuns: ReadonlyArray<ValidationRunRecord>;
    findings: ReadonlyArray<FindingRecord>;
  }) => Effect.Effect<Omit<WorkerHandoffRecord, "id" | "attemptId" | "createdAt">, unknown, never>;
  synthesizeWorkerHandoffFromThread: (
    attemptId: string,
    options?: { allowRunning?: boolean | undefined },
  ) => Effect.Effect<WorkerHandoffRecord | null, unknown, never>;
};

type PresenceAttemptServiceDeps = Readonly<{
  sql: SqlClient;
  removeWorktree: (input: {
    cwd: string;
    path: string;
    force?: boolean;
  }) => Effect.Effect<void, unknown, never>;
  readAvailableProviders: () => Effect.Effect<ReadonlyArray<ServerProvider>, unknown, never>;
  dispatchOrchestration: (
    command:
      | {
          type: "thread.create";
          commandId: CommandId;
          threadId: ThreadId;
          projectId: ProjectId;
          title: string;
          systemPrompt: string;
          modelSelection: ModelSelection;
          runtimeMode: "full-access";
          interactionMode: "default";
          branch: string;
          worktreePath: string;
          createdAt: string;
        }
      | {
          type: "thread.turn.start";
          commandId: CommandId;
          threadId: ThreadId;
          message: {
            messageId: MessageId;
            role: "user";
            text: string;
            attachments: [];
          };
          modelSelection: ModelSelection;
          titleSeed: string;
          runtimeMode: "full-access";
          interactionMode: "default";
          createdAt: string;
        },
  ) => Effect.Effect<void, unknown, never>;
  makeId: <T extends { make: (value: string) => unknown }>(
    schema: T,
    prefix: string,
  ) => ReturnType<T["make"]>;
  nowIso: () => string;
  presenceError: (message: string, cause?: unknown) => PresenceRpcError;
  isPresenceRpcError: (cause: unknown) => cause is PresenceRpcError;
  isSqliteUniqueConstraintError: (cause: unknown) => boolean;
  readAttemptOutcomesForTicket: (
    ticketId: string,
  ) => Effect.Effect<ReadonlyArray<AttemptOutcomeRecord>, unknown, never>;
  repeatedFailureKindForTicket: (
    outcomes: ReadonlyArray<AttemptOutcomeRecord>,
  ) => AttemptOutcomeRecord["kind"] | null;
  createOrUpdateFinding: (
    input: PresenceCreateOrUpdateFindingInput,
  ) => Effect.Effect<FindingRecord, unknown, never>;
  syncTicketProjectionBestEffort: (
    ticketId: string,
    dirtyReason: string,
  ) => Effect.Effect<void, unknown, never>;
  ensureWorkspacePrepared: (input: {
    attemptId: string;
    preferredBranch?: string | undefined;
    nextStatus: WorkspaceRecord["status"];
  }) => Effect.Effect<WorkspaceRecord, unknown, never>;
  readAttemptWorkspaceContext: (
    attemptId: string,
  ) => Effect.Effect<AttemptWorkspaceContextRow | null, unknown, never>;
  syncThreadWorkspaceMetadata: (input: {
    threadId: string;
    branch: string | null;
    worktreePath: string | null;
  }) => Effect.Effect<void, unknown, never>;
  writeAttemptOutcome: (
    input: PresenceWriteAttemptOutcomeInput,
  ) => Effect.Effect<AttemptOutcomeRecord, unknown, never>;
  evaluateSupervisorActionInternal: (input: {
    action: "start_attempt";
    ticketId: string;
    attemptId?: string | null;
  }) => Effect.Effect<{ allowed: boolean; reasons: ReadonlyArray<string> }, PresenceRpcError, never>;
  decodeJson: typeof JSON.parse extends (...args: never[]) => never
    ? never
    : <T>(value: string | null, fallback: T) => T;
  isModelSelectionAvailable: (
    providers: ReadonlyArray<ServerProvider>,
    selection: ModelSelection | null | undefined,
  ) => selection is ModelSelection;
  chooseDefaultModelSelection: (providers: ReadonlyArray<ServerProvider>) => ModelSelection | null;
  buildWorkerSystemPrompt: () => string;
  readLatestWorkerHandoffForAttempt: (
    attemptId: string,
  ) => Effect.Effect<WorkerHandoffRecord | null, unknown, never>;
  readLatestSupervisorHandoffForBoard: (
    boardId: string,
  ) => Effect.Effect<SupervisorHandoffRecord | null, unknown, never>;
  buildAttemptBootstrapPrompt: (input: AttemptBootstrapPromptInput) => string;
  waitForClaimedThreadAvailability: (input: {
    attemptId: string;
    threadId: string;
    maxChecks?: number;
  }) => Effect.Effect<boolean, unknown, never>;
  mapAttempt: (row: AttemptRow) => PresenceControlPlaneShape["attachThreadToAttempt"] extends (
    ...args: never[]
  ) => Effect.Effect<infer A, unknown, unknown>
    ? A
    : never;
  encodeJson: (value: unknown) => string;
  markTicketEvidenceChecklist: (ticketId: string) => Effect.Effect<void, unknown, never>;
  getOrCreateCapabilityScan: (
    repositoryId: string,
  ) => Effect.Effect<RepositoryCapabilityScanRecord, PresenceRpcError, never>;
  buildRunnableValidationCommands: (
    capabilityScan: RepositoryCapabilityScanRecord | null,
  ) => ReadonlyArray<RepositoryCapabilityCommand>;
  readRunningValidationBatchIdForAttempt: (
    attemptId: string,
  ) => Effect.Effect<string | null, unknown, never>;
  readValidationRunsForBatch: (
    batchId: string,
  ) => Effect.Effect<ReadonlyArray<ValidationRunRecord>, unknown, never>;
  runProcess: typeof runProcess;
  makeValidationShellInvocation: (commandLine: string) => {
    command: string;
    args: ReadonlyArray<string>;
  };
  summarizeCommandOutput: (value: string | null | undefined) => string | null;
  describeUnknownError: (error: unknown) => string;
  markTicketValidationChecklist: (ticketId: string) => Effect.Effect<void, unknown, never>;
  readFindingsForTicket: (
    ticketId: string,
  ) => Effect.Effect<ReadonlyArray<FindingRecord>, unknown, never>;
  updateFindingStatus: (
    findingId: string,
    status: FindingRecord["status"],
  ) => Effect.Effect<FindingRecord, unknown, never>;
  hasAttemptExecutionContext: (context: Pick<
    AttemptWorkspaceContextRow,
    "attemptThreadId" | "attemptLastWorkerHandoffId" | "workspaceStatus"
  >) => boolean;
  readThreadFromModel: (
    threadId: string,
  ) => Effect.Effect<(PresenceThreadReadModel & { id: string }) | null, unknown, never>;
  readChangedFilesForWorkspace: (
    workspacePath: string | null,
  ) => Effect.Effect<ReadonlyArray<string>, unknown, never>;
  readValidationRunsForAttempt: (
    attemptId: string,
  ) => Effect.Effect<ReadonlyArray<ValidationRunRecord>, unknown, never>;
  readLatestAssistantReasoningFromThread: (
    thread: PresenceThreadReadModel | null,
  ) => Effect.Effect<ParsedPresenceHandoffBlock | null, unknown, never>;
  buildBlockerSummaries: (input: {
    validationRuns: ReadonlyArray<ValidationRunRecord>;
    findings: ReadonlyArray<FindingRecord>;
    handoff: WorkerHandoffRecord | null;
  }) => ReadonlyArray<BlockerSummary>;
  uniqueStrings: (values: ReadonlyArray<string>) => ReadonlyArray<string>;
  isThreadSettled: (thread: PresenceThreadReadModel | null) => boolean;
}>;

type CreateAttemptTicketRow = Readonly<{
  id: string;
  title: string;
  boardId: string;
  status: string;
}>;

type AttemptRow = Readonly<{
  id: string;
  ticketId: string;
  workspaceId: string | null;
  title: string;
  status: string;
  provider: string | null;
  model: string | null;
  threadId: string | null;
  summary: string | null;
  confidence: number | null;
  lastWorkerHandoffId: string | null;
  createdAt: string;
  updatedAt: string;
}>;

const makePresenceAttemptService = (
  deps: PresenceAttemptServiceDeps,
): PresenceAttemptService => {
  const workerHandoffMateriallyChanged = (
    previous: WorkerHandoffRecord | null,
    next: Omit<WorkerHandoffRecord, "id" | "attemptId" | "createdAt">,
  ) =>
    !previous ||
    JSON.stringify({
      completedWork: previous.completedWork,
      currentHypothesis: previous.currentHypothesis,
      changedFiles: previous.changedFiles,
      testsRun: previous.testsRun,
      blockers: previous.blockers,
      nextStep: previous.nextStep,
      openQuestions: previous.openQuestions,
      retryCount: previous.retryCount,
      reasoningSource: previous.reasoningSource,
      reasoningUpdatedAt: previous.reasoningUpdatedAt,
      confidence: previous.confidence,
      evidenceIds: previous.evidenceIds,
    }) !==
      JSON.stringify({
        completedWork: next.completedWork,
        currentHypothesis: next.currentHypothesis,
        changedFiles: next.changedFiles,
        testsRun: next.testsRun,
        blockers: next.blockers,
        nextStep: next.nextStep,
        openQuestions: next.openQuestions,
        retryCount: next.retryCount,
        reasoningSource: next.reasoningSource,
        reasoningUpdatedAt: next.reasoningUpdatedAt,
        confidence: next.confidence,
        evidenceIds: next.evidenceIds,
      });

  const buildWorkerHandoffCandidate: PresenceAttemptService["buildWorkerHandoffCandidate"] = (input) =>
    Effect.gen(function* () {
      const latestAssistantReasoning = yield* deps.readLatestAssistantReasoningFromThread(input.thread);
      const previousReasoningUpdatedAt = input.previousHandoff?.reasoningUpdatedAt ?? null;
      const useAssistantReasoning =
        latestAssistantReasoning &&
        (!previousReasoningUpdatedAt ||
          latestAssistantReasoning.updatedAt.localeCompare(previousReasoningUpdatedAt) >= 0);

      const reasoningCompletedWork = useAssistantReasoning
        ? latestAssistantReasoning.completedWork
        : (input.previousHandoff?.completedWork ?? []);
      const reasoningCurrentHypothesis = useAssistantReasoning
        ? latestAssistantReasoning.currentHypothesis
        : (input.previousHandoff?.currentHypothesis ?? null);
      const reasoningNextStep = useAssistantReasoning
        ? latestAssistantReasoning.nextStep
        : (input.previousHandoff?.nextStep ?? null);
      const reasoningOpenQuestions = useAssistantReasoning
        ? latestAssistantReasoning.openQuestions
        : (input.previousHandoff?.openQuestions ?? []);
      const reasoningSource = useAssistantReasoning
        ? latestAssistantReasoning.source
        : (input.previousHandoff?.reasoningSource ?? null);
      const reasoningUpdatedAt = useAssistantReasoning
        ? latestAssistantReasoning.updatedAt
        : (input.previousHandoff?.reasoningUpdatedAt ?? null);

      const latestCheckpoint =
        input.thread?.checkpoints.find(
          (checkpoint) => checkpoint.turnId === input.thread?.latestTurn?.turnId,
        ) ??
        input.thread?.checkpoints.at(-1) ??
        null;
      const effectiveChangedFiles = deps.uniqueStrings([
        ...input.changedFiles,
        ...(latestCheckpoint?.files.map((file) => file.path) ?? []),
      ]);
      const testsRun = deps.uniqueStrings([
        ...(input.previousHandoff?.testsRun ?? []),
        ...input.validationRuns.map((run) => run.command),
      ]);
      const blockerSummaries = deps.buildBlockerSummaries({
        validationRuns: input.validationRuns,
        findings: input.findings,
        handoff: input.previousHandoff,
      });
      const blockers = deps.uniqueStrings([
        ...blockerSummaries.map((summary) =>
          summary.count > 1 ? `${summary.summary} (repeated ${summary.count} times)` : summary.summary,
        ),
        ...(input.thread?.latestTurn?.state === "error" || input.thread?.latestTurn?.state === "interrupted"
          ? [`Worker thread settled with state ${input.thread.latestTurn.state}.`]
          : []),
      ]);
      const nextStep =
        reasoningNextStep ??
        (input.thread?.latestTurn?.state === "completed"
          ? "Run validation, review the result, and continue only if new findings require it."
          : input.thread?.latestTurn?.state === "error" || input.thread?.latestTurn?.state === "interrupted"
            ? "Address the interruption or error before resuming the same attempt."
            : blockers[0]
              ? "Address the active blocker before continuing the same path."
              : "Continue the current attempt and keep the handoff state warm while working.");

      return {
        completedWork: reasoningCompletedWork,
        currentHypothesis: reasoningCurrentHypothesis,
        changedFiles: effectiveChangedFiles,
        testsRun,
        blockers,
        nextStep,
        openQuestions: reasoningOpenQuestions,
        retryCount: input.previousHandoff?.retryCount ?? 0,
        reasoningSource,
        reasoningUpdatedAt,
        confidence:
          input.previousHandoff?.confidence ??
          (input.attemptStatus === "in_progress" ? 0.68 : 0.72),
        evidenceIds: input.previousHandoff?.evidenceIds ?? [],
      } satisfies Omit<WorkerHandoffRecord, "id" | "attemptId" | "createdAt">;
    });

  const synthesizeWorkerHandoffFromThread: PresenceAttemptService["synthesizeWorkerHandoffFromThread"] = (
    attemptId,
    options,
  ) =>
    Effect.gen(function* () {
      const context = yield* deps.readAttemptWorkspaceContext(attemptId);
      if (!context?.attemptThreadId) {
        return null;
      }
      const [thread, previousHandoff, changedFiles, validationRuns, findings] = (yield* Effect.all([
        deps.readThreadFromModel(context.attemptThreadId),
        deps.readLatestWorkerHandoffForAttempt(attemptId),
        deps.readChangedFilesForWorkspace(context.workspaceWorktreePath),
        deps.readValidationRunsForAttempt(attemptId),
        deps.readFindingsForTicket(context.ticketId),
      ])) as [
        {
          latestTurn: {
            turnId: string;
            state: "interrupted" | "running" | "completed" | "error";
            requestedAt: string | null;
            completedAt: string | null;
          } | null;
          checkpoints: ReadonlyArray<{ turnId: string; files: ReadonlyArray<{ path: string }> }>;
          messages: ReadonlyArray<{
            role: string;
            text: string;
            createdAt: string;
            updatedAt: string;
          }>;
          activities: ReadonlyArray<{ kind: string; summary: string; createdAt: string }>;
        } | null,
        WorkerHandoffRecord | null,
        ReadonlyArray<string>,
        ReadonlyArray<ValidationRunRecord>,
        ReadonlyArray<FindingRecord>,
      ];
      if (!options?.allowRunning && !deps.isThreadSettled(thread)) {
        return previousHandoff;
      }
      const nextHandoff = yield* buildWorkerHandoffCandidate({
        attemptId,
        attemptTitle: context.attemptTitle,
        attemptStatus: context.attemptStatus,
        previousHandoff,
        thread,
        changedFiles,
        validationRuns,
        findings: findings.filter((finding) => finding.attemptId === null || finding.attemptId === attemptId),
      });

      if (!workerHandoffMateriallyChanged(previousHandoff, nextHandoff)) {
        return previousHandoff;
      }

      return yield* service.saveWorkerHandoff({
        attemptId: AttemptId.make(attemptId),
        completedWork: nextHandoff.completedWork,
        currentHypothesis: nextHandoff.currentHypothesis,
        changedFiles: nextHandoff.changedFiles,
        testsRun: nextHandoff.testsRun,
        blockers: nextHandoff.blockers,
        nextStep: nextHandoff.nextStep,
        openQuestions: nextHandoff.openQuestions,
        retryCount: nextHandoff.retryCount,
        reasoningSource: nextHandoff.reasoningSource,
        reasoningUpdatedAt: nextHandoff.reasoningUpdatedAt,
        confidence: nextHandoff.confidence,
        evidenceIds: nextHandoff.evidenceIds,
      });
    });

  const normalizeCreateAttemptError = (ticketId: string, cause: unknown): PresenceRpcError =>
    deps.isPresenceRpcError(cause)
      ? cause
      : deps.isSqliteUniqueConstraintError(cause)
        ? deps.presenceError(
            `Ticket '${ticketId}' already has an active attempt. Reuse or resolve it before creating another one.`,
            cause,
          )
        : deps.presenceError("Failed to create attempt.", cause);

  const createAttempt: PresenceAttemptService["createAttempt"] = (input) =>
    Effect.gen(function* () {
      const ticket = yield* deps.sql<CreateAttemptTicketRow>`
        SELECT ticket_id as id, title, board_id as "boardId", status
        FROM presence_tickets
        WHERE ticket_id = ${input.ticketId}
      `.pipe(Effect.map((rows: ReadonlyArray<CreateAttemptTicketRow>) => rows[0] ?? null));
      if (!ticket) {
        return yield* Effect.fail(deps.presenceError(`Ticket '${input.ticketId}' not found.`));
      }
      if (
        ticket.status === "blocked" ||
        ticket.status === "done" ||
        ticket.status === "ready_to_merge"
      ) {
        return yield* Effect.fail(
          deps.presenceError(
            `Ticket '${input.ticketId}' is ${ticket.status} and cannot accept a new attempt.`,
          ),
        );
      }
      const existingActiveAttempt = yield* deps.sql<{ id: string }>`
        SELECT attempt_id as id
        FROM presence_attempts
        WHERE
          ticket_id = ${input.ticketId} AND
          status IN ('planned', 'in_progress', 'in_review')
        ORDER BY created_at DESC
        LIMIT 1
      `.pipe(Effect.map((rows: ReadonlyArray<{ id: string }>) => rows[0] ?? null));
      if (existingActiveAttempt) {
        return yield* Effect.fail(
          deps.presenceError(
            `Ticket '${input.ticketId}' already has an active attempt ('${existingActiveAttempt.id}'). Reuse or resolve it before creating another one.`,
          ),
        );
      }
      const priorOutcomes = yield* deps.readAttemptOutcomesForTicket(input.ticketId);
      const repeatedFailureKind = deps.repeatedFailureKindForTicket(priorOutcomes);
      if (repeatedFailureKind) {
        yield* deps.createOrUpdateFinding({
          ticketId: input.ticketId,
          source: "supervisor",
          severity: "blocking",
          disposition: "escalate",
          summary: `Repeated ${repeatedFailureKind} attempts require escalation before another retry.`,
          rationale:
            "Presence detected repeated similar failed attempts on this ticket and blocked another ordinary retry.",
        });
        yield* deps.sql`
          UPDATE presence_tickets
          SET status = ${"blocked"}, updated_at = ${deps.nowIso()}
          WHERE ticket_id = ${input.ticketId}
        `;
        yield* deps.syncTicketProjectionBestEffort(
          input.ticketId,
          "Attempt creation blocked by repeated failures.",
        );
        return yield* Effect.fail(
          deps.presenceError(
            `Ticket '${input.ticketId}' has repeated ${repeatedFailureKind} outcomes. Escalate or create follow-up work before another retry attempt.`,
          ),
        );
      }

      const createdAt = deps.nowIso();
      const attemptId = deps.makeId(AttemptId, "attempt");
      const workspaceId = deps.makeId(WorkspaceId, "workspace");
      const title = input.title ?? `${ticket.title} Attempt`;
      yield* deps.sql.withTransaction(
        Effect.gen(function* () {
          yield* deps.sql`
            INSERT INTO presence_attempts (
              attempt_id, ticket_id, workspace_id, title, status, provider, model,
              thread_id, summary, confidence, last_worker_handoff_id, created_at, updated_at
            ) VALUES (
              ${attemptId},
              ${input.ticketId},
              ${workspaceId},
              ${title},
              ${"planned"},
              ${null},
              ${null},
              ${null},
              ${null},
              ${null},
              ${null},
              ${createdAt},
              ${createdAt}
            )
          `;
          yield* deps.sql`
            INSERT INTO presence_workspaces (
              workspace_id, attempt_id, status, branch, worktree_path, created_at, updated_at
            ) VALUES (
              ${workspaceId},
              ${attemptId},
              ${"unprepared"},
              ${null},
              ${null},
              ${createdAt},
              ${createdAt}
            )
          `;
          yield* deps.sql`
            UPDATE presence_tickets
            SET assigned_attempt_id = ${attemptId}, status = ${"in_progress"}, updated_at = ${createdAt}
            WHERE ticket_id = ${input.ticketId}
          `;
        }),
      );

      const attemptRecord = {
        id: AttemptId.make(attemptId),
        ticketId: TicketId.make(input.ticketId),
        workspaceId: WorkspaceId.make(workspaceId),
        title,
        status: "planned" as const,
        provider: null,
        model: null,
        threadId: null,
        summary: null,
        confidence: null,
        lastWorkerHandoffId: null,
        createdAt,
        updatedAt: createdAt,
      };
      yield* deps.syncTicketProjectionBestEffort(input.ticketId, "Attempt created.");
      return attemptRecord;
    }).pipe(
      Effect.mapError((cause) => normalizeCreateAttemptError(input.ticketId, cause)),
    );

  const service: PresenceAttemptService = {
    buildWorkerHandoffCandidate,
    createAttempt,

  prepareWorkspace: (input) =>
    deps.ensureWorkspacePrepared({
      attemptId: input.attemptId,
      preferredBranch: input.branch,
      nextStatus: "ready",
    }).pipe(
      Effect.mapError((cause: unknown) =>
        deps.presenceError("Failed to prepare workspace.", cause),
      ),
    ),

  cleanupWorkspace: (input) =>
    Effect.gen(function* () {
      const context = yield* deps.readAttemptWorkspaceContext(input.attemptId);
      if (!context) {
        return yield* Effect.fail(deps.presenceError(`Attempt '${input.attemptId}' not found.`));
      }

      if (context.workspaceWorktreePath) {
        yield* deps.removeWorktree(
          input.force === undefined
            ? {
                cwd: context.workspaceRoot,
                path: context.workspaceWorktreePath,
              }
            : {
                cwd: context.workspaceRoot,
                path: context.workspaceWorktreePath,
                force: input.force,
              },
        );
      }

      if (context.attemptThreadId) {
        yield* deps.syncThreadWorkspaceMetadata({
          threadId: context.attemptThreadId,
          branch: null,
          worktreePath: null,
        });
      }

      const updatedAt = deps.nowIso();
      const nextAttemptStatus =
        context.attemptStatus === "accepted" ||
        context.attemptStatus === "merged" ||
        context.attemptStatus === "rejected"
          ? context.attemptStatus
          : ("interrupted" as const);

      yield* deps.sql.withTransaction(
        Effect.gen(function* () {
          yield* deps.sql`
            UPDATE presence_workspaces
            SET
              status = ${"cleaned_up"},
              worktree_path = ${null},
              updated_at = ${updatedAt}
            WHERE workspace_id = ${context.workspaceId}
          `;
          yield* deps.sql`
            UPDATE presence_attempts
            SET status = ${nextAttemptStatus}, updated_at = ${updatedAt}
            WHERE attempt_id = ${context.attemptId}
          `;
        }),
      );
      if (nextAttemptStatus === "interrupted") {
        yield* deps.writeAttemptOutcome({
          attemptId: context.attemptId,
          kind: "abandoned",
          summary: "The workspace was cleaned up before the attempt merged.",
        });
      }
      yield* deps.syncTicketProjectionBestEffort(context.ticketId, "Workspace cleaned up.");

      return {
        id: WorkspaceId.make(context.workspaceId),
        attemptId: AttemptId.make(context.attemptId),
        status: "cleaned_up" as const,
        branch: context.workspaceBranch,
        worktreePath: null,
        createdAt: context.workspaceCreatedAt,
        updatedAt,
      };
    }).pipe(
      Effect.mapError((cause: unknown) =>
        deps.presenceError("Failed to clean up workspace.", cause),
      ),
    ),

  startAttemptSession: (input) =>
    Effect.gen(function* () {
      let recoveredUnavailableThread = false;

      while (true) {
        const attemptRow = yield* deps.readAttemptWorkspaceContext(input.attemptId);
        if (!attemptRow) {
          return yield* Effect.fail(deps.presenceError(`Attempt '${input.attemptId}' not found.`));
        }
        if (
          attemptRow.attemptStatus === "accepted" ||
          attemptRow.attemptStatus === "merged" ||
          attemptRow.attemptStatus === "rejected"
        ) {
          return yield* Effect.fail(
            deps.presenceError(
              `Attempt '${input.attemptId}' is ${attemptRow.attemptStatus} and cannot start a new session.`,
            ),
          );
        }
        if (!attemptRow.projectId) {
          return yield* Effect.fail(
            deps.presenceError("Attempt repository is missing an orchestration project."),
          );
        }

        const startPolicy = yield* deps.evaluateSupervisorActionInternal({
          action: "start_attempt",
          ticketId: attemptRow.ticketId,
          attemptId: input.attemptId,
        });
        if (!startPolicy.allowed) {
          return yield* Effect.fail(deps.presenceError(startPolicy.reasons.join(" ")));
        }

        const workspace = yield* deps.ensureWorkspacePrepared({
          attemptId: input.attemptId,
          preferredBranch: attemptRow.ticketTitle,
          nextStatus: "busy",
        });
        if (!workspace.branch || !workspace.worktreePath) {
          return yield* Effect.fail(
            deps.presenceError("Prepared workspace is missing branch or worktree metadata."),
          );
        }

        const providers = yield* deps.readAvailableProviders();
        const savedRepositorySelection = deps.decodeJson(
          attemptRow.defaultModelSelection,
          null,
        ) as ModelSelection | null;
        const existingAttemptSelection =
          attemptRow.attemptProvider && attemptRow.attemptModel
            ? ({ provider: attemptRow.attemptProvider, model: attemptRow.attemptModel } as ModelSelection)
            : null;
        const selection =
          input.provider && input.model
            ? ({ provider: input.provider, model: input.model } as ModelSelection)
            : deps.isModelSelectionAvailable(providers, existingAttemptSelection)
              ? existingAttemptSelection
              : deps.isModelSelectionAvailable(providers, savedRepositorySelection)
                ? savedRepositorySelection
                : deps.chooseDefaultModelSelection(providers);
        if (!selection) {
          return yield* Effect.fail(
            deps.presenceError("No provider/model is available to start an attempt session."),
          );
        }

        const createdAt = deps.nowIso();
        const claimedThreadId = attemptRow.attemptThreadId
          ? attemptRow.attemptThreadId
          : deps.makeId(ThreadId, "presence_thread");
        let shouldBootstrapWorker = false;
        let shouldBootstrapClaimedThread = false;
        let threadId = ThreadId.make(claimedThreadId);
        let shouldSyncExistingThreadMetadata = Boolean(attemptRow.attemptThreadId);

        if (!attemptRow.attemptThreadId) {
          yield* deps.sql`
            UPDATE presence_attempts
            SET
              thread_id = ${claimedThreadId},
              provider = ${selection.provider},
              model = ${selection.model},
              status = ${"in_progress"},
              updated_at = ${createdAt}
            WHERE attempt_id = ${input.attemptId} AND thread_id IS NULL
          `;
          const claimedAttempt = yield* deps.readAttemptWorkspaceContext(input.attemptId);
          if (!claimedAttempt?.attemptThreadId) {
            return yield* Effect.fail(
              deps.presenceError(`Attempt '${input.attemptId}' could not claim a worker thread.`),
            );
          }
          threadId = ThreadId.make(claimedAttempt.attemptThreadId);
          shouldBootstrapWorker = claimedAttempt.attemptThreadId === claimedThreadId;
          shouldSyncExistingThreadMetadata = false;
        } else {
          const existingThreadReady = yield* deps.waitForClaimedThreadAvailability({
            attemptId: input.attemptId,
            threadId: attemptRow.attemptThreadId,
            maxChecks: 10,
          });
          if (!existingThreadReady) {
            if (recoveredUnavailableThread) {
              return yield* Effect.fail(
                deps.presenceError(
                  `Attempt '${input.attemptId}' still points at an unavailable worker thread after recovery. Try again once the runtime settles.`,
                ),
              );
            }
            yield* deps.sql`
              UPDATE presence_attempts
              SET
                thread_id = ${null},
                status = ${attemptRow.attemptStatus},
                updated_at = ${createdAt}
              WHERE attempt_id = ${input.attemptId} AND thread_id = ${attemptRow.attemptThreadId}
            `;
            recoveredUnavailableThread = true;
            continue;
          }

          const [existingThread, latestWorkerHandoff] = yield* Effect.all([
            deps.readThreadFromModel(attemptRow.attemptThreadId),
            deps.readLatestWorkerHandoffForAttempt(input.attemptId),
          ]);
          shouldBootstrapClaimedThread = Boolean(existingThread && !existingThread.latestTurn && !latestWorkerHandoff);

          yield* deps.sql`
            UPDATE presence_attempts
            SET
              provider = ${selection.provider},
              model = ${selection.model},
              status = ${"in_progress"},
              updated_at = ${createdAt}
            WHERE attempt_id = ${input.attemptId}
          `;
        }

        if (shouldSyncExistingThreadMetadata) {
          yield* deps.syncThreadWorkspaceMetadata({
            threadId: threadId.toString(),
            branch: workspace.branch,
            worktreePath: workspace.worktreePath,
          });
        }
        yield* deps.sql`
          UPDATE presence_repositories
          SET
            default_model_selection_json = ${deps.encodeJson(selection)},
            updated_at = ${createdAt}
          WHERE repository_id = ${attemptRow.repositoryId}
        `;

        if (shouldBootstrapWorker) {
          yield* deps.dispatchOrchestration({
            type: "thread.create",
            commandId: CommandId.make(`presence_thread_create_${crypto.randomUUID()}`),
            threadId,
            projectId: ProjectId.make(attemptRow.projectId),
            title: `${attemptRow.ticketTitle} - ${attemptRow.attemptTitle}`,
            systemPrompt: deps.buildWorkerSystemPrompt(),
            modelSelection: selection,
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: workspace.branch,
            worktreePath: workspace.worktreePath,
            createdAt,
          }).pipe(
            Effect.catch((cause) =>
              Effect.gen(function* () {
                yield* deps.sql`
                    UPDATE presence_attempts
                    SET
                      thread_id = ${null},
                      status = ${"planned"},
                      updated_at = ${deps.nowIso()}
                    WHERE attempt_id = ${input.attemptId} AND thread_id = ${claimedThreadId}
                  `.pipe(Effect.catch(() => Effect.void));
                return yield* Effect.fail(
                  deps.presenceError("Failed to create the worker thread for this attempt.", cause),
                );
              }),
            ),
          );
        } else if (!shouldSyncExistingThreadMetadata) {
          const threadReady = yield* deps.waitForClaimedThreadAvailability({
            attemptId: input.attemptId,
            threadId: threadId.toString(),
          });
          if (!threadReady) {
            return yield* Effect.fail(
              deps.presenceError(
                `Attempt '${input.attemptId}' is already starting a worker session in another caller. Try again once that startup settles.`,
              ),
            );
          }
        }

        if (shouldBootstrapWorker || shouldBootstrapClaimedThread) {
          const [latestWorkerHandoff, latestSupervisorHandoff] = yield* Effect.all([
            deps.readLatestWorkerHandoffForAttempt(input.attemptId),
            deps.readLatestSupervisorHandoffForBoard(attemptRow.boardId),
          ]);
          const kickoffMessage = deps.buildAttemptBootstrapPrompt({
            attempt: attemptRow,
            workspace,
            latestWorkerHandoff,
            latestSupervisorHandoff,
          });

          yield* deps.dispatchOrchestration({
            type: "thread.turn.start",
            commandId: CommandId.make(`presence_turn_start_${crypto.randomUUID()}`),
            threadId,
            message: {
              messageId: deps.makeId(MessageId, "presence_message"),
              role: "user",
              text: kickoffMessage,
              attachments: [],
            },
            modelSelection: selection,
            titleSeed: attemptRow.ticketTitle,
            runtimeMode: "full-access",
            interactionMode: "default",
            createdAt,
          }).pipe(
            Effect.catch((cause) =>
              Effect.fail(
                deps.presenceError("Failed to start the worker turn for this attempt.", cause),
              ),
            ),
          );
        }

        yield* deps.syncTicketProjectionBestEffort(attemptRow.ticketId, "Attempt session started.");

        return {
          attemptId: AttemptId.make(input.attemptId),
          threadId,
          provider: selection.provider,
          model: selection.model,
          attachedAt: createdAt,
        };
      }
    }).pipe(
      Effect.mapError((cause: unknown) =>
        deps.presenceError("Failed to start attempt session.", cause),
      ),
    ),

  attachThreadToAttempt: (input) =>
    Effect.gen(function* () {
      const updatedAt = deps.nowIso();
      yield* deps.sql`
        UPDATE presence_attempts
        SET thread_id = ${input.threadId}, updated_at = ${updatedAt}
        WHERE attempt_id = ${input.attemptId}
      `;
      const context = yield* deps.readAttemptWorkspaceContext(input.attemptId);
      if (context?.workspaceBranch && context.workspaceWorktreePath) {
        yield* deps.syncThreadWorkspaceMetadata({
          threadId: input.threadId,
          branch: context.workspaceBranch,
          worktreePath: context.workspaceWorktreePath,
        });
      }
      const row = yield* deps.sql<AttemptRow>`
        SELECT
          attempt_id as id, ticket_id as "ticketId", workspace_id as "workspaceId",
          title, status, provider, model, thread_id as "threadId", summary, confidence,
          last_worker_handoff_id as "lastWorkerHandoffId",
          created_at as "createdAt", updated_at as "updatedAt"
        FROM presence_attempts
        WHERE attempt_id = ${input.attemptId}
      `.pipe(Effect.map((rows: ReadonlyArray<AttemptRow>) => rows[0] ?? null));
      if (!row) {
        return yield* Effect.fail(deps.presenceError(`Attempt '${input.attemptId}' not found.`));
      }
      yield* deps.syncTicketProjectionBestEffort(row.ticketId, "Thread attached to attempt.");
      return deps.mapAttempt(row);
    }).pipe(
      Effect.catch((cause) => Effect.fail(deps.presenceError("Failed to attach thread.", cause))),
    ),

  saveWorkerHandoff: (input) =>
    Effect.gen(function* () {
      const handoffId = deps.makeId(HandoffId, "handoff");
      const createdAt = deps.nowIso();
      const reasoningSource = input.reasoningSource ?? "manual_override";
      const reasoningUpdatedAt = input.reasoningUpdatedAt ?? createdAt;
      yield* deps.sql.withTransaction(
        Effect.gen(function* () {
          yield* deps.sql`
            INSERT INTO presence_handoffs (
              handoff_id, board_id, attempt_id, role, payload_json, created_at
            ) VALUES (
              ${handoffId},
              ${null},
              ${input.attemptId},
              ${"worker"},
              ${deps.encodeJson({
                completedWork: input.completedWork,
                currentHypothesis: input.currentHypothesis ?? null,
                changedFiles: input.changedFiles,
                testsRun: input.testsRun,
                blockers: input.blockers,
                nextStep: input.nextStep ?? null,
                openQuestions: input.openQuestions ?? [],
                retryCount: input.retryCount ?? 0,
                reasoningSource,
                reasoningUpdatedAt,
                confidence: input.confidence ?? null,
                evidenceIds: input.evidenceIds,
                resumeProtocol: DEFAULT_PRESENCE_RESUME_PROTOCOL.workerReadOrder,
              })},
              ${createdAt}
            )
          `;
          yield* deps.sql`
            UPDATE presence_attempts
            SET
              summary = ${input.completedWork[0] ?? null},
              confidence = ${input.confidence ?? null},
              last_worker_handoff_id = ${handoffId},
              updated_at = ${createdAt}
            WHERE attempt_id = ${input.attemptId}
          `;
        }),
      );
      const handoffRecord = {
        id: handoffId,
        attemptId: input.attemptId,
        completedWork: input.completedWork,
        currentHypothesis: input.currentHypothesis ?? null,
        changedFiles: input.changedFiles,
        testsRun: input.testsRun,
        blockers: input.blockers,
        nextStep: input.nextStep ?? null,
        openQuestions: input.openQuestions ?? [],
        retryCount: input.retryCount ?? 0,
        reasoningSource,
        reasoningUpdatedAt,
        confidence: input.confidence ?? null,
        evidenceIds: input.evidenceIds,
        createdAt,
      };
      const attemptContext = yield* deps.readAttemptWorkspaceContext(input.attemptId);
      if (attemptContext) {
        yield* deps.syncTicketProjectionBestEffort(attemptContext.ticketId, "Worker handoff saved.");
      }
      return handoffRecord;
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(deps.presenceError("Failed to save worker handoff.", cause)),
      ),
    ),

  saveAttemptEvidence: (input) =>
    Effect.gen(function* () {
      const attemptContext = yield* deps.readAttemptWorkspaceContext(input.attemptId);
      if (!attemptContext) {
        return yield* Effect.fail(deps.presenceError(`Attempt '${input.attemptId}' not found.`));
      }
      const evidenceId = deps.makeId(EvidenceId, "evidence");
      const createdAt = deps.nowIso();
      yield* deps.sql.withTransaction(
        Effect.gen(function* () {
          yield* deps.sql`
            INSERT INTO presence_attempt_evidence (
              evidence_id, attempt_id, title, kind, content, created_at
            ) VALUES (
              ${evidenceId},
              ${input.attemptId},
              ${input.title},
              ${input.kind},
              ${input.content},
              ${createdAt}
            )
          `;
          yield* deps.markTicketEvidenceChecklist(attemptContext.ticketId);
        }),
      );
      const evidenceRecord = {
        id: evidenceId,
        attemptId: input.attemptId,
        title: input.title,
        kind: input.kind,
        content: input.content,
        createdAt,
      };
      yield* deps.syncTicketProjectionBestEffort(attemptContext.ticketId, "Attempt evidence saved.");
      return evidenceRecord;
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(deps.presenceError("Failed to save attempt evidence.", cause)),
      ),
    ),

  runAttemptValidation: (input) =>
    Effect.gen(function* () {
      const context = yield* deps.readAttemptWorkspaceContext(input.attemptId);
      if (!context) {
        return yield* Effect.fail(deps.presenceError(`Attempt '${input.attemptId}' not found.`));
      }
      if (!deps.hasAttemptExecutionContext(context)) {
        return yield* Effect.fail(
          deps.presenceError("Validation can only run after the attempt has actually started work."),
        );
      }

      const capabilityScan = yield* deps.getOrCreateCapabilityScan(context.repositoryId);
      const commands = deps.buildRunnableValidationCommands(capabilityScan);
      if (commands.length === 0) {
        return yield* Effect.fail(
          deps.presenceError("No runnable validation command was discovered for this repository."),
        );
      }

      const existingRunningBatchId = yield* deps.readRunningValidationBatchIdForAttempt(
        context.attemptId,
      );
      if (existingRunningBatchId) {
        return yield* deps.readValidationRunsForBatch(existingRunningBatchId);
      }

      const cwd = context.workspaceWorktreePath?.trim() || context.workspaceRoot;
      const batchId = `validation_batch_${crypto.randomUUID()}`;
      const initializedRuns = commands.map((discovered) => {
        const runId = deps.makeId(ValidationRunId, "validation");
        const startedAt = deps.nowIso();
        return {
          id: runId,
          batchId,
          attemptId: AttemptId.make(context.attemptId),
          ticketId: TicketId.make(context.ticketId),
          commandKind: discovered.kind,
          command: discovered.command,
          status: "running" as const,
          exitCode: null,
          stdoutSummary: null,
          stderrSummary: null,
          startedAt,
          finishedAt: null,
        };
      });
      const claimedBatch = yield* deps.sql.withTransaction(
        Effect.gen(function* () {
          const createdAt = deps.nowIso();
          yield* deps.sql`
            INSERT INTO presence_validation_batches (
              validation_batch_id, attempt_id, ticket_id, status, created_at, updated_at, completed_at
            ) VALUES (
              ${batchId},
              ${context.attemptId},
              ${context.ticketId},
              ${"running"},
              ${createdAt},
              ${createdAt},
              ${null}
            )
          `;
          for (const run of initializedRuns) {
            yield* deps.sql`
              INSERT INTO presence_validation_runs (
                validation_run_id, batch_id, attempt_id, ticket_id, command_kind, command_text,
                status, exit_code, stdout_summary, stderr_summary, started_at, finished_at
              ) VALUES (
                ${run.id},
                ${batchId},
                ${context.attemptId},
                ${context.ticketId},
                ${run.commandKind},
                ${run.command},
                ${"running"},
                ${null},
                ${null},
                ${null},
                ${run.startedAt},
                ${null}
              )
            `;
          }
          return true as const;
        }),
      ).pipe(
        Effect.catch((cause) =>
          deps.isSqliteUniqueConstraintError(cause)
            ? Effect.succeed(false as const)
            : Effect.fail(cause),
        ),
      );
      if (!claimedBatch) {
        const runningBatchId = yield* deps.readRunningValidationBatchIdForAttempt(context.attemptId);
        if (runningBatchId) {
          return yield* deps.readValidationRunsForBatch(runningBatchId);
        }
        return yield* Effect.fail(
          deps.presenceError(
            "Validation is already being started for this attempt. Try again in a moment.",
          ),
        );
      }

      const runs: ValidationRunRecord[] = [];
      const validationEvidenceIds: string[] = [];
      for (const initializedRun of initializedRuns) {
        const discovered = {
          kind: initializedRun.commandKind,
          command: initializedRun.command,
        };
        const shellInvocation = deps.makeValidationShellInvocation(discovered.command);
        const execution: { kind: "success"; result: ProcessRunResult } | { kind: "failure"; cause: unknown } =
          yield* Effect.tryPromise(() =>
          deps.runProcess(shellInvocation.command, shellInvocation.args, {
            cwd,
            timeoutMs: 10 * 60_000,
            allowNonZeroExit: true,
            maxBufferBytes: 256 * 1024,
            outputMode: "truncate",
          }),
        ).pipe(
          Effect.map((result) => ({ kind: "success", result } as const)),
          Effect.catch((cause) => Effect.succeed({ kind: "failure", cause } as const)),
          );

        const finishedAt = deps.nowIso();
        const status =
          execution.kind === "success" && execution.result.code === 0 && !execution.result.timedOut
            ? "passed"
            : "failed";
        const exitCode = execution.kind === "success" ? execution.result.code : null;
        const stdoutSummary =
          execution.kind === "success"
            ? deps.summarizeCommandOutput(execution.result.stdout)
            : null;
        const stderrSummary =
          execution.kind === "success"
            ? deps.summarizeCommandOutput(execution.result.stderr)
            : deps.summarizeCommandOutput(deps.describeUnknownError(execution.cause));

        yield* deps.sql`
          UPDATE presence_validation_runs
          SET
            status = ${status},
            exit_code = ${exitCode},
            stdout_summary = ${stdoutSummary},
            stderr_summary = ${stderrSummary},
            finished_at = ${finishedAt}
          WHERE validation_run_id = ${initializedRun.id}
        `;

        const evidenceId = deps.makeId(EvidenceId, "evidence");
        const evidenceContent = [
          `Command: ${discovered.command}`,
          `Kind: ${discovered.kind}`,
          `Status: ${status}`,
          `Exit code: ${exitCode ?? "null"}`,
          stdoutSummary ? `Stdout: ${stdoutSummary}` : null,
          stderrSummary ? `Stderr: ${stderrSummary}` : null,
        ]
          .filter((value): value is string => value !== null)
          .join("\n");

        yield* deps.sql`
          INSERT INTO presence_attempt_evidence (
            evidence_id, attempt_id, title, kind, content, created_at
          ) VALUES (
            ${evidenceId},
            ${context.attemptId},
            ${`${discovered.kind} validation: ${discovered.command}`},
            ${"validation"},
            ${evidenceContent},
            ${finishedAt}
          )
        `;
        validationEvidenceIds.push(evidenceId);

        runs.push({
          id: initializedRun.id,
          batchId,
          attemptId: AttemptId.make(context.attemptId),
          ticketId: TicketId.make(context.ticketId),
          commandKind: discovered.kind,
          command: discovered.command,
          status,
          exitCode,
          stdoutSummary,
          stderrSummary,
          startedAt: initializedRun.startedAt,
          finishedAt,
        });
      }

      const failedRuns = runs.filter((run) => run.status === "failed");
      const batchCompletedAt = deps.nowIso();
      yield* deps.sql`
        UPDATE presence_validation_batches
        SET
          status = ${failedRuns.length > 0 ? "failed" : "passed"},
          updated_at = ${batchCompletedAt},
          completed_at = ${batchCompletedAt}
        WHERE validation_batch_id = ${batchId}
      `;

      yield* deps.sql.withTransaction(
        Effect.gen(function* () {
          yield* deps.markTicketEvidenceChecklist(context.ticketId);
          yield* deps.markTicketValidationChecklist(context.ticketId);
        }),
      );
      if (failedRuns.length > 0) {
        yield* deps.createOrUpdateFinding({
          ticketId: context.ticketId,
          attemptId: context.attemptId,
          source: "validation",
          severity: "blocking",
          disposition: "same_ticket",
          summary: `Validation failed for ${failedRuns.length} command${failedRuns.length === 1 ? "" : "s"} in batch ${batchId}.`,
          rationale: failedRuns
            .map(
              (run) =>
                `${run.commandKind}: ${run.command}${run.stderrSummary ? ` -> ${run.stderrSummary}` : ""}`,
            )
            .join(" | "),
          evidenceIds: validationEvidenceIds,
          validationBatchId: batchId,
        });
        yield* deps.writeAttemptOutcome({
          attemptId: context.attemptId,
          kind: "failed_validation",
          summary: `Validation batch ${batchId} failed for ${failedRuns.length} command${failedRuns.length === 1 ? "" : "s"}.`,
        });
      }
      if (failedRuns.length === 0) {
        const findings = yield* deps.readFindingsForTicket(context.ticketId);
        for (const finding of findings.filter(
          (finding) =>
            finding.attemptId === context.attemptId &&
            finding.source === "validation" &&
            finding.status === "open",
        )) {
          yield* deps.updateFindingStatus(finding.id, "resolved");
        }
      }
      yield* deps.syncTicketProjectionBestEffort(context.ticketId, "Validation batch recorded.");
      return runs;
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(deps.presenceError("Failed to run attempt validation.", cause)),
      ),
    ),

  resolveFinding: (input) =>
    Effect.gen(function* () {
      const finding = yield* deps.updateFindingStatus(input.findingId, "resolved");
      yield* deps.syncTicketProjectionBestEffort(finding.ticketId, "Finding resolved.");
      return finding;
    }).pipe(
      Effect.catch((cause) => Effect.fail(deps.presenceError("Failed to resolve finding.", cause))),
    ),

  dismissFinding: (input) =>
    Effect.gen(function* () {
      const finding = yield* deps.updateFindingStatus(input.findingId, "dismissed");
      yield* deps.syncTicketProjectionBestEffort(finding.ticketId, "Finding dismissed.");
      return finding;
    }).pipe(
      Effect.catch((cause) => Effect.fail(deps.presenceError("Failed to dismiss finding.", cause))),
    ),
  synthesizeWorkerHandoffFromThread,
};

  return service;
};

export { makePresenceAttemptService };
export type { PresenceAttemptService };
