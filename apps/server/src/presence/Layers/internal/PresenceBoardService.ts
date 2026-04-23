import { promises as nodeFs } from "node:fs";
import path from "node:path";

import {
  type AttemptRecord,
  type AttemptSummary,
  type AttemptOutcomeRecord,
  type AttemptEvidenceRecord,
  AttemptId,
  BoardId,
  CapabilityScanId,
  CommandId,
  DEFAULT_PRESENCE_RESUME_PROTOCOL,
  DeterministicJobId,
  FindingId,
  GoalIntakeId,
  HandoffId,
  KnowledgePageId,
  ProjectId,
  PromotionCandidateId,
  ProposedFollowUpId,
  RepositoryId,
  TicketId,
  type BoardRecord,
  type BoardSnapshot,
  type FindingRecord,
  type GoalIntakeRecord,
  type GoalIntakeResult,
  type KnowledgePageRecord,
  type MergeOperationRecord,
  type ModelSelection,
  type ProjectionHealthRecord,
  type PresenceAcceptanceChecklistItem,
  PresenceAttemptStatus,
  type PresenceCreateDeterministicJobInput,
  type PresenceCreateFollowUpProposalInput,
  type PresenceCreatePromotionCandidateInput,
  type PresenceGetBoardSnapshotInput,
  type PresenceGetRepositoryCapabilitiesInput,
  type PresenceImportRepositoryInput,
  type PresenceMaterializeFollowUpInput,
  type PresenceReviewPromotionCandidateInput,
  type PresenceRpcError,
  type PresenceScanRepositoryCapabilitiesInput,
  type PresenceSaveSupervisorHandoffInput,
  type PresenceSubmitGoalIntakeInput,
  type PresenceUpdateTicketInput,
  type PresenceUpsertKnowledgePageInput,
  type PresenceCreateTicketInput,
  PresenceTicketPriority,
  PresenceTicketStatus,
  type RepositoryCapabilityCommand,
  type RepositoryCapabilityScanRecord,
  type RepositorySummary,
  type DeterministicJobRecord,
  type ProposedFollowUpRecord,
  type PromotionCandidateRecord,
  type ServerProvider,
  type ReviewArtifactRecord,
  type ReviewDecisionRecord,
  type SupervisorActionKind,
  type SupervisorHandoffRecord,
  type SupervisorRunRecord,
  type SupervisorPolicyDecision,
  type TicketRecord,
  type TicketSummaryRecord,
  type WorkspaceRecord,
  type WorkerHandoffRecord,
} from "@t3tools/contracts";
import { Effect, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql/SqlClient";
import type {
  AttemptWorkspaceContextRow,
  PresenceThreadReadModel,
  TicketPolicyRow,
} from "./PresenceInternalDeps.ts";
import {
  buildTicketSummaryRecord,
  checklistIsComplete,
  hasAttemptExecutionContext,
  repeatedFailureKindForTicket,
  sanitizeProjectionSegment,
} from "./PresenceShared.ts";

import type { PresenceControlPlaneShape } from "../../Services/PresenceControlPlane.ts";
import type { GitCoreShape } from "../../../git/Services/GitCore.ts";
import type { OrchestrationEngineShape } from "../../../orchestration/Services/OrchestrationEngine.ts";
import type { ProviderRegistryShape } from "../../../provider/Services/ProviderRegistry.ts";
import type { SupervisorPolicyShape } from "../../Services/SupervisorPolicy.ts";

type PresenceBoardServiceCore = Pick<
  PresenceControlPlaneShape,
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

type PresenceBoardServiceInternals = Readonly<{
  getBoardSnapshotInternal: (
    boardId: string,
  ) => Effect.Effect<BoardSnapshot, PresenceRpcError, never>;
  materializeGoalIntakePlan: (input: {
    boardId: string;
    goalIntakeId: string;
  }) => Effect.Effect<GoalIntakeResult, PresenceRpcError, never>;
  scanRepositoryCapabilitiesInternal: (repository: {
    id: string;
    boardId: string;
    workspaceRoot: string;
  }) => Effect.Effect<RepositoryCapabilityScanRecord, PresenceRpcError, never>;
  getOrCreateCapabilityScan: (
    repositoryId: string,
  ) => Effect.Effect<RepositoryCapabilityScanRecord, PresenceRpcError, never>;
  ensurePromotionCandidateForAcceptedAttempt: (input: {
    boardId: string;
    ticketId: string;
    attemptId: string;
    workerHandoff: WorkerHandoffRecord | null;
    findings: ReadonlyArray<FindingRecord>;
  }) => Effect.Effect<void, PresenceRpcError, never>;
  evaluateSupervisorActionInternal: (input: {
    action: SupervisorActionKind;
    ticketId: string;
    attemptId?: string | null;
  }) => Effect.Effect<SupervisorPolicyDecision, PresenceRpcError, never>;
}>;

type PresenceBoardService = PresenceBoardServiceCore & PresenceBoardServiceInternals;

type RepositoryRow = Readonly<{
  id: string;
  boardId: string;
  projectId: string | null;
  title: string;
  workspaceRoot: string;
  defaultModelSelection: string | null;
  createdAt: string;
  updatedAt: string;
}>;

type BoardRow = Readonly<{
  id: string;
  repositoryId: string;
  title: string;
  sprintFocus: string | null;
  topPrioritySummary: string | null;
  createdAt: string;
  updatedAt: string;
}>;

type TicketRow = Readonly<{
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
}>;

type TicketDependencyRow = Readonly<{
  ticketId: string;
  dependsOnTicketId: string;
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

type WorkspaceRow = Readonly<{
  id: string;
  attemptId: string;
  status: string;
  branch: string | null;
  worktreePath: string | null;
  createdAt: string;
  updatedAt: string;
}>;

type SupervisorHandoffRow = Readonly<{
  id: string;
  boardId: string;
  payload: string;
  createdAt: string;
}>;

type WorkerHandoffRow = Readonly<{
  id: string;
  attemptId: string;
  payload: string;
  createdAt: string;
}>;

type EvidenceRow = Readonly<{
  id: string;
  attemptId: string;
  title: string;
  kind: string;
  content: string;
  createdAt: string;
}>;

type KnowledgePageRow = Readonly<{
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
}>;

type PromotionCandidateRow = Readonly<{
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
}>;

type DeterministicJobRow = Readonly<{
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
}>;

type ReviewDecisionRow = Readonly<{
  id: string;
  ticketId: string;
  attemptId: string | null;
  decision: string;
  notes: string;
  createdAt: string;
}>;

type CapabilityScanRow = Readonly<{
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
}>;

type GoalIntakeRow = Readonly<{
  id: string;
  boardId: string;
  source: string;
  rawGoal: string;
  summary: string;
  createdTicketIds: string;
  createdAt: string;
}>;

type FindingRow = Readonly<{
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
}>;

type ReviewArtifactRow = Readonly<{
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
}>;

type MergeOperationRow = Readonly<{
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
}>;

type ProposedFollowUpRow = Readonly<{
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
}>;

type AttemptOutcomeRow = Readonly<{
  attemptId: string;
  kind: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
}>;

type SupervisorRunRow = Readonly<{
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
}>;

type ProjectionHealthRow = Readonly<{
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
}>;

type GoalPlanningContext = Readonly<{
  repository: RepositoryRow;
  capabilityScan: RepositoryCapabilityScanRecord;
  topLevelEntries: ReadonlyArray<{ name: string; kind: "dir" | "file" }>;
  workspaceGlobs: ReadonlyArray<string>;
  hasReadme: boolean;
  hasAgentsGuide: boolean;
  hasClaudeGuide: boolean;
  activeTicketTitles: ReadonlyArray<string>;
}>;

type PresenceBoardServiceDeps = Readonly<{
  sql: SqlClient;
  gitCore: GitCoreShape;
  supervisorPolicy: SupervisorPolicyShape;
  orchestrationEngine: OrchestrationEngineShape;
  providerRegistry: ProviderRegistryShape;
  chooseDefaultModelSelection: (
    providers: ReadonlyArray<ServerProvider>,
  ) => ModelSelection | null;
  readRepositoryByWorkspaceRoot: (
    workspaceRoot: string,
  ) => Effect.Effect<RepositoryRow | null, unknown, never>;
  mapRepository: (row: RepositoryRow) => RepositorySummary;
  titleFromPath: (value: string) => string;
  makeId: <T extends { make: (value: string) => unknown }>(
    schema: T,
    prefix: string,
  ) => ReturnType<T["make"]>;
  nowIso: () => string;
  encodeJson: (value: unknown) => string;
  readTextFileIfPresent: (path: string) => Promise<string | null>;
  uniqueStrings: (values: ReadonlyArray<string>) => ReadonlyArray<string>;
  syncBoardProjectionBestEffort: (
    boardId: string,
    dirtyReason: string,
  ) => Effect.Effect<void, unknown, never>;
  projectionIsRepairEligible: (
    health: BoardSnapshot["boardProjectionHealth"] | BoardSnapshot["ticketProjectionHealth"][number] | null,
  ) => boolean;
  runProjectionWorker: () => Effect.Effect<void, unknown, never>;
  readLatestCapabilityScan: (
    repositoryId: string,
  ) => Effect.Effect<RepositoryCapabilityScanRecord | null, unknown, never>;
  readRepositoryById: (repositoryId: string) => Effect.Effect<RepositoryRow | null, unknown, never>;
  mapBoard: (row: BoardRow) => BoardRecord;
  mapTicket: (row: TicketRow) => TicketRecord;
  mapAttempt: (row: AttemptRow) => AttemptRecord;
  mapWorkspace: (row: WorkspaceRow) => WorkspaceRecord;
  mapSupervisorHandoff: (row: SupervisorHandoffRow) => SupervisorHandoffRecord;
  mapWorkerHandoff: (row: WorkerHandoffRow) => WorkerHandoffRecord;
  mapSupervisorRun: (row: SupervisorRunRow) => SupervisorRunRecord;
  mapProjectionHealth: (row: ProjectionHealthRow) => ProjectionHealthRecord;
  mapEvidence: (row: EvidenceRow) => AttemptEvidenceRecord;
  mapFinding: (row: FindingRow) => FindingRecord;
  mapReviewArtifact: (row: ReviewArtifactRow) => ReviewArtifactRecord;
  mapProposedFollowUp: (row: ProposedFollowUpRow) => ProposedFollowUpRecord;
  mapAttemptOutcome: (row: AttemptOutcomeRow) => AttemptOutcomeRecord;
  mapKnowledgePage: (row: KnowledgePageRow) => KnowledgePageRecord;
  mapPromotionCandidate: (row: PromotionCandidateRow) => PromotionCandidateRecord;
  mapJob: (row: DeterministicJobRow) => DeterministicJobRecord;
  mapReviewDecision: (row: ReviewDecisionRow) => ReviewDecisionRecord;
  mapMergeOperation: (row: MergeOperationRow) => MergeOperationRecord;
  mapCapabilityScan: (row: CapabilityScanRow) => RepositoryCapabilityScanRecord;
  mapGoalIntake: (row: GoalIntakeRow) => GoalIntakeRecord;
  syncTicketProjectionBestEffort: (
    ticketId: string,
    dirtyReason: string,
  ) => Effect.Effect<void, unknown, never>;
  syncProjectionStrict: (
    scopeType: "board" | "ticket",
    scopeId: string,
    dirtyReason: string,
  ) => Effect.Effect<void, unknown, never>;
  decodeJson: <T>(value: string | null, fallback: T) => T;
  readTicketForPolicy: (ticketId: string) => Effect.Effect<TicketPolicyRow | null, unknown, never>;
  readAttemptWorkspaceContext: (
    attemptId: string,
  ) => Effect.Effect<AttemptWorkspaceContextRow | null, unknown, never>;
  readFindingsForTicket: (
    ticketId: string,
  ) => Effect.Effect<ReadonlyArray<FindingRecord>, unknown, never>;
  readAttemptOutcomesForTicket: (
    ticketId: string,
  ) => Effect.Effect<ReadonlyArray<AttemptOutcomeRecord>, unknown, never>;
  normalizeGoalParts: (rawGoal: string) => {
    parts: ReadonlyArray<string>;
    decomposed: boolean;
  };
  shortTitle: (value: string, fallback: string) => string;
  readThreadFromModel: (
    threadId: string,
  ) => Effect.Effect<(PresenceThreadReadModel & { id: string }) | null, unknown, never>;
  buildWorkerHandoffCandidate: (input: {
    attemptId: string;
    attemptTitle: string;
    attemptStatus: string;
    previousHandoff: WorkerHandoffRecord | null;
    thread: PresenceThreadReadModel | null;
    changedFiles: ReadonlyArray<string>;
    findings: ReadonlyArray<FindingRecord>;
  }) => Effect.Effect<Omit<WorkerHandoffRecord, "id" | "attemptId" | "createdAt">, unknown, never>;
  presenceError: (message: string, cause?: unknown) => PresenceRpcError;
}>;

const makePresenceBoardService = (
  deps: PresenceBoardServiceDeps,
): PresenceBoardService => {
  const decode = Schema.decodeUnknownSync;
  const buildDefaultGoalChecklist = (): ReadonlyArray<PresenceAcceptanceChecklistItem> => [
    { id: `check_${crypto.randomUUID()}`, label: "Mechanism understood", checked: false },
    { id: `check_${crypto.randomUUID()}`, label: "Evidence attached", checked: false },
      { id: `check_${crypto.randomUUID()}`, label: "Reviewer validation captured", checked: false },
  ];

  const insertGoalPlannedTicket = (input: {
    boardId: string;
    title: string;
    description: string;
    priority: TicketRecord["priority"];
    createdAt: string;
  }) =>
    Effect.gen(function* () {
      const ticketId = deps.makeId(TicketId, "ticket");
      const checklist = buildDefaultGoalChecklist();
      yield* deps.sql`
        INSERT INTO presence_tickets (
          ticket_id, board_id, parent_ticket_id, title, description, status, priority,
          acceptance_checklist_json, assigned_attempt_id, created_at, updated_at
        ) VALUES (
          ${ticketId},
          ${input.boardId},
          ${null},
          ${input.title},
          ${input.description},
          ${"todo"},
          ${input.priority},
          ${deps.encodeJson(checklist)},
          ${null},
          ${input.createdAt},
          ${input.createdAt}
        )
      `;
      return {
        id: TicketId.make(ticketId),
        boardId: BoardId.make(input.boardId),
        parentTicketId: null,
        title: input.title,
        description: input.description,
        status: "todo" as const,
        priority: input.priority,
        acceptanceChecklist: checklist,
        assignedAttemptId: null,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      } satisfies TicketRecord;
    });

  const readGoalIntakeForBoard = (input: { boardId: string; goalIntakeId: string }) =>
    deps.sql<GoalIntakeRow & { repositoryId: string; workspaceRoot: string }>`
      SELECT
        goal.goal_intake_id as id,
        goal.board_id as "boardId",
        goal.source,
        goal.raw_goal as "rawGoal",
        goal.summary,
        goal.created_ticket_ids_json as "createdTicketIds",
        goal.created_at as "createdAt",
        board.repository_id as "repositoryId",
        repo.workspace_root as "workspaceRoot"
      FROM presence_goal_intakes goal
      INNER JOIN presence_boards board
        ON board.board_id = goal.board_id
      INNER JOIN presence_repositories repo
        ON repo.repository_id = board.repository_id
      WHERE goal.goal_intake_id = ${input.goalIntakeId}
        AND goal.board_id = ${input.boardId}
      LIMIT 1
    `.pipe(
      Effect.map(
        (
          rows: ReadonlyArray<
            GoalIntakeRow & { repositoryId: string; workspaceRoot: string }
          >,
        ) => rows[0] ?? null,
      ),
    );

  const readGoalPlanningContext = (input: {
    repository: RepositoryRow;
    boardId: string;
    capabilityScan: RepositoryCapabilityScanRecord;
  }): Effect.Effect<GoalPlanningContext, PresenceRpcError, never> =>
    Effect.gen(function* () {
      const packageJsonText = yield* Effect.promise(() =>
        deps.readTextFileIfPresent(path.join(input.repository.workspaceRoot, "package.json")),
      );
      const workspaceGlobs = (() => {
        if (!packageJsonText) {
          return [] as string[];
        }
        try {
          const parsed = JSON.parse(packageJsonText) as
            | { workspaces?: string[] | { packages?: string[] } }
            | null;
          if (Array.isArray(parsed?.workspaces)) {
            return parsed.workspaces.filter((value): value is string => typeof value === "string");
          }
          if (Array.isArray(parsed?.workspaces?.packages)) {
            return parsed.workspaces.packages.filter(
              (value): value is string => typeof value === "string",
            );
          }
        } catch {
          return [] as string[];
        }
        return [] as string[];
      })();

      const topLevelEntries = yield* Effect.promise(async () => {
        try {
          const entries = await nodeFs.readdir(input.repository.workspaceRoot, {
            withFileTypes: true,
          });
          return entries
            .filter((entry) => entry.name !== ".git")
            .map((entry) => ({
              name: entry.name,
              kind: entry.isDirectory() ? ("dir" as const) : ("file" as const),
            }))
            .sort((left, right) => left.name.localeCompare(right.name))
            .slice(0, 16);
        } catch {
          return [] as Array<{ name: string; kind: "dir" | "file" }>;
        }
      });

      const snapshot = yield* getBoardSnapshotInternal(input.boardId);
      return {
        repository: input.repository,
        capabilityScan: input.capabilityScan,
        topLevelEntries,
        workspaceGlobs,
        hasReadme: topLevelEntries.some((entry) => /^readme(\.|$)/i.test(entry.name)),
        hasAgentsGuide: topLevelEntries.some((entry) => /^agents\.md$/i.test(entry.name)),
        hasClaudeGuide: topLevelEntries.some((entry) => /^claude\.md$/i.test(entry.name)),
        activeTicketTitles: snapshot.tickets
          .filter((ticket) => ticket.status !== "done")
          .map((ticket) => ticket.title),
      } satisfies GoalPlanningContext;
    });

  const isDocumentationGoal = (value: string) =>
    /(agents\.md|claude\.md|readme|runbook|guide|documentation|docs?)/i.test(value);
  const isValidationGoal = (value: string) =>
    /(validation|test|tests|qa|lint|typecheck|build|ci|reliability)/i.test(value);

  const planGoalParts = (
    rawGoal: string,
    context: GoalPlanningContext,
  ): { parts: ReadonlyArray<string>; decomposed: boolean } => {
    const normalized = deps.normalizeGoalParts(rawGoal);
    if (normalized.parts.length > 1) {
      return normalized;
    }

    const compactGoal = rawGoal.replace(/\s+/g, " ").trim();
    const coordinationSplit = compactGoal.match(/^(.+?)\s+and\s+(.+)$/i);
    if (coordinationSplit) {
      const [, firstClause = "", secondClause = ""] = coordinationSplit;
      const first = firstClause.trim();
      const second = secondClause.trim().replace(/\.$/, "");
      const mixedDocumentationAndValidation =
        (isDocumentationGoal(first) && isValidationGoal(second)) ||
        (isValidationGoal(first) && isDocumentationGoal(second));
      const repoLooksMultiSurface =
        context.workspaceGlobs.length > 0 ||
        context.topLevelEntries.some((entry) => entry.kind === "dir" && /^(apps|packages|services)$/i.test(entry.name));
      if (mixedDocumentationAndValidation || (repoLooksMultiSurface && isDocumentationGoal(first))) {
        return {
          parts: deps.uniqueStrings([first, second]),
          decomposed: true,
        };
      }
    }

    return normalized;
  };

  const buildPlannedGoalTitle = (part: string, context: GoalPlanningContext) => {
    if (/agents\.md/i.test(part)) {
      return context.hasAgentsGuide
        ? "Update the repository AGENTS.md guide"
        : "Create the repository AGENTS.md guide";
    }
    if (/claude\.md/i.test(part)) {
      return context.hasClaudeGuide
        ? "Update the repository CLAUDE.md guide"
        : "Create the repository CLAUDE.md guide";
    }
    if (/readme/i.test(part)) {
      return context.hasReadme ? "Update the repository README" : "Create the repository README";
    }
    if (isValidationGoal(part)) {
        return deps.shortTitle(part, "Tighten reviewer confidence");
    }
    return deps.shortTitle(part, "Supervisor-planned goal");
  };

  const persistPromotionCandidate = (input: PresenceCreatePromotionCandidateInput) =>
    Effect.gen(function* () {
      const candidateId = deps.makeId(PromotionCandidateId, "promotion");
      const createdAt = deps.nowIso();
      yield* deps.sql`
        INSERT INTO presence_promotion_candidates (
          promotion_candidate_id, source_ticket_id, source_attempt_id, family, title, slug,
          compiled_truth, timeline_entry, status, created_at, updated_at
        ) VALUES (
          ${candidateId},
          ${input.sourceTicketId},
          ${input.sourceAttemptId ?? null},
          ${input.family},
          ${input.title},
          ${input.slug},
          ${input.compiledTruth},
          ${input.timelineEntry},
          ${"pending"},
          ${createdAt},
          ${createdAt}
        )
      `;
      return {
        id: PromotionCandidateId.make(candidateId),
        sourceTicketId: input.sourceTicketId,
        sourceAttemptId: input.sourceAttemptId ?? null,
        family: input.family,
        title: input.title,
        slug: input.slug,
        compiledTruth: input.compiledTruth,
        timelineEntry: input.timelineEntry,
        status: "pending" as const,
        createdAt,
        updatedAt: createdAt,
      } satisfies PromotionCandidateRecord;
    });

  const materializeGoalIntakePlan: PresenceBoardServiceInternals["materializeGoalIntakePlan"] = (
    input,
  ) =>
    Effect.gen(function* () {
      const intakeRow = yield* readGoalIntakeForBoard(input);
      if (!intakeRow) {
        return yield* Effect.fail(
          deps.presenceError(`Goal intake '${input.goalIntakeId}' was not found for this board.`),
        );
      }

      const existingIntake = deps.mapGoalIntake(intakeRow);
      if (existingIntake.createdTicketIds.length > 0) {
        const snapshot = yield* getBoardSnapshotInternal(input.boardId);
        const existingTickets = snapshot.tickets.filter((ticket) =>
          existingIntake.createdTicketIds.some((ticketId) => ticketId === ticket.id),
        );
        return {
          intake: existingIntake,
          createdTickets: existingTickets,
          decomposed: existingTickets.length > 1,
        } satisfies GoalIntakeResult;
      }

      const repository = yield* deps.readRepositoryById(intakeRow.repositoryId);
      if (!repository) {
        return yield* Effect.fail(
          deps.presenceError(
            `Repository '${intakeRow.repositoryId}' linked to goal intake '${input.goalIntakeId}' was not found.`,
          ),
        );
      }

      const capabilityScan = yield* getOrCreateCapabilityScan(repository.id);
      const planningContext = yield* readGoalPlanningContext({
        repository,
        boardId: input.boardId,
        capabilityScan,
      });
      const plan = planGoalParts(existingIntake.rawGoal, planningContext);
      const createdAt = deps.nowIso();
      const createdTickets = yield* deps.sql.withTransaction(
        Effect.gen(function* () {
          const tickets: TicketRecord[] = [];
          for (const part of plan.parts) {
            const title = buildPlannedGoalTitle(part, planningContext);
            const ticket = yield* insertGoalPlannedTicket({
              boardId: input.boardId,
              title,
              description: part,
              priority: "p2",
              createdAt,
            });
            tickets.push(ticket);
          }

          const summary = plan.decomposed
            ? `Presence reviewed the repo and planned this goal into ${tickets.length} tickets.`
            : "Presence reviewed the repo and planned one ticket from this goal.";
          yield* deps.sql`
            UPDATE presence_goal_intakes
            SET summary = ${summary},
                created_ticket_ids_json = ${deps.encodeJson(tickets.map((ticket) => ticket.id))}
            WHERE goal_intake_id = ${input.goalIntakeId}
          `;

          return {
            intake: {
              ...existingIntake,
              summary,
              createdTicketIds: tickets.map((ticket) => ticket.id),
            },
            createdTickets: tickets,
            decomposed: plan.decomposed,
          } satisfies GoalIntakeResult;
        }),
      );

      for (const ticket of createdTickets.createdTickets) {
        yield* deps.syncTicketProjectionBestEffort(
          ticket.id,
          "Goal intake planning created a new ticket.",
        );
      }
      yield* deps.syncBoardProjectionBestEffort(
        input.boardId,
        "Goal intake planning updated the board plan.",
      );
      return createdTickets;
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(deps.presenceError("Failed to plan and materialize the goal intake.", cause)),
      ),
    );

  const getBoardSnapshotInternal: PresenceBoardServiceInternals["getBoardSnapshotInternal"] = (
    boardId,
  ) =>
    Effect.gen(function* () {
      const repositoryRow = yield* deps.sql<{
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
        WHERE board_id = ${boardId}
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
      if (!repositoryRow) {
        return yield* Effect.fail(deps.presenceError(`Board '${boardId}' not found.`));
      }

      const boardRow = yield* deps.sql<{
        id: string;
        repositoryId: string;
        title: string;
        sprintFocus: string | null;
        topPrioritySummary: string | null;
        createdAt: string;
        updatedAt: string;
      }>`
        SELECT
          board_id as id,
          repository_id as "repositoryId",
          title,
          sprint_focus as "sprintFocus",
          top_priority_summary as "topPrioritySummary",
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM presence_boards
        WHERE board_id = ${boardId}
      `.pipe(
        Effect.map(
          (
            rows: ReadonlyArray<{
              id: string;
              repositoryId: string;
              title: string;
              sprintFocus: string | null;
              topPrioritySummary: string | null;
              createdAt: string;
              updatedAt: string;
            }>,
          ) => rows[0] ?? null,
        ),
      );
      if (!boardRow) {
        return yield* Effect.fail(
          deps.presenceError(`Board '${boardId}' is missing its record.`),
        );
      }

      const snapshotRows = (yield* Effect.all([
        deps.sql<TicketRow>`SELECT
            ticket_id as id, board_id as "boardId", parent_ticket_id as "parentTicketId",
            title, description, status, priority,
            acceptance_checklist_json as "acceptanceChecklist",
            assigned_attempt_id as "assignedAttemptId",
            created_at as "createdAt", updated_at as "updatedAt"
          FROM presence_tickets
          WHERE board_id = ${boardId}
          ORDER BY updated_at DESC, created_at DESC`,
        deps.sql<TicketDependencyRow>`SELECT
            ticket_id as "ticketId",
            depends_on_ticket_id as "dependsOnTicketId"
          FROM presence_ticket_dependencies
          WHERE ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})`,
        deps.sql<AttemptRow>`SELECT
            attempt_id as id, ticket_id as "ticketId", workspace_id as "workspaceId",
            title, status, provider, model, thread_id as "threadId", summary, confidence,
            last_worker_handoff_id as "lastWorkerHandoffId",
            created_at as "createdAt", updated_at as "updatedAt"
          FROM presence_attempts
          WHERE ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
          ORDER BY created_at DESC`,
        deps.sql<WorkspaceRow>`SELECT
            workspace_id as id, attempt_id as "attemptId", status, branch,
            worktree_path as "worktreePath", created_at as "createdAt", updated_at as "updatedAt"
          FROM presence_workspaces
          WHERE attempt_id IN (
            SELECT attempt_id FROM presence_attempts
            WHERE ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
          )`,
        deps.sql<SupervisorHandoffRow>`SELECT
            handoff_id as id, board_id as "boardId", payload_json as payload, created_at as "createdAt"
          FROM presence_handoffs
          WHERE board_id = ${boardId} AND role = 'supervisor'
          ORDER BY created_at DESC
          LIMIT 1`,
        deps.sql<WorkerHandoffRow>`SELECT
            handoff_id as id, attempt_id as "attemptId", payload_json as payload, created_at as "createdAt"
          FROM presence_handoffs
          WHERE attempt_id IN (
            SELECT attempt_id FROM presence_attempts
            WHERE ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
          ) AND role = 'worker'
          ORDER BY created_at DESC`,
        deps.sql<EvidenceRow>`SELECT
            evidence_id as id, attempt_id as "attemptId", title, kind, content, created_at as "createdAt"
          FROM presence_attempt_evidence
          WHERE attempt_id IN (
            SELECT attempt_id FROM presence_attempts
            WHERE ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
          )
          ORDER BY created_at DESC`,
        deps.sql<KnowledgePageRow>`SELECT
            knowledge_page_id as id, board_id as "boardId", family, slug, title,
            compiled_truth as "compiledTruth", timeline, linked_ticket_ids_json as "linkedTicketIds",
            created_at as "createdAt", updated_at as "updatedAt"
          FROM presence_knowledge_pages
          WHERE board_id = ${boardId}
          ORDER BY updated_at DESC`,
        deps.sql<PromotionCandidateRow>`SELECT
            promotion_candidate_id as id, source_ticket_id as "sourceTicketId",
            source_attempt_id as "sourceAttemptId", family, title, slug, compiled_truth as "compiledTruth",
            timeline_entry as "timelineEntry", status, created_at as "createdAt", updated_at as "updatedAt"
          FROM presence_promotion_candidates
          WHERE source_ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
          ORDER BY updated_at DESC`,
        deps.sql<DeterministicJobRow>`SELECT
            deterministic_job_id as id, board_id as "boardId", title, kind, status, progress,
            output_summary as "outputSummary", error_message as "errorMessage",
            created_at as "createdAt", updated_at as "updatedAt"
          FROM presence_deterministic_jobs
          WHERE board_id = ${boardId}
          ORDER BY updated_at DESC`,
        deps.sql<ReviewDecisionRow>`SELECT
            review_decision_id as id, ticket_id as "ticketId", attempt_id as "attemptId",
            decision, notes, created_at as "createdAt"
          FROM presence_review_decisions
          WHERE ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
          ORDER BY created_at DESC`,
        deps.sql<CapabilityScanRow>`SELECT
            capability_scan_id as id, repository_id as "repositoryId", board_id as "boardId",
            base_branch as "baseBranch", upstream_ref as "upstreamRef",
            has_remote as "hasRemote", is_clean as "isClean",
            ecosystems_json as ecosystems, markers_json as markers,
            discovered_commands_json as "discoveredCommands",
            risk_signals_json as "riskSignals", scanned_at as "scannedAt"
          FROM presence_repository_capability_scans
          WHERE board_id = ${boardId}
          LIMIT 1`,
        deps.sql<GoalIntakeRow>`SELECT
            goal_intake_id as id, board_id as "boardId", source, raw_goal as "rawGoal",
            summary, created_ticket_ids_json as "createdTicketIds", created_at as "createdAt"
          FROM presence_goal_intakes
          WHERE board_id = ${boardId}
          ORDER BY created_at DESC`,
        deps.sql<FindingRow>`SELECT
            finding_id as id, ticket_id as "ticketId", attempt_id as "attemptId",
            source, severity, disposition, status, summary, rationale,
            evidence_ids_json as "evidenceIds",
            created_at as "createdAt", updated_at as "updatedAt"
          FROM presence_findings
          WHERE ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
          ORDER BY updated_at DESC, created_at DESC`,
        deps.sql<ReviewArtifactRow>`SELECT
            review_artifact_id as id, ticket_id as "ticketId", attempt_id as "attemptId",
            reviewer_kind as "reviewerKind", decision, summary, checklist_json as "checklistJson",
            checklist_assessment_json as "checklistAssessmentJson",
            evidence_json as "evidenceJson",
            changed_files_json as "changedFilesJson",
            changed_files_reviewed_json as "changedFilesReviewedJson",
            finding_ids_json as "findingIdsJson",
            thread_id as "threadId",
            created_at as "createdAt"
          FROM presence_review_artifacts
          WHERE ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
          ORDER BY created_at DESC`,
        deps.sql<MergeOperationRow>`SELECT
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
          WHERE ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
          ORDER BY updated_at DESC, created_at DESC, merge_operation_id DESC`,
        deps.sql<ProposedFollowUpRow>`SELECT
            proposed_follow_up_id as id, parent_ticket_id as "parentTicketId",
            originating_attempt_id as "originatingAttemptId", kind, title, description,
            priority, status, finding_ids_json as "findingIdsJson",
            requires_human_confirmation as "requiresHumanConfirmation",
            created_ticket_id as "createdTicketId", created_at as "createdAt", updated_at as "updatedAt"
          FROM presence_follow_up_proposals
          WHERE parent_ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
          ORDER BY updated_at DESC, created_at DESC`,
        deps.sql<AttemptOutcomeRow>`SELECT
            o.attempt_id as "attemptId", o.kind, o.summary,
            o.created_at as "createdAt", o.updated_at as "updatedAt"
          FROM presence_attempt_outcomes o
          INNER JOIN presence_attempts a ON a.attempt_id = o.attempt_id
          WHERE a.ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
          ORDER BY o.updated_at DESC, o.created_at DESC`,
        deps.sql<SupervisorRunRow>`SELECT
            supervisor_run_id as id, board_id as "boardId",
            source_goal_intake_id as "sourceGoalIntakeId",
            scope_ticket_ids_json as "scopeTicketIdsJson",
            status, stage, current_ticket_id as "currentTicketId",
            active_thread_ids_json as "activeThreadIdsJson",
            summary, created_at as "createdAt", updated_at as "updatedAt"
          FROM presence_supervisor_runs
          WHERE board_id = ${boardId}
          ORDER BY updated_at DESC, created_at DESC`,
        deps.sql<ProjectionHealthRow>`SELECT
            scope_type as "scopeType",
            scope_id as "scopeId",
            status,
            desired_version as "desiredVersion",
            projected_version as "projectedVersion",
            lease_owner as "leaseOwner",
            lease_expires_at as "leaseExpiresAt",
            last_attempted_at as "lastAttemptedAt",
            last_succeeded_at as "lastSucceededAt",
            last_error_message as "lastErrorMessage",
            last_error_path as "lastErrorPath",
            dirty_reason as "dirtyReason",
            retry_after as "retryAfter",
            attempt_count as "attemptCount",
            updated_at as "updatedAt"
          FROM presence_projection_health
          WHERE scope_type = 'board' AND scope_id = ${boardId}
          LIMIT 1`,
        deps.sql<ProjectionHealthRow>`SELECT
            scope_type as "scopeType",
            scope_id as "scopeId",
            status,
            desired_version as "desiredVersion",
            projected_version as "projectedVersion",
            lease_owner as "leaseOwner",
            lease_expires_at as "leaseExpiresAt",
            last_attempted_at as "lastAttemptedAt",
            last_succeeded_at as "lastSucceededAt",
            last_error_message as "lastErrorMessage",
            last_error_path as "lastErrorPath",
            dirty_reason as "dirtyReason",
            retry_after as "retryAfter",
            attempt_count as "attemptCount",
            updated_at as "updatedAt"
          FROM presence_projection_health
          WHERE
            scope_type = 'ticket'
            AND scope_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
          ORDER BY updated_at DESC`,
      ])) as [
        ReadonlyArray<TicketRow>,
        ReadonlyArray<TicketDependencyRow>,
        ReadonlyArray<AttemptRow>,
        ReadonlyArray<WorkspaceRow>,
        ReadonlyArray<SupervisorHandoffRow>,
        ReadonlyArray<WorkerHandoffRow>,
        ReadonlyArray<EvidenceRow>,
        ReadonlyArray<KnowledgePageRow>,
        ReadonlyArray<PromotionCandidateRow>,
        ReadonlyArray<DeterministicJobRow>,
        ReadonlyArray<ReviewDecisionRow>,
        ReadonlyArray<CapabilityScanRow>,
        ReadonlyArray<GoalIntakeRow>,
        ReadonlyArray<FindingRow>,
        ReadonlyArray<ReviewArtifactRow>,
        ReadonlyArray<MergeOperationRow>,
        ReadonlyArray<ProposedFollowUpRow>,
        ReadonlyArray<AttemptOutcomeRow>,
        ReadonlyArray<SupervisorRunRow>,
        ReadonlyArray<ProjectionHealthRow>,
        ReadonlyArray<ProjectionHealthRow>,
      ];
      const [
        ticketRows,
        dependencyRows,
        attemptRows,
        workspaceRows,
        supervisorRows,
        workerRows,
        evidenceRows,
        knowledgeRows,
        promotionRows,
        jobRows,
        reviewRows,
        capabilityRows,
        goalRows,
        findingRows,
        reviewArtifactRows,
        mergeOperationRows,
        followUpRows,
        attemptOutcomeRows,
        supervisorRunRows,
        boardProjectionHealthRow,
        ticketProjectionHealthRows,
      ] = snapshotRows;

      const attempts = attemptRows.map(deps.mapAttempt);
      const workspaces = workspaceRows.map(deps.mapWorkspace);
      const findings = findingRows.map(deps.mapFinding);
      const reviewArtifacts = reviewArtifactRows.map(deps.mapReviewArtifact);
      const mergeOperations = mergeOperationRows.map(deps.mapMergeOperation);
      const proposedFollowUps = followUpRows.map(deps.mapProposedFollowUp);
      const attemptOutcomes = attemptOutcomeRows.map(deps.mapAttemptOutcome);
      const supervisorRuns = supervisorRunRows.map(deps.mapSupervisorRun);
      const boardProjectionHealth = boardProjectionHealthRow[0]
        ? deps.mapProjectionHealth(boardProjectionHealthRow[0])
        : null;
      const ticketProjectionHealth = ticketProjectionHealthRows.map(deps.mapProjectionHealth);
      const latestWorkerHandoffByAttemptId = new Map<string, WorkerHandoffRecord>();
      for (const row of workerRows) {
        if (!latestWorkerHandoffByAttemptId.has(row.attemptId)) {
          latestWorkerHandoffByAttemptId.set(row.attemptId, deps.mapWorkerHandoff(row));
        }
      }
      const workspaceByAttemptId = new Map(
        workspaces.map((workspace: WorkspaceRecord) => [workspace.attemptId, workspace] as const),
      );

      const attemptSummaries: AttemptSummary[] = yield* Effect.forEach(attempts, (attempt) =>
        Effect.gen(function* () {
          const workspace = workspaceByAttemptId.get(attempt.id) ?? null;
          const persistedHandoff = latestWorkerHandoffByAttemptId.get(attempt.id) ?? null;
          const thread = attempt.threadId ? yield* deps.readThreadFromModel(attempt.threadId) : null;
          const liveHandoff =
            thread && (attempt.status === "in_progress" || attempt.status === "in_review")
              ? yield* deps.buildWorkerHandoffCandidate({
                  attemptId: attempt.id,
                  attemptTitle: attempt.title,
                  attemptStatus: attempt.status,
                  previousHandoff: persistedHandoff,
                  thread,
                  changedFiles: persistedHandoff?.changedFiles ?? [],
                  findings: findings.filter(
                    (finding: FindingRecord) =>
                      finding.ticketId === attempt.ticketId &&
                      (finding.attemptId === null || finding.attemptId === attempt.id),
                  ),
                })
              : null;
          const effectiveHandoff =
            liveHandoff
              ? ({
                  id: persistedHandoff?.id ?? HandoffId.make(`handoff_preview_${attempt.id}`),
                  attemptId: AttemptId.make(attempt.id),
                  ...liveHandoff,
                  createdAt: persistedHandoff?.createdAt ?? deps.nowIso(),
                } satisfies WorkerHandoffRecord)
              : persistedHandoff;
          return {
            attempt,
            workspace,
            latestWorkerHandoff: effectiveHandoff,
          } satisfies AttemptSummary;
        }),
      );

      const effectiveWorkerHandoffByAttemptId = new Map(
        attemptSummaries.flatMap((summaryItem) =>
          summaryItem.latestWorkerHandoff
            ? [[summaryItem.attempt.id, summaryItem.latestWorkerHandoff] as const]
            : [],
        ),
      );
      const tickets: ReadonlyArray<TicketRecord> = ticketRows.map(deps.mapTicket);
      const ticketSummaries: TicketSummaryRecord[] = tickets.map((ticket) =>
        buildTicketSummaryRecord({
          ticket: ticket as TicketRecord,
          attempts: attempts.filter((attempt: AttemptRecord) => attempt.ticketId === ticket.id),
          latestWorkerHandoffByAttemptId: effectiveWorkerHandoffByAttemptId,
          findings: findings.filter((finding: FindingRecord) => finding.ticketId === ticket.id),
          followUps: proposedFollowUps.filter(
            (proposal: ProposedFollowUpRecord) => proposal.parentTicketId === ticket.id,
          ),
          attemptOutcomes: attemptOutcomes.filter((outcome: AttemptOutcomeRecord) =>
            attempts.some(
              (attempt: AttemptRecord) =>
                attempt.id === outcome.attemptId && attempt.ticketId === ticket.id,
            ),
          ),
          mergeOperations: mergeOperations.filter(
            (operation: MergeOperationRecord) => operation.ticketId === ticket.id,
          ),
        }),
      );

      return {
        repository: deps.mapRepository(repositoryRow),
        board: deps.mapBoard(boardRow),
        tickets,
        dependencies: dependencyRows.map((row) => ({
          ticketId: TicketId.make(row.ticketId),
          dependsOnTicketId: TicketId.make(row.dependsOnTicketId),
        })),
        attempts,
        workspaces,
        attemptSummaries,
        supervisorHandoff: supervisorRows[0] ? deps.mapSupervisorHandoff(supervisorRows[0]) : null,
        evidence: evidenceRows.map(deps.mapEvidence),
        findings,
        reviewArtifacts,
        mergeOperations,
        proposedFollowUps,
        ticketSummaries,
        attemptOutcomes,
        promotionCandidates: promotionRows.map(deps.mapPromotionCandidate),
        knowledgePages: knowledgeRows.map(deps.mapKnowledgePage),
        jobs: jobRows.map(deps.mapJob),
        reviewDecisions: reviewRows.map(deps.mapReviewDecision),
        supervisorRuns,
        boardProjectionHealth,
        ticketProjectionHealth,
        hasStaleProjections:
          (boardProjectionHealth !== null &&
            (boardProjectionHealth.status !== "healthy" ||
              boardProjectionHealth.projectedVersion < boardProjectionHealth.desiredVersion)) ||
          ticketProjectionHealth.some(
            (health: ProjectionHealthRecord) =>
              health.status !== "healthy" || health.projectedVersion < health.desiredVersion,
        ),
        capabilityScan: capabilityRows[0] ? deps.mapCapabilityScan(capabilityRows[0]) : null,
        goalIntakes: goalRows.map(deps.mapGoalIntake),
      } satisfies BoardSnapshot;
    }).pipe(
      Effect.mapError((cause) =>
        deps.presenceError(`Failed to assemble board snapshot for '${boardId}'.`, cause),
      ),
    );

  const scanRepositoryCapabilitiesInternal: PresenceBoardServiceInternals["scanRepositoryCapabilitiesInternal"] =
    (repository) =>
      Effect.gen(function* () {
        const status = yield* deps.gitCore.statusDetailsLocal(repository.workspaceRoot).pipe(
          Effect.mapError((cause) =>
            deps.presenceError("Failed to inspect repository capabilities.", cause),
          ),
        );

        const ecosystems: string[] = [];
        const markers: string[] = [];
        const discoveredCommands: RepositoryCapabilityCommand[] = [];
        const riskSignals: string[] = [];

        const pushCommand = (
          kind: RepositoryCapabilityCommand["kind"],
          command: string,
          source: string,
        ) => {
          if (
            !discoveredCommands.some(
              (candidate) =>
                candidate.kind === kind &&
                candidate.command === command &&
                candidate.source === source,
            )
          ) {
            discoveredCommands.push({ kind, command, source });
          }
        };

        const packageJsonText = yield* Effect.tryPromise(() =>
          deps.readTextFileIfPresent(path.join(repository.workspaceRoot, "package.json")),
        ).pipe(
          Effect.mapError((cause) =>
            deps.presenceError("Failed to read package.json during capability scan.", cause),
          ),
        );
        if (packageJsonText) {
          ecosystems.push("node");
          markers.push("package.json");
          try {
            const parsed = JSON.parse(packageJsonText) as {
              scripts?: Record<string, string>;
              packageManager?: string;
            };
            const packageManager = parsed.packageManager?.split("@")[0] ?? "npm";
            const scripts = parsed.scripts ?? {};
            if (scripts.test) {
              pushCommand("test", `${packageManager} run test`, "package.json:scripts.test");
            }
            if (scripts.build) {
              pushCommand("build", `${packageManager} run build`, "package.json:scripts.build");
            }
            if (scripts.lint) {
              pushCommand("lint", `${packageManager} run lint`, "package.json:scripts.lint");
            }
            if (scripts.dev) {
              pushCommand("dev", `${packageManager} run dev`, "package.json:scripts.dev");
            }
          } catch {
            riskSignals.push("package.json could not be parsed.");
          }
        }

        const cargoToml = yield* Effect.tryPromise(() =>
          deps.readTextFileIfPresent(path.join(repository.workspaceRoot, "Cargo.toml")),
        ).pipe(
          Effect.mapError((cause) =>
            deps.presenceError("Failed to read Cargo.toml during capability scan.", cause),
          ),
        );
        if (cargoToml) {
          ecosystems.push("rust");
          markers.push("Cargo.toml");
          pushCommand("test", "cargo test", "Cargo.toml");
          pushCommand("build", "cargo build", "Cargo.toml");
          pushCommand("lint", "cargo clippy --all-targets --all-features", "Cargo.toml");
        }

        const pyprojectToml = yield* Effect.tryPromise(() =>
          deps.readTextFileIfPresent(path.join(repository.workspaceRoot, "pyproject.toml")),
        ).pipe(
          Effect.mapError((cause) =>
            deps.presenceError("Failed to read pyproject.toml during capability scan.", cause),
          ),
        );
        if (pyprojectToml) {
          ecosystems.push("python");
          markers.push("pyproject.toml");
          if (/\bpytest\b/i.test(pyprojectToml)) {
            pushCommand("test", "pytest", "pyproject.toml");
          }
        }

        const goMod = yield* Effect.tryPromise(() =>
          deps.readTextFileIfPresent(path.join(repository.workspaceRoot, "go.mod")),
        ).pipe(
          Effect.mapError((cause) =>
            deps.presenceError("Failed to read go.mod during capability scan.", cause),
          ),
        );
        if (goMod) {
          ecosystems.push("go");
          markers.push("go.mod");
          pushCommand("test", "go test ./...", "go.mod");
          pushCommand("build", "go build ./...", "go.mod");
        }

        const makefile = yield* Effect.tryPromise(() =>
          deps.readTextFileIfPresent(path.join(repository.workspaceRoot, "Makefile")),
        ).pipe(
          Effect.mapError((cause) =>
            deps.presenceError("Failed to read Makefile during capability scan.", cause),
          ),
        );
        if (makefile) {
          ecosystems.push("make");
          markers.push("Makefile");
          if (/^test:/m.test(makefile)) pushCommand("test", "make test", "Makefile");
          if (/^build:/m.test(makefile)) pushCommand("build", "make build", "Makefile");
          if (/^lint:/m.test(makefile)) pushCommand("lint", "make lint", "Makefile");
          if (/^dev:/m.test(makefile)) pushCommand("dev", "make dev", "Makefile");
        }

        const workflowEntries = yield* Effect.tryPromise(async () => {
          try {
            return await nodeFs.readdir(
              path.join(repository.workspaceRoot, ".github", "workflows"),
            );
          } catch {
            return [];
          }
        }).pipe(
          Effect.mapError((cause) =>
            deps.presenceError(
              "Failed to inspect CI workflow markers during capability scan.",
              cause,
            ),
          ),
        );
        if (workflowEntries.length > 0) {
          markers.push(".github/workflows");
        }

        const lockfileNames = [
          "package-lock.json",
          "pnpm-lock.yaml",
          "yarn.lock",
          "bun.lockb",
          "bun.lock",
          "Cargo.lock",
        ];
        const presentLockfiles = yield* Effect.tryPromise(async () => {
          const found: string[] = [];
          for (const name of lockfileNames) {
            try {
              await nodeFs.access(path.join(repository.workspaceRoot, name));
              found.push(name);
            } catch {}
          }
          return found;
        }).pipe(
          Effect.mapError((cause) =>
            deps.presenceError("Failed to inspect repository lockfiles during capability scan.", cause),
          ),
        );
        markers.push(...presentLockfiles);

        if (!status.isRepo) riskSignals.push("Workspace root is not a git repository.");
        if (status.hasWorkingTreeChanges) {
          riskSignals.push("Repository has local working tree changes.");
        }
        if (status.workingTree.files.length > 100) {
          riskSignals.push("Repository has a large active change set.");
        }
        if (
          ecosystems.includes("node") &&
          presentLockfiles.filter((value) => value.includes("lock")).length === 0
        ) {
          riskSignals.push("Node repository is missing a lockfile.");
        }

        const record: RepositoryCapabilityScanRecord = {
          id: CapabilityScanId.make(`capability_${crypto.randomUUID()}`),
          repositoryId: RepositoryId.make(repository.id),
          boardId: BoardId.make(repository.boardId),
          baseBranch: status.branch,
          upstreamRef: status.upstreamRef,
          hasRemote: status.hasOriginRemote || status.upstreamRef !== null,
          isClean: !status.hasWorkingTreeChanges,
          ecosystems: deps.uniqueStrings(ecosystems),
          markers: deps.uniqueStrings(markers),
          discoveredCommands,
          riskSignals: deps.uniqueStrings(riskSignals),
          scannedAt: deps.nowIso(),
        };

        yield* deps.sql`
          INSERT INTO presence_repository_capability_scans (
            capability_scan_id, repository_id, board_id, base_branch, upstream_ref,
            has_remote, is_clean, ecosystems_json, markers_json, discovered_commands_json,
            risk_signals_json, scanned_at
          ) VALUES (
            ${record.id}, ${record.repositoryId}, ${record.boardId}, ${record.baseBranch},
            ${record.upstreamRef}, ${record.hasRemote ? 1 : 0}, ${record.isClean ? 1 : 0},
            ${deps.encodeJson(record.ecosystems)}, ${deps.encodeJson(record.markers)},
            ${deps.encodeJson(record.discoveredCommands)},
            ${deps.encodeJson(record.riskSignals)}, ${record.scannedAt}
          )
          ON CONFLICT(repository_id) DO UPDATE SET
            capability_scan_id = excluded.capability_scan_id,
            board_id = excluded.board_id,
            base_branch = excluded.base_branch,
            upstream_ref = excluded.upstream_ref,
            has_remote = excluded.has_remote,
            is_clean = excluded.is_clean,
            ecosystems_json = excluded.ecosystems_json,
            markers_json = excluded.markers_json,
            discovered_commands_json = excluded.discovered_commands_json,
            risk_signals_json = excluded.risk_signals_json,
            scanned_at = excluded.scanned_at
        `;

        return record;
      }).pipe(
        Effect.mapError((cause) =>
          deps.presenceError("Failed to scan repository capabilities.", cause),
        ),
      );

  const getOrCreateCapabilityScan: PresenceBoardServiceInternals["getOrCreateCapabilityScan"] = (
    repositoryId,
  ) =>
    Effect.gen(function* () {
      const existing = yield* deps.readLatestCapabilityScan(repositoryId);
      if (existing) {
        return existing;
      }

      const repository = yield* deps.readRepositoryById(repositoryId);
      if (!repository) {
        return yield* Effect.fail(
          deps.presenceError(
            `Repository '${repositoryId}' could not be found for capability scan.`,
          ),
        );
      }

      return yield* scanRepositoryCapabilitiesInternal(repository);
    }).pipe(
      Effect.mapError((cause) =>
        deps.presenceError("Failed to resolve repository capability scan.", cause),
      ),
    );

  const ensurePromotionCandidateForAcceptedAttempt: PresenceBoardServiceInternals["ensurePromotionCandidateForAcceptedAttempt"] =
    (input) =>
      Effect.gen(function* () {
        const existing = yield* deps.sql<{ id: string }>`
          SELECT promotion_candidate_id as id
          FROM presence_promotion_candidates
          WHERE source_ticket_id = ${input.ticketId}
            AND source_attempt_id = ${input.attemptId}
          LIMIT 1
        `.pipe(
          Effect.map((rows: ReadonlyArray<{ id: string }>) => rows[0] ?? null),
        );
        if (existing) {
          return;
        }
        const boardSnapshot = yield* getBoardSnapshotInternal(input.boardId);
        const ticket =
          boardSnapshot.tickets.find((candidate: TicketRecord) => candidate.id === input.ticketId) ??
          null;
        if (!ticket) {
          return;
        }
        const compiledTruth = deps
          .uniqueStrings([
            ...(input.workerHandoff?.completedWork ?? []),
            ...input.findings
              .filter((finding) => finding.status !== "dismissed")
              .map((finding) => finding.summary),
          ])
          .join("\n");
        const timelineEntry = `${deps.nowIso()} - Accepted supervisor review for ${ticket.title}.`;
        yield* persistPromotionCandidate({
          sourceTicketId: TicketId.make(input.ticketId),
          sourceAttemptId: AttemptId.make(input.attemptId),
          family: "bug-patterns",
          title: `${ticket.title} review insight`,
          slug: `${sanitizeProjectionSegment(ticket.title, "ticket")}-${input.attemptId.slice(-8)}`,
          compiledTruth:
            compiledTruth ||
            "Accepted work should be promoted only after review confirms the mechanism and evidence.",
          timelineEntry,
        });
        yield* deps.syncBoardProjectionBestEffort(
          input.boardId,
          "Accepted attempt promotion candidate updated brain projections.",
        );
      }).pipe(
        Effect.mapError((cause) =>
          deps.presenceError("Failed to ensure promotion candidate for accepted attempt.", cause),
        ),
      );

  const evaluateSupervisorActionInternal: PresenceBoardServiceInternals["evaluateSupervisorActionInternal"] = (
    input,
  ) =>
      Effect.gen(function* () {
        const ticket = yield* deps.readTicketForPolicy(input.ticketId);
        if (!ticket) {
          return yield* Effect.fail(deps.presenceError(`Ticket '${input.ticketId}' not found.`));
        }

        const attemptContext =
          input.attemptId && input.attemptId.trim().length > 0
            ? yield* deps.readAttemptWorkspaceContext(input.attemptId)
            : null;

        const findings = yield* deps.readFindingsForTicket(input.ticketId);
        const attemptOutcomes = yield* deps.readAttemptOutcomesForTicket(input.ticketId);
        const capabilityScan = yield* getOrCreateCapabilityScan(ticket.repositoryId);
        const unresolvedBlockingFindings = findings.filter(
          (finding) =>
            finding.status === "open" &&
            finding.severity === "blocking" &&
            (input.attemptId === undefined ||
              input.attemptId === null ||
              finding.attemptId === null ||
              finding.attemptId === input.attemptId),
        ).length;
        const retryBlocked =
          repeatedFailureKindForTicket(attemptOutcomes) !== null &&
          findings.some(
            (finding) =>
              finding.status === "open" &&
              finding.severity === "blocking" &&
              finding.source === "supervisor" &&
              finding.disposition === "escalate",
          );

        return yield* deps.supervisorPolicy.evaluate({
          action: input.action,
          ticketStatus: decode(PresenceTicketStatus)(ticket.status),
          attemptStatus: attemptContext
            ? decode(PresenceAttemptStatus)(attemptContext.attemptStatus)
            : null,
          attemptBelongsToTicket: attemptContext ? attemptContext.ticketId === input.ticketId : false,
          attemptHasExecutionContext: attemptContext ? hasAttemptExecutionContext(attemptContext) : false,
          checklistComplete: checklistIsComplete(ticket.acceptanceChecklist),
          capabilityScan,
          unresolvedBlockingFindings,
          retryBlocked,
        });
        }).pipe(
          Effect.mapError((cause) =>
            deps.presenceError("Failed to evaluate supervisor action.", cause),
          ),
      );

  return {
  listRepositories: (): Effect.Effect<ReadonlyArray<RepositorySummary>, PresenceRpcError, never> =>
    deps.sql<RepositoryRow>`
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
      ORDER BY updated_at DESC, created_at DESC
    `.pipe(
      Effect.map((rows: ReadonlyArray<RepositoryRow>) => rows.map(deps.mapRepository)),
      Effect.catch((cause) =>
        Effect.fail(deps.presenceError("Failed to list repositories.", cause)),
      ),
    ),

  importRepository: (
    input: PresenceImportRepositoryInput,
  ): Effect.Effect<RepositorySummary, PresenceRpcError, never> =>
    Effect.gen(function* () {
      const existing = yield* deps.readRepositoryByWorkspaceRoot(input.workspaceRoot);
      if (existing) {
        return deps.mapRepository(existing);
      }

      const currentReadModel = yield* deps.orchestrationEngine.getReadModel();
      const existingProject = currentReadModel.projects.find(
        (project: { workspaceRoot: string }) => project.workspaceRoot === input.workspaceRoot,
      );
      const providers = yield* deps.providerRegistry.getProviders;
      const defaultModelSelection =
        existingProject?.defaultModelSelection ??
        deps.chooseDefaultModelSelection(providers);
      const projectId =
        existingProject?.id ?? ProjectId.make(`presence_project_${crypto.randomUUID()}`);
      const title = input.title ?? deps.titleFromPath(input.workspaceRoot);
      const createdAt = deps.nowIso();

      if (!existingProject) {
        yield* deps.orchestrationEngine.dispatch({
          type: "project.create",
          commandId: CommandId.make(`presence_project_create_${crypto.randomUUID()}`),
          projectId,
          title,
          workspaceRoot: input.workspaceRoot,
          defaultModelSelection,
          createdAt,
        });
      }

      const repositoryId = deps.makeId(RepositoryId, "repository");
      const boardId = deps.makeId(BoardId, "board");
      yield* deps.sql.withTransaction(
        Effect.gen(function* () {
          yield* deps.sql`
            INSERT INTO presence_repositories (
              repository_id, board_id, project_id, title, workspace_root,
              default_model_selection_json, created_at, updated_at
            ) VALUES (
              ${repositoryId},
              ${boardId},
              ${projectId},
              ${title},
              ${input.workspaceRoot},
              ${deps.encodeJson(defaultModelSelection)},
              ${createdAt},
              ${createdAt}
            )
          `;
          yield* deps.sql`
            INSERT INTO presence_boards (
              board_id, repository_id, title, sprint_focus, top_priority_summary, created_at, updated_at
            ) VALUES (
              ${boardId},
              ${repositoryId},
              ${title},
              ${null},
              ${"Establish the first trustworthy supervisor-managed loop."},
              ${createdAt},
              ${createdAt}
            )
          `;
        }),
      );

      yield* scanRepositoryCapabilitiesInternal({
        id: repositoryId,
        boardId,
        workspaceRoot: input.workspaceRoot,
      });
      yield* deps.syncBoardProjectionBestEffort(boardId, "Repository imported.");

      return {
        id: RepositoryId.make(repositoryId),
        boardId: BoardId.make(boardId),
        projectId: ProjectId.make(projectId),
        title,
        workspaceRoot: input.workspaceRoot,
        defaultModelSelection,
        createdAt,
        updatedAt: createdAt,
      };
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(deps.presenceError("Failed to import repository.", cause)),
      ),
    ),

  getBoardSnapshot: (
    input: PresenceGetBoardSnapshotInput,
  ): Effect.Effect<BoardSnapshot, PresenceRpcError, never> =>
    Effect.gen(function* () {
      const snapshot = yield* getBoardSnapshotInternal(input.boardId);
      if (
        snapshot.boardProjectionHealth &&
        deps.projectionIsRepairEligible(snapshot.boardProjectionHealth)
      ) {
        yield* deps.runProjectionWorker().pipe(Effect.forkDetach, Effect.asVoid);
      }
      for (const health of snapshot.ticketProjectionHealth) {
        if (deps.projectionIsRepairEligible(health)) {
          yield* deps.runProjectionWorker().pipe(Effect.forkDetach, Effect.asVoid);
          break;
        }
      }
      return snapshot;
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(deps.presenceError("Failed to load board snapshot.", cause)),
      ),
    ),

  getRepositoryCapabilities: (
    input: PresenceGetRepositoryCapabilitiesInput,
  ): Effect.Effect<RepositoryCapabilityScanRecord | null, PresenceRpcError, never> =>
    deps.readLatestCapabilityScan(input.repositoryId).pipe(
      Effect.catch((cause) =>
        Effect.fail(deps.presenceError("Failed to load repository capabilities.", cause)),
      ),
    ),

  scanRepositoryCapabilities: (
    input: PresenceScanRepositoryCapabilitiesInput,
  ): Effect.Effect<RepositoryCapabilityScanRecord, PresenceRpcError, never> =>
    Effect.gen(function* () {
      const repository = yield* deps.readRepositoryById(input.repositoryId);
      if (!repository) {
        return yield* Effect.fail(
          deps.presenceError(
            `Repository '${input.repositoryId}' could not be found for capability scan.`,
          ),
        );
      }
      return yield* scanRepositoryCapabilitiesInternal(repository);
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(deps.presenceError("Failed to scan repository capabilities.", cause)),
      ),
    ),

  createTicket: (
    input: PresenceCreateTicketInput,
  ): Effect.Effect<TicketRecord, PresenceRpcError, never> =>
    Effect.gen(function* () {
      const createdAt = deps.nowIso();
      const ticketId = deps.makeId(TicketId, "ticket");
      const checklist: ReadonlyArray<PresenceAcceptanceChecklistItem> =
        input.acceptanceChecklist ?? [
          { id: `check_${crypto.randomUUID()}`, label: "Mechanism understood", checked: false },
          { id: `check_${crypto.randomUUID()}`, label: "Evidence attached", checked: false },
          {
            id: `check_${crypto.randomUUID()}`,
        label: "Reviewer validation captured",
            checked: false,
          },
        ];
      yield* deps.sql`
        INSERT INTO presence_tickets (
          ticket_id, board_id, parent_ticket_id, title, description, status, priority,
          acceptance_checklist_json, assigned_attempt_id, created_at, updated_at
        ) VALUES (
          ${ticketId},
          ${input.boardId},
          ${null},
          ${input.title},
          ${input.description},
          ${"todo"},
          ${input.priority},
          ${deps.encodeJson(checklist)},
          ${null},
          ${createdAt},
          ${createdAt}
        )
      `;
      const ticketRecord = {
        id: TicketId.make(ticketId),
        boardId: input.boardId,
        parentTicketId: null,
        title: input.title,
        description: input.description,
        status: "todo" as const,
        priority: input.priority,
        acceptanceChecklist: checklist,
        assignedAttemptId: null,
        createdAt,
        updatedAt: createdAt,
      };
      yield* deps.syncTicketProjectionBestEffort(ticketId, "Ticket created.");
      return ticketRecord;
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(deps.presenceError("Failed to create ticket.", cause)),
      ),
    ),

  updateTicket: (
    input: PresenceUpdateTicketInput,
  ): Effect.Effect<TicketRecord, PresenceRpcError, never> =>
    Effect.gen(function* () {
      const existing = yield* deps.sql<TicketRow>`
        SELECT
          ticket_id as id, board_id as "boardId", parent_ticket_id as "parentTicketId",
          title, description, status, priority,
          acceptance_checklist_json as "acceptanceChecklist",
          assigned_attempt_id as "assignedAttemptId",
          created_at as "createdAt", updated_at as "updatedAt"
        FROM presence_tickets
        WHERE ticket_id = ${input.ticketId}
      `.pipe(Effect.map((rows: ReadonlyArray<TicketRow>) => rows[0] ?? null));
      if (!existing) {
        return yield* Effect.fail(
          deps.presenceError(`Ticket '${input.ticketId}' not found.`),
        );
      }
      const updatedAt = deps.nowIso();
      const nextChecklist =
        input.acceptanceChecklist ??
        deps.decodeJson<ReadonlyArray<PresenceAcceptanceChecklistItem>>(
          existing.acceptanceChecklist,
          [],
        );
      yield* deps.sql`
        UPDATE presence_tickets
        SET
          title = ${input.title ?? existing.title},
          description = ${input.description ?? existing.description},
          status = ${input.status ?? existing.status},
          priority = ${input.priority ?? existing.priority},
          acceptance_checklist_json = ${deps.encodeJson(nextChecklist)},
          updated_at = ${updatedAt}
        WHERE ticket_id = ${input.ticketId}
      `;
      const ticketRecord = deps.mapTicket({
        ...existing,
        title: input.title ?? existing.title,
        description: input.description ?? existing.description,
        status: input.status ?? existing.status,
        priority: input.priority ?? existing.priority,
        acceptanceChecklist: deps.encodeJson(nextChecklist),
        updatedAt,
      });
      yield* deps.syncTicketProjectionBestEffort(input.ticketId, "Ticket updated.");
      return ticketRecord;
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(deps.presenceError("Failed to update ticket.", cause)),
      ),
    ),

  saveSupervisorHandoff: (
    input: PresenceSaveSupervisorHandoffInput,
  ): Effect.Effect<SupervisorHandoffRecord, PresenceRpcError, never> =>
    Effect.gen(function* () {
      const handoffId = deps.makeId(HandoffId, "handoff");
      const createdAt = deps.nowIso();
      yield* deps.sql`
        INSERT INTO presence_handoffs (
          handoff_id, board_id, attempt_id, role, payload_json, created_at
        ) VALUES (
          ${handoffId},
          ${input.boardId},
          ${null},
          ${"supervisor"},
          ${deps.encodeJson({
            topPriorities: input.topPriorities,
            activeAttemptIds: input.activeAttemptIds,
            blockedTicketIds: input.blockedTicketIds,
            recentDecisions: input.recentDecisions,
            nextBoardActions: input.nextBoardActions,
            currentRunId: input.currentRunId ?? null,
            stage: input.stage ?? null,
            resumeProtocol:
              input.resumeProtocol ?? DEFAULT_PRESENCE_RESUME_PROTOCOL.supervisorReadOrder,
          })},
          ${createdAt}
        )
      `;
      const handoffRecord = {
        id: handoffId,
        boardId: input.boardId,
        topPriorities: input.topPriorities,
        activeAttemptIds: input.activeAttemptIds,
        blockedTicketIds: input.blockedTicketIds,
        recentDecisions: input.recentDecisions,
        nextBoardActions: input.nextBoardActions,
        currentRunId: input.currentRunId ?? null,
        stage: input.stage ?? null,
        resumeProtocol:
          input.resumeProtocol ?? DEFAULT_PRESENCE_RESUME_PROTOCOL.supervisorReadOrder,
        createdAt,
      };
      yield* deps.syncBoardProjectionBestEffort(input.boardId, "Supervisor handoff saved.");
      return handoffRecord;
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(deps.presenceError("Failed to save supervisor handoff.", cause)),
      ),
    ),

  createFollowUpProposal: (
    input: PresenceCreateFollowUpProposalInput,
  ): Effect.Effect<ProposedFollowUpRecord, PresenceRpcError, never> =>
    Effect.gen(function* () {
      const ticket = yield* deps.sql<{ id: string }>`
        SELECT ticket_id as id
        FROM presence_tickets
        WHERE ticket_id = ${input.parentTicketId}
      `.pipe(Effect.map((rows: ReadonlyArray<{ id: string }>) => rows[0] ?? null));
      if (!ticket) {
        return yield* Effect.fail(
          deps.presenceError(`Ticket '${input.parentTicketId}' not found.`),
        );
      }
      const proposalId = deps.makeId(ProposedFollowUpId, "follow_up");
      const createdAt = deps.nowIso();
      yield* deps.sql`
        INSERT INTO presence_follow_up_proposals (
          proposed_follow_up_id, parent_ticket_id, originating_attempt_id, kind, title, description,
          priority, status, finding_ids_json, requires_human_confirmation,
          created_ticket_id, created_at, updated_at
        ) VALUES (
          ${proposalId},
          ${input.parentTicketId},
          ${input.originatingAttemptId ?? null},
          ${input.kind},
          ${input.title},
          ${input.description},
          ${input.priority},
          ${"open"},
          ${deps.encodeJson(input.findingIds)},
          ${1},
          ${null},
          ${createdAt},
          ${createdAt}
        )
      `;
      const proposal = {
        id: ProposedFollowUpId.make(proposalId),
        parentTicketId: TicketId.make(input.parentTicketId),
        originatingAttemptId: input.originatingAttemptId
          ? AttemptId.make(input.originatingAttemptId)
          : null,
        kind: input.kind,
        title: input.title,
        description: input.description,
        priority: input.priority,
        status: "open" as const,
        findingIds: input.findingIds.map((value) => FindingId.make(value)),
        requiresHumanConfirmation: true,
        createdTicketId: null,
        createdAt,
        updatedAt: createdAt,
      } satisfies ProposedFollowUpRecord;
      yield* deps.syncTicketProjectionBestEffort(
        input.parentTicketId,
        "Follow-up proposal created.",
      );
      return proposal;
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(deps.presenceError("Failed to create follow-up proposal.", cause)),
      ),
    ),

  materializeFollowUp: (
    input: PresenceMaterializeFollowUpInput,
  ): Effect.Effect<TicketRecord, PresenceRpcError, never> =>
    Effect.gen(function* () {
      const proposal = yield* deps.sql<ProposedFollowUpRow>`
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
        WHERE proposed_follow_up_id = ${input.proposalId}
      `.pipe(Effect.map((rows: ReadonlyArray<ProposedFollowUpRow>) => rows[0] ?? null));
      if (!proposal) {
        return yield* Effect.fail(
          deps.presenceError(`Follow-up proposal '${input.proposalId}' not found.`),
        );
      }
      if (proposal.kind === "request_changes") {
        return yield* Effect.fail(
          deps.presenceError(
            "Request-changes follow-up proposals do not materialize into child tickets.",
          ),
        );
      }
      if (proposal.createdTicketId) {
        const existing = yield* deps.sql<TicketRow>`
          SELECT
            ticket_id as id, board_id as "boardId", parent_ticket_id as "parentTicketId",
            title, description, status, priority,
            acceptance_checklist_json as "acceptanceChecklist",
            assigned_attempt_id as "assignedAttemptId",
            created_at as "createdAt", updated_at as "updatedAt"
          FROM presence_tickets
          WHERE ticket_id = ${proposal.createdTicketId}
        `.pipe(Effect.map((rows: ReadonlyArray<TicketRow>) => rows[0] ?? null));
        if (!existing) {
          return yield* Effect.fail(
            deps.presenceError(
              `Follow-up proposal '${input.proposalId}' points to a missing ticket.`,
            ),
          );
        }
        return deps.mapTicket(existing);
      }
      const parentTicket = yield* deps.sql<{ id: string; boardId: string }>`
        SELECT ticket_id as id, board_id as "boardId"
        FROM presence_tickets
        WHERE ticket_id = ${proposal.parentTicketId}
      `.pipe(
        Effect.map(
          (rows: ReadonlyArray<{ id: string; boardId: string }>) => rows[0] ?? null,
        ),
      );
      if (!parentTicket) {
        return yield* Effect.fail(
          deps.presenceError(
            `Parent ticket '${proposal.parentTicketId}' could not be loaded.`,
          ),
        );
      }
      const ticketId = deps.makeId(TicketId, "ticket");
      const createdAt = deps.nowIso();
      const checklist: PresenceAcceptanceChecklistItem[] = [
        { id: `check_${crypto.randomUUID()}`, label: "Mechanism understood", checked: false },
        { id: `check_${crypto.randomUUID()}`, label: "Evidence attached", checked: false },
      { id: `check_${crypto.randomUUID()}`, label: "Reviewer validation captured", checked: false },
      ];
      yield* deps.sql.withTransaction(
        Effect.gen(function* () {
          yield* deps.sql`
            INSERT INTO presence_tickets (
              ticket_id, board_id, parent_ticket_id, title, description, status, priority,
              acceptance_checklist_json, assigned_attempt_id, created_at, updated_at
            ) VALUES (
              ${ticketId},
              ${parentTicket.boardId},
              ${proposal.parentTicketId},
              ${proposal.title},
              ${proposal.description},
              ${proposal.kind === "blocker_ticket" ? "blocked" : "todo"},
              ${proposal.priority},
              ${deps.encodeJson(checklist)},
              ${null},
              ${createdAt},
              ${createdAt}
            )
          `;
          yield* deps.sql`
            UPDATE presence_follow_up_proposals
            SET
              status = ${"resolved"},
              created_ticket_id = ${ticketId},
              updated_at = ${createdAt}
            WHERE proposed_follow_up_id = ${input.proposalId}
          `;
        }),
      );
      yield* deps.syncTicketProjectionBestEffort(
        proposal.parentTicketId,
        "Follow-up proposal materialized on parent ticket.",
      );
      yield* deps.syncTicketProjectionBestEffort(
        ticketId,
        "Follow-up ticket materialized.",
      );
      return {
        id: TicketId.make(ticketId),
        boardId: BoardId.make(parentTicket.boardId),
        parentTicketId: TicketId.make(proposal.parentTicketId),
        title: proposal.title,
        description: proposal.description,
        status: proposal.kind === "blocker_ticket" ? "blocked" : "todo",
        priority: decode(PresenceTicketPriority)(proposal.priority),
        acceptanceChecklist: checklist,
        assignedAttemptId: null,
        createdAt,
        updatedAt: createdAt,
      } satisfies TicketRecord;
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(deps.presenceError("Failed to materialize follow-up.", cause)),
      ),
    ),

  syncTicketProjection: (input) =>
    deps
      .syncProjectionStrict(
        "ticket",
        input.ticketId,
        "Manual ticket projection sync requested.",
      )
      .pipe(
        Effect.catch((cause) =>
          Effect.fail(deps.presenceError("Failed to sync ticket projection.", cause)),
        ),
      ),

  syncBrainProjection: (input) =>
    deps
      .syncProjectionStrict(
        "board",
        input.boardId,
        "Manual board projection sync requested.",
      )
      .pipe(
        Effect.catch((cause) =>
          Effect.fail(deps.presenceError("Failed to sync brain projection.", cause)),
        ),
      ),

  upsertKnowledgePage: (
    input: PresenceUpsertKnowledgePageInput,
  ): Effect.Effect<KnowledgePageRecord, PresenceRpcError, never> =>
    Effect.gen(function* () {
      const existing = yield* deps.sql<{
        id: string;
        createdAt: string;
      }>`
        SELECT knowledge_page_id as id, created_at as "createdAt"
        FROM presence_knowledge_pages
        WHERE board_id = ${input.boardId} AND family = ${input.family} AND slug = ${input.slug}
      `.pipe(
        Effect.map(
          (rows: ReadonlyArray<{ id: string; createdAt: string }>) => rows[0] ?? null,
        ),
      );
      const knowledgePageId = existing?.id
        ? KnowledgePageId.make(existing.id)
        : deps.makeId(KnowledgePageId, "knowledge");
      const createdAt = existing?.createdAt ?? deps.nowIso();
      const updatedAt = deps.nowIso();
      yield* deps.sql`
        INSERT INTO presence_knowledge_pages (
          knowledge_page_id, board_id, family, slug, title, compiled_truth, timeline,
          linked_ticket_ids_json, created_at, updated_at
        ) VALUES (
          ${knowledgePageId},
          ${input.boardId},
          ${input.family},
          ${input.slug},
          ${input.title},
          ${input.compiledTruth},
          ${input.timeline},
          ${deps.encodeJson(input.linkedTicketIds)},
          ${createdAt},
          ${updatedAt}
        )
        ON CONFLICT (board_id, family, slug)
        DO UPDATE SET
          title = excluded.title,
          compiled_truth = excluded.compiled_truth,
          timeline = excluded.timeline,
          linked_ticket_ids_json = excluded.linked_ticket_ids_json,
          updated_at = excluded.updated_at
      `;
      const knowledgePage = {
        id: knowledgePageId,
        boardId: input.boardId,
        family: input.family,
        slug: input.slug,
        title: input.title,
        compiledTruth: input.compiledTruth,
        timeline: input.timeline,
        linkedTicketIds: input.linkedTicketIds,
        createdAt,
        updatedAt,
      };
      yield* deps.syncBoardProjectionBestEffort(input.boardId, "Knowledge page upserted.");
      return knowledgePage;
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(deps.presenceError("Failed to upsert knowledge page.", cause)),
      ),
    ),

  createPromotionCandidate: (
    input: PresenceCreatePromotionCandidateInput,
  ): Effect.Effect<PromotionCandidateRecord, PresenceRpcError, never> =>
    persistPromotionCandidate(input).pipe(
      Effect.catch((cause) =>
        Effect.fail(deps.presenceError("Failed to create promotion candidate.", cause)),
      ),
    ),

  reviewPromotionCandidate: (
    input: PresenceReviewPromotionCandidateInput,
  ): Effect.Effect<PromotionCandidateRecord, PresenceRpcError, never> =>
    Effect.gen(function* () {
      const updatedAt = deps.nowIso();
      yield* deps.sql`
        UPDATE presence_promotion_candidates
        SET status = ${input.status}, updated_at = ${updatedAt}
        WHERE promotion_candidate_id = ${input.promotionCandidateId}
      `;
      const row = yield* deps.sql<PromotionCandidateRow>`
        SELECT
          promotion_candidate_id as id, source_ticket_id as "sourceTicketId",
          source_attempt_id as "sourceAttemptId", family, title, slug, compiled_truth as "compiledTruth",
          timeline_entry as "timelineEntry", status, created_at as "createdAt", updated_at as "updatedAt"
        FROM presence_promotion_candidates
        WHERE promotion_candidate_id = ${input.promotionCandidateId}
      `.pipe(Effect.map((rows: ReadonlyArray<PromotionCandidateRow>) => rows[0] ?? null));
      if (!row) {
        return yield* Effect.fail(
          deps.presenceError(
            `Promotion candidate '${input.promotionCandidateId}' not found.`,
          ),
        );
      }
      return deps.mapPromotionCandidate(row);
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(deps.presenceError("Failed to review promotion candidate.", cause)),
      ),
    ),

  createDeterministicJob: (
    input: PresenceCreateDeterministicJobInput,
  ): Effect.Effect<DeterministicJobRecord, PresenceRpcError, never> =>
    Effect.gen(function* () {
      const jobId = deps.makeId(DeterministicJobId, "job");
      const createdAt = deps.nowIso();
      yield* deps.sql`
        INSERT INTO presence_deterministic_jobs (
          deterministic_job_id, board_id, title, kind, status, progress,
          output_summary, error_message, created_at, updated_at
        ) VALUES (
          ${jobId},
          ${input.boardId},
          ${input.title},
          ${input.kind},
          ${"queued"},
          ${0},
          ${null},
          ${null},
          ${createdAt},
          ${createdAt}
        )
      `;
      return {
        id: jobId,
        boardId: input.boardId,
        title: input.title,
        kind: input.kind,
        status: "queued" as const,
        progress: 0,
        outputSummary: null,
        errorMessage: null,
        createdAt,
        updatedAt: createdAt,
      };
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(deps.presenceError("Failed to create deterministic job.", cause)),
      ),
    ),

  evaluateSupervisorAction: (input) =>
    evaluateSupervisorActionInternal({
        action: input.action,
        ticketId: input.ticketId,
        attemptId: input.attemptId ?? null,
      })
      .pipe(
        Effect.catch((cause) =>
          Effect.fail(deps.presenceError("Failed to evaluate supervisor action.", cause)),
        ),
      ),

  submitGoalIntake: (
    input: PresenceSubmitGoalIntakeInput,
  ): Effect.Effect<GoalIntakeResult, PresenceRpcError, never> =>
    Effect.gen(function* () {
      const repository = yield* deps.sql<{ boardId: string; repositoryId: string }>`
        SELECT board_id as "boardId", repository_id as "repositoryId"
        FROM presence_boards
        WHERE board_id = ${input.boardId}
      `.pipe(
        Effect.map(
          (rows: ReadonlyArray<{ boardId: string; repositoryId: string }>) =>
            rows[0] ?? null,
        ),
      );
      if (!repository) {
        return yield* Effect.fail(
          deps.presenceError(`Board '${input.boardId}' not found.`),
        );
      }

      yield* getOrCreateCapabilityScan(repository.repositoryId);

      const createdAt = deps.nowIso();
      const intakeId = deps.makeId(GoalIntakeId, "goal");
      const summary = "Presence queued this goal and will review the repo before creating tickets.";

      yield* deps.sql`
        INSERT INTO presence_goal_intakes (
          goal_intake_id, board_id, source, raw_goal, summary, created_ticket_ids_json, created_at
        ) VALUES (
          ${intakeId},
          ${input.boardId},
          ${input.source},
          ${input.rawGoal},
          ${summary},
          ${deps.encodeJson([])},
          ${createdAt}
        )
      `;

      return {
        intake: {
          id: GoalIntakeId.make(intakeId),
          boardId: BoardId.make(input.boardId),
          source: input.source,
          rawGoal: input.rawGoal,
          summary,
          createdTicketIds: [],
          createdAt,
        },
        createdTickets: [],
        decomposed: false,
      } satisfies GoalIntakeResult;
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(deps.presenceError("Failed to submit supervisor goal intake.", cause)),
      ),
    ),

    getBoardSnapshotInternal,
    materializeGoalIntakePlan,
    scanRepositoryCapabilitiesInternal,
    getOrCreateCapabilityScan,
    ensurePromotionCandidateForAcceptedAttempt,
    evaluateSupervisorActionInternal,
  };
};

export { makePresenceBoardService };
export type { PresenceBoardServiceCore };
