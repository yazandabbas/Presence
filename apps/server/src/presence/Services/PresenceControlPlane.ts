import type {
  BoardId,
  BoardSnapshot,
  DeterministicJobRecord,
  PresenceAttachThreadInput,
  PresenceCreateAttemptInput,
  PresenceCreateDeterministicJobInput,
  PresenceCreatePromotionCandidateInput,
  PresenceCreateTicketInput,
  PresenceGetBoardSnapshotInput,
  PresenceImportRepositoryInput,
  PresenceListRepositoriesInput,
  PresenceReviewPromotionCandidateInput,
  PresenceSaveAttemptEvidenceInput,
  PresenceSaveSupervisorHandoffInput,
  PresenceSaveWorkerHandoffInput,
  PresenceStartAttemptSessionInput,
  PresenceSubmitReviewDecisionInput,
  PresenceUpdateTicketInput,
  PromotionCandidateRecord,
  RepositorySummary,
  ReviewDecisionRecord,
  SupervisorHandoffRecord,
  WorkerHandoffRecord,
  AttemptEvidenceRecord,
  AttemptRecord,
  TicketRecord,
  KnowledgePageRecord,
  PresenceUpsertKnowledgePageInput,
  AgentSessionRecord,
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
  readonly createTicket: (
    input: PresenceCreateTicketInput,
  ) => Effect.Effect<TicketRecord, PresenceRpcError, never>;
  readonly updateTicket: (
    input: PresenceUpdateTicketInput,
  ) => Effect.Effect<TicketRecord, PresenceRpcError, never>;
  readonly createAttempt: (
    input: PresenceCreateAttemptInput,
  ) => Effect.Effect<AttemptRecord, PresenceRpcError, never>;
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
  readonly submitReviewDecision: (
    input: PresenceSubmitReviewDecisionInput,
  ) => Effect.Effect<ReviewDecisionRecord, PresenceRpcError, never>;
}

export class PresenceControlPlane extends Context.Service<
  PresenceControlPlane,
  PresenceControlPlaneShape
>()("presence/Services/PresenceControlPlane") {}

