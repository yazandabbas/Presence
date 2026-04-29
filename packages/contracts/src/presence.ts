import { Effect, Option, Schema, SchemaIssue } from "effect";

import {
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
export const RepoBrainMemoryId = makePresenceId("RepoBrainMemoryId");
export type RepoBrainMemoryId = typeof RepoBrainMemoryId.Type;
export const RepoBrainEvidenceId = makePresenceId("RepoBrainEvidenceId");
export type RepoBrainEvidenceId = typeof RepoBrainEvidenceId.Type;
export const RepoBrainMemoryReviewId = makePresenceId("RepoBrainMemoryReviewId");
export type RepoBrainMemoryReviewId = typeof RepoBrainMemoryReviewId.Type;
export const PromotionCandidateId = makePresenceId("PromotionCandidateId");
export type PromotionCandidateId = typeof PromotionCandidateId.Type;
export const DeterministicJobId = makePresenceId("DeterministicJobId");
export type DeterministicJobId = typeof DeterministicJobId.Type;
export const ReviewDecisionId = makePresenceId("ReviewDecisionId");
export type ReviewDecisionId = typeof ReviewDecisionId.Type;
export const CapabilityScanId = makePresenceId("CapabilityScanId");
export type CapabilityScanId = typeof CapabilityScanId.Type;
export const GoalIntakeId = makePresenceId("GoalIntakeId");
export type GoalIntakeId = typeof GoalIntakeId.Type;
export const FindingId = makePresenceId("FindingId");
export type FindingId = typeof FindingId.Type;
export const ReviewArtifactId = makePresenceId("ReviewArtifactId");
export type ReviewArtifactId = typeof ReviewArtifactId.Type;
export const ProposedFollowUpId = makePresenceId("ProposedFollowUpId");
export type ProposedFollowUpId = typeof ProposedFollowUpId.Type;
export const SupervisorRunId = makePresenceId("SupervisorRunId");
export type SupervisorRunId = typeof SupervisorRunId.Type;
export const MergeOperationId = makePresenceId("MergeOperationId");
export type MergeOperationId = typeof MergeOperationId.Type;
export const MissionEventId = makePresenceId("MissionEventId");
export type MissionEventId = typeof MissionEventId.Type;
export const PresenceOperationId = makePresenceId("PresenceOperationId");
export type PresenceOperationId = typeof PresenceOperationId.Type;

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

export const RepoBrainMemoryKind = Schema.Literals([
  "fact",
  "decision",
  "workflow",
  "lesson",
  "risk",
]);
export type RepoBrainMemoryKind = typeof RepoBrainMemoryKind.Type;

export const RepoBrainMemoryStatus = Schema.Literals([
  "candidate",
  "accepted",
  "edited",
  "rejected",
  "stale",
  "disputed",
  "historical",
]);
export type RepoBrainMemoryStatus = typeof RepoBrainMemoryStatus.Type;

export const RepoBrainMemoryConfidence = Schema.Literals(["low", "medium", "high"]);
export type RepoBrainMemoryConfidence = typeof RepoBrainMemoryConfidence.Type;

export const RepoBrainTrustMode = Schema.Literals(["deny", "read_only", "read_write"]);
export type RepoBrainTrustMode = typeof RepoBrainTrustMode.Type;

export const RepoBrainMemoryScopeType = Schema.Literals([
  "repo",
  "package",
  "directory",
  "file",
  "symbol",
  "ticket",
  "attempt",
  "historical_only",
]);
export type RepoBrainMemoryScopeType = typeof RepoBrainMemoryScopeType.Type;

export const RepoBrainEvidenceRole = Schema.Literals([
  "supports",
  "contradicts",
  "supersedes",
  "context",
]);
export type RepoBrainEvidenceRole = typeof RepoBrainEvidenceRole.Type;

export const RepoBrainInvalidationTriggerKind = Schema.Literals([
  "file_changed",
  "command_failed",
  "command_removed",
  "newer_attempt",
  "newer_review",
  "finding_opened",
  "ticket_rescoped",
  "human_dispute",
  "source_missing",
  "contract_changed",
  "manual_expiry",
]);
export type RepoBrainInvalidationTriggerKind = typeof RepoBrainInvalidationTriggerKind.Type;

export const RepoBrainMemoryProposedBy = Schema.Literals([
  "worker",
  "reviewer",
  "supervisor",
  "human",
  "deterministic_projection",
]);
export type RepoBrainMemoryProposedBy = typeof RepoBrainMemoryProposedBy.Type;

export const RepoBrainPromotionReviewAction = Schema.Literals([
  "accept",
  "edit_accept",
  "reject",
  "dispute",
  "mark_stale",
  "mark_historical",
]);
export type RepoBrainPromotionReviewAction = typeof RepoBrainPromotionReviewAction.Type;

export const PresencePromotionStatus = Schema.Literals(["pending", "accepted", "rejected"]);
export type PresencePromotionStatus = typeof PresencePromotionStatus.Type;

export const PresenceJobStatus = Schema.Literals([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type PresenceJobStatus = typeof PresenceJobStatus.Type;

export const PresenceMergeOperationStatus = Schema.Literals([
  "pending_git",
  "git_applied",
  "finalized",
  "cleanup_pending",
  "failed",
]);
export type PresenceMergeOperationStatus = typeof PresenceMergeOperationStatus.Type;

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
  "waiting_on_review",
  "apply_review",
  "stable",
]);
export type PresenceSupervisorRunStage = typeof PresenceSupervisorRunStage.Type;

export const PresenceProjectionHealthStatus = Schema.Literals(["healthy", "stale", "repairing"]);
export type PresenceProjectionHealthStatus = typeof PresenceProjectionHealthStatus.Type;

export const PresenceProjectionScopeType = Schema.Literals(["board", "ticket"]);
export type PresenceProjectionScopeType = typeof PresenceProjectionScopeType.Type;

export const PresenceFindingSource = Schema.Literals(["review", "worker_handoff", "supervisor"]);
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

export const PresenceReviewRecommendationKind = Schema.Literals([
  "accept",
  "request_changes",
  "escalate",
]);
export type PresenceReviewRecommendationKind = typeof PresenceReviewRecommendationKind.Type;

export const RepositoryCommandKind = Schema.Literals(["test", "build", "lint", "dev"]);
export type RepositoryCommandKind = typeof RepositoryCommandKind.Type;

export const SupervisorActionKind = Schema.Literals([
  "start_attempt",
  "request_review",
  "request_changes",
  "approve_attempt",
  "merge_attempt",
]);
export type SupervisorActionKind = typeof SupervisorActionKind.Type;

export const PresenceMissionEventKind = Schema.Literals([
  "supervisor_decision",
  "controller_started",
  "controller_tick",
  "controller_action",
  "goal_queued",
  "goal_planning",
  "goal_planned",
  "goal_blocked",
  "runtime_health",
  "provider_unavailable",
  "session_stalled",
  "turn_started",
  "turn_completed",
  "turn_failed",
  "tool_started",
  "tool_completed",
  "approval_requested",
  "user_input_requested",
  "runtime_warning",
  "runtime_error",
  "worker_handoff",
  "review_result",
  "review_failed",
  "retry_queued",
  "merge_updated",
  "projection_repair",
  "human_blocker",
  "human_direction",
]);
export type PresenceMissionEventKind = typeof PresenceMissionEventKind.Type;

export const PresenceMissionSeverity = Schema.Literals(["info", "warning", "error", "success"]);
export type PresenceMissionSeverity = typeof PresenceMissionSeverity.Type;

export const PresenceMissionRetryBehavior = Schema.Literals([
  "automatic",
  "manual",
  "not_retryable",
  "not_applicable",
]);
export type PresenceMissionRetryBehavior = typeof PresenceMissionRetryBehavior.Type;

export const PresenceOperationKind = Schema.Literals([
  "controller_tick",
  "goal_planning",
  "supervisor_run",
  "worker_attempt",
  "review_run",
  "command_dispatch",
  "provider_runtime_observation",
  "projection_sync",
  "repo_brain_projection",
  "merge_operation",
  "human_direction",
]);
export type PresenceOperationKind = typeof PresenceOperationKind.Type;

export const PresenceOperationPhase = Schema.Literals([
  "queued",
  "start",
  "scan",
  "dispatch",
  "execute",
  "persist",
  "project",
  "observe",
  "finish",
]);
export type PresenceOperationPhase = typeof PresenceOperationPhase.Type;

export const PresenceOperationStatus = Schema.Literals([
  "running",
  "completed",
  "failed",
  "skipped",
  "cancelled",
]);
export type PresenceOperationStatus = typeof PresenceOperationStatus.Type;

export const PresenceAgentReportKind = Schema.Literals([
  "worker_progress",
  "reviewer_decision",
  "blocker",
  "evidence",
  "supervisor_decision",
]);
export type PresenceAgentReportKind = typeof PresenceAgentReportKind.Type;

export const GoalIntakeSource = Schema.Literals(["human_goal", "scout"]);
export type GoalIntakeSource = typeof GoalIntakeSource.Type;

export const GoalIntakeStatus = Schema.Literals([
  "queued",
  "planning",
  "planned",
  "blocked",
  "completed",
  "cancelled",
]);
export type GoalIntakeStatus = typeof GoalIntakeStatus.Type;

export const PresenceControllerMode = Schema.Literals(["active", "paused"]);
export type PresenceControllerMode = typeof PresenceControllerMode.Type;

export const PresenceControllerStatus = Schema.Literals([
  "idle",
  "planning",
  "running",
  "waiting_on_worker",
  "waiting_on_review",
  "needs_human",
  "harness_unavailable",
  "paused",
  "error",
]);
export type PresenceControllerStatus = typeof PresenceControllerStatus.Type;

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
  reasoningSource: Schema.NullOr(
    Schema.Literals(["assistant_block", "manual_override", "supervisor", "tool_report"]),
  ),
  reasoningUpdatedAt: Schema.NullOr(IsoDateTime),
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

export const ProjectionHealthRecord = Schema.Struct({
  scopeType: PresenceProjectionScopeType,
  scopeId: TrimmedNonEmptyString,
  status: PresenceProjectionHealthStatus,
  desiredVersion: NonNegativeInt,
  projectedVersion: NonNegativeInt,
  leaseOwner: Schema.NullOr(TrimmedNonEmptyString),
  leaseExpiresAt: Schema.NullOr(IsoDateTime),
  lastAttemptedAt: Schema.NullOr(IsoDateTime),
  lastSucceededAt: Schema.NullOr(IsoDateTime),
  lastErrorMessage: Schema.NullOr(TrimmedNonEmptyString),
  lastErrorPath: Schema.NullOr(TrimmedNonEmptyString),
  dirtyReason: Schema.NullOr(TrimmedNonEmptyString),
  retryAfter: Schema.NullOr(IsoDateTime),
  attemptCount: NonNegativeInt,
  updatedAt: IsoDateTime,
});
export type ProjectionHealthRecord = typeof ProjectionHealthRecord.Type;

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

export const RepoBrainMemoryScope = Schema.Struct({
  type: RepoBrainMemoryScopeType,
  target: Schema.NullOr(TrimmedNonEmptyString),
});
export type RepoBrainMemoryScope = typeof RepoBrainMemoryScope.Type;

export const RepoBrainInvalidationTrigger = Schema.Struct({
  kind: RepoBrainInvalidationTriggerKind,
  target: Schema.NullOr(TrimmedNonEmptyString),
  reason: TrimmedNonEmptyString,
});
export type RepoBrainInvalidationTrigger = typeof RepoBrainInvalidationTrigger.Type;

export const RepoBrainProvenanceSource = Schema.Struct({
  ticketId: Schema.NullOr(TicketId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  attemptId: Schema.NullOr(AttemptId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  missionEventId: Schema.NullOr(MissionEventId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  reviewArtifactId: Schema.NullOr(ReviewArtifactId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  promotionCandidateId: Schema.NullOr(PromotionCandidateId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  handoffId: Schema.NullOr(HandoffId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  findingId: Schema.NullOr(FindingId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  mergeOperationId: Schema.NullOr(MergeOperationId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  filePath: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  command: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  test: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  commitSha: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  threadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
}).check(
  Schema.makeFilter(
    (source) =>
      [
        source.ticketId,
        source.attemptId,
        source.missionEventId,
        source.reviewArtifactId,
        source.promotionCandidateId,
        source.handoffId,
        source.findingId,
        source.mergeOperationId,
        source.filePath,
        source.command,
        source.test,
        source.commitSha,
        source.threadId,
      ].some((value) => value !== null) ||
      new SchemaIssue.InvalidValue(Option.some(source), {
        message: "Repo-brain provenance requires at least one durable source reference.",
      }),
    { identifier: "RepoBrainProvenanceSource" },
  ),
);
export type RepoBrainProvenanceSource = typeof RepoBrainProvenanceSource.Type;

export const RepoBrainEvidenceRecord = Schema.Struct({
  id: RepoBrainEvidenceId,
  repositoryId: RepositoryId,
  memoryId: Schema.NullOr(RepoBrainMemoryId),
  role: RepoBrainEvidenceRole,
  source: RepoBrainProvenanceSource,
  summary: TrimmedNonEmptyString,
  confidence: RepoBrainMemoryConfidence,
  observedAt: IsoDateTime,
  createdAt: IsoDateTime,
});
export type RepoBrainEvidenceRecord = typeof RepoBrainEvidenceRecord.Type;

export const RepoBrainMemoryRecord = Schema.Struct({
  id: RepoBrainMemoryId,
  repositoryId: RepositoryId,
  kind: RepoBrainMemoryKind,
  status: RepoBrainMemoryStatus,
  title: TrimmedNonEmptyString,
  body: Schema.String,
  scope: RepoBrainMemoryScope,
  confidence: RepoBrainMemoryConfidence,
  trustMode: RepoBrainTrustMode,
  sourceEvidenceIds: Schema.Array(RepoBrainEvidenceId),
  invalidationTriggers: Schema.Array(RepoBrainInvalidationTrigger),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  reviewedAt: Schema.NullOr(IsoDateTime),
});
export type RepoBrainMemoryRecord = typeof RepoBrainMemoryRecord.Type;

export const RepoBrainPromotionCandidateRecord = Schema.Struct({
  id: PromotionCandidateId,
  repositoryId: RepositoryId,
  proposedMemoryId: Schema.NullOr(RepoBrainMemoryId),
  predecessorCandidateId: Schema.NullOr(PromotionCandidateId),
  kind: RepoBrainMemoryKind,
  status: RepoBrainMemoryStatus,
  title: TrimmedNonEmptyString,
  body: Schema.String,
  scope: RepoBrainMemoryScope,
  confidence: RepoBrainMemoryConfidence,
  proposedBy: RepoBrainMemoryProposedBy,
  sourceEvidenceIds: Schema.Array(RepoBrainEvidenceId),
  invalidationTriggers: Schema.Array(RepoBrainInvalidationTrigger),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  reviewedAt: Schema.NullOr(IsoDateTime),
});
export type RepoBrainPromotionCandidateRecord = typeof RepoBrainPromotionCandidateRecord.Type;

export const RepoBrainPromotionReviewRecord = Schema.Struct({
  id: RepoBrainMemoryReviewId,
  candidateId: PromotionCandidateId,
  resultingMemoryId: Schema.NullOr(RepoBrainMemoryId),
  action: RepoBrainPromotionReviewAction,
  reviewerKind: Schema.NullOr(PresenceReviewerKind),
  reviewer: Schema.NullOr(TrimmedNonEmptyString),
  reason: TrimmedNonEmptyString,
  finalTitle: Schema.NullOr(TrimmedNonEmptyString),
  finalBody: Schema.NullOr(Schema.String),
  finalScope: Schema.NullOr(RepoBrainMemoryScope),
  finalConfidence: Schema.NullOr(RepoBrainMemoryConfidence),
  finalInvalidationTriggers: Schema.Array(RepoBrainInvalidationTrigger).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  createdAt: IsoDateTime,
});
export type RepoBrainPromotionReviewRecord = typeof RepoBrainPromotionReviewRecord.Type;

export const PresenceOperationCounter = Schema.Struct({
  name: TrimmedNonEmptyString,
  value: NonNegativeInt,
});
export type PresenceOperationCounter = typeof PresenceOperationCounter.Type;

export const PresenceOperationError = Schema.Struct({
  code: Schema.NullOr(TrimmedNonEmptyString),
  message: TrimmedNonEmptyString,
  detail: Schema.NullOr(Schema.String),
});
export type PresenceOperationError = typeof PresenceOperationError.Type;

export const PresenceOperationRecord = Schema.Struct({
  id: PresenceOperationId,
  parentOperationId: Schema.NullOr(PresenceOperationId),
  boardId: Schema.NullOr(BoardId),
  ticketId: Schema.NullOr(TicketId),
  attemptId: Schema.NullOr(AttemptId),
  reviewArtifactId: Schema.NullOr(ReviewArtifactId),
  supervisorRunId: Schema.NullOr(SupervisorRunId),
  threadId: Schema.NullOr(ThreadId),
  kind: PresenceOperationKind,
  phase: PresenceOperationPhase,
  status: PresenceOperationStatus,
  dedupeKey: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  details: Schema.Record(Schema.String, Schema.Unknown),
  counters: Schema.Array(PresenceOperationCounter),
  error: Schema.NullOr(PresenceOperationError),
  startedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  durationMs: Schema.NullOr(NonNegativeInt),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type PresenceOperationRecord = typeof PresenceOperationRecord.Type;

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
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type FindingRecord = typeof FindingRecord.Type;

export const ReviewChecklistAssessmentItem = Schema.Struct({
  label: TrimmedNonEmptyString,
  satisfied: Schema.Boolean,
  notes: Schema.String,
});
export type ReviewChecklistAssessmentItem = typeof ReviewChecklistAssessmentItem.Type;

export const ReviewEvidenceKind = Schema.Literals([
  "file_inspection",
  "diff_review",
  "command",
  "runtime_behavior",
  "reasoning",
]);
export type ReviewEvidenceKind = typeof ReviewEvidenceKind.Type;

export const ReviewEvidenceOutcome = Schema.Literals([
  "passed",
  "failed",
  "not_applicable",
  "inconclusive",
]);
export type ReviewEvidenceOutcome = typeof ReviewEvidenceOutcome.Type;

export const ReviewEvidenceItem = Schema.Struct({
  summary: TrimmedNonEmptyString,
  kind: ReviewEvidenceKind.pipe(Schema.withDecodingDefault(Effect.succeed("reasoning"))),
  target: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  outcome: ReviewEvidenceOutcome.pipe(Schema.withDecodingDefault(Effect.succeed("inconclusive"))),
  relevant: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  details: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});
export type ReviewEvidenceItem = typeof ReviewEvidenceItem.Type;

export const ReviewArtifactRecord = Schema.Struct({
  id: ReviewArtifactId,
  ticketId: TicketId,
  attemptId: Schema.NullOr(AttemptId),
  reviewerKind: PresenceReviewerKind,
  decision: Schema.NullOr(PresenceReviewRecommendationKind),
  summary: TrimmedNonEmptyString,
  checklistJson: Schema.String,
  checklistAssessment: Schema.Array(ReviewChecklistAssessmentItem),
  evidence: Schema.Array(ReviewEvidenceItem),
  changedFiles: Schema.Array(TrimmedNonEmptyString),
  changedFilesReviewed: Schema.Array(TrimmedNonEmptyString),
  findingIds: Schema.Array(FindingId),
  threadId: Schema.NullOr(ThreadId),
  createdAt: IsoDateTime,
});
export type ReviewArtifactRecord = typeof ReviewArtifactRecord.Type;

export const MergeOperationRecord = Schema.Struct({
  id: MergeOperationId,
  ticketId: TicketId,
  attemptId: AttemptId,
  status: PresenceMergeOperationStatus,
  baseBranch: TrimmedNonEmptyString,
  sourceBranch: TrimmedNonEmptyString,
  sourceHeadSha: Schema.NullOr(TrimmedNonEmptyString),
  baseHeadBefore: Schema.NullOr(TrimmedNonEmptyString),
  baseHeadAfter: Schema.NullOr(TrimmedNonEmptyString),
  mergeCommitSha: Schema.NullOr(TrimmedNonEmptyString),
  errorSummary: Schema.NullOr(Schema.String),
  gitAbortAttempted: Schema.Boolean,
  cleanupWorktreeDone: Schema.Boolean,
  cleanupThreadDone: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type MergeOperationRecord = typeof MergeOperationRecord.Type;

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
  riskSignals: Schema.Array(TrimmedNonEmptyString),
  scannedAt: IsoDateTime,
});
export type RepositoryCapabilityScanRecord = typeof RepositoryCapabilityScanRecord.Type;

export const SupervisorPolicyDecision = Schema.Struct({
  action: SupervisorActionKind,
  allowed: Schema.Boolean,
  reasons: Schema.Array(TrimmedNonEmptyString),
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
  status: GoalIntakeStatus.pipe(Schema.withDecodingDefault(Effect.succeed("queued"))),
  plannedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  blockedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  lastError: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime.pipe(
    Schema.withDecodingDefault(Effect.succeed("1970-01-01T00:00:00.000Z")),
  ),
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
  hasMergeFailure: Schema.Boolean,
  hasCleanupPending: Schema.Boolean,
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

export const PresenceAgentReport = Schema.Struct({
  kind: PresenceAgentReportKind,
  summary: TrimmedNonEmptyString,
  details: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  decision: Schema.optional(PresenceReviewDecisionKind),
  evidence: Schema.Array(ReviewEvidenceItem).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  blockers: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  nextAction: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type PresenceAgentReport = typeof PresenceAgentReport.Type;

export const PresenceMissionEventRecord = Schema.Struct({
  id: MissionEventId,
  boardId: BoardId,
  ticketId: Schema.NullOr(TicketId),
  attemptId: Schema.NullOr(AttemptId),
  reviewArtifactId: Schema.NullOr(ReviewArtifactId),
  supervisorRunId: Schema.NullOr(SupervisorRunId),
  threadId: Schema.NullOr(ThreadId),
  kind: PresenceMissionEventKind,
  severity: PresenceMissionSeverity,
  summary: TrimmedNonEmptyString,
  detail: Schema.NullOr(Schema.String),
  retryBehavior: PresenceMissionRetryBehavior,
  humanAction: Schema.NullOr(TrimmedNonEmptyString),
  dedupeKey: TrimmedNonEmptyString,
  report: Schema.NullOr(PresenceAgentReport),
  createdAt: IsoDateTime,
});
export type PresenceMissionEventRecord = typeof PresenceMissionEventRecord.Type;

export const PresenceTicketMissionBriefing = Schema.Struct({
  ticketId: TicketId,
  stage: TrimmedNonEmptyString,
  statusLine: TrimmedNonEmptyString,
  waitingOn: TrimmedNonEmptyString,
  latestEventId: Schema.NullOr(MissionEventId),
  latestEventSummary: Schema.NullOr(TrimmedNonEmptyString),
  latestEventAt: Schema.NullOr(IsoDateTime),
  needsHuman: Schema.Boolean,
  humanAction: Schema.NullOr(TrimmedNonEmptyString),
  retryBehavior: PresenceMissionRetryBehavior,
  updatedAt: IsoDateTime,
});
export type PresenceTicketMissionBriefing = typeof PresenceTicketMissionBriefing.Type;

export const PresenceBoardMissionBriefing = Schema.Struct({
  boardId: BoardId,
  summary: TrimmedNonEmptyString,
  activeTicketIds: Schema.Array(TicketId),
  blockedTicketIds: Schema.Array(TicketId),
  humanActionTicketIds: Schema.Array(TicketId),
  latestEventId: Schema.NullOr(MissionEventId),
  latestEventSummary: Schema.NullOr(TrimmedNonEmptyString),
  latestEventAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
});
export type PresenceBoardMissionBriefing = typeof PresenceBoardMissionBriefing.Type;

export const PresenceBoardControllerState = Schema.Struct({
  boardId: BoardId,
  mode: PresenceControllerMode,
  status: PresenceControllerStatus,
  summary: TrimmedNonEmptyString,
  leaseOwner: Schema.NullOr(TrimmedNonEmptyString),
  leaseExpiresAt: Schema.NullOr(IsoDateTime),
  lastTickAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
});
export type PresenceBoardControllerState = typeof PresenceBoardControllerState.Type;

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
  findings: Schema.Array(FindingRecord),
  reviewArtifacts: Schema.Array(ReviewArtifactRecord),
  mergeOperations: Schema.Array(MergeOperationRecord),
  proposedFollowUps: Schema.Array(ProposedFollowUpRecord),
  ticketSummaries: Schema.Array(TicketSummaryRecord),
  attemptOutcomes: Schema.Array(AttemptOutcomeRecord),
  reviewDecisions: Schema.Array(ReviewDecisionRecord),
  supervisorRuns: Schema.Array(SupervisorRunRecord),
  boardProjectionHealth: Schema.NullOr(ProjectionHealthRecord),
  ticketProjectionHealth: Schema.Array(ProjectionHealthRecord),
  hasStaleProjections: Schema.Boolean,
  capabilityScan: Schema.NullOr(RepositoryCapabilityScanRecord),
  goalIntakes: Schema.Array(GoalIntakeRecord),
  missionBriefing: Schema.NullOr(PresenceBoardMissionBriefing).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  ticketBriefings: Schema.Array(PresenceTicketMissionBriefing).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  missionEvents: Schema.Array(PresenceMissionEventRecord).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  controllerState: Schema.NullOr(PresenceBoardControllerState).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  operationLedger: Schema.Array(PresenceOperationRecord).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  repoBrainMemories: Schema.Array(RepoBrainMemoryRecord).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  repoBrainEvidence: Schema.Array(RepoBrainEvidenceRecord).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  repoBrainPromotionCandidates: Schema.Array(RepoBrainPromotionCandidateRecord).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  repoBrainPromotionReviews: Schema.Array(RepoBrainPromotionReviewRecord).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
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
  reasoningSource: Schema.optional(
    Schema.NullOr(
      Schema.Literals(["assistant_block", "manual_override", "supervisor", "tool_report"]),
    ),
  ),
  reasoningUpdatedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
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
export type PresenceCreateFollowUpProposalInput = typeof PresenceCreateFollowUpProposalInput.Type;

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

export const PresenceSubmitGoalIntakeInput = Schema.Struct({
  boardId: BoardId,
  rawGoal: TrimmedNonEmptyString,
  source: GoalIntakeSource.pipe(Schema.withDecodingDefault(Effect.succeed("human_goal"))),
  priorityHint: Schema.optional(PresenceTicketPriority),
  planNow: Schema.optionalKey(Schema.Boolean),
});
export type PresenceSubmitGoalIntakeInput = typeof PresenceSubmitGoalIntakeInput.Type;

export const GoalIntakeResult = Schema.Struct({
  intake: GoalIntakeRecord,
  createdTickets: Schema.Array(TicketRecord),
  decomposed: Schema.Boolean,
});
export type GoalIntakeResult = typeof GoalIntakeResult.Type;

export const PresenceHumanDirectionKind = Schema.Literals([
  "retry_review_with_codex",
  "start_fresh_attempt",
  "pause_ticket",
  "custom",
]);
export type PresenceHumanDirectionKind = typeof PresenceHumanDirectionKind.Type;

export const PresenceSubmitHumanDirectionInput = Schema.Struct({
  boardId: BoardId,
  ticketId: TicketId,
  attemptId: Schema.optional(Schema.NullOr(AttemptId)),
  directionKind: PresenceHumanDirectionKind,
  instructions: TrimmedNonEmptyString,
  autoContinue: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});
export type PresenceSubmitHumanDirectionInput = typeof PresenceSubmitHumanDirectionInput.Type;

export const PresenceHumanDirectionResult = Schema.Struct({
  missionEvent: PresenceMissionEventRecord,
  supervisorRun: Schema.NullOr(SupervisorRunRecord),
});
export type PresenceHumanDirectionResult = typeof PresenceHumanDirectionResult.Type;

export const PresenceSetControllerModeInput = Schema.Struct({
  boardId: BoardId,
  mode: PresenceControllerMode,
});
export type PresenceSetControllerModeInput = typeof PresenceSetControllerModeInput.Type;

export const PresenceSetControllerModeResult = Schema.Struct({
  controllerState: PresenceBoardControllerState,
});
export type PresenceSetControllerModeResult = typeof PresenceSetControllerModeResult.Type;

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
    "changed files and reviewer validation notes",
  ],
};
