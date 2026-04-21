import { Effect, Schema } from "effect";

import {
  CommandId,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection, ProviderKind } from "./orchestration.ts";

const makePresenceId = <Brand extends string>(brand: Brand) => {
  return TrimmedNonEmptyString.pipe(Schema.brand(brand));
};

export const RepositoryId = makePresenceId("RepositoryId");
export type RepositoryId = typeof RepositoryId.Type;
export const BoardId = makePresenceId("BoardId");
export type BoardId = typeof BoardId.Type;
export const TicketId = makePresenceId("TicketId");
export type TicketId = typeof TicketId.Type;
export const AttemptId = makePresenceId("AttemptId");
export type AttemptId = typeof AttemptId.Type;
export const WorkspaceId = makePresenceId("WorkspaceId");
export type WorkspaceId = typeof WorkspaceId.Type;
export const HandoffId = makePresenceId("HandoffId");
export type HandoffId = typeof HandoffId.Type;
export const EvidenceId = makePresenceId("EvidenceId");
export type EvidenceId = typeof EvidenceId.Type;
export const KnowledgePageId = makePresenceId("KnowledgePageId");
export type KnowledgePageId = typeof KnowledgePageId.Type;
export const PromotionCandidateId = makePresenceId("PromotionCandidateId");
export type PromotionCandidateId = typeof PromotionCandidateId.Type;
export const DeterministicJobId = makePresenceId("DeterministicJobId");
export type DeterministicJobId = typeof DeterministicJobId.Type;
export const ReviewDecisionId = makePresenceId("ReviewDecisionId");
export type ReviewDecisionId = typeof ReviewDecisionId.Type;
export const CapabilityScanId = makePresenceId("CapabilityScanId");
export type CapabilityScanId = typeof CapabilityScanId.Type;
export const ValidationWaiverId = makePresenceId("ValidationWaiverId");
export type ValidationWaiverId = typeof ValidationWaiverId.Type;
export const GoalIntakeId = makePresenceId("GoalIntakeId");
export type GoalIntakeId = typeof GoalIntakeId.Type;
export const ValidationRunId = makePresenceId("ValidationRunId");
export type ValidationRunId = typeof ValidationRunId.Type;
export const FindingId = makePresenceId("FindingId");
export type FindingId = typeof FindingId.Type;
export const ReviewArtifactId = makePresenceId("ReviewArtifactId");
export type ReviewArtifactId = typeof ReviewArtifactId.Type;
export const ProposedFollowUpId = makePresenceId("ProposedFollowUpId");
export type ProposedFollowUpId = typeof ProposedFollowUpId.Type;
export const SupervisorRunId = makePresenceId("SupervisorRunId");
export type SupervisorRunId = typeof SupervisorRunId.Type;

export const PresenceTicketStatus = Schema.Literals([
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "ready_to_merge",
  "blocked",
  "done",
]);
export type PresenceTicketStatus = typeof PresenceTicketStatus.Type;

export const PresenceTicketPriority = Schema.Literals(["p0", "p1", "p2", "p3"]);
export type PresenceTicketPriority = typeof PresenceTicketPriority.Type;

export const PresenceAttemptStatus = Schema.Literals([
  "planned",
  "in_progress",
  "in_review",
  "accepted",
  "merged",
  "rejected",
  "interrupted",
]);
export type PresenceAttemptStatus = typeof PresenceAttemptStatus.Type;

export const PresenceWorkspaceStatus = Schema.Literals([
  "unprepared",
  "ready",
  "busy",
  "error",
  "cleaned_up",
]);
export type PresenceWorkspaceStatus = typeof PresenceWorkspaceStatus.Type;

export const PresenceHandoffRole = Schema.Literals(["supervisor", "worker"]);
export type PresenceHandoffRole = typeof PresenceHandoffRole.Type;

export const PresenceKnowledgeFamily = Schema.Literals([
  "architecture",
  "modules",
  "incidents",
  "bug-patterns",
  "vulnerabilities",
  "runbooks",
  "product-decisions",
  "agent-performance",
  "release-notes",
]);
export type PresenceKnowledgeFamily = typeof PresenceKnowledgeFamily.Type;

export const PresencePromotionStatus = Schema.Literals([
  "pending",
  "accepted",
  "rejected",
]);
export type PresencePromotionStatus = typeof PresencePromotionStatus.Type;

