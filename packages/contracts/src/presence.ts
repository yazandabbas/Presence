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

export const PresenceTicketStatus = Schema.Literals([
  "backlog",
  "todo",
  "in_progress",
  "in_review",
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

export const PresenceReviewDecisionKind = Schema.Literals([
  "accept",
  "reject",
  "request_changes",
  "escalate",
  "merge_approved",
]);
export type PresenceReviewDecisionKind = typeof PresenceReviewDecisionKind.Type;

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
  confidence: Schema.NullOr(Schema.Number),
  evidenceIds: Schema.Array(EvidenceId),
  createdAt: IsoDateTime,
});
export type WorkerHandoffRecord = typeof WorkerHandoffRecord.Type;

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
  reviewDecisions: Schema.Array(ReviewDecisionRecord),
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
  confidence: Schema.optional(Schema.NullOr(Schema.Number)),
  evidenceIds: Schema.Array(EvidenceId),
});
export type PresenceSaveWorkerHandoffInput = typeof PresenceSaveWorkerHandoffInput.Type;

export const PresenceSaveAttemptEvidenceInput = Schema.Struct({
  attemptId: AttemptId,
  title: TrimmedNonEmptyString,
  kind: TrimmedNonEmptyString,
  content: Schema.String,
});
export type PresenceSaveAttemptEvidenceInput = typeof PresenceSaveAttemptEvidenceInput.Type;

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
    "active attempt summaries",
    "linked knowledge pages",
  ],
  workerReadOrder: [
    "ticket",
    "attempt summary",
    "latest worker handoff",
    "linked evidence",
    "linked knowledge pages",
  ],
};

