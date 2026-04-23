import type { PresenceControlPlaneShape } from "../../Services/PresenceControlPlane.ts";
import type {
  PresenceAttemptOutcomeKind,
  PresenceFindingSource,
  ModelSelection,
  PresenceFindingDisposition,
  PresenceFindingSeverity,
  PresenceReviewDecisionKind,
  PresenceReviewRecommendationKind,
  ReviewChecklistAssessmentItem,
  ReviewEvidenceItem,
  FindingRecord,
  MergeOperationRecord,
  ReviewArtifactRecord,
  WorkerHandoffRecord,
} from "@t3tools/contracts";
import type {
  ParsedPresenceReviewFinding,
  ParsedPresenceReviewResult,
} from "./PresenceShared.ts";

import type { GitCore } from "../../../git/Services/GitCore.ts";
import type { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import type { ProviderRegistry } from "../../../provider/Services/ProviderRegistry.ts";
import type { SupervisorPolicy } from "../../Services/SupervisorPolicy.ts";

type PickMethods<K extends keyof PresenceControlPlaneShape> = Pick<PresenceControlPlaneShape, K>;

type PresenceStore = Readonly<Record<string, unknown>>;

type PresenceProjectionRuntime = Readonly<{
  syncBoardProjectionBestEffort: unknown;
  syncTicketProjectionBestEffort: unknown;
  syncProjectionStrict: unknown;
  runProjectionWorker: unknown;
}>;

type PresencePrompting = Readonly<{
  buildAttemptBootstrapPrompt: unknown;
  buildReviewWorkerPrompt: unknown;
  buildReviewWorkerSystemPrompt: unknown;
  buildSupervisorSystemPrompt: unknown;
  buildWorkerContinuationPrompt: unknown;
  buildWorkerSystemPrompt: unknown;
}>;

type PresenceBoardService = PickMethods<
  | "listRepositories"
  | "importRepository"
  | "getBoardSnapshot"
  | "getRepositoryCapabilities"
  | "scanRepositoryCapabilities"
  | "createTicket"
  | "updateTicket"
  | "saveSupervisorHandoff"
  | "createFollowUpProposal"
  | "materializeFollowUp"
  | "syncTicketProjection"
  | "syncBrainProjection"
  | "upsertKnowledgePage"
  | "createPromotionCandidate"
  | "reviewPromotionCandidate"
  | "createDeterministicJob"
  | "evaluateSupervisorAction"
  | "submitGoalIntake"
>;

type PresenceAttemptService = PickMethods<
  | "createAttempt"
  | "prepareWorkspace"
  | "cleanupWorkspace"
  | "startAttemptSession"
  | "attachThreadToAttempt"
  | "saveWorkerHandoff"
  | "saveAttemptEvidence"
  | "resolveFinding"
  | "dismissFinding"
>;

type PresenceReviewMergeService = PickMethods<"submitReviewDecision">;

type PresenceSupervisorRuntime = PickMethods<"startSupervisorRun" | "cancelSupervisorRun">;

type PresenceInternalDeps = Readonly<{
  gitCore: typeof GitCore.Service;
  orchestrationEngine: typeof OrchestrationEngineService.Service;
  providerRegistry: typeof ProviderRegistry.Service;
  supervisorPolicy: typeof SupervisorPolicy.Service;
}>;

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

type TicketPolicyRow = {
  id: string;
  boardId: string;
  repositoryId: string;
  status: string;
  acceptanceChecklist: string;
};

type PresenceThreadReadModel = {
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
};

type PresenceReviewFindingInput = {
  severity: PresenceFindingSeverity;
  disposition: PresenceFindingDisposition;
  summary: string;
  rationale: string;
};

type PresenceCreateOrUpdateFindingInput = {
  ticketId: string;
  attemptId?: string | null | undefined;
  source: PresenceFindingSource;
  severity: PresenceFindingSeverity;
  disposition: PresenceFindingDisposition;
  summary: string;
  rationale: string;
  evidenceIds?: ReadonlyArray<string> | undefined;
};

type PresenceReviewArtifactInput = {
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
};

type PresencePersistMergeOperationInput = {
  id: string;
  ticketId: string;
  attemptId: string;
  status: MergeOperationRecord["status"];
  baseBranch: string;
  sourceBranch: string;
  sourceHeadSha: string | null;
  baseHeadBefore: string | null;
  baseHeadAfter?: string | null;
  mergeCommitSha?: string | null;
  errorSummary?: string | null;
  gitAbortAttempted?: boolean | undefined;
  cleanupWorktreeDone?: boolean | undefined;
  cleanupThreadDone?: boolean | undefined;
  createdAt?: string | undefined;
};

type PresenceResolveOpenFindingsInput = {
  ticketId: string;
  attemptId?: string | null | undefined;
  source?: PresenceFindingSource | undefined;
};

type PresenceWriteAttemptOutcomeInput = {
  attemptId: string;
  kind: PresenceAttemptOutcomeKind;
  summary: string;
};

type PresenceEnsurePromotionCandidateInput = {
  boardId: string;
  ticketId: string;
  attemptId: string;
  workerHandoff: WorkerHandoffRecord | null;
  findings: ReadonlyArray<FindingRecord>;
};

type PresenceReviewDecisionApplicationInput = {
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
};

export type {
  AttemptWorkspaceContextRow,
  PresenceCreateOrUpdateFindingInput,
  PresenceEnsurePromotionCandidateInput,
  PresencePersistMergeOperationInput,
  PresenceReviewDecisionApplicationInput,
  PresenceReviewArtifactInput,
  PresenceReviewFindingInput,
  PresenceResolveOpenFindingsInput,
  PresenceThreadReadModel,
  PresenceWriteAttemptOutcomeInput,
  TicketPolicyRow,
  PresenceAttemptService,
  PresenceBoardService,
  PresenceInternalDeps,
  PresenceProjectionRuntime,
  PresencePrompting,
  PresenceReviewMergeService,
  PresenceStore,
  PresenceSupervisorRuntime,
  ParsedPresenceReviewFinding,
  ParsedPresenceReviewResult,
};
