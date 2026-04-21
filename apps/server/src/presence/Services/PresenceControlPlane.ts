import type {
  BoardId,
  BoardSnapshot,
  GoalIntakeResult,
  DeterministicJobRecord,
  PresenceEvaluateSupervisorActionInput,
  PresenceGetRepositoryCapabilitiesInput,
  PresenceRunAttemptValidationInput,
  PresenceAttachThreadInput,
  PresenceCleanupWorkspaceInput,
  PresenceCreateAttemptInput,
  PresenceCreateDeterministicJobInput,
  PresenceCreatePromotionCandidateInput,
  PresenceRecordValidationWaiverInput,
  PresenceScanRepositoryCapabilitiesInput,
  PresencePrepareWorkspaceInput,
  PresenceCreateTicketInput,
  PresenceGetBoardSnapshotInput,
  PresenceImportRepositoryInput,
  PresenceListRepositoriesInput,
  PresenceReviewPromotionCandidateInput,
  PresenceSubmitGoalIntakeInput,
  PresenceSaveAttemptEvidenceInput,
  PresenceSaveSupervisorHandoffInput,
  PresenceSaveWorkerHandoffInput,
  PresenceStartAttemptSessionInput,
  PresenceSubmitReviewDecisionInput,
  PresenceUpdateTicketInput,
  PromotionCandidateRecord,
  RepositoryCapabilityScanRecord,
  RepositorySummary,
  ReviewDecisionRecord,
  SupervisorPolicyDecision,
  SupervisorHandoffRecord,
  ValidationRunRecord,
  ValidationWaiverRecord,
  WorkerHandoffRecord,
  AttemptEvidenceRecord,
  AttemptRecord,
  TicketRecord,
  KnowledgePageRecord,
  PresenceUpsertKnowledgePageInput,
  AgentSessionRecord,
  WorkspaceRecord,
} from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

import type { PresenceRpcError } from "@t3tools/contracts";

export interface PresenceControlPlaneShape {
  readonly listRepositories: (
    input: PresenceListRepositoriesInput,
  ) => Effect.Effect<ReadonlyArray<RepositorySummary>, PresenceRpcError, never>;
  readonly importRepository: (
    input: PresenceImportRepositoryInput,
  ) => Effect.Effect<RepositorySummary, PresenceRpcError, never>;
  readonly getBoardSnapshot: (
    input: PresenceGetBoardSnapshotInput,
  ) => Effect.Effect<BoardSnapshot, PresenceRpcError, never>;
  readonly getRepositoryCapabilities: (
    input: PresenceGetRepositoryCapabilitiesInput,
  ) => Effect.Effect<RepositoryCapabilityScanRecord | null, PresenceRpcError, never>;
  readonly scanRepositoryCapabilities: (
    input: PresenceScanRepositoryCapabilitiesInput,
  ) => Effect.Effect<RepositoryCapabilityScanRecord, PresenceRpcError, never>;
  readonly createTicket: (
    input: PresenceCreateTicketInput,
  ) => Effect.Effect<TicketRecord, PresenceRpcError, never>;
  readonly updateTicket: (
    input: PresenceUpdateTicketInput,
  ) => Effect.Effect<TicketRecord, PresenceRpcError, never>;
  readonly createAttempt: (
    input: PresenceCreateAttemptInput,
  ) => Effect.Effect<AttemptRecord, PresenceRpcError, never>;
  readonly prepareWorkspace: (
    input: PresencePrepareWorkspaceInput,
  ) => Effect.Effect<WorkspaceRecord, PresenceRpcError, never>;
  readonly cleanupWorkspace: (
    input: PresenceCleanupWorkspaceInput,
  ) => Effect.Effect<WorkspaceRecord, PresenceRpcError, never>;
  readonly startAttemptSession: (
    input: PresenceStartAttemptSessionInput,
  ) => Effect.Effect<AgentSessionRecord, PresenceRpcError, never>;
  readonly attachThreadToAttempt: (
    input: PresenceAttachThreadInput,
  ) => Effect.Effect<AttemptRecord, PresenceRpcError, never>;
  readonly saveSupervisorHandoff: (
    input: PresenceSaveSupervisorHandoffInput,
  ) => Effect.Effect<SupervisorHandoffRecord, PresenceRpcError, never>;
  readonly saveWorkerHandoff: (
    input: PresenceSaveWorkerHandoffInput,
  ) => Effect.Effect<WorkerHandoffRecord, PresenceRpcError, never>;
  readonly saveAttemptEvidence: (
    input: PresenceSaveAttemptEvidenceInput,
  ) => Effect.Effect<AttemptEvidenceRecord, PresenceRpcError, never>;
  readonly runAttemptValidation: (
    input: PresenceRunAttemptValidationInput,
  ) => Effect.Effect<ReadonlyArray<ValidationRunRecord>, PresenceRpcError, never>;
  readonly upsertKnowledgePage: (
    input: PresenceUpsertKnowledgePageInput,
  ) => Effect.Effect<KnowledgePageRecord, PresenceRpcError, never>;
  readonly createPromotionCandidate: (
    input: PresenceCreatePromotionCandidateInput,
  ) => Effect.Effect<PromotionCandidateRecord, PresenceRpcError, never>;
  readonly reviewPromotionCandidate: (
    input: PresenceReviewPromotionCandidateInput,
  ) => Effect.Effect<PromotionCandidateRecord, PresenceRpcError, never>;
  readonly createDeterministicJob: (
    input: PresenceCreateDeterministicJobInput,
  ) => Effect.Effect<DeterministicJobRecord, PresenceRpcError, never>;
  readonly evaluateSupervisorAction: (
    input: PresenceEvaluateSupervisorActionInput,
  ) => Effect.Effect<SupervisorPolicyDecision, PresenceRpcError, never>;
  readonly recordValidationWaiver: (
    input: PresenceRecordValidationWaiverInput,
  ) => Effect.Effect<ValidationWaiverRecord, PresenceRpcError, never>;
  readonly submitGoalIntake: (
    input: PresenceSubmitGoalIntakeInput,
  ) => Effect.Effect<GoalIntakeResult, PresenceRpcError, never>;
  readonly submitReviewDecision: (
    input: PresenceSubmitReviewDecisionInput,
  ) => Effect.Effect<ReviewDecisionRecord, PresenceRpcError, never>;
}

export class PresenceControlPlane extends Context.Service<
  PresenceControlPlane,
  PresenceControlPlaneShape
>()("presence/Services/PresenceControlPlane") {}
