import {
  AttemptId,
  CapabilityScanId,
  BoardId,
  DeterministicJobId,
  EvidenceId,
  FindingId,
  GoalIntakeId,
  GoalIntakeSource,
  HandoffId,
  KnowledgePageId,
  MergeOperationId,
  ProjectId,
  PromotionCandidateId,
  ProposedFollowUpId,
  RepositoryId,
  ReviewArtifactId,
  ReviewDecisionId,
  SupervisorRunId,
  ThreadId,
  TicketId,
  ValidationRunId,
  ValidationWaiverId,
  WorkspaceId,
  ProviderKind,
  PresenceAttemptOutcomeKind,
  PresenceAttemptStatus,
  PresenceFindingDisposition,
  PresenceFindingSeverity,
  PresenceFindingSource,
  PresenceFindingStatus,
  PresenceFollowUpProposalKind,
  PresenceJobStatus,
  PresenceKnowledgeFamily,
  PresenceMergeOperationStatus,
  PresenceProjectionHealthStatus,
  PresenceProjectionScopeType,
  PresencePromotionStatus,
  PresenceReviewDecisionKind,
  PresenceReviewRecommendationKind,
  PresenceReviewerKind,
  PresenceSupervisorRunStage,
  PresenceSupervisorRunStatus,
  PresenceTicketPriority,
  PresenceTicketStatus,
  PresenceWorkspaceStatus,
  RepositoryCommandKind,
  type PresenceAcceptanceChecklistItem,
  type AttemptEvidenceRecord,
  type AttemptOutcomeRecord,
  type AttemptRecord,
  type BoardRecord,
  type DeterministicJobRecord,
  type FindingRecord,
  type GoalIntakeRecord,
  type KnowledgePageRecord,
  type ModelSelection,
  type MergeOperationRecord,
  type ProjectionHealthRecord,
  type PromotionCandidateRecord,
  type ProposedFollowUpRecord,
  type RepositoryCapabilityCommand,
  type RepositoryCapabilityScanRecord,
  type RepositorySummary,
  type ReviewArtifactRecord,
  type ReviewChecklistAssessmentItem,
  type ReviewDecisionRecord,
  type ReviewEvidenceItem,
  type SupervisorHandoffRecord,
  type SupervisorRunRecord,
  type ValidationRunRecord,
  type ValidationWaiverRecord,
  type WorkerHandoffRecord,
} from "@t3tools/contracts";
import { Effect, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql/SqlClient";

import {
  decodeJson,
  encodeJson,
  isEvidenceChecklistItem,
  isMechanismChecklistItem,
  isValidationChecklistItem,
  uniqueStrings,
  type WorkerReasoningSource,
} from "./PresenceShared.ts";
import type { AttemptWorkspaceContextRow, TicketPolicyRow } from "./PresenceInternalDeps.ts";

const decode = Schema.decodeUnknownSync;

const mapRepository = (row: {
  id: string;
  boardId: string;
  projectId: string | null;
  title: string;
  workspaceRoot: string;
  defaultModelSelection: string | null;
  createdAt: string;
  updatedAt: string;
}): RepositorySummary => ({
  id: RepositoryId.make(row.id),
  boardId: BoardId.make(row.boardId),
  projectId: row.projectId ? ProjectId.make(row.projectId) : null,
  title: row.title,
  workspaceRoot: row.workspaceRoot,
  defaultModelSelection: decodeJson<ModelSelection | null>(row.defaultModelSelection, null),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const mapBoard = (row: {
  id: string;
  repositoryId: string;
  title: string;
  sprintFocus: string | null;
  topPrioritySummary: string | null;
  createdAt: string;
  updatedAt: string;
}): BoardRecord => ({
  id: BoardId.make(row.id),
  repositoryId: RepositoryId.make(row.repositoryId),
  title: row.title,
  sprintFocus: row.sprintFocus,
  topPrioritySummary: row.topPrioritySummary,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const mapTicket = (row: {
  id: string;
  boardId: string;
  parentTicketId: string | null;
  title: string;
  description: string;
  status: string;
  priority: string;
  acceptanceChecklist: string;
  assignedAttemptId: string | null;
  createdAt: string;
  updatedAt: string;
}) => ({
  id: TicketId.make(row.id),
  boardId: BoardId.make(row.boardId),
  parentTicketId: row.parentTicketId ? TicketId.make(row.parentTicketId) : null,
  title: row.title,
  description: row.description,
  status: decode(PresenceTicketStatus)(row.status),
  priority: decode(PresenceTicketPriority)(row.priority),
  acceptanceChecklist: decodeJson(row.acceptanceChecklist, []),
  assignedAttemptId: row.assignedAttemptId ? AttemptId.make(row.assignedAttemptId) : null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const mapAttempt = (row: {
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
}): AttemptRecord => ({
  id: AttemptId.make(row.id),
  ticketId: TicketId.make(row.ticketId),
  workspaceId: row.workspaceId ? WorkspaceId.make(row.workspaceId) : null,
  title: row.title,
  status: decode(PresenceAttemptStatus)(row.status),
  provider: row.provider ? decode(ProviderKind)(row.provider) : null,
  model: row.model,
  threadId: row.threadId ? ThreadId.make(row.threadId) : null,
  summary: row.summary,
  confidence: row.confidence,
  lastWorkerHandoffId: row.lastWorkerHandoffId ? HandoffId.make(row.lastWorkerHandoffId) : null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const mapWorkspace = (row: {
  id: string;
  attemptId: string;
  status: string;
  branch: string | null;
  worktreePath: string | null;
  createdAt: string;
  updatedAt: string;
}) => ({
  id: WorkspaceId.make(row.id),
  attemptId: AttemptId.make(row.attemptId),
  status: decode(PresenceWorkspaceStatus)(row.status),
  branch: row.branch,
  worktreePath: row.worktreePath,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const mapSupervisorHandoff = (row: {
  id: string;
  boardId: string;
  payload: string;
  createdAt: string;
}): SupervisorHandoffRecord => {
  const payload = decodeJson<{
    topPriorities: string[];
    activeAttemptIds: string[];
    blockedTicketIds: string[];
    recentDecisions: string[];
    nextBoardActions: string[];
    currentRunId: string | null;
    stage: PresenceSupervisorRunStage | null;
    resumeProtocol: string[];
  }>(row.payload, {
    topPriorities: [],
    activeAttemptIds: [],
    blockedTicketIds: [],
    recentDecisions: [],
    nextBoardActions: [],
    currentRunId: null,
    stage: null,
    resumeProtocol: [],
  });
  return {
    id: HandoffId.make(row.id),
    boardId: BoardId.make(row.boardId),
    topPriorities: payload.topPriorities,
    activeAttemptIds: payload.activeAttemptIds.map((value) => AttemptId.make(value)),
    blockedTicketIds: payload.blockedTicketIds.map((value) => TicketId.make(value)),
    recentDecisions: payload.recentDecisions,
    nextBoardActions: payload.nextBoardActions,
    currentRunId: payload.currentRunId ? SupervisorRunId.make(payload.currentRunId) : null,
    stage: payload.stage,
    resumeProtocol: [...payload.resumeProtocol],
    createdAt: row.createdAt,
  };
};

const mapWorkerHandoff = (row: {
  id: string;
  attemptId: string;
  payload: string;
  createdAt: string;
}): WorkerHandoffRecord => {
  const payload = decodeJson<{
    completedWork: string[];
    currentHypothesis: string | null;
    changedFiles: string[];
    testsRun: string[];
    blockers: string[];
    nextStep: string | null;
    openQuestions: string[];
    retryCount: number;
    reasoningSource: WorkerReasoningSource;
    reasoningUpdatedAt: string | null;
    confidence: number | null;
    evidenceIds: string[];
  }>(row.payload, {
    completedWork: [],
    currentHypothesis: null,
    changedFiles: [],
    testsRun: [],
    blockers: [],
    nextStep: null,
    openQuestions: [],
    retryCount: 0,
    reasoningSource: null,
    reasoningUpdatedAt: null,
    confidence: null,
    evidenceIds: [],
  });
  return {
    id: HandoffId.make(row.id),
    attemptId: AttemptId.make(row.attemptId),
    completedWork: payload.completedWork,
    currentHypothesis: payload.currentHypothesis,
    changedFiles: payload.changedFiles,
    testsRun: payload.testsRun,
    blockers: payload.blockers,
    nextStep: payload.nextStep,
    openQuestions: payload.openQuestions,
    retryCount: payload.retryCount,
    reasoningSource: payload.reasoningSource ?? null,
    reasoningUpdatedAt: payload.reasoningUpdatedAt ?? null,
    confidence: payload.confidence,
    evidenceIds: payload.evidenceIds.map((value) => EvidenceId.make(value)),
    createdAt: row.createdAt,
  };
};

const mapSupervisorRun = (row: {
  id: string;
  boardId: string;
  sourceGoalIntakeId: string | null;
  scopeTicketIdsJson: string;
  status: string;
  stage: string;
  currentTicketId: string | null;
  activeThreadIdsJson: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
}): SupervisorRunRecord => ({
  id: SupervisorRunId.make(row.id),
  boardId: BoardId.make(row.boardId),
  sourceGoalIntakeId: row.sourceGoalIntakeId ? GoalIntakeId.make(row.sourceGoalIntakeId) : null,
  scopeTicketIds: decodeJson<string[]>(row.scopeTicketIdsJson, []).map((value) => TicketId.make(value)),
  status: decode(PresenceSupervisorRunStatus)(row.status),
  stage: decode(PresenceSupervisorRunStage)(row.stage),
  currentTicketId: row.currentTicketId ? TicketId.make(row.currentTicketId) : null,
  activeThreadIds: decodeJson<string[]>(row.activeThreadIdsJson, []).map((value) => ThreadId.make(value)),
  summary: row.summary,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const mapProjectionHealth = (row: {
  scopeType: string;
  scopeId: string;
  status: string;
  desiredVersion: number;
  projectedVersion: number;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  lastAttemptedAt: string | null;
  lastSucceededAt: string | null;
  lastErrorMessage: string | null;
  lastErrorPath: string | null;
  dirtyReason: string | null;
  retryAfter: string | null;
  attemptCount: number;
  updatedAt: string;
}): ProjectionHealthRecord => ({
  scopeType: decode(PresenceProjectionScopeType)(row.scopeType),
  scopeId: row.scopeId,
  status: decode(PresenceProjectionHealthStatus)(row.status),
  desiredVersion: Math.max(0, Number(row.desiredVersion ?? 0)),
  projectedVersion: Math.max(0, Number(row.projectedVersion ?? 0)),
  leaseOwner: row.leaseOwner,
  leaseExpiresAt: row.leaseExpiresAt,
  lastAttemptedAt: row.lastAttemptedAt,
  lastSucceededAt: row.lastSucceededAt,
  lastErrorMessage: row.lastErrorMessage,
  lastErrorPath: row.lastErrorPath,
  dirtyReason: row.dirtyReason,
  retryAfter: row.retryAfter,
  attemptCount: Math.max(0, Number(row.attemptCount ?? 0)),
  updatedAt: row.updatedAt,
});

const mapEvidence = (row: {
  id: string;
  attemptId: string;
  title: string;
  kind: string;
  content: string;
  createdAt: string;
}): AttemptEvidenceRecord => ({
  id: EvidenceId.make(row.id),
  attemptId: AttemptId.make(row.attemptId),
  title: row.title,
  kind: row.kind,
  content: row.content,
  createdAt: row.createdAt,
});

const mapValidationRun = (row: {
  id: string;
  batchId: string;
  attemptId: string;
  ticketId: string;
  commandKind: string;
  command: string;
  status: string;
  exitCode: number | null;
  stdoutSummary: string | null;
  stderrSummary: string | null;
  startedAt: string;
  finishedAt: string | null;
}): ValidationRunRecord => ({
  id: ValidationRunId.make(row.id),
  batchId: row.batchId,
  attemptId: AttemptId.make(row.attemptId),
  ticketId: TicketId.make(row.ticketId),
  commandKind: decode(RepositoryCommandKind)(row.commandKind),
  command: row.command,
  status: decode(Schema.Literals(["running", "passed", "failed"]))(row.status),
  exitCode: row.exitCode,
  stdoutSummary: row.stdoutSummary,
  stderrSummary: row.stderrSummary,
  startedAt: row.startedAt,
  finishedAt: row.finishedAt,
});

const mapFinding = (row: {
  id: string;
  ticketId: string;
  attemptId: string | null;
  source: string;
  severity: string;
  disposition: string;
  status: string;
  summary: string;
  rationale: string;
  evidenceIds: string;
  validationBatchId: string | null;
  createdAt: string;
  updatedAt: string;
}): FindingRecord => ({
  id: FindingId.make(row.id),
  ticketId: TicketId.make(row.ticketId),
  attemptId: row.attemptId ? AttemptId.make(row.attemptId) : null,
  source: decode(PresenceFindingSource)(row.source),
  severity: decode(PresenceFindingSeverity)(row.severity),
  disposition: decode(PresenceFindingDisposition)(row.disposition),
  status: decode(PresenceFindingStatus)(row.status),
  summary: row.summary,
  rationale: row.rationale,
  evidenceIds: decodeJson<string[]>(row.evidenceIds, []).map((value) => EvidenceId.make(value)),
  validationBatchId: row.validationBatchId,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const mapReviewArtifact = (row: {
  id: string;
  ticketId: string;
  attemptId: string | null;
  reviewerKind: string;
  decision: string | null;
  summary: string;
  checklistJson: string;
  checklistAssessmentJson: string;
  evidenceJson: string;
  changedFilesJson: string;
  changedFilesReviewedJson: string;
  findingIdsJson: string;
  threadId: string | null;
  createdAt: string;
}): ReviewArtifactRecord => ({
  id: ReviewArtifactId.make(row.id),
  ticketId: TicketId.make(row.ticketId),
  attemptId: row.attemptId ? AttemptId.make(row.attemptId) : null,
  reviewerKind: decode(PresenceReviewerKind)(row.reviewerKind),
  decision: row.decision ? decode(PresenceReviewRecommendationKind)(row.decision) : null,
  summary: row.summary,
  checklistJson: row.checklistJson,
  checklistAssessment: decodeJson<ReviewChecklistAssessmentItem[]>(row.checklistAssessmentJson, []),
  evidence: decodeJson<ReviewEvidenceItem[]>(row.evidenceJson, []),
  changedFiles: decodeJson<string[]>(row.changedFilesJson, []),
  changedFilesReviewed: decodeJson<string[]>(row.changedFilesReviewedJson, []),
  findingIds: decodeJson<string[]>(row.findingIdsJson, []).map((value) => FindingId.make(value)),
  threadId: row.threadId ? ThreadId.make(row.threadId) : null,
  createdAt: row.createdAt,
});

const mapProposedFollowUp = (row: {
  id: string;
  parentTicketId: string;
  originatingAttemptId: string | null;
  kind: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  findingIdsJson: string;
  requiresHumanConfirmation: number | boolean;
  createdTicketId: string | null;
  createdAt: string;
  updatedAt: string;
}): ProposedFollowUpRecord => ({
  id: ProposedFollowUpId.make(row.id),
  parentTicketId: TicketId.make(row.parentTicketId),
  originatingAttemptId: row.originatingAttemptId ? AttemptId.make(row.originatingAttemptId) : null,
  kind: decode(PresenceFollowUpProposalKind)(row.kind),
  title: row.title,
  description: row.description,
  priority: decode(PresenceTicketPriority)(row.priority),
  status: decode(PresenceFindingStatus)(row.status),
  findingIds: decodeJson<string[]>(row.findingIdsJson, []).map((value) => FindingId.make(value)),
  requiresHumanConfirmation: Boolean(row.requiresHumanConfirmation),
  createdTicketId: row.createdTicketId ? TicketId.make(row.createdTicketId) : null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const mapAttemptOutcome = (row: {
  attemptId: string;
  kind: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
}): AttemptOutcomeRecord => ({
  attemptId: AttemptId.make(row.attemptId),
  kind: decode(PresenceAttemptOutcomeKind)(row.kind),
  summary: row.summary,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const mapKnowledgePage = (row: {
  id: string;
  boardId: string;
  family: string;
  slug: string;
  title: string;
  compiledTruth: string;
  timeline: string;
  linkedTicketIds: string;
  createdAt: string;
  updatedAt: string;
}): KnowledgePageRecord => ({
  id: KnowledgePageId.make(row.id),
  boardId: BoardId.make(row.boardId),
  family: decode(PresenceKnowledgeFamily)(row.family),
  slug: row.slug,
  title: row.title,
  compiledTruth: row.compiledTruth,
  timeline: row.timeline,
  linkedTicketIds: decodeJson<string[]>(row.linkedTicketIds, []).map((value) => TicketId.make(value)),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const mapPromotionCandidate = (row: {
  id: string;
  sourceTicketId: string;
  sourceAttemptId: string | null;
  family: string;
  title: string;
  slug: string;
  compiledTruth: string;
  timelineEntry: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}): PromotionCandidateRecord => ({
  id: PromotionCandidateId.make(row.id),
  sourceTicketId: TicketId.make(row.sourceTicketId),
  sourceAttemptId: row.sourceAttemptId ? AttemptId.make(row.sourceAttemptId) : null,
  family: decode(PresenceKnowledgeFamily)(row.family),
  title: row.title,
  slug: row.slug,
  compiledTruth: row.compiledTruth,
  timelineEntry: row.timelineEntry,
  status: decode(PresencePromotionStatus)(row.status),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const mapJob = (row: {
  id: string;
  boardId: string;
  title: string;
  kind: string;
  status: string;
  progress: number;
  outputSummary: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}): DeterministicJobRecord => ({
  id: DeterministicJobId.make(row.id),
  boardId: BoardId.make(row.boardId),
  title: row.title,
  kind: row.kind,
  status: decode(PresenceJobStatus)(row.status),
  progress: row.progress,
  outputSummary: row.outputSummary,
  errorMessage: row.errorMessage,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const mapReviewDecision = (row: {
  id: string;
  ticketId: string;
  attemptId: string | null;
  decision: string;
  notes: string;
  createdAt: string;
}): ReviewDecisionRecord => ({
  id: ReviewDecisionId.make(row.id),
  ticketId: TicketId.make(row.ticketId),
  attemptId: row.attemptId ? AttemptId.make(row.attemptId) : null,
  decision: decode(PresenceReviewDecisionKind)(row.decision),
  notes: row.notes,
  createdAt: row.createdAt,
});

const mapCapabilityScan = (row: {
  id: string;
  repositoryId: string;
  boardId: string;
  baseBranch: string | null;
  upstreamRef: string | null;
  hasRemote: number | boolean;
  isClean: number | boolean;
  ecosystems: string;
  markers: string;
  discoveredCommands: string;
  hasValidationCapability: number | boolean;
  riskSignals: string;
  scannedAt: string;
}): RepositoryCapabilityScanRecord => ({
  id: CapabilityScanId.make(row.id),
  repositoryId: RepositoryId.make(row.repositoryId),
  boardId: BoardId.make(row.boardId),
  baseBranch: row.baseBranch,
  upstreamRef: row.upstreamRef,
  hasRemote: Boolean(row.hasRemote),
  isClean: Boolean(row.isClean),
  ecosystems: decodeJson<string[]>(row.ecosystems, []),
  markers: decodeJson<string[]>(row.markers, []),
  discoveredCommands: decodeJson<RepositoryCapabilityCommand[]>(row.discoveredCommands, []),
  hasValidationCapability: Boolean(row.hasValidationCapability),
  riskSignals: decodeJson<string[]>(row.riskSignals, []),
  scannedAt: row.scannedAt,
});

const mapValidationWaiver = (row: {
  id: string;
  ticketId: string;
  attemptId: string | null;
  reason: string;
  grantedBy: string;
  createdAt: string;
}): ValidationWaiverRecord => ({
  id: ValidationWaiverId.make(row.id),
  ticketId: TicketId.make(row.ticketId),
  attemptId: row.attemptId ? AttemptId.make(row.attemptId) : null,
  reason: row.reason,
  grantedBy: row.grantedBy,
  createdAt: row.createdAt,
});

const mapGoalIntake = (row: {
  id: string;
  boardId: string;
  source: string;
  rawGoal: string;
  summary: string;
  createdTicketIds: string;
  createdAt: string;
}): GoalIntakeRecord => ({
  id: GoalIntakeId.make(row.id),
  boardId: BoardId.make(row.boardId),
  source: decode(GoalIntakeSource)(row.source),
  rawGoal: row.rawGoal,
  summary: row.summary,
  createdTicketIds: decodeJson<string[]>(row.createdTicketIds, []).map((value) => TicketId.make(value)),
  createdAt: row.createdAt,
});

const mapMergeOperation = (row: {
  id: string;
  ticketId: string;
  attemptId: string;
  status: string;
  baseBranch: string;
  sourceBranch: string;
  sourceHeadSha: string | null;
  baseHeadBefore: string | null;
  baseHeadAfter: string | null;
  mergeCommitSha: string | null;
  errorSummary: string | null;
  gitAbortAttempted: number | boolean;
  cleanupWorktreeDone: number | boolean;
  cleanupThreadDone: number | boolean;
  createdAt: string;
  updatedAt: string;
}): MergeOperationRecord => ({
  id: MergeOperationId.make(row.id),
  ticketId: TicketId.make(row.ticketId),
  attemptId: AttemptId.make(row.attemptId),
  status: decode(PresenceMergeOperationStatus)(row.status),
  baseBranch: row.baseBranch,
  sourceBranch: row.sourceBranch,
  sourceHeadSha: row.sourceHeadSha,
  baseHeadBefore: row.baseHeadBefore,
  baseHeadAfter: row.baseHeadAfter,
  mergeCommitSha: row.mergeCommitSha,
  errorSummary: row.errorSummary,
  gitAbortAttempted: Boolean(row.gitAbortAttempted),
  cleanupWorktreeDone: Boolean(row.cleanupWorktreeDone),
  cleanupThreadDone: Boolean(row.cleanupThreadDone),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

type PresenceStoreDeps = Readonly<{
  sql: SqlClient;
  nowIso: () => string;
}>;

const makePresenceStore = (deps: PresenceStoreDeps) => {
  type AttemptWorkspaceContextRow = {
    attemptId: string;
    attemptTitle: string;
    attemptStatus: string;
    attemptThreadId: string | null;
    attemptProvider: string | null;
    attemptModel: string | null;
    attemptLastWorkerHandoffId: string | null;
    ticketId: string;
    ticketTitle: string;
    ticketDescription: string;
    ticketAcceptanceChecklist: string;
    boardId: string;
    repositoryId: string;
    workspaceRoot: string;
    projectId: string | null;
    defaultModelSelection: string | null;
    workspaceId: string;
    workspaceStatus: string;
    workspaceBranch: string | null;
    workspaceWorktreePath: string | null;
    workspaceCreatedAt: string;
    workspaceUpdatedAt: string;
  };

  const readRepositoryByWorkspaceRoot = (workspaceRoot: string) =>
    deps.sql<{
      id: string;
      boardId: string;
      projectId: string | null;
      title: string;
      workspaceRoot: string;
      defaultModelSelection: string | null;
      createdAt: string;
      updatedAt: string;
    }>`
      SELECT
        repository_id as id,
        board_id as "boardId",
        project_id as "projectId",
        title,
        workspace_root as "workspaceRoot",
        default_model_selection_json as "defaultModelSelection",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM presence_repositories
      WHERE workspace_root = ${workspaceRoot}
    `.pipe(
      Effect.map(
        (rows: ReadonlyArray<{
          id: string;
          boardId: string;
          projectId: string | null;
          title: string;
          workspaceRoot: string;
          defaultModelSelection: string | null;
          createdAt: string;
          updatedAt: string;
        }>) => rows[0] ?? null,
      ),
    );

  const readRepositoryById = (repositoryId: string) =>
    deps.sql<{
      id: string;
      boardId: string;
      projectId: string | null;
      title: string;
      workspaceRoot: string;
      defaultModelSelection: string | null;
      createdAt: string;
      updatedAt: string;
    }>`
      SELECT
        repository_id as id,
        board_id as "boardId",
        project_id as "projectId",
        title,
        workspace_root as "workspaceRoot",
        default_model_selection_json as "defaultModelSelection",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM presence_repositories
      WHERE repository_id = ${repositoryId}
    `.pipe(
      Effect.map(
        (rows: ReadonlyArray<{
          id: string;
          boardId: string;
          projectId: string | null;
          title: string;
          workspaceRoot: string;
          defaultModelSelection: string | null;
          createdAt: string;
          updatedAt: string;
        }>) => rows[0] ?? null,
      ),
    );

  const readLatestCapabilityScan = (repositoryId: string) =>
    deps.sql<{
      id: string;
      repositoryId: string;
      boardId: string;
      baseBranch: string;
      upstreamRef: string | null;
      hasRemote: number | boolean;
      isClean: number | boolean;
      ecosystems: string;
      markers: string;
      discoveredCommands: string;
      hasValidationCapability: number | boolean;
      riskSignals: string;
      scannedAt: string;
    }>`
      SELECT
        capability_scan_id as id,
        repository_id as "repositoryId",
        board_id as "boardId",
        base_branch as "baseBranch",
        upstream_ref as "upstreamRef",
        has_remote as "hasRemote",
        is_clean as "isClean",
        ecosystems_json as ecosystems,
        markers_json as markers,
        discovered_commands_json as "discoveredCommands",
        has_validation_capability as "hasValidationCapability",
        risk_signals_json as "riskSignals",
        scanned_at as "scannedAt"
      FROM presence_repository_capability_scans
      WHERE repository_id = ${repositoryId}
    `.pipe(
      Effect.map(
        (rows: ReadonlyArray<{
          id: string;
          repositoryId: string;
          boardId: string;
          baseBranch: string;
          upstreamRef: string | null;
          hasRemote: number | boolean;
          isClean: number | boolean;
          ecosystems: string;
          markers: string;
          discoveredCommands: string;
          hasValidationCapability: number | boolean;
          riskSignals: string;
          scannedAt: string;
        }>) => (rows[0] ? mapCapabilityScan(rows[0]) : null),
      ),
    );

  const readTicketForPolicy = (ticketId: string) =>
    deps.sql<{
      id: string;
      boardId: string;
      repositoryId: string;
      status: string;
      acceptanceChecklist: string;
    }>`
      SELECT
        t.ticket_id as id,
        t.board_id as "boardId",
        b.repository_id as "repositoryId",
        t.status as status,
        t.acceptance_checklist_json as "acceptanceChecklist"
      FROM presence_tickets t
      INNER JOIN presence_boards b ON b.board_id = t.board_id
      WHERE t.ticket_id = ${ticketId}
    `.pipe(Effect.map((rows: ReadonlyArray<TicketPolicyRow>) => rows[0] ?? null));

  const readValidationWaiversForTicket = (ticketId: string) =>
    deps.sql<{
      id: string;
      ticketId: string;
      attemptId: string | null;
      reason: string;
      grantedBy: string;
      createdAt: string;
    }>`
      SELECT
        validation_waiver_id as id,
        ticket_id as "ticketId",
        attempt_id as "attemptId",
        reason,
        granted_by as "grantedBy",
        created_at as "createdAt"
      FROM presence_validation_waivers
      WHERE ticket_id = ${ticketId}
      ORDER BY created_at DESC
    `.pipe(
      Effect.map(
        (rows: ReadonlyArray<{
          id: string;
          ticketId: string;
          attemptId: string | null;
          reason: string;
          grantedBy: string;
          createdAt: string;
        }>) => rows.map(mapValidationWaiver),
      ),
    );

  const readAttemptWorkspaceContext = (attemptId: string) =>
    deps.sql<AttemptWorkspaceContextRow>`
      SELECT
        a.attempt_id as "attemptId",
        a.title as "attemptTitle",
        a.status as "attemptStatus",
        a.thread_id as "attemptThreadId",
        a.provider as "attemptProvider",
        a.model as "attemptModel",
        a.last_worker_handoff_id as "attemptLastWorkerHandoffId",
        t.ticket_id as "ticketId",
        t.title as "ticketTitle",
        t.description as "ticketDescription",
        t.acceptance_checklist_json as "ticketAcceptanceChecklist",
        t.board_id as "boardId",
        r.repository_id as "repositoryId",
        r.workspace_root as "workspaceRoot",
        r.project_id as "projectId",
        r.default_model_selection_json as "defaultModelSelection",
        w.workspace_id as "workspaceId",
        w.status as "workspaceStatus",
        w.branch as "workspaceBranch",
        w.worktree_path as "workspaceWorktreePath",
        w.created_at as "workspaceCreatedAt",
        w.updated_at as "workspaceUpdatedAt"
      FROM presence_attempts a
      INNER JOIN presence_tickets t ON t.ticket_id = a.ticket_id
      INNER JOIN presence_boards b ON b.board_id = t.board_id
      INNER JOIN presence_repositories r ON r.repository_id = b.repository_id
      INNER JOIN presence_workspaces w ON w.workspace_id = a.workspace_id
      WHERE a.attempt_id = ${attemptId}
    `.pipe(Effect.map((rows: ReadonlyArray<AttemptWorkspaceContextRow>) => rows[0] ?? null));

  const readLatestSupervisorHandoffForBoard = (boardId: string) =>
    deps.sql<{
      id: string;
      boardId: string;
      payload: string;
      createdAt: string;
    }>`
      SELECT
        handoff_id as id,
        board_id as "boardId",
        payload_json as payload,
        created_at as "createdAt"
      FROM presence_handoffs
      WHERE board_id = ${boardId} AND role = 'supervisor'
      ORDER BY created_at DESC
      LIMIT 1
    `.pipe(
      Effect.map(
        (rows: ReadonlyArray<{
          id: string;
          boardId: string;
          payload: string;
          createdAt: string;
        }>) => (rows[0] ? mapSupervisorHandoff(rows[0]) : null),
      ),
    );

  const readLatestWorkerHandoffForAttempt = (attemptId: string) =>
    deps.sql<{
      id: string;
      attemptId: string;
      payload: string;
      createdAt: string;
    }>`
      SELECT
        handoff_id as id,
        attempt_id as "attemptId",
        payload_json as payload,
        created_at as "createdAt"
      FROM presence_handoffs
      WHERE attempt_id = ${attemptId} AND role = 'worker'
      ORDER BY created_at DESC
      LIMIT 1
    `.pipe(
      Effect.map(
        (rows: ReadonlyArray<{
          id: string;
          attemptId: string;
          payload: string;
          createdAt: string;
        }>) => (rows[0] ? mapWorkerHandoff(rows[0]) : null),
      ),
    );

  const readSupervisorRunById = (runId: string) =>
    deps.sql<{
      id: string;
      boardId: string;
      sourceGoalIntakeId: string | null;
      scopeTicketIdsJson: string;
      status: string;
      stage: string;
      currentTicketId: string | null;
      activeThreadIdsJson: string;
      summary: string;
      createdAt: string;
      updatedAt: string;
    }>`
      SELECT
        supervisor_run_id as id,
        board_id as "boardId",
        source_goal_intake_id as "sourceGoalIntakeId",
        scope_ticket_ids_json as "scopeTicketIdsJson",
        status,
        stage,
        current_ticket_id as "currentTicketId",
        active_thread_ids_json as "activeThreadIdsJson",
        summary,
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM presence_supervisor_runs
      WHERE supervisor_run_id = ${runId}
      LIMIT 1
    `.pipe(
      Effect.map(
        (rows: ReadonlyArray<{
          id: string;
          boardId: string;
          sourceGoalIntakeId: string | null;
          scopeTicketIdsJson: string;
          status: string;
          stage: string;
          currentTicketId: string | null;
          activeThreadIdsJson: string;
          summary: string;
          createdAt: string;
          updatedAt: string;
        }>) => (rows[0] ? mapSupervisorRun(rows[0]) : null),
      ),
    );

  const readLatestSupervisorRunForBoard = (boardId: string) =>
    deps.sql<{
      id: string;
      boardId: string;
      sourceGoalIntakeId: string | null;
      scopeTicketIdsJson: string;
      status: string;
      stage: string;
      currentTicketId: string | null;
      activeThreadIdsJson: string;
      summary: string;
      createdAt: string;
      updatedAt: string;
    }>`
      SELECT
        supervisor_run_id as id,
        board_id as "boardId",
        source_goal_intake_id as "sourceGoalIntakeId",
        scope_ticket_ids_json as "scopeTicketIdsJson",
        status,
        stage,
        current_ticket_id as "currentTicketId",
        active_thread_ids_json as "activeThreadIdsJson",
        summary,
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM presence_supervisor_runs
      WHERE board_id = ${boardId}
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    `.pipe(
      Effect.map(
        (rows: ReadonlyArray<{
          id: string;
          boardId: string;
          sourceGoalIntakeId: string | null;
          scopeTicketIdsJson: string;
          status: string;
          stage: string;
          currentTicketId: string | null;
          activeThreadIdsJson: string;
          summary: string;
          createdAt: string;
          updatedAt: string;
        }>) => (rows[0] ? mapSupervisorRun(rows[0]) : null),
      ),
    );

  const readMergeOperationById = (mergeOperationId: string) =>
    deps.sql<{
      id: string;
      ticketId: string;
      attemptId: string;
      status: string;
      baseBranch: string;
      sourceBranch: string;
      sourceHeadSha: string | null;
      baseHeadBefore: string | null;
      baseHeadAfter: string | null;
      mergeCommitSha: string | null;
      errorSummary: string | null;
      gitAbortAttempted: number | boolean;
      cleanupWorktreeDone: number | boolean;
      cleanupThreadDone: number | boolean;
      createdAt: string;
      updatedAt: string;
    }>`
      SELECT
        merge_operation_id as id,
        ticket_id as "ticketId",
        attempt_id as "attemptId",
        status,
        base_branch as "baseBranch",
        source_branch as "sourceBranch",
        source_head_sha as "sourceHeadSha",
        base_head_before as "baseHeadBefore",
        base_head_after as "baseHeadAfter",
        merge_commit_sha as "mergeCommitSha",
        error_summary as "errorSummary",
        git_abort_attempted as "gitAbortAttempted",
        cleanup_worktree_done as "cleanupWorktreeDone",
        cleanup_thread_done as "cleanupThreadDone",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM presence_merge_operations
      WHERE merge_operation_id = ${mergeOperationId}
      LIMIT 1
    `.pipe(
      Effect.map(
        (rows: ReadonlyArray<{
          id: string;
          ticketId: string;
          attemptId: string;
          status: string;
          baseBranch: string;
          sourceBranch: string;
          sourceHeadSha: string | null;
          baseHeadBefore: string | null;
          baseHeadAfter: string | null;
          mergeCommitSha: string | null;
          errorSummary: string | null;
          gitAbortAttempted: number | boolean;
          cleanupWorktreeDone: number | boolean;
          cleanupThreadDone: number | boolean;
          createdAt: string;
          updatedAt: string;
        }>) => (rows[0] ? mapMergeOperation(rows[0]) : null),
      ),
    );

  const readLatestMergeOperationForAttempt = (attemptId: string) =>
    deps.sql<{
      id: string;
      ticketId: string;
      attemptId: string;
      status: string;
      baseBranch: string;
      sourceBranch: string;
      sourceHeadSha: string | null;
      baseHeadBefore: string | null;
      baseHeadAfter: string | null;
      mergeCommitSha: string | null;
      errorSummary: string | null;
      gitAbortAttempted: number | boolean;
      cleanupWorktreeDone: number | boolean;
      cleanupThreadDone: number | boolean;
      createdAt: string;
      updatedAt: string;
    }>`
      SELECT
        merge_operation_id as id,
        ticket_id as "ticketId",
        attempt_id as "attemptId",
        status,
        base_branch as "baseBranch",
        source_branch as "sourceBranch",
        source_head_sha as "sourceHeadSha",
        base_head_before as "baseHeadBefore",
        base_head_after as "baseHeadAfter",
        merge_commit_sha as "mergeCommitSha",
        error_summary as "errorSummary",
        git_abort_attempted as "gitAbortAttempted",
        cleanup_worktree_done as "cleanupWorktreeDone",
        cleanup_thread_done as "cleanupThreadDone",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM presence_merge_operations
      WHERE attempt_id = ${attemptId}
      ORDER BY updated_at DESC, created_at DESC, merge_operation_id DESC
      LIMIT 1
    `.pipe(
      Effect.map(
        (rows: ReadonlyArray<{
          id: string;
          ticketId: string;
          attemptId: string;
          status: string;
          baseBranch: string;
          sourceBranch: string;
          sourceHeadSha: string | null;
          baseHeadBefore: string | null;
          baseHeadAfter: string | null;
          mergeCommitSha: string | null;
          errorSummary: string | null;
          gitAbortAttempted: number | boolean;
          cleanupWorktreeDone: number | boolean;
          cleanupThreadDone: number | boolean;
          createdAt: string;
          updatedAt: string;
        }>) => (rows[0] ? mapMergeOperation(rows[0]) : null),
      ),
    );

  const persistMergeOperation = (input: {
    id: string;
    ticketId: string;
    attemptId: string;
    status: MergeOperationRecord["status"];
    baseBranch: string;
    sourceBranch: string;
    sourceHeadSha?: string | null | undefined;
    baseHeadBefore?: string | null | undefined;
    baseHeadAfter?: string | null | undefined;
    mergeCommitSha?: string | null | undefined;
    errorSummary?: string | null | undefined;
    gitAbortAttempted?: boolean | undefined;
    cleanupWorktreeDone?: boolean | undefined;
    cleanupThreadDone?: boolean | undefined;
    createdAt?: string | undefined;
  }) =>
    Effect.gen(function* () {
      const updatedAt = deps.nowIso();
      yield* deps.sql`
        INSERT INTO presence_merge_operations (
          merge_operation_id, ticket_id, attempt_id, status, base_branch, source_branch,
          source_head_sha, base_head_before, base_head_after, merge_commit_sha, error_summary,
          git_abort_attempted, cleanup_worktree_done, cleanup_thread_done, created_at, updated_at
        ) VALUES (
          ${input.id},
          ${input.ticketId},
          ${input.attemptId},
          ${input.status},
          ${input.baseBranch},
          ${input.sourceBranch},
          ${input.sourceHeadSha ?? null},
          ${input.baseHeadBefore ?? null},
          ${input.baseHeadAfter ?? null},
          ${input.mergeCommitSha ?? null},
          ${input.errorSummary ?? null},
          ${input.gitAbortAttempted ? 1 : 0},
          ${input.cleanupWorktreeDone ? 1 : 0},
          ${input.cleanupThreadDone ? 1 : 0},
          ${input.createdAt ?? updatedAt},
          ${updatedAt}
        )
        ON CONFLICT(merge_operation_id) DO UPDATE SET
          status = excluded.status,
          base_branch = excluded.base_branch,
          source_branch = excluded.source_branch,
          source_head_sha = excluded.source_head_sha,
          base_head_before = excluded.base_head_before,
          base_head_after = excluded.base_head_after,
          merge_commit_sha = excluded.merge_commit_sha,
          error_summary = excluded.error_summary,
          git_abort_attempted = excluded.git_abort_attempted,
          cleanup_worktree_done = excluded.cleanup_worktree_done,
          cleanup_thread_done = excluded.cleanup_thread_done,
          updated_at = excluded.updated_at
      `;
      const persisted = yield* readMergeOperationById(input.id);
      if (!persisted) {
        return yield* Effect.fail(new Error(`Merge operation '${input.id}' could not be reloaded.`));
      }
      return persisted;
    });

  const readLatestMergeApprovedDecisionForAttempt = (attemptId: string) =>
    deps.sql<{
      id: string;
      ticketId: string;
      attemptId: string | null;
      decision: string;
      notes: string;
      createdAt: string;
    }>`
      SELECT
        review_decision_id as id,
        ticket_id as "ticketId",
        attempt_id as "attemptId",
        decision,
        notes,
        created_at as "createdAt"
      FROM presence_review_decisions
      WHERE attempt_id = ${attemptId} AND decision = 'merge_approved'
      ORDER BY created_at DESC
      LIMIT 1
    `.pipe(
      Effect.map(
        (rows: ReadonlyArray<{
          id: string;
          ticketId: string;
          attemptId: string | null;
          decision: string;
          notes: string;
          createdAt: string;
        }>) => (rows[0] ? mapReviewDecision(rows[0]) : null),
      ),
    );

  const readValidationRunsForAttempt = (attemptId: string) =>
    deps.sql<{
      id: string;
      batchId: string;
      attemptId: string;
      ticketId: string;
      commandKind: string;
      command: string;
      status: string;
      exitCode: number | null;
      stdoutSummary: string | null;
      stderrSummary: string | null;
      startedAt: string;
      finishedAt: string | null;
    }>`
      SELECT
        validation_run_id as id,
        batch_id as "batchId",
        attempt_id as "attemptId",
        ticket_id as "ticketId",
        command_kind as "commandKind",
        command_text as command,
        status,
        exit_code as "exitCode",
        stdout_summary as "stdoutSummary",
        stderr_summary as "stderrSummary",
        started_at as "startedAt",
        finished_at as "finishedAt"
      FROM presence_validation_runs
      WHERE attempt_id = ${attemptId}
      ORDER BY started_at DESC, validation_run_id DESC
    `.pipe(
      Effect.map(
        (rows: ReadonlyArray<{
          id: string;
          batchId: string;
          attemptId: string;
          ticketId: string;
          commandKind: string;
          command: string;
          status: string;
          exitCode: number | null;
          stdoutSummary: string | null;
          stderrSummary: string | null;
          startedAt: string;
          finishedAt: string | null;
        }>) => rows.map(mapValidationRun),
      ),
    );

  const readValidationRunsForBatch = (batchId: string) =>
    deps.sql<{
      id: string;
      batchId: string;
      attemptId: string;
      ticketId: string;
      commandKind: string;
      command: string;
      status: string;
      exitCode: number | null;
      stdoutSummary: string | null;
      stderrSummary: string | null;
      startedAt: string;
      finishedAt: string | null;
    }>`
      SELECT
        validation_run_id as id,
        batch_id as "batchId",
        attempt_id as "attemptId",
        ticket_id as "ticketId",
        command_kind as "commandKind",
        command_text as command,
        status,
        exit_code as "exitCode",
        stdout_summary as "stdoutSummary",
        stderr_summary as "stderrSummary",
        started_at as "startedAt",
        finished_at as "finishedAt"
      FROM presence_validation_runs
      WHERE batch_id = ${batchId}
      ORDER BY started_at DESC, validation_run_id DESC
    `.pipe(
      Effect.map(
        (rows: ReadonlyArray<{
          id: string;
          batchId: string;
          attemptId: string;
          ticketId: string;
          commandKind: string;
          command: string;
          status: string;
          exitCode: number | null;
          stdoutSummary: string | null;
          stderrSummary: string | null;
          startedAt: string;
          finishedAt: string | null;
        }>) => rows.map(mapValidationRun),
      ),
    );

  const readRunningValidationBatchIdForAttempt = (attemptId: string) =>
    deps.sql<{ batchId: string }>`
      SELECT validation_batch_id as "batchId"
      FROM presence_validation_batches
      WHERE attempt_id = ${attemptId} AND status = 'running'
      ORDER BY updated_at DESC, validation_batch_id DESC
      LIMIT 1
    `.pipe(Effect.map((rows: ReadonlyArray<{ batchId: string }>) => rows[0]?.batchId ?? null));

  const readFindingsForTicket = (ticketId: string) =>
    deps.sql<{
      id: string;
      ticketId: string;
      attemptId: string | null;
      source: string;
      severity: string;
      disposition: string;
      status: string;
      summary: string;
      rationale: string;
      evidenceIds: string;
      validationBatchId: string | null;
      createdAt: string;
      updatedAt: string;
    }>`
      SELECT
        finding_id as id,
        ticket_id as "ticketId",
        attempt_id as "attemptId",
        source,
        severity,
        disposition,
        status,
        summary,
        rationale,
        evidence_ids_json as "evidenceIds",
        validation_batch_id as "validationBatchId",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM presence_findings
      WHERE ticket_id = ${ticketId}
      ORDER BY updated_at DESC, created_at DESC
    `.pipe(
      Effect.map(
        (rows: ReadonlyArray<{
          id: string;
          ticketId: string;
          attemptId: string | null;
          source: string;
          severity: string;
          disposition: string;
          status: string;
          summary: string;
          rationale: string;
          evidenceIds: string;
          validationBatchId: string | null;
          createdAt: string;
          updatedAt: string;
        }>) => rows.map(mapFinding),
      ),
    );

  const readReviewArtifactsForTicket = (ticketId: string) =>
    deps.sql<{
      id: string;
      ticketId: string;
      attemptId: string | null;
      reviewerKind: string;
      decision: string | null;
      summary: string;
      checklistJson: string;
      checklistAssessmentJson: string;
      evidenceJson: string;
      changedFilesJson: string;
      changedFilesReviewedJson: string;
      findingIdsJson: string;
      threadId: string | null;
      createdAt: string;
    }>`
      SELECT
        review_artifact_id as id,
        ticket_id as "ticketId",
        attempt_id as "attemptId",
        reviewer_kind as "reviewerKind",
        decision,
        summary,
        checklist_json as "checklistJson",
        checklist_assessment_json as "checklistAssessmentJson",
        evidence_json as "evidenceJson",
        changed_files_json as "changedFilesJson",
        changed_files_reviewed_json as "changedFilesReviewedJson",
        finding_ids_json as "findingIdsJson",
        thread_id as "threadId",
        created_at as "createdAt"
      FROM presence_review_artifacts
      WHERE ticket_id = ${ticketId}
      ORDER BY created_at DESC
    `.pipe(
      Effect.map(
        (rows: ReadonlyArray<{
          id: string;
          ticketId: string;
          attemptId: string | null;
          reviewerKind: string;
          decision: string | null;
          summary: string;
          checklistJson: string;
          checklistAssessmentJson: string;
          evidenceJson: string;
          changedFilesJson: string;
          changedFilesReviewedJson: string;
          findingIdsJson: string;
          threadId: string | null;
          createdAt: string;
        }>) => rows.map(mapReviewArtifact),
      ),
    );

  const readFollowUpProposalsForTicket = (ticketId: string) =>
    deps.sql<{
      id: string;
      parentTicketId: string;
      originatingAttemptId: string | null;
      kind: string;
      title: string;
      description: string;
      priority: string;
      status: string;
      findingIdsJson: string;
      requiresHumanConfirmation: number | boolean;
      createdTicketId: string | null;
      createdAt: string;
      updatedAt: string;
    }>`
      SELECT
        proposed_follow_up_id as id,
        parent_ticket_id as "parentTicketId",
        originating_attempt_id as "originatingAttemptId",
        kind,
        title,
        description,
        priority,
        status,
        finding_ids_json as "findingIdsJson",
        requires_human_confirmation as "requiresHumanConfirmation",
        created_ticket_id as "createdTicketId",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM presence_follow_up_proposals
      WHERE parent_ticket_id = ${ticketId}
      ORDER BY updated_at DESC, created_at DESC
    `.pipe(
      Effect.map(
        (rows: ReadonlyArray<{
          id: string;
          parentTicketId: string;
          originatingAttemptId: string | null;
          kind: string;
          title: string;
          description: string;
          priority: string;
          status: string;
          findingIdsJson: string;
          requiresHumanConfirmation: number | boolean;
          createdTicketId: string | null;
          createdAt: string;
          updatedAt: string;
        }>) => rows.map(mapProposedFollowUp),
      ),
    );

  const readAttemptOutcomesForTicket = (ticketId: string) =>
    deps.sql<{
      attemptId: string;
      kind: string;
      summary: string;
      createdAt: string;
      updatedAt: string;
    }>`
      SELECT
        o.attempt_id as "attemptId",
        o.kind,
        o.summary,
        o.created_at as "createdAt",
        o.updated_at as "updatedAt"
      FROM presence_attempt_outcomes o
      INNER JOIN presence_attempts a ON a.attempt_id = o.attempt_id
      WHERE a.ticket_id = ${ticketId}
      ORDER BY o.updated_at DESC, o.created_at DESC
    `.pipe(
      Effect.map(
        (rows: ReadonlyArray<{
          attemptId: string;
          kind: string;
          summary: string;
          createdAt: string;
          updatedAt: string;
        }>) => rows.map(mapAttemptOutcome),
      ),
    );

  const readOpenBlockingFindingsForTicket = (input: {
    ticketId: string;
    attemptId?: string | null | undefined;
  }) =>
    readFindingsForTicket(input.ticketId).pipe(
      Effect.map((findings: ReadonlyArray<FindingRecord>) =>
        findings.filter(
          (finding) =>
            finding.status === "open" &&
            finding.severity === "blocking" &&
            (input.attemptId === undefined ||
              input.attemptId === null ||
              finding.attemptId === null ||
              finding.attemptId === input.attemptId),
        ),
      ),
    );

  const createOrUpdateFinding = (input: {
    ticketId: string;
    attemptId?: string | null | undefined;
    source: PresenceFindingSource;
    severity: PresenceFindingSeverity;
    disposition: PresenceFindingDisposition;
    summary: string;
    rationale: string;
    evidenceIds?: ReadonlyArray<string> | undefined;
    validationBatchId?: string | null | undefined;
  }) =>
    Effect.gen(function* () {
      const existing = yield* deps.sql<{
        id: string;
        createdAt: string;
      }>`
        SELECT
          finding_id as id,
          created_at as "createdAt"
        FROM presence_findings
        WHERE ticket_id = ${input.ticketId}
          AND COALESCE(attempt_id, '') = ${input.attemptId ?? ""}
          AND source = ${input.source}
          AND summary = ${input.summary}
          AND status = ${"open"}
        ORDER BY created_at DESC
        LIMIT 1
      `.pipe(Effect.map((rows: ReadonlyArray<{ id: string; createdAt: string }>) => rows[0] ?? null));
      const updatedAt = deps.nowIso();
      const evidenceIds = uniqueStrings([...(input.evidenceIds ?? [])]);
      if (existing) {
        yield* deps.sql`
          UPDATE presence_findings
          SET
            severity = ${input.severity},
            disposition = ${input.disposition},
            rationale = ${input.rationale},
            evidence_ids_json = ${encodeJson(evidenceIds)},
            validation_batch_id = ${input.validationBatchId ?? null},
            updated_at = ${updatedAt}
          WHERE finding_id = ${existing.id}
        `;
        return {
          id: FindingId.make(existing.id),
          ticketId: TicketId.make(input.ticketId),
          attemptId: input.attemptId ? AttemptId.make(input.attemptId) : null,
          source: input.source,
          severity: input.severity,
          disposition: input.disposition,
          status: "open" as const,
          summary: input.summary,
          rationale: input.rationale,
          evidenceIds: evidenceIds.map((value) => EvidenceId.make(value)),
          validationBatchId: input.validationBatchId ?? null,
          createdAt: existing.createdAt,
          updatedAt,
        } satisfies FindingRecord;
      }

      const findingId = FindingId.make(`finding_${crypto.randomUUID()}`);
      yield* deps.sql`
        INSERT INTO presence_findings (
          finding_id, ticket_id, attempt_id, source, severity, disposition, status,
          summary, rationale, evidence_ids_json, validation_batch_id, created_at, updated_at
        ) VALUES (
          ${findingId},
          ${input.ticketId},
          ${input.attemptId ?? null},
          ${input.source},
          ${input.severity},
          ${input.disposition},
          ${"open"},
          ${input.summary},
          ${input.rationale},
          ${encodeJson(evidenceIds)},
          ${input.validationBatchId ?? null},
          ${updatedAt},
          ${updatedAt}
        )
      `;
      return {
        id: findingId,
        ticketId: TicketId.make(input.ticketId),
        attemptId: input.attemptId ? AttemptId.make(input.attemptId) : null,
        source: input.source,
        severity: input.severity,
        disposition: input.disposition,
        status: "open" as const,
        summary: input.summary,
        rationale: input.rationale,
        evidenceIds: evidenceIds.map((value) => EvidenceId.make(value)),
        validationBatchId: input.validationBatchId ?? null,
        createdAt: updatedAt,
        updatedAt,
      } satisfies FindingRecord;
    });

  const updateFindingStatus = (findingId: string, status: typeof PresenceFindingStatus.Type) =>
    Effect.gen(function* () {
      const updatedAt = deps.nowIso();
      yield* deps.sql`
        UPDATE presence_findings
        SET status = ${status}, updated_at = ${updatedAt}
        WHERE finding_id = ${findingId}
      `;
      const row = yield* deps.sql<{
        id: string;
        ticketId: string;
        attemptId: string | null;
        source: string;
        severity: string;
        disposition: string;
        status: string;
        summary: string;
        rationale: string;
        evidenceIds: string;
        validationBatchId: string | null;
        createdAt: string;
        updatedAt: string;
      }>`
        SELECT
          finding_id as id,
          ticket_id as "ticketId",
          attempt_id as "attemptId",
          source,
          severity,
          disposition,
          status,
          summary,
          rationale,
          evidence_ids_json as "evidenceIds",
          validation_batch_id as "validationBatchId",
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM presence_findings
        WHERE finding_id = ${findingId}
      `.pipe(
        Effect.map(
          (rows: ReadonlyArray<{
            id: string;
            ticketId: string;
            attemptId: string | null;
            source: string;
            severity: string;
            disposition: string;
            status: string;
            summary: string;
            rationale: string;
            evidenceIds: string;
            validationBatchId: string | null;
            createdAt: string;
            updatedAt: string;
          }>) => rows[0] ?? null,
        ),
      );
      if (!row) {
        throw new Error(`Finding '${findingId}' not found.`);
      }
      return mapFinding(row);
    });

  const resolveOpenFindings = (input: {
    ticketId: string;
    attemptId?: string | null | undefined;
    source?: typeof PresenceFindingSource.Type | undefined;
  }) =>
    Effect.gen(function* () {
      const findings = (yield* readFindingsForTicket(input.ticketId)) as ReadonlyArray<FindingRecord>;
      const matching = findings.filter(
        (finding) =>
          finding.status === "open" &&
          (input.source === undefined || finding.source === input.source) &&
          (input.attemptId === undefined ||
            input.attemptId === null ||
            finding.attemptId === null ||
            finding.attemptId === input.attemptId),
      );
      for (const finding of matching) {
        yield* updateFindingStatus(finding.id, "resolved");
      }
      return matching;
    });

  const createReviewArtifact = (input: {
    ticketId: string;
    attemptId?: string | null | undefined;
    reviewerKind: "human" | "policy" | "review_agent";
    decision?: PresenceReviewRecommendationKind | null | undefined;
    summary: string;
    checklistJson: string;
    checklistAssessment?: ReadonlyArray<ReviewChecklistAssessmentItem> | undefined;
    evidence?: ReadonlyArray<ReviewEvidenceItem> | undefined;
    changedFiles: ReadonlyArray<string>;
    changedFilesReviewed?: ReadonlyArray<string> | undefined;
    findingIds: ReadonlyArray<string>;
    threadId?: string | null | undefined;
  }) =>
    Effect.gen(function* () {
      const artifactId = ReviewArtifactId.make(`review_artifact_${crypto.randomUUID()}`);
      const createdAt = deps.nowIso();
      const persistedThreadId = input.threadId
        ? yield* deps
            .sql<{ threadId: string }>`
              SELECT thread_id as "threadId"
              FROM projection_threads
              WHERE thread_id = ${input.threadId}
            `
            .pipe(
              Effect.map(
                (rows: ReadonlyArray<{ threadId: string }>) => rows[0]?.threadId ?? null,
              ),
            )
        : null;
      yield* deps.sql`
        INSERT INTO presence_review_artifacts (
          review_artifact_id, ticket_id, attempt_id, reviewer_kind, decision, summary, checklist_json,
          checklist_assessment_json, evidence_json, changed_files_json, changed_files_reviewed_json,
          finding_ids_json, thread_id, created_at
        ) VALUES (
          ${artifactId},
          ${input.ticketId},
          ${input.attemptId ?? null},
          ${input.reviewerKind},
          ${input.decision ?? null},
          ${input.summary},
          ${input.checklistJson},
          ${encodeJson(input.checklistAssessment ?? [])},
          ${encodeJson(input.evidence ?? [])},
          ${encodeJson(uniqueStrings([...input.changedFiles]))},
          ${encodeJson(uniqueStrings([...(input.changedFilesReviewed ?? [])]))},
          ${encodeJson(uniqueStrings([...input.findingIds]))},
          ${persistedThreadId},
          ${createdAt}
        )
      `;
      return {
        id: artifactId,
        ticketId: TicketId.make(input.ticketId),
        attemptId: input.attemptId ? AttemptId.make(input.attemptId) : null,
        reviewerKind: input.reviewerKind,
        decision: input.decision ?? null,
        summary: input.summary,
        checklistJson: input.checklistJson,
        checklistAssessment: [...(input.checklistAssessment ?? [])],
        evidence: [...(input.evidence ?? [])],
        changedFiles: uniqueStrings([...input.changedFiles]),
        changedFilesReviewed: uniqueStrings([...(input.changedFilesReviewed ?? [])]),
        findingIds: uniqueStrings([...input.findingIds]).map((value) => FindingId.make(value)),
        threadId: persistedThreadId ? ThreadId.make(persistedThreadId) : null,
        createdAt,
      } satisfies ReviewArtifactRecord;
    });

  const materializeReviewFindings = (input: {
    ticketId: string;
    attemptId?: string | null | undefined;
    findings: ReadonlyArray<{
      severity: PresenceFindingSeverity;
      disposition: PresenceFindingDisposition;
      summary: string;
      rationale: string;
    }>;
  }) =>
    Effect.forEach(
      input.findings,
      (finding) =>
        createOrUpdateFinding({
          ticketId: input.ticketId,
          attemptId: input.attemptId,
          source: "review",
          severity: finding.severity,
          disposition: finding.disposition,
          summary: finding.summary,
          rationale: finding.rationale,
        }),
      { concurrency: "unbounded" },
    );

  const updateTicketChecklist = (
    ticketId: string,
    transform: (items: PresenceAcceptanceChecklistItem[]) => PresenceAcceptanceChecklistItem[],
  ) =>
    Effect.gen(function* () {
      const existing = yield* deps.sql<{ acceptanceChecklist: string }>`
        SELECT acceptance_checklist_json as "acceptanceChecklist"
        FROM presence_tickets
        WHERE ticket_id = ${ticketId}
      `.pipe(
        Effect.map((rows: ReadonlyArray<{ acceptanceChecklist: string }>) => rows[0] ?? null),
      );
      if (!existing) {
        return yield* Effect.fail(new Error(`Ticket '${ticketId}' not found.`));
      }

      const current = decodeJson<PresenceAcceptanceChecklistItem[]>(existing.acceptanceChecklist, []);
      const next = transform(current);
      yield* deps.sql`
        UPDATE presence_tickets
        SET acceptance_checklist_json = ${encodeJson(next)}, updated_at = ${deps.nowIso()}
        WHERE ticket_id = ${ticketId}
      `;
      return next;
    });

  const markTicketEvidenceChecklist = (ticketId: string) =>
    updateTicketChecklist(ticketId, (items) =>
      items.map((item) => (isEvidenceChecklistItem(item) ? { ...item, checked: true } : item)),
    ).pipe(Effect.asVoid);

  const markTicketValidationChecklist = (ticketId: string) =>
    updateTicketChecklist(ticketId, (items) =>
      items.map((item) => (isValidationChecklistItem(item) ? { ...item, checked: true } : item)),
    ).pipe(Effect.asVoid);

  const markTicketMechanismChecklist = (ticketId: string) =>
    updateTicketChecklist(ticketId, (items) =>
      items.map((item) => (isMechanismChecklistItem(item) ? { ...item, checked: true } : item)),
    ).pipe(Effect.asVoid);

  const writeAttemptOutcome = (input: {
    attemptId: string;
    kind: PresenceAttemptOutcomeKind;
    summary: string;
  }) =>
    Effect.gen(function* () {
      const existing = yield* deps.sql<{ createdAt: string }>`
        SELECT created_at as "createdAt"
        FROM presence_attempt_outcomes
        WHERE attempt_id = ${input.attemptId}
      `.pipe(Effect.map((rows: ReadonlyArray<{ createdAt: string }>) => rows[0] ?? null));
      const updatedAt = deps.nowIso();
      yield* deps.sql`
        INSERT INTO presence_attempt_outcomes (
          attempt_id, kind, summary, created_at, updated_at
        ) VALUES (
          ${input.attemptId},
          ${input.kind},
          ${input.summary},
          ${existing?.createdAt ?? updatedAt},
          ${updatedAt}
        )
        ON CONFLICT (attempt_id) DO UPDATE SET
          kind = excluded.kind,
          summary = excluded.summary,
          updated_at = excluded.updated_at
      `;
      return {
        attemptId: AttemptId.make(input.attemptId),
        kind: input.kind,
        summary: input.summary,
        createdAt: existing?.createdAt ?? updatedAt,
        updatedAt,
      } satisfies AttemptOutcomeRecord;
    });

  return {
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
    mapValidationRun,
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
    mapValidationWaiver,
    mapGoalIntake,
    readRepositoryByWorkspaceRoot,
    readRepositoryById,
    readLatestCapabilityScan,
    readTicketForPolicy,
    readValidationWaiversForTicket,
    readAttemptWorkspaceContext,
    readLatestSupervisorHandoffForBoard,
    readLatestWorkerHandoffForAttempt,
    readSupervisorRunById,
    readLatestSupervisorRunForBoard,
    readMergeOperationById,
    readLatestMergeOperationForAttempt,
    persistMergeOperation,
    readLatestMergeApprovedDecisionForAttempt,
    readValidationRunsForAttempt,
    readValidationRunsForBatch,
    readRunningValidationBatchIdForAttempt,
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
    markTicketValidationChecklist,
    markTicketMechanismChecklist,
    writeAttemptOutcome,
  };
};

export { makePresenceStore };
