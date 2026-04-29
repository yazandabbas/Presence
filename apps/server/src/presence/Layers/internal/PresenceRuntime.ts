import {
  AgentSessionRecord,
  AttemptId,
  type AttemptRecord,
  type AttemptSummary,
  BoardId,
  type BoardRecord,
  BoardSnapshot,
  CommandId,
  DEFAULT_PRESENCE_RESUME_PROTOCOL,
  type DeterministicJobRecord,
  DeterministicJobId,
  EvidenceId,
  FindingId,
  GoalIntakeId,
  GoalIntakeSource,
  type GoalIntakeRecord,
  type GoalIntakeResult,
  HandoffId,
  type KnowledgePageRecord,
  KnowledgePageId,
  MessageId,
  MergeOperationId,
  type ModelSelection,
  PresenceAttachThreadInput,
  PresenceCleanupWorkspaceInput,
  PresenceCreateFollowUpProposalInput,
  PresenceCreateAttemptInput,
  PresenceCreateDeterministicJobInput,
  PresenceCreatePromotionCandidateInput,
  PresenceCancelSupervisorRunInput,
  PresenceDismissFindingInput,
  PresenceEvaluateSupervisorActionInput,
  PresenceGetRepositoryCapabilitiesInput,
  PresenceMaterializeFollowUpInput,
  PresencePrepareWorkspaceInput,
  PresenceProjectionHealthStatus,
  PresenceResolveFindingInput,
  type PresenceAcceptanceChecklistItem,
  PresenceCreateTicketInput,
  PresenceGetBoardSnapshotInput,
  PresenceImportRepositoryInput,
  PresenceListRepositoriesInput,
  PresenceMergeOperationStatus,
  PresenceScanRepositoryCapabilitiesInput,
  PresencePromotionStatus,
  PresenceReviewDecisionKind,
  PresenceReviewRecommendationKind,
  PresenceReviewPromotionCandidateInput,
  PresenceRpcError,
  type PresenceHumanDirectionResult,
  type PresenceSetControllerModeResult,
  PresenceSetControllerModeInput,
  PresenceSubmitHumanDirectionInput,
  PresenceSubmitGoalIntakeInput,
  PresenceStartSupervisorRunInput,
  PresenceSaveAttemptEvidenceInput,
  PresenceSaveSupervisorHandoffInput,
  PresenceSaveWorkerHandoffInput,
  PresenceStartAttemptSessionInput,
  PresenceAttemptStatus,
  PresenceAttemptOutcomeKind,
  PresenceFindingDisposition,
  PresenceFindingSeverity,
  PresenceFindingSource,
  PresenceFindingStatus,
  PresenceFollowUpProposalKind,
  PresenceJobStatus,
  PresenceKnowledgeFamily,
  PresenceReviewerKind,
  PresenceProjectionScopeType,
  PresenceSupervisorRunStage,
  PresenceSupervisorRunStatus,
  type RepositoryCapabilityScanRecord,
  type RepositoryCapabilityCommand,
  RepositoryCommandKind,
  PresenceTicketPriority,
  PresenceSubmitReviewDecisionInput,
  PresenceTicketStatus,
  PresenceUpdateTicketInput,
  PresenceUpsertKnowledgePageInput,
  PresenceWorkspaceStatus,
  ProviderKind,
  ProposedFollowUpId,
  type PromotionCandidateRecord,
  PromotionCandidateId,
  ProjectId,
  RepositoryId,
  type RepositorySummary,
  ReviewDecisionId,
  ReviewArtifactId,
  type ReviewChecklistAssessmentItem,
  type ReviewEvidenceItem,
  SupervisorRunId,
  type AttemptOutcomeRecord,
  type FindingRecord,
  type MergeOperationRecord,
  type ProposedFollowUpRecord,
  type ProjectionHealthRecord,
  type ReviewArtifactRecord,
  type ReviewDecisionRecord,
  type SupervisorPolicyDecision,
  type SupervisorActionKind,
  type SupervisorHandoffRecord,
  type SupervisorRunRecord,
  type TicketSummaryRecord,
  ThreadId,
  TicketId,
  TrimmedNonEmptyString,
  type TicketRecord,
  type WorkspaceRecord,
  WorkspaceId,
  type WorkerHandoffRecord,
  type AttemptEvidenceRecord,
} from "@t3tools/contracts";
import { resolveAutoFeatureBranchName } from "@t3tools/shared/git";
import { Effect, Result, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { GitCore } from "../../../git/Services/GitCore.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import type { PresenceControlPlaneShape } from "../../Services/PresenceControlPlane.ts";
import { ProviderRegistry } from "../../../provider/Services/ProviderRegistry.ts";
import { ServerSettingsService } from "../../../serverSettings.ts";
import { SupervisorPolicy } from "../../Services/SupervisorPolicy.ts";
import { makePresenceAttemptService } from "./PresenceAttemptService.ts";
import { makePresenceBoardService } from "./PresenceBoardService.ts";
import { makePresenceProjectionRuntime } from "./PresenceProjectionRuntime.ts";
import { makePresenceReviewMergeService } from "./PresenceReviewMergeService.ts";
import { makePresenceRuntimeSupport } from "./PresenceRuntimeSupport.ts";
import {
  buildAttemptBootstrapPrompt,
  buildReviewWorkerPrompt,
  buildSupervisorPromptSections,
  buildReviewWorkerSystemPrompt,
  buildSupervisorSystemPrompt,
  buildWorkerContinuationPrompt,
  buildWorkerSystemPrompt,
  formatBulletList,
  formatChecklistMarkdown,
  reviewResultSupportsMechanismChecklist,
} from "./PresencePrompting.ts";
import {
  REVIEW_THREAD_TIMEOUT_MS,
  addMillisecondsIso,
  buildBlockerSummaries,
  checklistIsComplete,
  chooseDefaultModelSelection,
  collapseWhitespace,
  conciseProjectionErrorMessage,
  collectAttemptActivityEntries,
  decodeJson,
  describeUnknownError,
  encodeJson,
  formatOptionalText,
  hasActivePresenceRuntimeEvents,
  hasAttemptExecutionContext,
  isEvidenceChecklistItem,
  isThreadSettled,
  isMechanismChecklistItem,
  isModelSelectionAvailable,
  isPresenceRpcError,
  isSqliteUniqueConstraintError,
  makeId,
  mergeOperationHasCleanupPending,
  mergeOperationIndicatesFailure,
  mergeOperationIsNonTerminal,
  normalizeGoalParts,
  normalizeIdList,
  nowIso,
  presenceError,
  projectionErrorPath,
  projectionIsRepairEligible,
  projectionRepairKey,
  projectionRetryDelayMs,
  readLatestAssistantReasoningFromThread,
  readLatestReviewResultFromThread,
  reviewResultHasValidationEvidence,
  readTextFileIfPresent,
  repeatedFailureKindForTicket,
  reasoningIsStale,
  sanitizeProjectionSegment,
  shortTitle,
  titleFromPath,
  truncateText,
  uniqueStrings,
  type AttemptActivityEntry,
  type BlockerSummary,
  type ParsedPresenceReviewFinding,
  type ParsedPresenceReviewResult,
  type ProjectionHealthStatus,
  type ProjectionScopeType,
  type WorkerReasoningSource,
} from "./PresenceShared.ts";
import { threadCorrelationSource } from "./PresenceCorrelationKeys.ts";
import { makePresenceStore } from "./PresenceStore.ts";
import { makePresenceSupervisorRuntime } from "./PresenceSupervisorRuntime.ts";

export const makePresenceControlPlane = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const gitCore = yield* GitCore;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const providerRegistry = yield* ProviderRegistry;
  const serverSettings = yield* ServerSettingsService;
  const supervisorPolicy = yield* SupervisorPolicy;

  const readPresenceModelSelection = () =>
    serverSettings.getSettings.pipe(
      Effect.map((settings) => settings.presence.modelSelection),
      Effect.catch((error) =>
        Effect.logWarning("failed to read Presence harness setting", {
          error: String(error),
        }).pipe(Effect.as(null)),
      ),
    );

  const readPresenceNativeToolsEnabled = () =>
    serverSettings.getSettings.pipe(
      Effect.map((settings) => settings.presence.nativeToolsEnabled),
      Effect.catch((error) =>
        Effect.logWarning("failed to read Presence native tools setting", {
          error: String(error),
        }).pipe(Effect.as(true)),
      ),
    );

  const persistSupervisorRun = (input: {
    runId: string;
    boardId: string;
    sourceGoalIntakeId: string | null;
    scopeTicketIds: ReadonlyArray<string>;
    status: PresenceSupervisorRunStatus;
    stage: PresenceSupervisorRunStage;
    currentTicketId: string | null;
    activeThreadIds: ReadonlyArray<string>;
    summary: string;
    createdAt?: string;
  }) =>
    Effect.gen(function* () {
      const now = nowIso();
      yield* sql`
        INSERT INTO presence_supervisor_runs (
          supervisor_run_id, board_id, source_goal_intake_id, scope_ticket_ids_json, status, stage,
          current_ticket_id, active_thread_ids_json, summary, created_at, updated_at
        ) VALUES (
          ${input.runId},
          ${input.boardId},
          ${input.sourceGoalIntakeId},
          ${encodeJson(input.scopeTicketIds)},
          ${input.status},
          ${input.stage},
          ${input.currentTicketId},
          ${encodeJson(input.activeThreadIds)},
          ${input.summary},
          ${input.createdAt ?? now},
          ${now}
        )
        ON CONFLICT(supervisor_run_id) DO UPDATE SET
          source_goal_intake_id = excluded.source_goal_intake_id,
          scope_ticket_ids_json = excluded.scope_ticket_ids_json,
          status = excluded.status,
          stage = excluded.stage,
          current_ticket_id = excluded.current_ticket_id,
          active_thread_ids_json = excluded.active_thread_ids_json,
          summary = excluded.summary,
          updated_at = excluded.updated_at
      `;
      const row = yield* readSupervisorRunById(input.runId);
      if (!row) {
        return yield* Effect.fail(
          presenceError(`Supervisor run '${input.runId}' could not be loaded.`),
        );
      }
      yield* Effect.forEach(
        input.activeThreadIds,
        (threadId) =>
          store.attachSupervisorRunToThreadCorrelation({
            threadId,
            boardId: input.boardId,
            supervisorRunId: input.runId,
            source: threadCorrelationSource("supervisor_active_thread"),
          }),
        { discard: true },
      );
      yield* syncBoardProjectionBestEffort(input.boardId, "Supervisor run updated.");
      return row;
    });

  const getOrCreateCapabilityScan = (repositoryId: string) =>
    boardService.getOrCreateCapabilityScan(repositoryId);

  const store = makePresenceStore({ sql, nowIso });
  const {
    mapRepository,
    mapBoard,
    mapTicket,
    mapAttempt,
    mapWorkspace,
    mapSupervisorHandoff,
    mapWorkerHandoff,
    mapSupervisorRun,
    mapProjectionHealth,
    mapEvidence,
    mapFinding,
    mapReviewArtifact,
    mapProposedFollowUp,
    mapAttemptOutcome,
    mapKnowledgePage,
    mapPromotionCandidate,
    mapJob,
    mapReviewDecision,
    mapMergeOperation,
    mapCapabilityScan,
    mapGoalIntake,
    readRepositoryByWorkspaceRoot,
    readRepositoryById,
    readLatestCapabilityScan,
    readTicketForPolicy,
    readAttemptWorkspaceContext,
    readLatestSupervisorHandoffForBoard,
    readLatestWorkerHandoffForAttempt,
    readSupervisorRunById,
    readLatestSupervisorRunForBoard,
    readMergeOperationById,
    readLatestMergeOperationForAttempt,
    persistMergeOperation,
    readLatestMergeApprovedDecisionForAttempt,
    readFindingsForTicket,
    readReviewArtifactsForTicket,
    readFollowUpProposalsForTicket,
    readAttemptOutcomesForTicket,
    readOpenBlockingFindingsForTicket,
    createOrUpdateFinding,
    updateFindingStatus,
    resolveOpenFindings,
    createReviewArtifact,
    materializeReviewFindings,
    markTicketEvidenceChecklist,
    markTicketMechanismChecklist,
    writeAttemptOutcome,
    readBoardMissionBriefing,
    readBoardControllerState,
    upsertBoardControllerState,
    readTicketMissionBriefingsForBoard,
    readRecentMissionEventsForBoard,
    readRecentOperationLedgerForBoard,
    refreshTicketMissionState,
    refreshBoardMissionState,
    writeMissionEvent,
    upsertOperationLedger,
  } = store;
  const runtimeSupport = makePresenceRuntimeSupport({
    sql,
    gitCore,
    orchestrationEngine,
    providerRegistry,
    makeId,
    nowIso,
    readAttemptWorkspaceContext,
    readPresenceModelSelection,
    readPresenceNativeToolsEnabled,
    chooseDefaultModelSelection,
    isModelSelectionAvailable,
    uniqueStrings,
    decodeJson,
    presenceError,
  });
  const {
    ensureWorkspacePrepared,
    readThreadFromModel,
    readChangedFilesForWorkspace,
    resolveModelSelectionForAttempt,
    syncThreadWorkspaceMetadata,
    queueTurnStart,
    waitForClaimedThreadAvailability,
  } = runtimeSupport;
  let getBoardSnapshotInternalRef: (
    boardId: string,
  ) => Effect.Effect<BoardSnapshot, Error, never> = () =>
    Effect.die("Board snapshot service was not initialized.");
  let buildWorkerHandoffCandidateRef: (
    input: Parameters<
      ReturnType<typeof makePresenceAttemptService>["buildWorkerHandoffCandidate"]
    >[0],
  ) => ReturnType<
    ReturnType<typeof makePresenceAttemptService>["buildWorkerHandoffCandidate"]
  > = () => Effect.die("Worker handoff builder was not initialized.");
  const projectionRuntime = makePresenceProjectionRuntime({
    sql,
    nowIso,
    mapProjectionHealth,
    getBoardSnapshotInternal: (boardId: string) => getBoardSnapshotInternalRef(boardId),
    readTicketForPolicy,
    readThreadFromModel,
    buildBlockerSummaries,
    upsertOperationLedger,
  });
  const {
    buildAttemptActivityMarkdown,
    buildAttemptBlockersMarkdown,
    buildAttemptDecisionsMarkdown,
    buildAttemptFindingsMarkdown,
    buildAttemptProgressMarkdown,
    buildAttemptReviewMarkdown,
    buildBrainIndexMarkdown,
    buildBrainLogMarkdown,
    buildKnowledgePageMarkdown,
    readProjectionHealth,
    runProjectionWorker,
    buildSupervisorHandoffMarkdown,
    buildSupervisorRunMarkdown,
    buildTicketCurrentSummaryMarkdown,
    buildTicketMarkdown,
    syncBoardProjectionBestEffort,
    syncProjectionStrict,
    syncTicketProjectionBestEffort,
    writeProjectionFile,
  } = projectionRuntime;

  const boardService = {
    ...makePresenceBoardService({
      sql,
      gitCore,
      supervisorPolicy,
      orchestrationEngine,
      providerRegistry,
      chooseDefaultModelSelection,
      readRepositoryByWorkspaceRoot,
      mapRepository,
      titleFromPath,
      makeId,
      nowIso,
      encodeJson,
      readTextFileIfPresent,
      uniqueStrings,
      syncBoardProjectionBestEffort,
      projectionIsRepairEligible,
      runProjectionWorker,
      readLatestCapabilityScan,
      readRepositoryById,
      mapBoard,
      mapTicket,
      mapAttempt,
      mapWorkspace,
      mapSupervisorHandoff,
      mapWorkerHandoff,
      mapSupervisorRun,
      mapProjectionHealth,
      mapEvidence,
      mapFinding,
      mapReviewArtifact,
      mapProposedFollowUp,
      mapAttemptOutcome,
      mapKnowledgePage,
      mapPromotionCandidate,
      mapJob,
      mapReviewDecision,
      mapMergeOperation,
      mapCapabilityScan,
      mapGoalIntake,
      syncTicketProjectionBestEffort,
      syncProjectionStrict,
      decodeJson,
      readTicketForPolicy,
      readAttemptWorkspaceContext,
      readFindingsForTicket,
      readAttemptOutcomesForTicket,
      readBoardMissionBriefing,
      readBoardControllerState,
      readTicketMissionBriefingsForBoard,
      readRecentMissionEventsForBoard,
      readRecentOperationLedgerForBoard,
      normalizeGoalParts,
      shortTitle,
      readThreadFromModel,
      buildWorkerHandoffCandidate: (input) => buildWorkerHandoffCandidateRef(input),
      presenceError,
    }),
  };
  const {
    saveSupervisorHandoff,
    createFollowUpProposal,
    materializeFollowUp,
    syncTicketProjection,
    syncBrainProjection,
    upsertKnowledgePage,
    createPromotionCandidate,
    reviewPromotionCandidate,
    createDeterministicJob,
    evaluateSupervisorAction,
    submitGoalIntake,
    getBoardSnapshotInternal,
    materializeGoalIntakePlan,
    ensurePromotionCandidateForAcceptedAttempt,
    evaluateSupervisorActionInternal,
  } = boardService;
  getBoardSnapshotInternalRef = getBoardSnapshotInternal;
  const attemptService = makePresenceAttemptService({
    sql,
    removeWorktree: (input) => gitCore.removeWorktree(input),
    readAvailableProviders: () => providerRegistry.getProviders,
    dispatchOrchestration: (command) => orchestrationEngine.dispatch(command),
    makeId,
    nowIso,
    presenceError,
    isPresenceRpcError,
    isSqliteUniqueConstraintError,
    readAttemptOutcomesForTicket,
    repeatedFailureKindForTicket,
    createOrUpdateFinding,
    syncTicketProjectionBestEffort,
    ensureWorkspacePrepared,
    readAttemptWorkspaceContext,
    syncThreadWorkspaceMetadata,
    writeAttemptOutcome,
    upsertPresenceThreadCorrelation: store.upsertPresenceThreadCorrelation,
    writeMissionEvent,
    upsertOperationLedger,
    evaluateSupervisorActionInternal,
    decodeJson,
    isModelSelectionAvailable,
    chooseDefaultModelSelection,
    readPresenceModelSelection,
    buildWorkerSystemPrompt,
    readLatestWorkerHandoffForAttempt,
    readLatestSupervisorHandoffForBoard,
    retrieveRepoBrainMemories: store.retrieveRepoBrainMemories,
    buildAttemptBootstrapPrompt,
    waitForClaimedThreadAvailability,
    mapAttempt,
    encodeJson,
    markTicketEvidenceChecklist,
    readFindingsForTicket,
    updateFindingStatus,
    hasAttemptExecutionContext,
    readThreadFromModel,
    readChangedFilesForWorkspace,
    readLatestAssistantReasoningFromThread,
    readRecentMissionEventsForBoard,
    buildBlockerSummaries,
    uniqueStrings,
    isThreadSettled,
  });
  const {
    buildWorkerHandoffCandidate,
    createAttempt,
    startAttemptSession,
    saveWorkerHandoff,
    synthesizeWorkerHandoffFromThread,
  } = attemptService;
  buildWorkerHandoffCandidateRef = buildWorkerHandoffCandidate;
  const reviewMergeService = makePresenceReviewMergeService({
    presenceError,
    gitExecute: (input) => gitCore.execute(input),
    gitStatusDetails: (cwd) => gitCore.statusDetails(cwd),
    gitPrepareCommitContext: (cwd) => gitCore.prepareCommitContext(cwd),
    gitCommit: (cwd, title, body) => gitCore.commit(cwd, title, body ?? ""),
    removeWorktree: (input) => gitCore.removeWorktree(input),
    dispatchOrchestration: (command) => orchestrationEngine.dispatch(command),
    resolveModelSelectionForAttempt,
    makeId,
    nowIso,
    buildReviewWorkerSystemPrompt,
    buildReviewWorkerPrompt,
    queueTurnStart,
    readTicketForPolicy,
    readLatestWorkerHandoffForAttempt,
    retrieveRepoBrainMemories: store.retrieveRepoBrainMemories,
    createOrUpdateFinding,
    sql,
    createReviewArtifact,
    upsertPresenceThreadCorrelation: store.upsertPresenceThreadCorrelation,
    syncTicketProjectionBestEffort,
    readLatestCapabilityScan,
    readLatestMergeApprovedDecisionForAttempt,
    readAttemptWorkspaceContext,
    readLatestMergeOperationForAttempt,
    evaluateSupervisorActionInternal,
    persistMergeOperation,
    readMergeOperationById,
    updateFindingStatus,
    writeAttemptOutcome,
    writeMissionEvent,
    resolveOpenFindings,
    materializeReviewFindings,
    markTicketMechanismChecklist,
    syncThreadWorkspaceMetadata,
  });
  const {
    startReviewSession,
    queueReviewSessionTurn,
    blockTicketForReviewFailure,
    applyReviewDecisionInternal,
  } = reviewMergeService;
  const supervisorRuntime = makePresenceSupervisorRuntime({
    getBoardSnapshotInternal,
    readLatestSupervisorRunForBoard,
    readSupervisorRunById,
    persistSupervisorRun,
    saveSupervisorHandoff,
    normalizeIdList,
    nowIso,
    makeId,
    isSqliteUniqueConstraintError,
    presenceError,
    projectionIsRepairEligible,
    runProjectionWorker,
    materializeGoalIntakePlan,
    createAttempt,
    readAttemptWorkspaceContext,
    startAttemptSession,
    readThreadFromModel,
    isThreadSettled,
    synthesizeWorkerHandoffFromThread,
    syncTicketProjectionBestEffort,
    readLatestWorkerHandoffForAttempt,
    uniqueStrings,
    saveWorkerHandoff,
    createOrUpdateFinding,
    sql,
    resolveModelSelectionForAttempt,
    queueTurnStart,
    buildWorkerContinuationPrompt,
    startReviewSession,
    queueReviewSessionTurn,
    addMillisecondsIso,
    reviewThreadTimeoutMs: REVIEW_THREAD_TIMEOUT_MS,
    readLatestReviewResultFromThread,
    reviewResultHasValidationEvidence,
    blockTicketForReviewFailure,
    applyReviewDecisionInternal,
    reviewResultSupportsMechanismChecklist,
    ensurePromotionCandidateForAcceptedAttempt,
    writeMissionEvent,
  });

  const describeHumanDirection = (input: PresenceSubmitHumanDirectionInput): string => {
    if (input.directionKind === "retry_review_with_codex") {
      return "Retry the review with Codex guidance.";
    }
    if (input.directionKind === "start_fresh_attempt") {
      return "Start a fresh attempt and avoid repeating the failed path.";
    }
    if (input.directionKind === "pause_ticket") {
      return "Pause this ticket until the user gives more direction.";
    }
    return "Follow the user's custom direction.";
  };

  const statusAfterHumanDirection = (
    input: PresenceSubmitHumanDirectionInput,
    currentStatus: PresenceTicketStatus,
    hasAttempt: boolean,
  ): PresenceTicketStatus => {
    if (input.directionKind === "pause_ticket") {
      return "blocked";
    }
    if (input.directionKind === "retry_review_with_codex") {
      return hasAttempt ? "in_review" : "todo";
    }
    if (input.directionKind === "start_fresh_attempt") {
      return "todo";
    }
    if (currentStatus === "blocked") {
      return hasAttempt ? "in_progress" : "todo";
    }
    return currentStatus;
  };

  const submitHumanDirection: (
    input: PresenceSubmitHumanDirectionInput,
  ) => Effect.Effect<PresenceHumanDirectionResult, PresenceRpcError, never> = (input) =>
    Effect.gen(function* () {
      const snapshot = yield* getBoardSnapshotInternal(input.boardId);
      const ticket = snapshot.tickets.find((candidate) => candidate.id === input.ticketId);
      if (!ticket) {
        return yield* Effect.fail(
          presenceError("Ticket does not belong to the selected Presence board."),
        );
      }

      const attemptsForTicket = snapshot.attempts.filter(
        (attempt) => attempt.ticketId === input.ticketId,
      );
      const selectedAttemptId =
        input.attemptId ??
        ticket.assignedAttemptId ??
        attemptsForTicket.toSorted((left, right) =>
          right.createdAt.localeCompare(left.createdAt),
        )[0]?.id ??
        null;
      const summary = describeHumanDirection(input);
      const createdAt = nowIso();

      const event = yield* writeMissionEvent({
        boardId: input.boardId,
        ticketId: input.ticketId,
        attemptId: selectedAttemptId,
        kind: "human_direction",
        severity: input.directionKind === "pause_ticket" ? "warning" : "info",
        summary,
        detail: input.instructions,
        retryBehavior: input.directionKind === "pause_ticket" ? "manual" : "automatic",
        humanAction: null,
        dedupeKey: `human-direction:${input.ticketId}:${createdAt}`,
        report: {
          kind: "supervisor_decision",
          summary,
          details: input.instructions,
          evidence: [],
          blockers: [],
          nextAction:
            input.directionKind === "pause_ticket"
              ? "Wait for the user to resume the ticket."
              : "Resume the supervisor loop with this direction.",
        },
        createdAt,
      });

      const nextStatus = statusAfterHumanDirection(
        input,
        ticket.status,
        attemptsForTicket.length > 0,
      );
      if (ticket.status !== nextStatus) {
        yield* boardService.updateTicket({
          ticketId: input.ticketId,
          status: nextStatus,
        });
      }

      yield* saveSupervisorHandoff({
        boardId: input.boardId,
        topPriorities: [ticket.title],
        activeAttemptIds: selectedAttemptId ? [AttemptId.make(selectedAttemptId)] : [],
        blockedTicketIds:
          input.directionKind === "pause_ticket" ? [TicketId.make(input.ticketId)] : [],
        recentDecisions: [`Human direction: ${input.instructions}`],
        nextBoardActions:
          input.directionKind === "pause_ticket"
            ? ["Keep this ticket paused until the user resumes it."]
            : ["Resume this ticket using the latest human direction."],
        currentRunId: null,
        stage: "plan",
        resumeProtocol: DEFAULT_PRESENCE_RESUME_PROTOCOL.supervisorReadOrder,
      });

      yield* refreshTicketMissionState({
        boardId: input.boardId,
        ticketId: input.ticketId,
        latestEvent: event,
      });
      yield* refreshBoardMissionState(input.boardId);

      const shouldAutoContinue =
        input.autoContinue !== false && input.directionKind !== "pause_ticket";
      if (!shouldAutoContinue) {
        return { missionEvent: event, supervisorRun: null };
      }

      const refreshedSnapshot = yield* getBoardSnapshotInternal(input.boardId);
      const latestRun = refreshedSnapshot.supervisorRuns[0] ?? null;
      if (
        latestRun?.status === "running" ||
        hasActivePresenceRuntimeEvents(refreshedSnapshot.missionEvents)
      ) {
        return { missionEvent: event, supervisorRun: null };
      }

      const supervisorRun = yield* supervisorRuntime
        .startSupervisorRun({
          boardId: input.boardId,
          ticketIds: [input.ticketId],
        })
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("Presence human direction did not auto-start supervisor", {
              error: describeUnknownError(error),
            }).pipe(Effect.as(null)),
          ),
        );

      return { missionEvent: event, supervisorRun };
    }).pipe(
      Effect.catch((error) =>
        Effect.fail(isPresenceRpcError(error) ? error : presenceError(describeUnknownError(error))),
      ),
    );

  const planGoalIntake: PresenceControlPlaneShape["planGoalIntake"] = (input) =>
    materializeGoalIntakePlan({
      boardId: input.boardId,
      goalIntakeId: input.goalIntakeId,
    }).pipe(
      Effect.catch((error) =>
        Effect.fail(isPresenceRpcError(error) ? error : presenceError(describeUnknownError(error))),
      ),
    );

  const setControllerMode: (
    input: PresenceSetControllerModeInput,
  ) => Effect.Effect<PresenceSetControllerModeResult, PresenceRpcError, never> = (input) =>
    Effect.gen(function* () {
      const snapshot = yield* getBoardSnapshotInternal(input.boardId);
      const status = input.mode === "paused" ? "paused" : "idle";
      const summary =
        input.mode === "paused"
          ? "Presence is paused for this board."
          : "Presence is active and will pick up queued work automatically.";
      if (
        snapshot.controllerState?.mode === input.mode &&
        snapshot.controllerState.status === status
      ) {
        return { controllerState: snapshot.controllerState };
      }
      const controllerState = yield* upsertBoardControllerState({
        boardId: input.boardId,
        mode: input.mode,
        status,
        summary,
        lastTickAt: snapshot.controllerState?.lastTickAt ?? null,
      }).pipe(
        Effect.mapError((cause) =>
          presenceError("Failed to update Presence controller mode.", cause),
        ),
      );
      yield* writeMissionEvent({
        boardId: input.boardId,
        kind: "controller_action",
        severity: input.mode === "paused" ? "warning" : "info",
        summary,
        detail: null,
        retryBehavior: "not_applicable",
        humanAction: null,
        dedupeKey: `controller-mode:${input.boardId}:${input.mode}:${controllerState.updatedAt}`,
        createdAt: controllerState.updatedAt,
      }).pipe(
        Effect.mapError((cause) =>
          presenceError("Failed to record Presence controller mode change.", cause),
        ),
      );
      return { controllerState };
    }).pipe(
      Effect.catch((error) =>
        Effect.fail(isPresenceRpcError(error) ? error : presenceError(describeUnknownError(error))),
      ),
    );

  return {
    ...boardService,
    planGoalIntake,
    ...attemptService,
    ...reviewMergeService,
    ...supervisorRuntime,
    submitHumanDirection,
    setControllerMode,
  } satisfies PresenceControlPlaneShape;
});