export const PresenceJobStatus = Schema.Literals([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type PresenceJobStatus = typeof PresenceJobStatus.Type;

export const PresenceSupervisorRunStatus = Schema.Literals([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type PresenceSupervisorRunStatus = typeof PresenceSupervisorRunStatus.Type;

export const PresenceSupervisorRunStage = Schema.Literals([
  "plan",
  "waiting_on_worker",
  "validate",
  "waiting_on_review",
  "apply_review",
  "stable",
]);
export type PresenceSupervisorRunStage = typeof PresenceSupervisorRunStage.Type;

export const PresenceValidationRunStatus = Schema.Literals([
  "running",
  "passed",
  "failed",
]);
export type PresenceValidationRunStatus = typeof PresenceValidationRunStatus.Type;

export const PresenceFindingSource = Schema.Literals([
  "validation",
  "review",
  "worker_handoff",
  "supervisor",
]);
export type PresenceFindingSource = typeof PresenceFindingSource.Type;

export const PresenceFindingSeverity = Schema.Literals(["info", "warning", "blocking"]);
export type PresenceFindingSeverity = typeof PresenceFindingSeverity.Type;

export const PresenceFindingDisposition = Schema.Literals([
  "same_ticket",
  "followup_child",
  "blocker",
  "escalate",
]);
export type PresenceFindingDisposition = typeof PresenceFindingDisposition.Type;

export const PresenceFindingStatus = Schema.Literals(["open", "resolved", "dismissed"]);
export type PresenceFindingStatus = typeof PresenceFindingStatus.Type;

export const PresenceReviewerKind = Schema.Literals(["human", "policy", "review_agent"]);
export type PresenceReviewerKind = typeof PresenceReviewerKind.Type;

export const PresenceFollowUpProposalKind = Schema.Literals([
  "child_ticket",
  "blocker_ticket",
  "request_changes",
]);
export type PresenceFollowUpProposalKind = typeof PresenceFollowUpProposalKind.Type;

export const PresenceAttemptOutcomeKind = Schema.Literals([
  "failed_validation",
  "wrong_mechanism",
  "blocked_by_env",
  "abandoned",
  "rejected_review",
  "superseded",
  "merged",
]);
export type PresenceAttemptOutcomeKind = typeof PresenceAttemptOutcomeKind.Type;

export const PresenceReviewDecisionKind = Schema.Literals([
  "accept",
  "reject",
  "request_changes",
  "escalate",
  "merge_approved",
]);
export type PresenceReviewDecisionKind = typeof PresenceReviewDecisionKind.Type;

export const RepositoryCommandKind = Schema.Literals(["test", "build", "lint", "dev"]);
export type RepositoryCommandKind = typeof RepositoryCommandKind.Type;

export const SupervisorActionKind = Schema.Literals([
  "start_attempt",
  "request_review",
  "request_changes",
  "approve_attempt",
  "merge_attempt",
  "record_validation_waiver",
]);
export type SupervisorActionKind = typeof SupervisorActionKind.Type;

export const GoalIntakeSource = Schema.Literals(["human_goal", "scout"]);
export type GoalIntakeSource = typeof GoalIntakeSource.Type;

export const PresenceAcceptanceChecklistItem = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  checked: Schema.Boolean,
});
export type PresenceAcceptanceChecklistItem = typeof PresenceAcceptanceChecklistItem.Type;

export const RepositorySummary = Schema.Struct({
  id: RepositoryId,
  boardId: BoardId,
  projectId: Schema.NullOr(ProjectId),
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  defaultModelSelection: Schema.NullOr(ModelSelection),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type RepositorySummary = typeof RepositorySummary.Type;

export const BoardRecord = Schema.Struct({
  id: BoardId,
  repositoryId: RepositoryId,
  title: TrimmedNonEmptyString,
  sprintFocus: Schema.NullOr(TrimmedNonEmptyString),
  topPrioritySummary: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BoardRecord = typeof BoardRecord.Type;

export const TicketDependency = Schema.Struct({
  ticketId: TicketId,
  dependsOnTicketId: TicketId,
});
export type TicketDependency = typeof TicketDependency.Type;

export const TicketRecord = Schema.Struct({
  id: TicketId,
  boardId: BoardId,
  parentTicketId: Schema.NullOr(TicketId),
  title: TrimmedNonEmptyString,
  description: Schema.String,
  status: PresenceTicketStatus,
  priority: PresenceTicketPriority,
  acceptanceChecklist: Schema.Array(PresenceAcceptanceChecklistItem),
  assignedAttemptId: Schema.NullOr(AttemptId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type TicketRecord = typeof TicketRecord.Type;

export const WorkspaceRecord = Schema.Struct({
  id: WorkspaceId,
  attemptId: AttemptId,
  status: PresenceWorkspaceStatus,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkspaceRecord = typeof WorkspaceRecord.Type;

export const AttemptRecord = Schema.Struct({
  id: AttemptId,
  ticketId: TicketId,
  workspaceId: Schema.NullOr(WorkspaceId),
  title: TrimmedNonEmptyString,
  status: PresenceAttemptStatus,
  provider: Schema.NullOr(ProviderKind),
  model: Schema.NullOr(TrimmedNonEmptyString),
  threadId: Schema.NullOr(ThreadId),
  summary: Schema.NullOr(TrimmedNonEmptyString),
  confidence: Schema.NullOr(Schema.Number),
  lastWorkerHandoffId: Schema.NullOr(HandoffId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type AttemptRecord = typeof AttemptRecord.Type;

export const AttemptOutcomeRecord = Schema.Struct({
  attemptId: AttemptId,
  kind: PresenceAttemptOutcomeKind,
  summary: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type AttemptOutcomeRecord = typeof AttemptOutcomeRecord.Type;

export const AgentSessionRecord = Schema.Struct({
  attemptId: AttemptId,
  threadId: ThreadId,
  provider: ProviderKind,
  model: TrimmedNonEmptyString,
  attachedAt: IsoDateTime,
});
export type AgentSessionRecord = typeof AgentSessionRecord.Type;

export const SupervisorHandoffRecord = Schema.Struct({
  id: HandoffId,
  boardId: BoardId,
  topPriorities: Schema.Array(TrimmedNonEmptyString),
  activeAttemptIds: Schema.Array(AttemptId),
  blockedTicketIds: Schema.Array(TicketId),
  recentDecisions: Schema.Array(TrimmedNonEmptyString),
  nextBoardActions: Schema.Array(TrimmedNonEmptyString),
  currentRunId: Schema.NullOr(SupervisorRunId),
  stage: Schema.NullOr(PresenceSupervisorRunStage),
  resumeProtocol: Schema.Array(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});
export type SupervisorHandoffRecord = typeof SupervisorHandoffRecord.Type;

export const WorkerHandoffRecord = Schema.Struct({
  id: HandoffId,
  attemptId: AttemptId,
  completedWork: Schema.Array(TrimmedNonEmptyString),
  currentHypothesis: Schema.NullOr(TrimmedNonEmptyString),
  changedFiles: Schema.Array(TrimmedNonEmptyString),
  testsRun: Schema.Array(TrimmedNonEmptyString),
  blockers: Schema.Array(TrimmedNonEmptyString),
  nextStep: Schema.NullOr(TrimmedNonEmptyString),
  openQuestions: Schema.Array(TrimmedNonEmptyString),
  retryCount: NonNegativeInt,
  confidence: Schema.NullOr(Schema.Number),
  evidenceIds: Schema.Array(EvidenceId),
  createdAt: IsoDateTime,
});
export type WorkerHandoffRecord = typeof WorkerHandoffRecord.Type;

export const SupervisorRunRecord = Schema.Struct({
  id: SupervisorRunId,
  boardId: BoardId,
  sourceGoalIntakeId: Schema.NullOr(GoalIntakeId),
  scopeTicketIds: Schema.Array(TicketId),
  status: PresenceSupervisorRunStatus,
  stage: PresenceSupervisorRunStage,
  currentTicketId: Schema.NullOr(TicketId),
  activeThreadIds: Schema.Array(ThreadId),
  summary: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type SupervisorRunRecord = typeof SupervisorRunRecord.Type;

export const AttemptSummary = Schema.Struct({
  attempt: AttemptRecord,
  workspace: Schema.NullOr(WorkspaceRecord),
  latestWorkerHandoff: Schema.NullOr(WorkerHandoffRecord),
});
export type AttemptSummary = typeof AttemptSummary.Type;

export const AttemptEvidenceRecord = Schema.Struct({
  id: EvidenceId,
  attemptId: AttemptId,
  title: TrimmedNonEmptyString,
  kind: TrimmedNonEmptyString,
  content: Schema.String,
  createdAt: IsoDateTime,
});
export type AttemptEvidenceRecord = typeof AttemptEvidenceRecord.Type;

export const PromotionCandidateRecord = Schema.Struct({
  id: PromotionCandidateId,
  sourceTicketId: TicketId,
  sourceAttemptId: Schema.NullOr(AttemptId),
  family: PresenceKnowledgeFamily,
  title: TrimmedNonEmptyString,
  slug: TrimmedNonEmptyString,
  compiledTruth: Schema.String,
  timelineEntry: Schema.String,
  status: PresencePromotionStatus,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type PromotionCandidateRecord = typeof PromotionCandidateRecord.Type;

export const KnowledgePageRecord = Schema.Struct({
  id: KnowledgePageId,
  boardId: BoardId,
  family: PresenceKnowledgeFamily,
  slug: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  compiledTruth: Schema.String,
  timeline: Schema.String,
  linkedTicketIds: Schema.Array(TicketId),
  updatedAt: IsoDateTime,
  createdAt: IsoDateTime,
});
export type KnowledgePageRecord = typeof KnowledgePageRecord.Type;

export const DeterministicJobRecord = Schema.Struct({
  id: DeterministicJobId,
  boardId: BoardId,
  title: TrimmedNonEmptyString,
  kind: TrimmedNonEmptyString,
  status: PresenceJobStatus,
  progress: NonNegativeInt,
  outputSummary: Schema.NullOr(TrimmedNonEmptyString),
  errorMessage: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type DeterministicJobRecord = typeof DeterministicJobRecord.Type;

export const ValidationRunRecord = Schema.Struct({
  id: ValidationRunId,
  batchId: TrimmedNonEmptyString,
  attemptId: AttemptId,
  ticketId: TicketId,
  commandKind: RepositoryCommandKind,
  command: TrimmedNonEmptyString,
  status: PresenceValidationRunStatus,
  exitCode: Schema.NullOr(Schema.Int),
  stdoutSummary: Schema.NullOr(Schema.String),
  stderrSummary: Schema.NullOr(Schema.String),
  startedAt: IsoDateTime,
  finishedAt: Schema.NullOr(IsoDateTime),
});
export type ValidationRunRecord = typeof ValidationRunRecord.Type;

export const FindingRecord = Schema.Struct({
  id: FindingId,
  ticketId: TicketId,
  attemptId: Schema.NullOr(AttemptId),
  source: PresenceFindingSource,
  severity: PresenceFindingSeverity,
  disposition: PresenceFindingDisposition,
  status: PresenceFindingStatus,
  summary: TrimmedNonEmptyString,
  rationale: Schema.String,
  evidenceIds: Schema.Array(EvidenceId),
  validationBatchId: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type FindingRecord = typeof FindingRecord.Type;

export const ReviewArtifactRecord = Schema.Struct({
  id: ReviewArtifactId,
  ticketId: TicketId,
  attemptId: Schema.NullOr(AttemptId),
  reviewerKind: PresenceReviewerKind,
  summary: TrimmedNonEmptyString,
  checklistJson: Schema.String,
  changedFiles: Schema.Array(TrimmedNonEmptyString),
  findingIds: Schema.Array(FindingId),
  threadId: Schema.NullOr(ThreadId),
  createdAt: IsoDateTime,
});
export type ReviewArtifactRecord = typeof ReviewArtifactRecord.Type;

export const ProposedFollowUpRecord = Schema.Struct({
  id: ProposedFollowUpId,
  parentTicketId: TicketId,
  originatingAttemptId: Schema.NullOr(AttemptId),
  kind: PresenceFollowUpProposalKind,
  title: TrimmedNonEmptyString,
  description: Schema.String,
  priority: PresenceTicketPriority,
  status: PresenceFindingStatus,
  findingIds: Schema.Array(FindingId),
  requiresHumanConfirmation: Schema.Boolean,
  createdTicketId: Schema.NullOr(TicketId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProposedFollowUpRecord = typeof ProposedFollowUpRecord.Type;

export const RepositoryCapabilityCommand = Schema.Struct({
  kind: RepositoryCommandKind,
  command: TrimmedNonEmptyString,
  source: TrimmedNonEmptyString,
});
export type RepositoryCapabilityCommand = typeof RepositoryCapabilityCommand.Type;

export const RepositoryCapabilityScanRecord = Schema.Struct({
  id: CapabilityScanId,
  repositoryId: RepositoryId,
  boardId: BoardId,
  baseBranch: Schema.NullOr(TrimmedNonEmptyString),
  upstreamRef: Schema.NullOr(TrimmedNonEmptyString),
  hasRemote: Schema.Boolean,
  isClean: Schema.Boolean,
  ecosystems: Schema.Array(TrimmedNonEmptyString),
  markers: Schema.Array(TrimmedNonEmptyString),
  discoveredCommands: Schema.Array(RepositoryCapabilityCommand),
  hasValidationCapability: Schema.Boolean,
  riskSignals: Schema.Array(TrimmedNonEmptyString),
  scannedAt: IsoDateTime,
});
export type RepositoryCapabilityScanRecord = typeof RepositoryCapabilityScanRecord.Type;

export const ValidationWaiverRecord = Schema.Struct({
  id: ValidationWaiverId,
  ticketId: TicketId,
  attemptId: Schema.NullOr(AttemptId),
  reason: TrimmedNonEmptyString,
  grantedBy: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});
export type ValidationWaiverRecord = typeof ValidationWaiverRecord.Type;

export const SupervisorPolicyDecision = Schema.Struct({
  action: SupervisorActionKind,
  allowed: Schema.Boolean,
  reasons: Schema.Array(TrimmedNonEmptyString),
  requiresHumanValidationWaiver: Schema.Boolean,
  requiresHumanMerge: Schema.Boolean,
  recommendedTicketStatus: Schema.NullOr(PresenceTicketStatus),
  recommendedAttemptStatus: Schema.NullOr(PresenceAttemptStatus),
});
export type SupervisorPolicyDecision = typeof SupervisorPolicyDecision.Type;

export const GoalIntakeRecord = Schema.Struct({
  id: GoalIntakeId,
  boardId: BoardId,
  source: GoalIntakeSource,
  rawGoal: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  createdTicketIds: Schema.Array(TicketId),
  createdAt: IsoDateTime,
});
export type GoalIntakeRecord = typeof GoalIntakeRecord.Type;

export const TicketSummaryRecord = Schema.Struct({
  ticketId: TicketId,
  currentMechanism: Schema.NullOr(TrimmedNonEmptyString),
  triedAcrossAttempts: Schema.Array(TrimmedNonEmptyString),
  failedWhy: Schema.Array(TrimmedNonEmptyString),
  openFindings: Schema.Array(TrimmedNonEmptyString),
  nextStep: Schema.NullOr(TrimmedNonEmptyString),
  activeAttemptId: Schema.NullOr(AttemptId),
  blocked: Schema.Boolean,
  escalated: Schema.Boolean,
  hasFollowUpProposal: Schema.Boolean,
});
export type TicketSummaryRecord = typeof TicketSummaryRecord.Type;

export const ReviewDecisionRecord = Schema.Struct({
  id: ReviewDecisionId,
  ticketId: TicketId,
  attemptId: Schema.NullOr(AttemptId),
  decision: PresenceReviewDecisionKind,
  notes: Schema.String,
  createdAt: IsoDateTime,
});
export type ReviewDecisionRecord = typeof ReviewDecisionRecord.Type;

export const BoardSnapshot = Schema.Struct({
  repository: RepositorySummary,
  board: BoardRecord,
  tickets: Schema.Array(TicketRecord),
  dependencies: Schema.Array(TicketDependency),
  attempts: Schema.Array(AttemptRecord),
  workspaces: Schema.Array(WorkspaceRecord),
  attemptSummaries: Schema.Array(AttemptSummary),
  supervisorHandoff: Schema.NullOr(SupervisorHandoffRecord),
  evidence: Schema.Array(AttemptEvidenceRecord),
  promotionCandidates: Schema.Array(PromotionCandidateRecord),
  knowledgePages: Schema.Array(KnowledgePageRecord),
  jobs: Schema.Array(DeterministicJobRecord),
  validationRuns: Schema.Array(ValidationRunRecord),
  findings: Schema.Array(FindingRecord),
  reviewArtifacts: Schema.Array(ReviewArtifactRecord),
  proposedFollowUps: Schema.Array(ProposedFollowUpRecord),
  ticketSummaries: Schema.Array(TicketSummaryRecord),
  attemptOutcomes: Schema.Array(AttemptOutcomeRecord),
  reviewDecisions: Schema.Array(ReviewDecisionRecord),
  supervisorRuns: Schema.Array(SupervisorRunRecord),
  capabilityScan: Schema.NullOr(RepositoryCapabilityScanRecord),
  validationWaivers: Schema.Array(ValidationWaiverRecord),
  goalIntakes: Schema.Array(GoalIntakeRecord),
});
export type BoardSnapshot = typeof BoardSnapshot.Type;

export class PresenceRpcError extends Schema.TaggedErrorClass<PresenceRpcError>()(
  "PresenceRpcError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const PresenceListRepositoriesInput = Schema.Struct({});
export type PresenceListRepositoriesInput = typeof PresenceListRepositoriesInput.Type;

export const PresenceImportRepositoryInput = Schema.Struct({
  workspaceRoot: TrimmedNonEmptyString,
  title: Schema.optional(TrimmedNonEmptyString),
});
export type PresenceImportRepositoryInput = typeof PresenceImportRepositoryInput.Type;

export const PresenceGetBoardSnapshotInput = Schema.Struct({
  boardId: BoardId,
});
export type PresenceGetBoardSnapshotInput = typeof PresenceGetBoardSnapshotInput.Type;

export const PresenceGetRepositoryCapabilitiesInput = Schema.Struct({
  repositoryId: RepositoryId,
});
export type PresenceGetRepositoryCapabilitiesInput =
  typeof PresenceGetRepositoryCapabilitiesInput.Type;

export const PresenceScanRepositoryCapabilitiesInput = Schema.Struct({
  repositoryId: RepositoryId,
});
export type PresenceScanRepositoryCapabilitiesInput =
  typeof PresenceScanRepositoryCapabilitiesInput.Type;

export const PresenceCreateTicketInput = Schema.Struct({
  boardId: BoardId,
  title: TrimmedNonEmptyString,
  description: Schema.String,
  priority: PresenceTicketPriority.pipe(Schema.withDecodingDefault(Effect.succeed("p2"))),
  acceptanceChecklist: Schema.optional(Schema.Array(PresenceAcceptanceChecklistItem)),
});
export type PresenceCreateTicketInput = typeof PresenceCreateTicketInput.Type;

export const PresenceUpdateTicketInput = Schema.Struct({
  ticketId: TicketId,
  title: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(Schema.String),
  status: Schema.optional(PresenceTicketStatus),
  priority: Schema.optional(PresenceTicketPriority),
  acceptanceChecklist: Schema.optional(Schema.Array(PresenceAcceptanceChecklistItem)),
});
export type PresenceUpdateTicketInput = typeof PresenceUpdateTicketInput.Type;

export const PresenceCreateAttemptInput = Schema.Struct({
  ticketId: TicketId,
  title: Schema.optional(TrimmedNonEmptyString),
});
export type PresenceCreateAttemptInput = typeof PresenceCreateAttemptInput.Type;

export const PresencePrepareWorkspaceInput = Schema.Struct({
  attemptId: AttemptId,
  branch: Schema.optional(TrimmedNonEmptyString),
});
export type PresencePrepareWorkspaceInput = typeof PresencePrepareWorkspaceInput.Type;

export const PresenceCleanupWorkspaceInput = Schema.Struct({
  attemptId: AttemptId,
  force: Schema.optional(Schema.Boolean),
});
export type PresenceCleanupWorkspaceInput = typeof PresenceCleanupWorkspaceInput.Type;

export const PresenceStartAttemptSessionInput = Schema.Struct({
  attemptId: AttemptId,
  provider: Schema.optional(ProviderKind),
  model: Schema.optional(TrimmedNonEmptyString),
});
export type PresenceStartAttemptSessionInput = typeof PresenceStartAttemptSessionInput.Type;

export const PresenceSaveSupervisorHandoffInput = Schema.Struct({
  boardId: BoardId,
  topPriorities: Schema.Array(TrimmedNonEmptyString),
  activeAttemptIds: Schema.Array(AttemptId),
  blockedTicketIds: Schema.Array(TicketId),
  recentDecisions: Schema.Array(TrimmedNonEmptyString),
  nextBoardActions: Schema.Array(TrimmedNonEmptyString),
  currentRunId: Schema.optional(Schema.NullOr(SupervisorRunId)),
  stage: Schema.optional(Schema.NullOr(PresenceSupervisorRunStage)),
  resumeProtocol: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});
export type PresenceSaveSupervisorHandoffInput = typeof PresenceSaveSupervisorHandoffInput.Type;

export const PresenceSaveWorkerHandoffInput = Schema.Struct({
  attemptId: AttemptId,
  completedWork: Schema.Array(TrimmedNonEmptyString),
  currentHypothesis: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  changedFiles: Schema.Array(TrimmedNonEmptyString),
  testsRun: Schema.Array(TrimmedNonEmptyString),
  blockers: Schema.Array(TrimmedNonEmptyString),
  nextStep: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  openQuestions: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  retryCount: Schema.optional(NonNegativeInt),
  confidence: Schema.optional(Schema.NullOr(Schema.Number)),
  evidenceIds: Schema.Array(EvidenceId),
});
export type PresenceSaveWorkerHandoffInput = typeof PresenceSaveWorkerHandoffInput.Type;

export const PresenceStartSupervisorRunInput = Schema.Struct({
  boardId: BoardId,
  goalIntakeId: Schema.optional(Schema.NullOr(GoalIntakeId)),
  ticketIds: Schema.optional(Schema.Array(TicketId)),
});
export type PresenceStartSupervisorRunInput = typeof PresenceStartSupervisorRunInput.Type;

export const PresenceCancelSupervisorRunInput = Schema.Struct({
  runId: SupervisorRunId,
});
export type PresenceCancelSupervisorRunInput = typeof PresenceCancelSupervisorRunInput.Type;

export const PresenceSaveAttemptEvidenceInput = Schema.Struct({
  attemptId: AttemptId,
  title: TrimmedNonEmptyString,
  kind: TrimmedNonEmptyString,
  content: Schema.String,
});
export type PresenceSaveAttemptEvidenceInput = typeof PresenceSaveAttemptEvidenceInput.Type;

export const PresenceRunAttemptValidationInput = Schema.Struct({
  attemptId: AttemptId,
});
export type PresenceRunAttemptValidationInput = typeof PresenceRunAttemptValidationInput.Type;

export const PresenceResolveFindingInput = Schema.Struct({
  findingId: FindingId,
});
export type PresenceResolveFindingInput = typeof PresenceResolveFindingInput.Type;

export const PresenceDismissFindingInput = Schema.Struct({
  findingId: FindingId,
});
export type PresenceDismissFindingInput = typeof PresenceDismissFindingInput.Type;

export const PresenceCreateFollowUpProposalInput = Schema.Struct({
  parentTicketId: TicketId,
  originatingAttemptId: Schema.optional(AttemptId),
  kind: PresenceFollowUpProposalKind,
  title: TrimmedNonEmptyString,
  description: Schema.String,
  priority: PresenceTicketPriority.pipe(Schema.withDecodingDefault(Effect.succeed("p2"))),
  findingIds: Schema.Array(FindingId).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type PresenceCreateFollowUpProposalInput =
  typeof PresenceCreateFollowUpProposalInput.Type;

export const PresenceMaterializeFollowUpInput = Schema.Struct({
  proposalId: ProposedFollowUpId,
});
export type PresenceMaterializeFollowUpInput = typeof PresenceMaterializeFollowUpInput.Type;

export const PresenceSyncTicketProjectionInput = Schema.Struct({
  ticketId: TicketId,
});
export type PresenceSyncTicketProjectionInput = typeof PresenceSyncTicketProjectionInput.Type;

export const PresenceSyncBrainProjectionInput = Schema.Struct({
  boardId: BoardId,
});
export type PresenceSyncBrainProjectionInput = typeof PresenceSyncBrainProjectionInput.Type;

export const PresenceUpsertKnowledgePageInput = Schema.Struct({
  boardId: BoardId,
  family: PresenceKnowledgeFamily,
  slug: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  compiledTruth: Schema.String,
  timeline: Schema.String,
  linkedTicketIds: Schema.Array(TicketId),
});
export type PresenceUpsertKnowledgePageInput = typeof PresenceUpsertKnowledgePageInput.Type;

export const PresenceCreatePromotionCandidateInput = Schema.Struct({
  sourceTicketId: TicketId,
  sourceAttemptId: Schema.optional(Schema.NullOr(AttemptId)),
  family: PresenceKnowledgeFamily,
  title: TrimmedNonEmptyString,
  slug: TrimmedNonEmptyString,
  compiledTruth: Schema.String,
  timelineEntry: Schema.String,
});
export type PresenceCreatePromotionCandidateInput =
  typeof PresenceCreatePromotionCandidateInput.Type;

export const PresenceReviewPromotionCandidateInput = Schema.Struct({
  promotionCandidateId: PromotionCandidateId,
  status: PresencePromotionStatus,
});
export type PresenceReviewPromotionCandidateInput =
  typeof PresenceReviewPromotionCandidateInput.Type;

export const PresenceCreateDeterministicJobInput = Schema.Struct({
  boardId: BoardId,
  title: TrimmedNonEmptyString,
  kind: TrimmedNonEmptyString,
});
export type PresenceCreateDeterministicJobInput = typeof PresenceCreateDeterministicJobInput.Type;

export const PresenceEvaluateSupervisorActionInput = Schema.Struct({
  action: SupervisorActionKind,
  ticketId: TicketId,
  attemptId: Schema.optional(Schema.NullOr(AttemptId)),
});
export type PresenceEvaluateSupervisorActionInput =
  typeof PresenceEvaluateSupervisorActionInput.Type;

export const PresenceRecordValidationWaiverInput = Schema.Struct({
  ticketId: TicketId,
  attemptId: Schema.optional(Schema.NullOr(AttemptId)),
  reason: TrimmedNonEmptyString,
  grantedBy: TrimmedNonEmptyString.pipe(Schema.withDecodingDefault(Effect.succeed("human"))),
});
export type PresenceRecordValidationWaiverInput = typeof PresenceRecordValidationWaiverInput.Type;

export const PresenceSubmitGoalIntakeInput = Schema.Struct({
  boardId: BoardId,
  rawGoal: TrimmedNonEmptyString,
  source: GoalIntakeSource.pipe(Schema.withDecodingDefault(Effect.succeed("human_goal"))),
  priorityHint: Schema.optional(PresenceTicketPriority),
});
export type PresenceSubmitGoalIntakeInput = typeof PresenceSubmitGoalIntakeInput.Type;

export const GoalIntakeResult = Schema.Struct({
  intake: GoalIntakeRecord,
  createdTickets: Schema.Array(TicketRecord),
  decomposed: Schema.Boolean,
});
export type GoalIntakeResult = typeof GoalIntakeResult.Type;

export const PresenceSubmitReviewDecisionInput = Schema.Struct({
  ticketId: TicketId,
  attemptId: Schema.optional(Schema.NullOr(AttemptId)),
  decision: PresenceReviewDecisionKind,
  notes: Schema.String,
});
export type PresenceSubmitReviewDecisionInput = typeof PresenceSubmitReviewDecisionInput.Type;

export const PresenceAttachThreadInput = Schema.Struct({
  attemptId: AttemptId,
  threadId: ThreadId,
});
export type PresenceAttachThreadInput = typeof PresenceAttachThreadInput.Type;

export const PresenceResumeProtocol = Schema.Struct({
  supervisorReadOrder: Schema.Array(TrimmedNonEmptyString),
  workerReadOrder: Schema.Array(TrimmedNonEmptyString),
});
export type PresenceResumeProtocol = typeof PresenceResumeProtocol.Type;

export const DEFAULT_PRESENCE_RESUME_PROTOCOL: PresenceResumeProtocol = {
  supervisorReadOrder: [
    "board snapshot",
    "latest supervisor handoff",
    "active ticket summaries",
    "relevant brain pages",
  ],
  workerReadOrder: [
    "ticket",
    "ticket current summary",
    "attempt progress",
    "attempt decisions",
    "attempt blockers",
    "attempt findings",
    "changed files and validation output",
  ],
};
