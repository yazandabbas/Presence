import {
  AttemptId,
  CapabilityScanId,
  BoardId,
  DeterministicJobId,
  EvidenceId,
  FindingId,
  GoalIntakeId,
  GoalIntakeSource,
  GoalIntakeStatus,
  HandoffId,
  KnowledgePageId,
  MergeOperationId,
  MissionEventId,
  ProjectId,
  PromotionCandidateId,
  ProposedFollowUpId,
  RepositoryId,
  ReviewArtifactId,
  ReviewDecisionId,
  SupervisorRunId,
  ThreadId,
  TicketId,
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
  PresenceControllerMode,
  PresenceControllerStatus,
  PresenceKnowledgeFamily,
  PresenceMergeOperationStatus,
  PresenceMissionEventKind,
  PresenceMissionRetryBehavior,
  PresenceMissionSeverity,
  PresenceOperationId,
  PresenceOperationKind,
  PresenceOperationPhase,
  PresenceOperationStatus,
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
  type PresenceAcceptanceChecklistItem,
  type PresenceAgentReport,
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
  type PresenceOperationCounter,
  type PresenceOperationError,
  type PresenceOperationRecord,
  type PresenceBoardMissionBriefing,
  type PresenceBoardControllerState,
  type PresenceMissionEventRecord,
  type PresenceTicketMissionBriefing,
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
  type WorkerHandoffRecord,
} from "@t3tools/contracts";
import { Effect, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql/SqlClient";

import {
  decodeJson,
  encodeJson,
  isEvidenceChecklistItem,
  isMechanismChecklistItem,
  stableHash,
  uniqueStrings,
  type WorkerReasoningSource,
} from "./PresenceShared.ts";
import {
  operationMergeKey,
  operationMissionEventKey,
  operationReviewArtifactKey,
  operationScopeKey,
} from "./PresenceCorrelationKeys.ts";
import type { TicketPolicyRow } from "./PresenceInternalDeps.ts";

const decode = Schema.decodeUnknownSync;

const RECENT_MISSION_EVENT_READ_LIMIT_MAX = 500;
const RECENT_MISSION_EVENT_READ_LIMIT_DEFAULT = 40;

const clampRecentMissionEventReadLimit = (limit: number) =>
  Math.max(1, Math.min(RECENT_MISSION_EVENT_READ_LIMIT_MAX, Math.floor(limit)));

type PresenceThreadCorrelationRole = "worker" | "review" | "supervisor";

type PresenceThreadCorrelationRecord = Readonly<{
  role: PresenceThreadCorrelationRole;
  boardId: string;
  ticketId: string | null;
  attemptId: string | null;
  reviewArtifactId: string | null;
  supervisorRunId: string | null;
}>;

type PresenceThreadCorrelationRow = Readonly<{
  role: string;
  boardId: string;
  ticketId: string | null;
  attemptId: string | null;
  reviewArtifactId: string | null;
  supervisorRunId: string | null;
}>;

const mapPresenceThreadCorrelation = (
  row: PresenceThreadCorrelationRow,
): PresenceThreadCorrelationRecord => ({
  role: row.role === "review" ? "review" : row.role === "supervisor" ? "supervisor" : "worker",
  boardId: row.boardId,
  ticketId: row.ticketId,
  attemptId: row.attemptId,
  reviewArtifactId: row.reviewArtifactId,
  supervisorRunId: row.supervisorRunId,
});

const mapPresenceOperation = (row: {
  id: string;
  parentOperationId: string | null;
  boardId: string | null;
  ticketId: string | null;
  attemptId: string | null;
  reviewArtifactId: string | null;
  supervisorRunId: string | null;
  threadId: string | null;
  kind: string;
  phase: string;
  status: string;
  dedupeKey: string;
  summary: string;
  detailsJson: string;
  countersJson: string;
  errorJson: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
}): PresenceOperationRecord => ({
  id: PresenceOperationId.make(row.id),
  parentOperationId: row.parentOperationId ? PresenceOperationId.make(row.parentOperationId) : null,
  boardId: row.boardId ? BoardId.make(row.boardId) : null,
  ticketId: row.ticketId ? TicketId.make(row.ticketId) : null,
  attemptId: row.attemptId ? AttemptId.make(row.attemptId) : null,
  reviewArtifactId: row.reviewArtifactId ? ReviewArtifactId.make(row.reviewArtifactId) : null,
  supervisorRunId: row.supervisorRunId ? SupervisorRunId.make(row.supervisorRunId) : null,
  threadId: row.threadId ? ThreadId.make(row.threadId) : null,
  kind: decode(PresenceOperationKind)(row.kind),
  phase: decode(PresenceOperationPhase)(row.phase),
  status: decode(PresenceOperationStatus)(row.status),
  dedupeKey: row.dedupeKey,
  summary: row.summary,
  details: decodeJson<Record<string, unknown>>(row.detailsJson, {}),
  counters: decodeJson<PresenceOperationCounter[]>(row.countersJson, []),
  error: row.errorJson
    ? decodeJson<PresenceOperationError>(row.errorJson, {
        code: null,
        message: "Operation error could not be decoded.",
        detail: null,
      })
    : null,
  startedAt: row.startedAt,
  completedAt: row.completedAt,
  durationMs: row.durationMs,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const operationKindFromMissionEvent = (kind: PresenceMissionEventKind): PresenceOperationKind => {
  switch (kind) {
    case "controller_started":
    case "controller_tick":
    case "controller_action":
      return "controller_tick";
    case "goal_queued":
    case "goal_planning":
    case "goal_planned":
    case "goal_blocked":
      return "goal_planning";
    case "supervisor_decision":
      return "supervisor_run";
    case "worker_handoff":
      return "worker_attempt";
    case "review_result":
    case "review_failed":
      return "review_run";
    case "merge_updated":
      return "merge_operation";
    case "projection_repair":
      return "projection_sync";
    case "human_direction":
    case "human_blocker":
      return "human_direction";
    case "turn_started":
    case "turn_completed":
    case "turn_failed":
    case "tool_started":
    case "tool_completed":
    case "approval_requested":
    case "user_input_requested":
    case "runtime_health":
    case "provider_unavailable":
    case "session_stalled":
    case "runtime_warning":
    case "runtime_error":
    case "retry_queued":
      return "provider_runtime_observation";
  }
};

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
  scopeTicketIds: decodeJson<string[]>(row.scopeTicketIdsJson, []).map((value) =>
    TicketId.make(value),
  ),
  status: decode(PresenceSupervisorRunStatus)(row.status),
  stage: decode(PresenceSupervisorRunStage)(row.stage),
  currentTicketId: row.currentTicketId ? TicketId.make(row.currentTicketId) : null,
  activeThreadIds: decodeJson<string[]>(row.activeThreadIdsJson, []).map((value) =>
    ThreadId.make(value),
  ),
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
  linkedTicketIds: decodeJson<string[]>(row.linkedTicketIds, []).map((value) =>
    TicketId.make(value),
  ),
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
  riskSignals: decodeJson<string[]>(row.riskSignals, []),
  scannedAt: row.scannedAt,
});

const mapGoalIntake = (row: {
  id: string;
  boardId: string;
  source: string;
  rawGoal: string;
  summary: string;
  createdTicketIds: string;
  status?: string | null;
  plannedAt?: string | null;
  blockedAt?: string | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}): GoalIntakeRecord => ({
  id: GoalIntakeId.make(row.id),
  boardId: BoardId.make(row.boardId),
  source: decode(GoalIntakeSource)(row.source),
  rawGoal: row.rawGoal,
  summary: row.summary,
  createdTicketIds: decodeJson<string[]>(row.createdTicketIds, []).map((value) =>
    TicketId.make(value),
  ),
  status: decode(GoalIntakeStatus)(row.status ?? "queued"),
  plannedAt: row.plannedAt ?? null,
  blockedAt: row.blockedAt ?? null,
  lastError: row.lastError ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt ?? row.createdAt,
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

const mapMissionEvent = (row: {
  id: string;
  boardId: string;
  ticketId: string | null;
  attemptId: string | null;
  reviewArtifactId: string | null;
  supervisorRunId: string | null;
  threadId: string | null;
  kind: string;
  severity: string;
  summary: string;
  detail: string | null;
  retryBehavior: string;
  humanAction: string | null;
  dedupeKey: string;
  report: string | null;
  createdAt: string;
}): PresenceMissionEventRecord => ({
  id: MissionEventId.make(row.id),
  boardId: BoardId.make(row.boardId),
  ticketId: row.ticketId ? TicketId.make(row.ticketId) : null,
  attemptId: row.attemptId ? AttemptId.make(row.attemptId) : null,
  reviewArtifactId: row.reviewArtifactId ? ReviewArtifactId.make(row.reviewArtifactId) : null,
  supervisorRunId: row.supervisorRunId ? SupervisorRunId.make(row.supervisorRunId) : null,
  threadId: row.threadId ? ThreadId.make(row.threadId) : null,
  kind: decode(PresenceMissionEventKind)(row.kind),
  severity: decode(PresenceMissionSeverity)(row.severity),
  summary: row.summary,
  detail: row.detail,
  retryBehavior: decode(PresenceMissionRetryBehavior)(row.retryBehavior),
  humanAction: row.humanAction,
  dedupeKey: row.dedupeKey,
  report: decodeJson<PresenceAgentReport | null>(row.report, null),
  createdAt: row.createdAt,
});

const mapTicketMissionBriefing = (row: {
  ticketId: string;
  boardId: string;
  stage: string;
  statusLine: string;
  waitingOn: string;
  latestEventId: string | null;
  latestEventSummary: string | null;
  latestEventAt: string | null;
  needsHuman: number | boolean;
  humanAction: string | null;
  retryBehavior: string;
  updatedAt: string;
}): PresenceTicketMissionBriefing => ({
  ticketId: TicketId.make(row.ticketId),
  stage: row.stage,
  statusLine: row.statusLine,
  waitingOn: row.waitingOn,
  latestEventId: row.latestEventId ? MissionEventId.make(row.latestEventId) : null,
  latestEventSummary: row.latestEventSummary,
  latestEventAt: row.latestEventAt,
  needsHuman: Boolean(row.needsHuman),
  humanAction: row.humanAction,
  retryBehavior: decode(PresenceMissionRetryBehavior)(row.retryBehavior),
  updatedAt: row.updatedAt,
});

const mapBoardMissionBriefing = (row: {
  boardId: string;
  summary: string;
  activeTicketIds: string;
  blockedTicketIds: string;
  humanActionTicketIds: string;
  latestEventId: string | null;
  latestEventSummary: string | null;
  latestEventAt: string | null;
  updatedAt: string;
}): PresenceBoardMissionBriefing => ({
  boardId: BoardId.make(row.boardId),
  summary: row.summary,
  activeTicketIds: decodeJson<string[]>(row.activeTicketIds, []).map((value) =>
    TicketId.make(value),
  ),
  blockedTicketIds: decodeJson<string[]>(row.blockedTicketIds, []).map((value) =>
    TicketId.make(value),
  ),
  humanActionTicketIds: decodeJson<string[]>(row.humanActionTicketIds, []).map((value) =>
    TicketId.make(value),
  ),
  latestEventId: row.latestEventId ? MissionEventId.make(row.latestEventId) : null,
  latestEventSummary: row.latestEventSummary,
  latestEventAt: row.latestEventAt,
  updatedAt: row.updatedAt,
});

const mapBoardControllerState = (row: {
  boardId: string;
  mode: string;
  status: string;
  summary: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  lastTickAt: string | null;
  updatedAt: string;
}): PresenceBoardControllerState => ({
  boardId: BoardId.make(row.boardId),
  mode: decode(PresenceControllerMode)(row.mode),
  status: decode(PresenceControllerStatus)(row.status),
  summary: row.summary,
  leaseOwner: row.leaseOwner,
  leaseExpiresAt: row.leaseExpiresAt,
  lastTickAt: row.lastTickAt,
  updatedAt: row.updatedAt,
});

type RepoBrainProjectionSource = Readonly<{
  ticketId?: string | null;
  attemptId?: string | null;
  missionEventId?: string | null;
  reviewArtifactId?: string | null;
  promotionCandidateId?: string | null;
  handoffId?: string | null;
  findingId?: string | null;
  mergeOperationId?: string | null;
  filePath?: string | null;
  command?: string | null;
  test?: string | null;
  commitSha?: string | null;
  threadId?: string | null;
}>;

type RepoBrainProjectionScope = Readonly<{
  type:
    | "repo"
    | "package"
    | "directory"
    | "file"
    | "symbol"
    | "ticket"
    | "attempt"
    | "historical_only";
  target: string | null;
}>;

type RepoBrainProjectionTrigger = Readonly<{
  kind:
    | "file_changed"
    | "command_failed"
    | "command_removed"
    | "newer_attempt"
    | "newer_review"
    | "finding_opened"
    | "ticket_rescoped"
    | "human_dispute"
    | "source_missing"
    | "contract_changed"
    | "manual_expiry";
  target: string | null;
  reason: string;
}>;

type PresenceOperationDetails = Readonly<Record<string, unknown>>;

type PresenceOperationLedgerInput = Readonly<{
  parentOperationId?: string | null | undefined;
  boardId?: string | null | undefined;
  ticketId?: string | null | undefined;
  attemptId?: string | null | undefined;
  reviewArtifactId?: string | null | undefined;
  supervisorRunId?: string | null | undefined;
  threadId?: string | null | undefined;
  kind: PresenceOperationKind;
  phase: PresenceOperationPhase;
  status: PresenceOperationStatus;
  dedupeKey: string;
  summary: string;
  details?: PresenceOperationDetails | undefined;
  counters?: ReadonlyArray<PresenceOperationCounter> | undefined;
  error?: PresenceOperationError | null | undefined;
  startedAt?: string | undefined;
  completedAt?: string | null | undefined;
}>;

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
        (
          rows: ReadonlyArray<{
            id: string;
            boardId: string;
            projectId: string | null;
            title: string;
            workspaceRoot: string;
            defaultModelSelection: string | null;
            createdAt: string;
            updatedAt: string;
          }>,
        ) => rows[0] ?? null,
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
        (
          rows: ReadonlyArray<{
            id: string;
            boardId: string;
            projectId: string | null;
            title: string;
            workspaceRoot: string;
            defaultModelSelection: string | null;
            createdAt: string;
            updatedAt: string;
          }>,
        ) => rows[0] ?? null,
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
        risk_signals_json as "riskSignals",
        scanned_at as "scannedAt"
      FROM presence_repository_capability_scans
      WHERE repository_id = ${repositoryId}
    `.pipe(
      Effect.map(
        (
          rows: ReadonlyArray<{
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
            riskSignals: string;
            scannedAt: string;
          }>,
        ) => (rows[0] ? mapCapabilityScan(rows[0]) : null),
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
        (
          rows: ReadonlyArray<{
            id: string;
            boardId: string;
            payload: string;
            createdAt: string;
          }>,
        ) => (rows[0] ? mapSupervisorHandoff(rows[0]) : null),
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
        (
          rows: ReadonlyArray<{
            id: string;
            attemptId: string;
            payload: string;
            createdAt: string;
          }>,
        ) => (rows[0] ? mapWorkerHandoff(rows[0]) : null),
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
        (
          rows: ReadonlyArray<{
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
          }>,
        ) => (rows[0] ? mapSupervisorRun(rows[0]) : null),
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
        (
          rows: ReadonlyArray<{
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
          }>,
        ) => (rows[0] ? mapSupervisorRun(rows[0]) : null),
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
        (
          rows: ReadonlyArray<{
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
          }>,
        ) => (rows[0] ? mapMergeOperation(rows[0]) : null),
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
        (
          rows: ReadonlyArray<{
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
          }>,
        ) => (rows[0] ? mapMergeOperation(rows[0]) : null),
      ),
    );

  const readOperationLedgerByDedupeKey = (input: { scopeKey: string; dedupeKey: string }) =>
    deps.sql<{
      id: string;
      parentOperationId: string | null;
      boardId: string | null;
      ticketId: string | null;
      attemptId: string | null;
      reviewArtifactId: string | null;
      supervisorRunId: string | null;
      threadId: string | null;
      kind: string;
      phase: string;
      status: string;
      dedupeKey: string;
      summary: string;
      detailsJson: string;
      countersJson: string;
      errorJson: string | null;
      startedAt: string;
      completedAt: string | null;
      durationMs: number | null;
      createdAt: string;
      updatedAt: string;
    }>`
      SELECT
        operation_id as id,
        parent_operation_id as "parentOperationId",
        board_id as "boardId",
        ticket_id as "ticketId",
        attempt_id as "attemptId",
        review_artifact_id as "reviewArtifactId",
        supervisor_run_id as "supervisorRunId",
        thread_id as "threadId",
        kind,
        phase,
        status,
        dedupe_key as "dedupeKey",
        summary,
        details_json as "detailsJson",
        counters_json as "countersJson",
        error_json as "errorJson",
        started_at as "startedAt",
        completed_at as "completedAt",
        duration_ms as "durationMs",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM presence_operation_ledger
      WHERE scope_key = ${input.scopeKey}
        AND dedupe_key = ${input.dedupeKey}
      LIMIT 1
    `.pipe(Effect.map((rows) => (rows[0] ? mapPresenceOperation(rows[0]) : null)));

  const readRecentOperationLedgerForBoard = (boardId: string, limit = 100) =>
    deps.sql<{
      id: string;
      parentOperationId: string | null;
      boardId: string | null;
      ticketId: string | null;
      attemptId: string | null;
      reviewArtifactId: string | null;
      supervisorRunId: string | null;
      threadId: string | null;
      kind: string;
      phase: string;
      status: string;
      dedupeKey: string;
      summary: string;
      detailsJson: string;
      countersJson: string;
      errorJson: string | null;
      startedAt: string;
      completedAt: string | null;
      durationMs: number | null;
      createdAt: string;
      updatedAt: string;
    }>`
      SELECT
        operation_id as id,
        parent_operation_id as "parentOperationId",
        board_id as "boardId",
        ticket_id as "ticketId",
        attempt_id as "attemptId",
        review_artifact_id as "reviewArtifactId",
        supervisor_run_id as "supervisorRunId",
        thread_id as "threadId",
        kind,
        phase,
        status,
        dedupe_key as "dedupeKey",
        summary,
        details_json as "detailsJson",
        counters_json as "countersJson",
        error_json as "errorJson",
        started_at as "startedAt",
        completed_at as "completedAt",
        duration_ms as "durationMs",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM presence_operation_ledger
      WHERE board_id = ${boardId}
      ORDER BY updated_at DESC, created_at DESC, operation_id DESC
      LIMIT ${Math.max(1, Math.min(500, Math.floor(limit)))}
    `.pipe(Effect.map((rows) => rows.map(mapPresenceOperation)));

  const upsertOperationLedger = (input: PresenceOperationLedgerInput) =>
    Effect.gen(function* () {
      const now = deps.nowIso();
      const scopeKey = operationScopeKey(input.boardId);
      const operationId = `presence_operation_${stableHash({
        scopeKey,
        dedupeKey: input.dedupeKey,
      })}`;
      const startedAt = input.startedAt ?? now;
      const completedAt = input.completedAt ?? null;
      const durationMs =
        completedAt === null ? null : Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
      yield* deps.sql`
        INSERT INTO presence_operation_ledger (
          operation_id, scope_key, parent_operation_id, board_id, ticket_id, attempt_id,
          review_artifact_id, supervisor_run_id, thread_id, kind, phase, status, dedupe_key,
          summary, details_json, counters_json, error_json, started_at, completed_at,
          duration_ms, created_at, updated_at
        ) VALUES (
          ${operationId},
          ${scopeKey},
          ${input.parentOperationId ?? null},
          ${input.boardId ?? null},
          ${input.ticketId ?? null},
          ${input.attemptId ?? null},
          ${input.reviewArtifactId ?? null},
          ${input.supervisorRunId ?? null},
          ${input.threadId ?? null},
          ${input.kind},
          ${input.phase},
          ${input.status},
          ${input.dedupeKey},
          ${input.summary},
          ${encodeJson(input.details ?? {})},
          ${encodeJson(input.counters ?? [])},
          ${input.error ? encodeJson(input.error) : null},
          ${startedAt},
          ${completedAt},
          ${durationMs},
          ${now},
          ${now}
        )
        ON CONFLICT(scope_key, dedupe_key) DO UPDATE SET
          parent_operation_id = COALESCE(excluded.parent_operation_id, presence_operation_ledger.parent_operation_id),
          board_id = COALESCE(excluded.board_id, presence_operation_ledger.board_id),
          ticket_id = COALESCE(excluded.ticket_id, presence_operation_ledger.ticket_id),
          attempt_id = COALESCE(excluded.attempt_id, presence_operation_ledger.attempt_id),
          review_artifact_id = COALESCE(excluded.review_artifact_id, presence_operation_ledger.review_artifact_id),
          supervisor_run_id = COALESCE(excluded.supervisor_run_id, presence_operation_ledger.supervisor_run_id),
          thread_id = COALESCE(excluded.thread_id, presence_operation_ledger.thread_id),
          kind = excluded.kind,
          phase = excluded.phase,
          status = excluded.status,
          summary = excluded.summary,
          details_json = excluded.details_json,
          counters_json = excluded.counters_json,
          error_json = excluded.error_json,
          started_at = presence_operation_ledger.started_at,
          completed_at = excluded.completed_at,
          duration_ms = excluded.duration_ms,
          updated_at = excluded.updated_at
      `;
      const record = yield* readOperationLedgerByDedupeKey({
        scopeKey,
        dedupeKey: input.dedupeKey,
      });
      if (!record) {
        return yield* Effect.fail(
          new Error(`Presence operation '${input.dedupeKey}' could not be reloaded.`),
        );
      }
      return record;
    });

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
        return yield* Effect.fail(
          new Error(`Merge operation '${input.id}' could not be reloaded.`),
        );
      }
      const boardId = yield* boardIdForTicket(input.ticketId);
      if (boardId) {
        yield* upsertOperationLedger({
          boardId,
          ticketId: input.ticketId,
          attemptId: input.attemptId,
          kind: "merge_operation",
          phase: "finish",
          status: input.status === "failed" ? "failed" : "completed",
          dedupeKey: operationMergeKey(input.id),
          summary: input.errorSummary ?? `Merge operation ${input.status}.`,
          details: {
            mergeOperationId: input.id,
            baseBranch: input.baseBranch,
            sourceBranch: input.sourceBranch,
            sourceHeadSha: input.sourceHeadSha ?? null,
            baseHeadBefore: input.baseHeadBefore ?? null,
            baseHeadAfter: input.baseHeadAfter ?? null,
            mergeCommitSha: input.mergeCommitSha ?? null,
            cleanupWorktreeDone: input.cleanupWorktreeDone ?? false,
            cleanupThreadDone: input.cleanupThreadDone ?? false,
          },
          counters: [
            { name: "gitAbortAttempted", value: input.gitAbortAttempted ? 1 : 0 },
            {
              name: "cleanupStepsDone",
              value: [input.cleanupWorktreeDone, input.cleanupThreadDone].filter(Boolean).length,
            },
          ],
          error: input.errorSummary
            ? { code: "merge_operation_failed", message: input.errorSummary, detail: null }
            : null,
          startedAt: persisted.createdAt,
          completedAt: persisted.updatedAt,
        });
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
        (
          rows: ReadonlyArray<{
            id: string;
            ticketId: string;
            attemptId: string | null;
            decision: string;
            notes: string;
            createdAt: string;
          }>,
        ) => (rows[0] ? mapReviewDecision(rows[0]) : null),
      ),
    );

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
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM presence_findings
      WHERE ticket_id = ${ticketId}
      ORDER BY updated_at DESC, created_at DESC
    `.pipe(
      Effect.map(
        (
          rows: ReadonlyArray<{
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
            createdAt: string;
            updatedAt: string;
          }>,
        ) => rows.map(mapFinding),
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
        (
          rows: ReadonlyArray<{
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
          }>,
        ) => rows.map(mapReviewArtifact),
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
        (
          rows: ReadonlyArray<{
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
          }>,
        ) => rows.map(mapProposedFollowUp),
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
        (
          rows: ReadonlyArray<{
            attemptId: string;
            kind: string;
            summary: string;
            createdAt: string;
            updatedAt: string;
          }>,
        ) => rows.map(mapAttemptOutcome),
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
      `.pipe(
        Effect.map((rows: ReadonlyArray<{ id: string; createdAt: string }>) => rows[0] ?? null),
      );
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
          createdAt: existing.createdAt,
          updatedAt,
        } satisfies FindingRecord;
      }

      const findingId = FindingId.make(`finding_${crypto.randomUUID()}`);
      yield* deps.sql`
        INSERT INTO presence_findings (
          finding_id, ticket_id, attempt_id, source, severity, disposition, status,
          summary, rationale, evidence_ids_json, created_at, updated_at
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
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM presence_findings
        WHERE finding_id = ${findingId}
      `.pipe(
        Effect.map(
          (
            rows: ReadonlyArray<{
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
              createdAt: string;
              updatedAt: string;
            }>,
          ) => rows[0] ?? null,
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
      const findings = (yield* readFindingsForTicket(
        input.ticketId,
      )) as ReadonlyArray<FindingRecord>;
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
        ? yield* deps.sql<{ threadId: string }>`
              SELECT thread_id as "threadId"
              FROM projection_threads
              WHERE thread_id = ${input.threadId}
            `.pipe(
            Effect.map((rows: ReadonlyArray<{ threadId: string }>) => rows[0]?.threadId ?? null),
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
      const boardId = yield* boardIdForTicket(input.ticketId);
      if (boardId) {
        yield* upsertOperationLedger({
          boardId,
          ticketId: input.ticketId,
          attemptId: input.attemptId ?? null,
          reviewArtifactId: artifactId,
          threadId: persistedThreadId,
          kind: "review_run",
          phase: "finish",
          status: input.decision === "escalate" ? "failed" : "completed",
          dedupeKey: operationReviewArtifactKey(artifactId),
          summary: input.summary,
          details: {
            reviewerKind: input.reviewerKind,
            decision: input.decision ?? null,
            changedFiles: uniqueStrings([...input.changedFiles]),
            changedFilesReviewed: uniqueStrings([...(input.changedFilesReviewed ?? [])]),
            findingIds: uniqueStrings([...input.findingIds]),
          },
          counters: [
            { name: "changedFiles", value: uniqueStrings([...input.changedFiles]).length },
            {
              name: "changedFilesReviewed",
              value: uniqueStrings([...(input.changedFilesReviewed ?? [])]).length,
            },
            { name: "findings", value: uniqueStrings([...input.findingIds]).length },
            { name: "evidenceItems", value: input.evidence?.length ?? 0 },
          ],
          error:
            input.decision === "escalate"
              ? {
                  code: "review_escalated",
                  message: input.summary,
                  detail: input.checklistJson,
                }
              : null,
          startedAt: createdAt,
          completedAt: createdAt,
        });
        yield* refreshRepoBrainReadModelForBoard(boardId);
      }
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
      `.pipe(Effect.map((rows: ReadonlyArray<{ acceptanceChecklist: string }>) => rows[0] ?? null));
      if (!existing) {
        return yield* Effect.fail(new Error(`Ticket '${ticketId}' not found.`));
      }

      const current = decodeJson<PresenceAcceptanceChecklistItem[]>(
        existing.acceptanceChecklist,
        [],
      );
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

  const upsertPresenceThreadCorrelation = (input: {
    threadId: string;
    boardId: string;
    role: PresenceThreadCorrelationRole;
    ticketId?: string | null | undefined;
    attemptId?: string | null | undefined;
    reviewArtifactId?: string | null | undefined;
    supervisorRunId?: string | null | undefined;
    source: string;
  }) =>
    Effect.gen(function* () {
      const updatedAt = deps.nowIso();
      yield* deps.sql`
        INSERT INTO presence_thread_correlations (
          thread_id, board_id, role, ticket_id, attempt_id, review_artifact_id,
          supervisor_run_id, source, created_at, updated_at
        ) VALUES (
          ${input.threadId},
          ${input.boardId},
          ${input.role},
          ${input.ticketId ?? null},
          ${input.attemptId ?? null},
          ${input.reviewArtifactId ?? null},
          ${input.supervisorRunId ?? null},
          ${input.source},
          ${updatedAt},
          ${updatedAt}
        )
        ON CONFLICT(thread_id) DO UPDATE SET
          board_id = excluded.board_id,
          role = excluded.role,
          ticket_id = excluded.ticket_id,
          attempt_id = excluded.attempt_id,
          review_artifact_id = COALESCE(excluded.review_artifact_id, presence_thread_correlations.review_artifact_id),
          supervisor_run_id = COALESCE(excluded.supervisor_run_id, presence_thread_correlations.supervisor_run_id),
          source = excluded.source,
          updated_at = excluded.updated_at
      `;
    });

  const attachSupervisorRunToThreadCorrelation = (input: {
    threadId: string;
    boardId: string;
    supervisorRunId: string;
    source: string;
  }) =>
    Effect.gen(function* () {
      const updatedAt = deps.nowIso();
      yield* deps.sql`
        UPDATE presence_thread_correlations
        SET
          supervisor_run_id = ${input.supervisorRunId},
          source = ${input.source},
          updated_at = ${updatedAt}
        WHERE thread_id = ${input.threadId}
          AND board_id = ${input.boardId}
      `;
    });

  const readPresenceThreadCorrelation = (threadId: string) =>
    Effect.gen(function* () {
      const registryRows = yield* deps.sql<PresenceThreadCorrelationRow>`
        SELECT
          role,
          board_id as "boardId",
          ticket_id as "ticketId",
          attempt_id as "attemptId",
          review_artifact_id as "reviewArtifactId",
          supervisor_run_id as "supervisorRunId"
        FROM presence_thread_correlations
        WHERE thread_id = ${threadId}
        LIMIT 1
      `;
      const registry = registryRows[0];
      if (registry) {
        return mapPresenceThreadCorrelation(registry);
      }

      const attemptRows = yield* deps.sql<{
        boardId: string;
        ticketId: string;
        attemptId: string;
      }>`
        SELECT
          tickets.board_id as "boardId",
          attempts.ticket_id as "ticketId",
          attempts.attempt_id as "attemptId"
        FROM presence_attempts attempts
        INNER JOIN presence_tickets tickets
          ON tickets.ticket_id = attempts.ticket_id
        WHERE attempts.thread_id = ${threadId}
        LIMIT 1
      `;
      const attempt = attemptRows[0];
      if (attempt) {
        return {
          role: "worker" as const,
          boardId: attempt.boardId,
          ticketId: attempt.ticketId,
          attemptId: attempt.attemptId,
          reviewArtifactId: null,
          supervisorRunId: null,
        };
      }

      const reviewRows = yield* deps.sql<{
        boardId: string;
        ticketId: string;
        attemptId: string | null;
        reviewArtifactId: string;
      }>`
        SELECT
          tickets.board_id as "boardId",
          artifacts.ticket_id as "ticketId",
          artifacts.attempt_id as "attemptId",
          artifacts.review_artifact_id as "reviewArtifactId"
        FROM presence_review_artifacts artifacts
        INNER JOIN presence_tickets tickets
          ON tickets.ticket_id = artifacts.ticket_id
        WHERE artifacts.thread_id = ${threadId}
        ORDER BY artifacts.created_at DESC
        LIMIT 1
      `;
      const review = reviewRows[0];
      if (review) {
        return {
          role: "review" as const,
          boardId: review.boardId,
          ticketId: review.ticketId,
          attemptId: review.attemptId,
          reviewArtifactId: review.reviewArtifactId,
          supervisorRunId: null,
        };
      }

      const missionThreadRows = yield* deps.sql<{
        boardId: string;
        ticketId: string | null;
        attemptId: string | null;
        reviewArtifactId: string | null;
        supervisorRunId: string | null;
        kind: string;
      }>`
        SELECT
          board_id as "boardId",
          ticket_id as "ticketId",
          attempt_id as "attemptId",
          review_artifact_id as "reviewArtifactId",
          supervisor_run_id as "supervisorRunId",
          kind
        FROM presence_mission_events
        WHERE thread_id = ${threadId}
        ORDER BY created_at DESC
        LIMIT 1
      `;
      const missionThread = missionThreadRows[0];
      if (missionThread) {
        return {
          role:
            missionThread.kind.startsWith("review") || threadId.startsWith("presence_review_thread")
              ? ("review" as const)
              : missionThread.supervisorRunId
                ? ("supervisor" as const)
                : ("worker" as const),
          boardId: missionThread.boardId,
          ticketId: missionThread.ticketId,
          attemptId: missionThread.attemptId,
          reviewArtifactId: missionThread.reviewArtifactId,
          supervisorRunId: missionThread.supervisorRunId,
        };
      }

      const supervisorRows = yield* deps.sql<{
        boardId: string;
        supervisorRunId: string;
        currentTicketId: string | null;
        activeThreadIdsJson: string;
      }>`
        SELECT
          board_id as "boardId",
          supervisor_run_id as "supervisorRunId",
          current_ticket_id as "currentTicketId",
          active_thread_ids_json as "activeThreadIdsJson"
        FROM presence_supervisor_runs
        WHERE active_thread_ids_json LIKE ${`%${threadId}%`}
        ORDER BY updated_at DESC
        LIMIT 20
      `;
      const supervisor = supervisorRows.find((row) =>
        decodeJson<ReadonlyArray<string>>(row.activeThreadIdsJson, []).includes(threadId),
      );
      if (supervisor) {
        return {
          role: "supervisor" as const,
          boardId: supervisor.boardId,
          ticketId: supervisor.currentTicketId,
          attemptId: null,
          reviewArtifactId: null,
          supervisorRunId: supervisor.supervisorRunId,
        };
      }

      return null;
    });

  const readRecentMissionEventsForBoard = (
    boardId: string,
    limit = RECENT_MISSION_EVENT_READ_LIMIT_DEFAULT,
  ) =>
    deps.sql<{
      id: string;
      boardId: string;
      ticketId: string | null;
      attemptId: string | null;
      reviewArtifactId: string | null;
      supervisorRunId: string | null;
      threadId: string | null;
      kind: string;
      severity: string;
      summary: string;
      detail: string | null;
      retryBehavior: string;
      humanAction: string | null;
      dedupeKey: string;
      report: string | null;
      createdAt: string;
    }>`
      SELECT
        mission_event_id as id,
        board_id as "boardId",
        ticket_id as "ticketId",
        attempt_id as "attemptId",
        review_artifact_id as "reviewArtifactId",
        supervisor_run_id as "supervisorRunId",
        thread_id as "threadId",
        kind,
        severity,
        summary,
        detail,
        retry_behavior as "retryBehavior",
        human_action as "humanAction",
        dedupe_key as "dedupeKey",
        report_json as report,
        created_at as "createdAt"
      FROM presence_mission_events
      WHERE board_id = ${boardId}
      ORDER BY created_at DESC
      LIMIT ${clampRecentMissionEventReadLimit(limit)}
    `.pipe(Effect.map((rows) => rows.map(mapMissionEvent)));

  const readTicketMissionBriefingsForBoard = (boardId: string) =>
    deps.sql<{
      ticketId: string;
      boardId: string;
      stage: string;
      statusLine: string;
      waitingOn: string;
      latestEventId: string | null;
      latestEventSummary: string | null;
      latestEventAt: string | null;
      needsHuman: number | boolean;
      humanAction: string | null;
      retryBehavior: string;
      updatedAt: string;
    }>`
      SELECT
        ticket_id as "ticketId",
        board_id as "boardId",
        stage,
        status_line as "statusLine",
        waiting_on as "waitingOn",
        latest_event_id as "latestEventId",
        latest_event_summary as "latestEventSummary",
        latest_event_at as "latestEventAt",
        needs_human as "needsHuman",
        human_action as "humanAction",
        retry_behavior as "retryBehavior",
        updated_at as "updatedAt"
      FROM presence_ticket_mission_state
      WHERE board_id = ${boardId}
      ORDER BY updated_at DESC
    `.pipe(Effect.map((rows) => rows.map(mapTicketMissionBriefing)));

  const readBoardMissionBriefing = (boardId: string) =>
    deps.sql<{
      boardId: string;
      summary: string;
      activeTicketIds: string;
      blockedTicketIds: string;
      humanActionTicketIds: string;
      latestEventId: string | null;
      latestEventSummary: string | null;
      latestEventAt: string | null;
      updatedAt: string;
    }>`
      SELECT
        board_id as "boardId",
        summary,
        active_ticket_ids_json as "activeTicketIds",
        blocked_ticket_ids_json as "blockedTicketIds",
        human_action_ticket_ids_json as "humanActionTicketIds",
        latest_event_id as "latestEventId",
        latest_event_summary as "latestEventSummary",
        latest_event_at as "latestEventAt",
        updated_at as "updatedAt"
      FROM presence_board_mission_state
      WHERE board_id = ${boardId}
      LIMIT 1
    `.pipe(Effect.map((rows) => (rows[0] ? mapBoardMissionBriefing(rows[0]) : null)));

  const readBoardControllerState = (boardId: string) =>
    deps.sql<{
      boardId: string;
      mode: string;
      status: string;
      summary: string;
      leaseOwner: string | null;
      leaseExpiresAt: string | null;
      lastTickAt: string | null;
      updatedAt: string;
    }>`
      SELECT
        board_id as "boardId",
        mode,
        status,
        summary,
        lease_owner as "leaseOwner",
        lease_expires_at as "leaseExpiresAt",
        last_tick_at as "lastTickAt",
        updated_at as "updatedAt"
      FROM presence_board_controller_state
      WHERE board_id = ${boardId}
      LIMIT 1
    `.pipe(Effect.map((rows) => (rows[0] ? mapBoardControllerState(rows[0]) : null)));

  const upsertBoardControllerState = (input: {
    boardId: string;
    mode?: PresenceControllerMode;
    status: PresenceControllerStatus;
    summary: string;
    leaseOwner?: string | null;
    leaseExpiresAt?: string | null;
    lastTickAt?: string | null;
    updatedAt?: string;
  }) =>
    Effect.gen(function* () {
      const updatedAt = input.updatedAt ?? deps.nowIso();
      const existing = yield* readBoardControllerState(input.boardId);
      const mode = input.mode ?? existing?.mode ?? "active";
      yield* deps.sql`
        INSERT INTO presence_board_controller_state (
          board_id, mode, status, summary, lease_owner, lease_expires_at, last_tick_at, updated_at
        ) VALUES (
          ${input.boardId},
          ${mode},
          ${input.status},
          ${input.summary},
          ${input.leaseOwner ?? null},
          ${input.leaseExpiresAt ?? null},
          ${input.lastTickAt ?? null},
          ${updatedAt}
        )
        ON CONFLICT(board_id) DO UPDATE SET
          mode = excluded.mode,
          status = excluded.status,
          summary = excluded.summary,
          lease_owner = excluded.lease_owner,
          lease_expires_at = excluded.lease_expires_at,
          last_tick_at = COALESCE(excluded.last_tick_at, presence_board_controller_state.last_tick_at),
          updated_at = excluded.updated_at
      `;
      const state = yield* readBoardControllerState(input.boardId);
      return state!;
    });

  const updateGoalIntakeStatus = (input: {
    goalIntakeId: string;
    status: GoalIntakeStatus;
    summary?: string | null;
    createdTicketIds?: ReadonlyArray<string> | null;
    lastError?: string | null;
  }) =>
    Effect.gen(function* () {
      const now = deps.nowIso();
      yield* deps.sql`
        UPDATE presence_goal_intakes
        SET status = ${input.status},
            summary = COALESCE(${input.summary ?? null}, summary),
            created_ticket_ids_json = COALESCE(
              ${input.createdTicketIds ? encodeJson(input.createdTicketIds) : null},
              created_ticket_ids_json
            ),
            planned_at = CASE
              WHEN ${input.status} = 'planned' THEN COALESCE(planned_at, ${now})
              ELSE planned_at
            END,
            blocked_at = CASE
              WHEN ${input.status} = 'blocked' THEN COALESCE(blocked_at, ${now})
              ELSE blocked_at
            END,
            last_error = ${input.lastError ?? null},
            updated_at = ${now}
        WHERE goal_intake_id = ${input.goalIntakeId}
      `;
    });

  const readPendingGoalIntakesForController = (boardId: string) =>
    deps.sql<{
      id: string;
      boardId: string;
      source: string;
      rawGoal: string;
      summary: string;
      createdTicketIds: string;
      status: string;
      plannedAt: string | null;
      blockedAt: string | null;
      lastError: string | null;
      createdAt: string;
      updatedAt: string | null;
    }>`
      SELECT
        goal_intake_id as id,
        board_id as "boardId",
        source,
        raw_goal as "rawGoal",
        summary,
        created_ticket_ids_json as "createdTicketIds",
        status,
        planned_at as "plannedAt",
        blocked_at as "blockedAt",
        last_error as "lastError",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM presence_goal_intakes
      WHERE board_id = ${boardId}
        AND status IN ('queued', 'planning')
      ORDER BY created_at ASC
    `.pipe(Effect.map((rows) => rows.map(mapGoalIntake)));

  const readControllerWakeBoardIds = () =>
    deps.sql<{ boardId: string }>`
      SELECT DISTINCT board_id as "boardId"
      FROM presence_boards
      WHERE board_id NOT IN (
        SELECT board_id
        FROM presence_board_controller_state
        WHERE mode = 'paused'
      )
      ORDER BY board_id ASC
    `.pipe(Effect.map((rows) => rows.map((row) => row.boardId)));

  const upsertRepoBrainEvidence = (input: {
    repositoryId: string;
    dedupeKey: string;
    role: "supports" | "contradicts" | "supersedes" | "context";
    source: RepoBrainProjectionSource;
    summary: string;
    confidence: "low" | "medium" | "high";
    observedAt: string;
    createdAt?: string;
  }) =>
    Effect.gen(function* () {
      const evidenceId = `repo_brain_evidence_${stableHash({
        repositoryId: input.repositoryId,
        dedupeKey: input.dedupeKey,
      })}`;
      const createdAt = input.createdAt ?? deps.nowIso();
      yield* deps.sql`
        INSERT INTO presence_repo_brain_evidence (
          repo_brain_evidence_id, repository_id, repo_brain_memory_id, role, source_json,
          summary, confidence, observed_at, created_at, dedupe_key
        ) VALUES (
          ${evidenceId},
          ${input.repositoryId},
          ${null},
          ${input.role},
          ${encodeJson(input.source)},
          ${input.summary},
          ${input.confidence},
          ${input.observedAt},
          ${createdAt},
          ${input.dedupeKey}
        )
        ON CONFLICT(repository_id, dedupe_key) DO UPDATE SET
          role = excluded.role,
          source_json = excluded.source_json,
          summary = excluded.summary,
          confidence = excluded.confidence,
          observed_at = excluded.observed_at
      `;
      return evidenceId;
    });

  const upsertRepoBrainCandidate = (input: {
    repositoryId: string;
    sourceDedupeKey: string;
    evidenceId: string;
    kind: "fact" | "decision" | "workflow" | "lesson" | "risk";
    title: string;
    body: string;
    scope: RepoBrainProjectionScope;
    confidence: "low" | "medium" | "high";
    proposedBy: "worker" | "reviewer" | "supervisor" | "human" | "deterministic_projection";
    invalidationTriggers: ReadonlyArray<RepoBrainProjectionTrigger>;
    createdAt: string;
  }) =>
    Effect.gen(function* () {
      const candidateId = `repo_brain_candidate_${stableHash({
        repositoryId: input.repositoryId,
        sourceDedupeKey: input.sourceDedupeKey,
      })}`;
      yield* deps.sql`
        INSERT INTO presence_repo_brain_candidates (
          repo_brain_candidate_id, repository_id, proposed_memory_id, predecessor_candidate_id,
          kind, status, title, body, scope_json, confidence, proposed_by,
          source_evidence_ids_json, invalidation_triggers_json, created_at, updated_at,
          reviewed_at, source_dedupe_key
        ) VALUES (
          ${candidateId},
          ${input.repositoryId},
          ${null},
          ${null},
          ${input.kind},
          ${"candidate"},
          ${input.title},
          ${input.body},
          ${encodeJson(input.scope)},
          ${input.confidence},
          ${input.proposedBy},
          ${encodeJson([input.evidenceId])},
          ${encodeJson(input.invalidationTriggers)},
          ${input.createdAt},
          ${input.createdAt},
          ${null},
          ${input.sourceDedupeKey}
        )
        ON CONFLICT(repository_id, source_dedupe_key) DO UPDATE SET
          kind = excluded.kind,
          title = excluded.title,
          body = excluded.body,
          scope_json = excluded.scope_json,
          confidence = excluded.confidence,
          proposed_by = excluded.proposed_by,
          source_evidence_ids_json = excluded.source_evidence_ids_json,
          invalidation_triggers_json = excluded.invalidation_triggers_json,
          updated_at = excluded.updated_at
        WHERE presence_repo_brain_candidates.status = 'candidate'
      `;
      yield* deps.sql`
        INSERT INTO presence_repo_brain_candidate_sources (
          repository_id, source_dedupe_key, evidence_id, candidate_id, created_at
        ) VALUES (
          ${input.repositoryId},
          ${input.sourceDedupeKey},
          ${input.evidenceId},
          ${candidateId},
          ${input.createdAt}
        )
        ON CONFLICT(repository_id, source_dedupe_key) DO UPDATE SET
          evidence_id = excluded.evidence_id,
          candidate_id = excluded.candidate_id
      `;
      return candidateId;
    });

  const boardIdForTicket = (ticketId: string) =>
    deps.sql<{ boardId: string }>`
      SELECT board_id as "boardId"
      FROM presence_tickets
      WHERE ticket_id = ${ticketId}
      LIMIT 1
    `.pipe(Effect.map((rows) => rows[0]?.boardId ?? null));

  const refreshRepoBrainReadModelForBoard = (boardId: string) =>
    Effect.gen(function* () {
      const startedAt = deps.nowIso();
      const repositoryRows = yield* deps.sql<{ repositoryId: string }>`
        SELECT repository_id as "repositoryId"
        FROM presence_repositories
        WHERE board_id = ${boardId}
        LIMIT 1
      `;
      const repositoryId = repositoryRows[0]?.repositoryId;
      if (!repositoryId) {
        yield* upsertOperationLedger({
          boardId,
          kind: "repo_brain_projection",
          phase: "project",
          status: "skipped",
          dedupeKey: `repo-brain-projection:${boardId}:${startedAt}`,
          summary: "Repo-brain projection skipped because no repository exists for the board.",
          details: { reason: "repository_missing" },
          error: {
            code: "repository_missing",
            message: "No repository exists for this Presence board.",
            detail: null,
          },
          startedAt,
          completedAt: deps.nowIso(),
        });
        return;
      }

      const missionRows = yield* deps.sql<{
        id: string;
        ticketId: string | null;
        attemptId: string | null;
        reviewArtifactId: string | null;
        threadId: string | null;
        summary: string;
        dedupeKey: string;
        createdAt: string;
      }>`
        SELECT
          mission_event_id as id,
          ticket_id as "ticketId",
          attempt_id as "attemptId",
          review_artifact_id as "reviewArtifactId",
          thread_id as "threadId",
          summary,
          dedupe_key as "dedupeKey",
          created_at as "createdAt"
        FROM presence_mission_events
        WHERE board_id = ${boardId}
      `;
      for (const event of missionRows) {
        yield* upsertRepoBrainEvidence({
          repositoryId,
          dedupeKey: `mission:${event.dedupeKey}`,
          role: "context",
          source: {
            ticketId: event.ticketId,
            attemptId: event.attemptId,
            missionEventId: event.id,
            reviewArtifactId: event.reviewArtifactId,
            threadId: event.threadId,
          },
          summary: event.summary,
          confidence: "low",
          observedAt: event.createdAt,
          createdAt: event.createdAt,
        });
      }

      const workerRows = yield* deps.sql<{
        id: string;
        ticketId: string;
        attemptId: string;
        payload: string;
        createdAt: string;
      }>`
        SELECT
          h.handoff_id as id,
          a.ticket_id as "ticketId",
          h.attempt_id as "attemptId",
          h.payload_json as payload,
          h.created_at as "createdAt"
        FROM presence_handoffs h
        INNER JOIN presence_attempts a ON a.attempt_id = h.attempt_id
        INNER JOIN presence_tickets t ON t.ticket_id = a.ticket_id
        WHERE t.board_id = ${boardId}
          AND h.role = 'worker'
      `;
      for (const handoff of workerRows) {
        const payload = decodeJson<{
          completedWork: string[];
          currentHypothesis: string | null;
          changedFiles: string[];
          testsRun: string[];
          blockers: string[];
          nextStep: string | null;
          retryCount: number;
        }>(handoff.payload, {
          completedWork: [],
          currentHypothesis: null,
          changedFiles: [],
          testsRun: [],
          blockers: [],
          nextStep: null,
          retryCount: 0,
        });
        const summary =
          payload.blockers[0] ??
          payload.currentHypothesis ??
          payload.completedWork[0] ??
          payload.nextStep ??
          "Worker handoff captured repo-brain evidence.";
        const sourceDedupeKey = `worker-handoff:${handoff.id}`;
        const evidenceId = yield* upsertRepoBrainEvidence({
          repositoryId,
          dedupeKey: sourceDedupeKey,
          role: payload.blockers.length > 0 ? "contradicts" : "supports",
          source: {
            ticketId: handoff.ticketId,
            attemptId: handoff.attemptId,
            handoffId: handoff.id,
            filePath: payload.changedFiles[0] ?? null,
            command: payload.testsRun[0] ?? null,
            test: payload.testsRun[0] ?? null,
          },
          summary,
          confidence: payload.blockers.length > 0 ? "medium" : "low",
          observedAt: handoff.createdAt,
          createdAt: handoff.createdAt,
        });
        const body = [
          "Worker handoff proposed this memory candidate. Treat it as unpromoted until reviewed.",
          payload.currentHypothesis ? `Hypothesis: ${payload.currentHypothesis}` : null,
          payload.completedWork.length > 0
            ? `Completed work: ${payload.completedWork.join("; ")}`
            : null,
          payload.blockers.length > 0 ? `Blockers: ${payload.blockers.join("; ")}` : null,
          payload.nextStep ? `Next step: ${payload.nextStep}` : null,
        ]
          .filter((value): value is string => value !== null)
          .join("\n");
        yield* upsertRepoBrainCandidate({
          repositoryId,
          sourceDedupeKey,
          evidenceId,
          kind: payload.blockers.length > 0 ? "risk" : "lesson",
          title: payload.blockers[0] ?? payload.currentHypothesis ?? "Worker handoff lesson",
          body,
          scope: { type: "attempt", target: handoff.attemptId },
          confidence: payload.blockers.length > 0 ? "medium" : "low",
          proposedBy: "worker",
          invalidationTriggers: [
            {
              kind: "newer_attempt",
              target: handoff.attemptId,
              reason: "A newer attempt may supersede this worker handoff.",
            },
            ...payload.changedFiles.map((filePath) => ({
              kind: "file_changed" as const,
              target: filePath,
              reason: "The referenced file changed after this candidate was created.",
            })),
          ],
          createdAt: handoff.createdAt,
        });
      }

      const findingRows = yield* deps.sql<{
        id: string;
        ticketId: string;
        attemptId: string | null;
        severity: string;
        disposition: string;
        status: string;
        summary: string;
        rationale: string;
        createdAt: string;
        updatedAt: string;
      }>`
        SELECT
          finding_id as id,
          ticket_id as "ticketId",
          attempt_id as "attemptId",
          severity,
          disposition,
          status,
          summary,
          rationale,
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM presence_findings
        WHERE ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
      `;
      for (const finding of findingRows) {
        const sourceDedupeKey = `finding:${finding.id}`;
        const evidenceId = yield* upsertRepoBrainEvidence({
          repositoryId,
          dedupeKey: sourceDedupeKey,
          role: finding.status === "open" ? "contradicts" : "context",
          source: {
            ticketId: finding.ticketId,
            attemptId: finding.attemptId,
            findingId: finding.id,
          },
          summary: finding.summary,
          confidence: finding.severity === "blocking" ? "high" : "medium",
          observedAt: finding.updatedAt,
          createdAt: finding.createdAt,
        });
        if (finding.status === "open" && finding.severity === "blocking") {
          yield* upsertRepoBrainCandidate({
            repositoryId,
            sourceDedupeKey,
            evidenceId,
            kind: "risk",
            title: finding.summary,
            body: finding.rationale,
            scope: finding.attemptId
              ? { type: "attempt", target: finding.attemptId }
              : { type: "ticket", target: finding.ticketId },
            confidence: "high",
            proposedBy: "reviewer",
            invalidationTriggers: [
              {
                kind: "finding_opened",
                target: finding.id,
                reason: "The open finding must be resolved or dismissed before this risk is stale.",
              },
            ],
            createdAt: finding.createdAt,
          });
        }
      }

      const mergeRows = yield* deps.sql<{
        id: string;
        ticketId: string;
        attemptId: string;
        status: string;
        sourceHeadSha: string | null;
        baseHeadBefore: string | null;
        baseHeadAfter: string | null;
        mergeCommitSha: string | null;
        errorSummary: string | null;
        createdAt: string;
        updatedAt: string;
      }>`
        SELECT
          merge_operation_id as id,
          ticket_id as "ticketId",
          attempt_id as "attemptId",
          status,
          source_head_sha as "sourceHeadSha",
          base_head_before as "baseHeadBefore",
          base_head_after as "baseHeadAfter",
          merge_commit_sha as "mergeCommitSha",
          error_summary as "errorSummary",
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM presence_merge_operations
        WHERE ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
      `;
      for (const merge of mergeRows) {
        yield* upsertRepoBrainEvidence({
          repositoryId,
          dedupeKey: operationMergeKey(merge.id),
          role: merge.status === "failed" ? "contradicts" : "supports",
          source: {
            ticketId: merge.ticketId,
            attemptId: merge.attemptId,
            mergeOperationId: merge.id,
            commitSha: merge.mergeCommitSha ?? merge.sourceHeadSha ?? merge.baseHeadAfter,
          },
          summary: merge.errorSummary ?? `Merge operation ${merge.status}.`,
          confidence: merge.mergeCommitSha || merge.sourceHeadSha ? "high" : "medium",
          observedAt: merge.updatedAt,
          createdAt: merge.createdAt,
        });
      }

      const reviewRows = yield* deps.sql<{
        id: string;
        ticketId: string;
        attemptId: string | null;
        decision: string | null;
        summary: string;
        evidenceJson: string;
        changedFilesJson: string;
        changedFilesReviewedJson: string;
        threadId: string | null;
        createdAt: string;
      }>`
        SELECT
          review_artifact_id as id,
          ticket_id as "ticketId",
          attempt_id as "attemptId",
          decision,
          summary,
          evidence_json as "evidenceJson",
          changed_files_json as "changedFilesJson",
          changed_files_reviewed_json as "changedFilesReviewedJson",
          thread_id as "threadId",
          created_at as "createdAt"
        FROM presence_review_artifacts
        WHERE ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
      `;
      for (const review of reviewRows) {
        const evidence = decodeJson<ReviewEvidenceItem[]>(review.evidenceJson, []);
        const changedFiles = uniqueStrings([
          ...decodeJson<string[]>(review.changedFilesReviewedJson, []),
          ...decodeJson<string[]>(review.changedFilesJson, []),
        ]);
        const commandEvidence = evidence.find((item) => item.kind === "command" && item.target);
        const fileEvidence = evidence.find(
          (item) => (item.kind === "file_inspection" || item.kind === "diff_review") && item.target,
        );
        const sourceDedupeKey = operationReviewArtifactKey(review.id);
        const evidenceId = yield* upsertRepoBrainEvidence({
          repositoryId,
          dedupeKey: sourceDedupeKey,
          role: review.decision === "accept" ? "supports" : "context",
          source: {
            ticketId: review.ticketId,
            attemptId: review.attemptId,
            reviewArtifactId: review.id,
            filePath: fileEvidence?.target ?? changedFiles[0] ?? null,
            command: commandEvidence?.target ?? null,
            test: commandEvidence?.target ?? null,
            threadId: review.threadId,
          },
          summary: review.summary,
          confidence: review.decision === "accept" ? "high" : "medium",
          observedAt: review.createdAt,
          createdAt: review.createdAt,
        });
        if (review.decision === "accept") {
          yield* upsertRepoBrainCandidate({
            repositoryId,
            sourceDedupeKey,
            evidenceId,
            kind: "fact",
            title: `Review accepted ${review.ticketId}`,
            body: [
              "Reviewer-derived candidate. It may describe current implementation state, but it is still unpromoted.",
              review.summary,
              evidence.length > 0
                ? `Evidence: ${evidence.map((item) => item.summary).join("; ")}`
                : null,
            ]
              .filter((value): value is string => value !== null)
              .join("\n"),
            scope: review.attemptId
              ? { type: "attempt", target: review.attemptId }
              : { type: "ticket", target: review.ticketId },
            confidence: "high",
            proposedBy: "reviewer",
            invalidationTriggers: [
              {
                kind: "newer_review",
                target: review.id,
                reason: "A newer review artifact may supersede this accepted review.",
              },
              ...changedFiles.map((filePath) => ({
                kind: "file_changed" as const,
                target: filePath,
                reason: "The reviewed file changed after this candidate was created.",
              })),
            ],
            createdAt: review.createdAt,
          });
        }
      }
      const completedAt = deps.nowIso();
      yield* upsertOperationLedger({
        boardId,
        kind: "repo_brain_projection",
        phase: "project",
        status: "completed",
        dedupeKey: `repo-brain-projection:${boardId}:${startedAt}`,
        summary: "Repo-brain read model projection refreshed.",
        details: {
          repositoryId,
          retention: "Durable ledger rows are kept until the board is deleted.",
        },
        counters: [
          { name: "missionEventsScanned", value: missionRows.length },
          { name: "workerHandoffsScanned", value: workerRows.length },
          { name: "findingsScanned", value: findingRows.length },
          { name: "mergeOperationsScanned", value: mergeRows.length },
          { name: "reviewArtifactsScanned", value: reviewRows.length },
        ],
        startedAt,
        completedAt,
      });
    });

  const refreshTicketMissionState = (input: {
    boardId: string;
    ticketId: string;
    latestEvent?: PresenceMissionEventRecord | null;
  }) =>
    Effect.gen(function* () {
      const ticketRows = yield* deps.sql<{
        status: string;
        title: string;
      }>`
        SELECT status, title
        FROM presence_tickets
        WHERE ticket_id = ${input.ticketId}
        LIMIT 1
      `;
      const ticket = ticketRows[0];
      if (!ticket) return;
      const latestEvent =
        input.latestEvent ??
        (yield* deps.sql<{
          id: string;
          boardId: string;
          ticketId: string | null;
          attemptId: string | null;
          reviewArtifactId: string | null;
          supervisorRunId: string | null;
          threadId: string | null;
          kind: string;
          severity: string;
          summary: string;
          detail: string | null;
          retryBehavior: string;
          humanAction: string | null;
          dedupeKey: string;
          report: string | null;
          createdAt: string;
        }>`
          SELECT
            mission_event_id as id,
            board_id as "boardId",
            ticket_id as "ticketId",
            attempt_id as "attemptId",
            review_artifact_id as "reviewArtifactId",
            supervisor_run_id as "supervisorRunId",
            thread_id as "threadId",
            kind,
            severity,
            summary,
            detail,
            retry_behavior as "retryBehavior",
            human_action as "humanAction",
            dedupe_key as "dedupeKey",
            report_json as report,
            created_at as "createdAt"
          FROM presence_mission_events
          WHERE ticket_id = ${input.ticketId}
          ORDER BY created_at DESC
          LIMIT 1
        `.pipe(Effect.map((rows) => (rows[0] ? mapMissionEvent(rows[0]) : null))));
      const stage =
        ticket.status === "ready_to_merge"
          ? "Ready to merge"
          : ticket.status === "blocked"
            ? "Blocked"
            : ticket.status === "in_review"
              ? "Reviewing"
              : ticket.status === "in_progress"
                ? "In execution"
                : ticket.status === "done"
                  ? "Done"
                  : "Needs setup";
      const needsHuman =
        ticket.status === "blocked" ||
        ticket.status === "ready_to_merge" ||
        latestEvent?.humanAction !== null;
      const humanAction =
        latestEvent?.humanAction ??
        (ticket.status === "ready_to_merge"
          ? "Approve or merge the accepted attempt."
          : ticket.status === "blocked"
            ? "Give Presence direction on the blocker."
            : null);
      const statusLine = latestEvent?.summary ?? `Presence is tracking ${ticket.title}.`;
      const waitingOn =
        humanAction ??
        (ticket.status === "in_review"
          ? "Waiting on reviewer evidence."
          : ticket.status === "in_progress"
            ? "Waiting on worker progress."
            : ticket.status === "todo"
              ? "Waiting for Presence to start the next attempt."
              : "No immediate action needed.");
      const retryBehavior =
        latestEvent?.retryBehavior ?? (needsHuman ? "manual" : "not_applicable");
      const updatedAt = deps.nowIso();
      yield* deps.sql`
        INSERT INTO presence_ticket_mission_state (
          ticket_id, board_id, stage, status_line, waiting_on, latest_event_id,
          latest_event_summary, latest_event_at, needs_human, human_action,
          retry_behavior, updated_at
        ) VALUES (
          ${input.ticketId},
          ${input.boardId},
          ${stage},
          ${statusLine},
          ${waitingOn},
          ${latestEvent?.id ?? null},
          ${latestEvent?.summary ?? null},
          ${latestEvent?.createdAt ?? null},
          ${needsHuman ? 1 : 0},
          ${humanAction},
          ${retryBehavior},
          ${updatedAt}
        )
        ON CONFLICT(ticket_id) DO UPDATE SET
          stage = excluded.stage,
          status_line = excluded.status_line,
          waiting_on = excluded.waiting_on,
          latest_event_id = excluded.latest_event_id,
          latest_event_summary = excluded.latest_event_summary,
          latest_event_at = excluded.latest_event_at,
          needs_human = excluded.needs_human,
          human_action = excluded.human_action,
          retry_behavior = excluded.retry_behavior,
          updated_at = excluded.updated_at
      `;
    });

  const refreshBoardMissionState = (boardId: string) =>
    Effect.gen(function* () {
      const ticketRows = yield* deps.sql<{
        ticketId: string;
        status: string;
      }>`
        SELECT ticket_id as "ticketId", status
        FROM presence_tickets
        WHERE board_id = ${boardId}
      `;
      const stateRows = yield* deps.sql<{
        ticketId: string;
        needsHuman: number | boolean;
      }>`
        SELECT ticket_id as "ticketId", needs_human as "needsHuman"
        FROM presence_ticket_mission_state
        WHERE board_id = ${boardId}
      `;
      const latest = (yield* readRecentMissionEventsForBoard(boardId, 1))[0] ?? null;
      const activeTicketIds = ticketRows
        .filter((ticket) =>
          ["todo", "in_progress", "in_review", "ready_to_merge"].includes(ticket.status),
        )
        .map((ticket) => ticket.ticketId);
      const blockedTicketIds = ticketRows
        .filter((ticket) => ticket.status === "blocked")
        .map((ticket) => ticket.ticketId);
      const humanActionTicketIds = uniqueStrings([
        ...ticketRows
          .filter((ticket) => ticket.status === "blocked" || ticket.status === "ready_to_merge")
          .map((ticket) => ticket.ticketId),
        ...stateRows.filter((state) => Boolean(state.needsHuman)).map((state) => state.ticketId),
      ]);
      const summary =
        humanActionTicketIds.length > 0
          ? `Presence needs direction on ${humanActionTicketIds.length} ticket${humanActionTicketIds.length === 1 ? "" : "s"}.`
          : activeTicketIds.length > 0
            ? `Presence is actively moving ${activeTicketIds.length} ticket${activeTicketIds.length === 1 ? "" : "s"}.`
            : "Presence is ready for the next repo goal.";
      const updatedAt = deps.nowIso();
      yield* deps.sql`
        INSERT INTO presence_board_mission_state (
          board_id, summary, active_ticket_ids_json, blocked_ticket_ids_json,
          human_action_ticket_ids_json, latest_event_id, latest_event_summary,
          latest_event_at, updated_at
        ) VALUES (
          ${boardId},
          ${summary},
          ${encodeJson(activeTicketIds)},
          ${encodeJson(blockedTicketIds)},
          ${encodeJson(humanActionTicketIds)},
          ${latest?.id ?? null},
          ${latest?.summary ?? null},
          ${latest?.createdAt ?? null},
          ${updatedAt}
        )
        ON CONFLICT(board_id) DO UPDATE SET
          summary = excluded.summary,
          active_ticket_ids_json = excluded.active_ticket_ids_json,
          blocked_ticket_ids_json = excluded.blocked_ticket_ids_json,
          human_action_ticket_ids_json = excluded.human_action_ticket_ids_json,
          latest_event_id = excluded.latest_event_id,
          latest_event_summary = excluded.latest_event_summary,
          latest_event_at = excluded.latest_event_at,
          updated_at = excluded.updated_at
      `;
    });

  const writeMissionEvent = (input: {
    boardId: string;
    ticketId?: string | null;
    attemptId?: string | null;
    reviewArtifactId?: string | null;
    supervisorRunId?: string | null;
    threadId?: string | null;
    kind: PresenceMissionEventKind;
    severity?: PresenceMissionSeverity;
    summary: string;
    detail?: string | null;
    retryBehavior?: PresenceMissionRetryBehavior;
    humanAction?: string | null;
    dedupeKey: string;
    report?: PresenceAgentReport | null;
    createdAt?: string;
  }) =>
    Effect.gen(function* () {
      const createdAt = input.createdAt ?? deps.nowIso();
      const missionEventId = MissionEventId.make(`mission_event_${crypto.randomUUID()}`);
      yield* deps.sql`
        INSERT OR IGNORE INTO presence_mission_events (
          mission_event_id, board_id, ticket_id, attempt_id, review_artifact_id,
          supervisor_run_id, thread_id, kind, severity, summary, detail,
          retry_behavior, human_action, dedupe_key, report_json, created_at
        ) VALUES (
          ${missionEventId},
          ${input.boardId},
          ${input.ticketId ?? null},
          ${input.attemptId ?? null},
          ${input.reviewArtifactId ?? null},
          ${input.supervisorRunId ?? null},
          ${input.threadId ?? null},
          ${input.kind},
          ${input.severity ?? "info"},
          ${input.summary},
          ${input.detail ?? null},
          ${input.retryBehavior ?? "not_applicable"},
          ${input.humanAction ?? null},
          ${input.dedupeKey},
          ${input.report ? encodeJson(input.report) : null},
          ${createdAt}
        )
      `;
      const persistedRows = yield* deps.sql<{
        id: string;
        boardId: string;
        ticketId: string | null;
        attemptId: string | null;
        reviewArtifactId: string | null;
        supervisorRunId: string | null;
        threadId: string | null;
        kind: string;
        severity: string;
        summary: string;
        detail: string | null;
        retryBehavior: string;
        humanAction: string | null;
        dedupeKey: string;
        report: string | null;
        createdAt: string;
      }>`
        SELECT
          mission_event_id as id,
          board_id as "boardId",
          ticket_id as "ticketId",
          attempt_id as "attemptId",
          review_artifact_id as "reviewArtifactId",
          supervisor_run_id as "supervisorRunId",
          thread_id as "threadId",
          kind,
          severity,
          summary,
          detail,
          retry_behavior as "retryBehavior",
          human_action as "humanAction",
          dedupe_key as "dedupeKey",
          report_json as report,
          created_at as "createdAt"
        FROM presence_mission_events
        WHERE board_id = ${input.boardId}
          AND dedupe_key = ${input.dedupeKey}
        LIMIT 1
      `;
      const event = mapMissionEvent(persistedRows[0]!);
      if (event.ticketId) {
        yield* refreshTicketMissionState({
          boardId: event.boardId,
          ticketId: event.ticketId,
          latestEvent: event,
        });
      }
      yield* refreshBoardMissionState(event.boardId);
      yield* upsertOperationLedger({
        boardId: event.boardId,
        ticketId: event.ticketId,
        attemptId: event.attemptId,
        reviewArtifactId: event.reviewArtifactId,
        supervisorRunId: event.supervisorRunId,
        threadId: event.threadId,
        kind: operationKindFromMissionEvent(event.kind),
        phase: "observe",
        status: event.severity === "error" ? "failed" : "completed",
        dedupeKey: operationMissionEventKey(event.dedupeKey),
        summary: event.summary,
        details: {
          missionEventId: event.id,
          missionEventKind: event.kind,
          severity: event.severity,
          retryBehavior: event.retryBehavior,
          humanAction: event.humanAction,
          detail: event.detail,
          report: event.report,
        },
        error:
          event.severity === "error"
            ? {
                code: event.kind,
                message: event.summary,
                detail: event.detail,
              }
            : null,
        startedAt: event.createdAt,
        completedAt: event.createdAt,
      });
      yield* refreshRepoBrainReadModelForBoard(event.boardId);
      return event;
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
    mapMissionEvent,
    mapTicketMissionBriefing,
    mapBoardMissionBriefing,
    mapBoardControllerState,
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
    upsertPresenceThreadCorrelation,
    attachSupervisorRunToThreadCorrelation,
    readPresenceThreadCorrelation,
    readRecentMissionEventsForBoard,
    readTicketMissionBriefingsForBoard,
    readBoardMissionBriefing,
    readBoardControllerState,
    upsertBoardControllerState,
    updateGoalIntakeStatus,
    readPendingGoalIntakesForController,
    readControllerWakeBoardIds,
    upsertOperationLedger,
    readRecentOperationLedgerForBoard,
    refreshRepoBrainReadModelForBoard,
    refreshTicketMissionState,
    refreshBoardMissionState,
    writeMissionEvent,
  };
};

export { makePresenceStore };
