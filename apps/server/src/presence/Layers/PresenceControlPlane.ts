import { promises as nodeFs } from "node:fs";
import path from "node:path";

import {
  AgentSessionRecord,
  AttemptId,
  type AttemptRecord,
  type AttemptSummary,
  BoardId,
  type BoardRecord,
  BoardSnapshot,
  CapabilityScanId,
  CommandId,
  DEFAULT_PRESENCE_RESUME_PROTOCOL,
  type DeterministicJobRecord,
  DeterministicJobId,
  EvidenceId,
  GoalIntakeId,
  GoalIntakeSource,
  type GoalIntakeRecord,
  type GoalIntakeResult,
  HandoffId,
  type KnowledgePageRecord,
  KnowledgePageId,
  MessageId,
  type ModelSelection,
  PresenceAttachThreadInput,
  PresenceCleanupWorkspaceInput,
  PresenceCreateAttemptInput,
  PresenceCreateDeterministicJobInput,
  PresenceCreatePromotionCandidateInput,
  PresenceEvaluateSupervisorActionInput,
  PresenceGetRepositoryCapabilitiesInput,
  PresencePrepareWorkspaceInput,
  PresenceRecordValidationWaiverInput,
  PresenceRunAttemptValidationInput,
  type PresenceAcceptanceChecklistItem,
  PresenceCreateTicketInput,
  PresenceGetBoardSnapshotInput,
  PresenceImportRepositoryInput,
  PresenceListRepositoriesInput,
  PresenceScanRepositoryCapabilitiesInput,
  PresencePromotionStatus,
  PresenceReviewDecisionKind,
  PresenceReviewPromotionCandidateInput,
  PresenceRpcError,
  PresenceSubmitGoalIntakeInput,
  PresenceSaveAttemptEvidenceInput,
  PresenceSaveSupervisorHandoffInput,
  PresenceSaveWorkerHandoffInput,
  PresenceStartAttemptSessionInput,
  PresenceAttemptStatus,
  PresenceJobStatus,
  PresenceKnowledgeFamily,
  type RepositoryCapabilityCommand,
  type RepositoryCapabilityScanRecord,
  RepositoryCommandKind,
  PresenceTicketPriority,
  PresenceSubmitReviewDecisionInput,
  PresenceTicketStatus,
  PresenceUpdateTicketInput,
  PresenceUpsertKnowledgePageInput,
  PresenceWorkspaceStatus,
  ProviderKind,
  type PromotionCandidateRecord,
  PromotionCandidateId,
  ProjectId,
  RepositoryId,
  type RepositorySummary,
  ReviewDecisionId,
  type ReviewDecisionRecord,
  type SupervisorPolicyDecision,
  type SupervisorActionKind,
  type SupervisorHandoffRecord,
  ThreadId,
  TicketId,
  type TicketRecord,
  type ValidationWaiverRecord,
  ValidationWaiverId,
  ValidationRunId,
  type ValidationRunRecord,
  type WorkspaceRecord,
  WorkspaceId,
  type WorkerHandoffRecord,
  type AttemptEvidenceRecord,
} from "@t3tools/contracts";
import { resolveAutoFeatureBranchName } from "@t3tools/shared/git";
import { Effect, Layer, Result, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { GitCore } from "../../git/Services/GitCore.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { PresenceControlPlane, type PresenceControlPlaneShape } from "../Services/PresenceControlPlane.ts";
import { SupervisorPolicyLive } from "./SupervisorPolicy.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { SupervisorPolicy } from "../Services/SupervisorPolicy.ts";
import { runProcess } from "../../processRunner.ts";

const encodeJson = (value: unknown) => JSON.stringify(value);

function decodeJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function summarizeCommandOutput(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (normalized.length === 0) return null;
  return normalized.slice(0, 600);
}

function isEvidenceChecklistItem(item: PresenceAcceptanceChecklistItem): boolean {
  return /evidence attached/i.test(item.label);
}

function isValidationChecklistItem(item: PresenceAcceptanceChecklistItem): boolean {
  return /validation recorded|tests? or validation captured/i.test(item.label);
}

function makeValidationShellInvocation(commandLine: string): {
  command: string;
  args: ReadonlyArray<string>;
} {
  if (process.platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", commandLine],
    };
  }

  return {
    command: "sh",
    args: ["-lc", commandLine],
  };
}

function presenceError(message: string, cause?: unknown) {
  return new PresenceRpcError({ message, ...(cause !== undefined ? { cause } : {}) });
}

function makeId<T extends { make: (value: string) => any }>(schema: T, prefix: string) {
  return schema.make(`${prefix}_${crypto.randomUUID()}`);
}

function titleFromPath(workspaceRoot: string): string {
  const normalized = workspaceRoot.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/);
  return parts.at(-1) || workspaceRoot;
}

function chooseDefaultModelSelection(
  providers: ReadonlyArray<{
    provider: string;
    enabled: boolean;
    installed: boolean;
    status: string;
    models: ReadonlyArray<{ slug: string }>;
  }>,
): ModelSelection | null {
  const preferredProviders = ["codex", "claudeAgent"];
  for (const providerName of preferredProviders) {
    const provider = providers.find(
      (candidate) =>
        candidate.provider === providerName &&
        candidate.enabled &&
        candidate.installed &&
        candidate.status !== "error" &&
        candidate.models.length > 0,
    );
    if (!provider) continue;
    if (provider.provider === "codex") {
      return {
        provider: "codex",
        model: provider.models[0]!.slug,
      };
    }
    if (provider.provider === "claudeAgent") {
      return {
        provider: "claudeAgent",
        model: provider.models[0]!.slug,
      };
    }
  }
  return null;
}

async function readTextFileIfPresent(filePath: string): Promise<string | null> {
  try {
    return await nodeFs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function uniqueStrings(values: ReadonlyArray<string>): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function shortTitle(value: string, fallback: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  return normalized.length <= 72 ? normalized : `${normalized.slice(0, 69).trimEnd()}...`;
}

function normalizeGoalParts(rawGoal: string): { parts: string[]; decomposed: boolean } {
  const lines = rawGoal
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const bulletLines = lines
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, "").trim())
    .filter(Boolean);

  const hasStructuredList =
    lines.length > 1 &&
    lines.every((line) => /^[-*]\s+/.test(line) || /^\d+[.)]\s+/.test(line));

  if (hasStructuredList) {
    return { parts: uniqueStrings(bulletLines), decomposed: bulletLines.length > 1 };
  }

  const semicolonParts = rawGoal
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  if (semicolonParts.length > 1) {
    return { parts: uniqueStrings(semicolonParts), decomposed: true };
  }

  return { parts: [rawGoal.trim()], decomposed: false };
}

const makePresenceControlPlane = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const gitCore = yield* GitCore;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const providerRegistry = yield* ProviderRegistry;
  const supervisorPolicy = yield* SupervisorPolicy;

  const readRepositoryByWorkspaceRoot = (workspaceRoot: string) =>
    sql<{
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
    `.pipe(Effect.map((rows) => rows[0] ?? null));

  const readRepositoryById = (repositoryId: string) =>
    sql<{
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
    `.pipe(Effect.map((rows) => rows[0] ?? null));

  const readLatestCapabilityScan = (repositoryId: string) =>
    sql<any>`
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
    `.pipe(Effect.map((rows) => (rows[0] ? mapCapabilityScan(rows[0]) : null)));

  const readTicketForPolicy = (ticketId: string) =>
    sql<{
      id: string;
      boardId: string;
      repositoryId: string;
      status: typeof PresenceTicketStatus.Type;
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
    `.pipe(Effect.map((rows) => rows[0] ?? null));

  const readValidationWaiversForTicket = (ticketId: string) =>
    sql<{
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
    `.pipe(Effect.map((rows) => rows.map(mapValidationWaiver)));

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
    status: typeof PresenceTicketStatus.Type;
    priority: string;
    acceptanceChecklist: string;
    assignedAttemptId: string | null;
    createdAt: string;
    updatedAt: string;
  }): TicketRecord => ({
    id: TicketId.make(row.id),
    boardId: BoardId.make(row.boardId),
    parentTicketId: row.parentTicketId ? TicketId.make(row.parentTicketId) : null,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: Schema.decodeSync(PresenceTicketPriority)(row.priority as never),
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
    status: Schema.decodeSync(PresenceAttemptStatus)(row.status as never),
    provider: row.provider ? Schema.decodeSync(ProviderKind)(row.provider as never) : null,
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
  }): WorkspaceRecord => ({
    id: WorkspaceId.make(row.id),
    attemptId: AttemptId.make(row.attemptId),
    status: Schema.decodeSync(PresenceWorkspaceStatus)(row.status as never),
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
    }>(row.payload, {
      topPriorities: [],
      activeAttemptIds: [],
      blockedTicketIds: [],
      recentDecisions: [],
      nextBoardActions: [],
    });
    return {
      id: HandoffId.make(row.id),
      boardId: BoardId.make(row.boardId),
      topPriorities: payload.topPriorities,
      activeAttemptIds: payload.activeAttemptIds.map((value) => AttemptId.make(value)),
      blockedTicketIds: payload.blockedTicketIds.map((value) => TicketId.make(value)),
      recentDecisions: payload.recentDecisions,
      nextBoardActions: payload.nextBoardActions,
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
      confidence: number | null;
      evidenceIds: string[];
    }>(row.payload, {
      completedWork: [],
      currentHypothesis: null,
      changedFiles: [],
      testsRun: [],
      blockers: [],
      nextStep: null,
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
      confidence: payload.confidence,
      evidenceIds: payload.evidenceIds.map((value) => EvidenceId.make(value)),
      createdAt: row.createdAt,
    };
  };

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
    commandKind: Schema.decodeSync(RepositoryCommandKind)(row.commandKind as never),
    command: row.command,
    status: Schema.decodeSync(Schema.Literals(["running", "passed", "failed"]))(row.status as never),
    exitCode: row.exitCode,
    stdoutSummary: row.stdoutSummary,
    stderrSummary: row.stderrSummary,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
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
    family: Schema.decodeSync(PresenceKnowledgeFamily)(row.family as never),
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
    family: Schema.decodeSync(PresenceKnowledgeFamily)(row.family as never),
    title: row.title,
    slug: row.slug,
    compiledTruth: row.compiledTruth,
    timelineEntry: row.timelineEntry,
    status: Schema.decodeSync(PresencePromotionStatus)(row.status as never),
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
    status: Schema.decodeSync(PresenceJobStatus)(row.status as never),
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
    decision: Schema.decodeSync(PresenceReviewDecisionKind)(row.decision as never),
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
    source: Schema.decodeSync(GoalIntakeSource)(row.source as never),
    rawGoal: row.rawGoal,
    summary: row.summary,
    createdTicketIds: decodeJson<string[]>(row.createdTicketIds, []).map((value) => TicketId.make(value)),
    createdAt: row.createdAt,
  });

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

  const readAttemptWorkspaceContext = (attemptId: string) =>
    sql<AttemptWorkspaceContextRow>`
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
    `.pipe(Effect.map((rows) => rows[0] ?? null));

  const syncThreadWorkspaceMetadata = (input: {
    threadId: string;
    branch: string | null;
    worktreePath: string | null;
  }) =>
    orchestrationEngine.dispatch({
      type: "thread.meta.update",
      commandId: CommandId.make(`presence_thread_meta_update_${crypto.randomUUID()}`),
      threadId: ThreadId.make(input.threadId),
      branch: input.branch,
      worktreePath: input.worktreePath,
    });

  const readLatestSupervisorHandoffForBoard = (boardId: string) =>
    sql<{
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
    `.pipe(Effect.map((rows) => rows[0] ? mapSupervisorHandoff(rows[0]) : null));

  const readLatestWorkerHandoffForAttempt = (attemptId: string) =>
    sql<{
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
    `.pipe(Effect.map((rows) => rows[0] ? mapWorkerHandoff(rows[0]) : null));

  const formatBulletList = (items: ReadonlyArray<string>) =>
    items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None recorded.";

  const buildAttemptBootstrapPrompt = (input: {
    attempt: AttemptWorkspaceContextRow;
    workspace: WorkspaceRecord;
    latestWorkerHandoff: WorkerHandoffRecord | null;
    latestSupervisorHandoff: SupervisorHandoffRecord | null;
  }) => {
    const acceptanceChecklist = decodeJson<Array<{ label: string; checked: boolean }>>(
      input.attempt.ticketAcceptanceChecklist,
      [],
    );
    const checklistLines =
      acceptanceChecklist.length > 0
        ? acceptanceChecklist.map((item) => `- [${item.checked ? "x" : " "}] ${item.label}`).join("\n")
        : "- No explicit acceptance checklist was provided.";

    const workerHandoffSection = input.latestWorkerHandoff
      ? [
          "Latest worker handoff:",
          `Completed work:\n${formatBulletList(input.latestWorkerHandoff.completedWork)}`,
          `Current hypothesis:\n${input.latestWorkerHandoff.currentHypothesis ?? "None recorded."}`,
          `Changed files:\n${formatBulletList(input.latestWorkerHandoff.changedFiles)}`,
          `Tests run:\n${formatBulletList(input.latestWorkerHandoff.testsRun)}`,
          `Blockers:\n${formatBulletList(input.latestWorkerHandoff.blockers)}`,
          `Next step:\n${input.latestWorkerHandoff.nextStep ?? "None recorded."}`,
        ].join("\n\n")
      : "Latest worker handoff:\n- None yet. This is the first active session for the attempt.";

    const supervisorSection = input.latestSupervisorHandoff
      ? [
          "Latest supervisor handoff:",
          `Top priorities:\n${formatBulletList(input.latestSupervisorHandoff.topPriorities)}`,
          `Recent decisions:\n${formatBulletList(input.latestSupervisorHandoff.recentDecisions)}`,
          `Next board actions:\n${formatBulletList(input.latestSupervisorHandoff.nextBoardActions)}`,
        ].join("\n\n")
      : "Latest supervisor handoff:\n- None recorded.";

    return [
      "You are the worker assigned to this Presence ticket attempt.",
      "Work inside the attached worktree and treat this message as the full kickoff packet for the attempt.",
      "",
      "Ticket:",
      `Title: ${input.attempt.ticketTitle}`,
      `Description: ${input.attempt.ticketDescription || "No additional description provided."}`,
      "",
      "Acceptance checklist:",
      checklistLines,
      "",
      "Workspace context:",
      `- Repository root: ${input.attempt.workspaceRoot}`,
      `- Worktree path: ${input.workspace.worktreePath ?? "Unavailable"}`,
      `- Branch: ${input.workspace.branch ?? "Unavailable"}`,
      "",
      supervisorSection,
      "",
      workerHandoffSection,
      "",
      "Operating rules:",
      "- Inspect the repo before making assumptions.",
      "- Keep changes scoped to the ticket.",
      "- Run relevant validation when feasible.",
      "- If blocked, say so clearly and explain why.",
      "- Before stopping, leave a structured worker handoff with completed work, hypothesis, tests, blockers, and next step.",
      "",
      "Start by understanding the problem, inspecting the most relevant files, and then making concrete progress in this workspace.",
    ].join("\n");
  };

  const scanRepositoryCapabilitiesInternal = (repository: {
    id: string;
    boardId: string;
    workspaceRoot: string;
  }) =>
    Effect.gen(function* () {
      const status = yield* gitCore.statusDetailsLocal(repository.workspaceRoot).pipe(
        Effect.mapError((cause) =>
          presenceError("Failed to inspect repository capabilities.", cause),
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
        readTextFileIfPresent(path.join(repository.workspaceRoot, "package.json")),
      ).pipe(
        Effect.mapError((cause) =>
          presenceError("Failed to read package.json during capability scan.", cause),
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
          if (scripts.test) pushCommand("test", `${packageManager} run test`, "package.json:scripts.test");
          if (scripts.build) pushCommand("build", `${packageManager} run build`, "package.json:scripts.build");
          if (scripts.lint) pushCommand("lint", `${packageManager} run lint`, "package.json:scripts.lint");
          if (scripts.dev) pushCommand("dev", `${packageManager} run dev`, "package.json:scripts.dev");
        } catch {
          riskSignals.push("package.json could not be parsed.");
        }
      }

      const cargoToml = yield* Effect.tryPromise(() =>
        readTextFileIfPresent(path.join(repository.workspaceRoot, "Cargo.toml")),
      ).pipe(
        Effect.mapError((cause) => presenceError("Failed to read Cargo.toml during capability scan.", cause)),
      );
      if (cargoToml) {
        ecosystems.push("rust");
        markers.push("Cargo.toml");
        pushCommand("test", "cargo test", "Cargo.toml");
        pushCommand("build", "cargo build", "Cargo.toml");
        pushCommand("lint", "cargo clippy --all-targets --all-features", "Cargo.toml");
      }

      const pyprojectToml = yield* Effect.tryPromise(() =>
        readTextFileIfPresent(path.join(repository.workspaceRoot, "pyproject.toml")),
      ).pipe(
        Effect.mapError((cause) =>
          presenceError("Failed to read pyproject.toml during capability scan.", cause),
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
        readTextFileIfPresent(path.join(repository.workspaceRoot, "go.mod")),
      ).pipe(
        Effect.mapError((cause) => presenceError("Failed to read go.mod during capability scan.", cause)),
      );
      if (goMod) {
        ecosystems.push("go");
        markers.push("go.mod");
        pushCommand("test", "go test ./...", "go.mod");
        pushCommand("build", "go build ./...", "go.mod");
      }

      const makefile = yield* Effect.tryPromise(() =>
        readTextFileIfPresent(path.join(repository.workspaceRoot, "Makefile")),
      ).pipe(
        Effect.mapError((cause) => presenceError("Failed to read Makefile during capability scan.", cause)),
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
          return await nodeFs.readdir(path.join(repository.workspaceRoot, ".github", "workflows"));
        } catch {
          return [];
        }
      }).pipe(
        Effect.mapError((cause) =>
          presenceError("Failed to inspect CI workflow markers during capability scan.", cause),
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
          presenceError("Failed to inspect repository lockfiles during capability scan.", cause),
        ),
      );
      markers.push(...presentLockfiles);

      if (!status.isRepo) riskSignals.push("Workspace root is not a git repository.");
      if (status.hasWorkingTreeChanges) riskSignals.push("Repository has local working tree changes.");
      if (status.workingTree.files.length > 100) {
        riskSignals.push("Repository has a large active change set.");
      }
      if (ecosystems.includes("node") && presentLockfiles.filter((value) => value.includes("lock")).length === 0) {
        riskSignals.push("Node repository is missing a lockfile.");
      }

      const hasValidationCapability = discoveredCommands.some(
        (command) => command.kind === "test" || command.kind === "build" || command.kind === "lint",
      );
      if (!hasValidationCapability) {
        riskSignals.push("No obvious validation command was discovered.");
      }

      const record: RepositoryCapabilityScanRecord = {
        id: CapabilityScanId.make(`capability_${crypto.randomUUID()}`),
        repositoryId: RepositoryId.make(repository.id),
        boardId: BoardId.make(repository.boardId),
        baseBranch: status.branch,
        upstreamRef: status.upstreamRef,
        hasRemote: status.hasOriginRemote || status.upstreamRef !== null,
        isClean: !status.hasWorkingTreeChanges,
        ecosystems: uniqueStrings(ecosystems),
        markers: uniqueStrings(markers),
        discoveredCommands,
        hasValidationCapability,
        riskSignals: uniqueStrings(riskSignals),
        scannedAt: nowIso(),
      };

      yield* sql`
        INSERT INTO presence_repository_capability_scans (
          capability_scan_id, repository_id, board_id, base_branch, upstream_ref,
          has_remote, is_clean, ecosystems_json, markers_json, discovered_commands_json,
          has_validation_capability, risk_signals_json, scanned_at
        ) VALUES (
          ${record.id}, ${record.repositoryId}, ${record.boardId}, ${record.baseBranch},
          ${record.upstreamRef}, ${record.hasRemote ? 1 : 0}, ${record.isClean ? 1 : 0},
          ${encodeJson(record.ecosystems)}, ${encodeJson(record.markers)},
          ${encodeJson(record.discoveredCommands)}, ${record.hasValidationCapability ? 1 : 0},
          ${encodeJson(record.riskSignals)}, ${record.scannedAt}
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
          has_validation_capability = excluded.has_validation_capability,
          risk_signals_json = excluded.risk_signals_json,
          scanned_at = excluded.scanned_at
      `;

      return record;
    });

  const readCurrentBranchName = (cwd: string) =>
    gitCore.execute({
      operation: "Presence.readCurrentBranchName",
      cwd,
      args: ["branch", "--show-current"],
      allowNonZeroExit: true,
      timeoutMs: 5_000,
      maxOutputBytes: 4_096,
    }).pipe(
      Effect.map((result) => {
        const branch = result.stdout.trim();
        return result.code === 0 && branch.length > 0 ? branch : null;
      }),
      Effect.mapError((cause) => presenceError("Failed to read the repository base branch.", cause)),
    );

  const hasHeadCommit = (cwd: string) =>
    gitCore.execute({
      operation: "Presence.hasHeadCommit",
      cwd,
      args: ["rev-parse", "--verify", "HEAD"],
      allowNonZeroExit: true,
      timeoutMs: 5_000,
      maxOutputBytes: 4_096,
    }).pipe(
      Effect.map((result) => result.code === 0),
      Effect.mapError((cause) => presenceError("Failed to inspect repository history.", cause)),
    );

  const hasAttemptExecutionContext = (context: AttemptWorkspaceContextRow) =>
    Boolean(
      context.attemptThreadId ||
        context.attemptProvider ||
        context.attemptModel ||
        context.attemptLastWorkerHandoffId ||
        context.workspaceWorktreePath ||
        context.workspaceBranch ||
        context.workspaceStatus === "ready" ||
        context.workspaceStatus === "busy" ||
        context.workspaceStatus === "cleaned_up",
    );

  const checklistIsComplete = (checklistJson: string) =>
    decodeJson<PresenceAcceptanceChecklistItem[]>(checklistJson, []).every((item) => item.checked);

  const updateTicketChecklist = (
    ticketId: string,
    transform: (items: PresenceAcceptanceChecklistItem[]) => PresenceAcceptanceChecklistItem[],
  ) =>
    Effect.gen(function* () {
      const existing = yield* sql<{ acceptanceChecklist: string }>`
        SELECT acceptance_checklist_json as "acceptanceChecklist"
        FROM presence_tickets
        WHERE ticket_id = ${ticketId}
      `.pipe(Effect.map((rows) => rows[0] ?? null));
      if (!existing) {
        return yield* Effect.fail(presenceError(`Ticket '${ticketId}' not found.`));
      }

      const current = decodeJson<PresenceAcceptanceChecklistItem[]>(existing.acceptanceChecklist, []);
      const next = transform(current);
      yield* sql`
        UPDATE presence_tickets
        SET acceptance_checklist_json = ${encodeJson(next)}, updated_at = ${nowIso()}
        WHERE ticket_id = ${ticketId}
      `;
      return next;
    });

  const markTicketEvidenceChecklist = (ticketId: string) =>
    updateTicketChecklist(ticketId, (items) =>
      items.map((item) => (isEvidenceChecklistItem(item) ? { ...item, checked: true } : item)),
    );

  const markTicketValidationChecklist = (ticketId: string) =>
    updateTicketChecklist(ticketId, (items) =>
      items.map((item) => (isValidationChecklistItem(item) ? { ...item, checked: true } : item)),
    );

  const readValidationRunsForAttempt = (attemptId: string) =>
    sql<{
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
    `.pipe(Effect.map((rows) => rows.map(mapValidationRun)));

  const latestValidationBatchForAttempt = (attemptId: string) =>
    readValidationRunsForAttempt(attemptId).pipe(
      Effect.map((runs) => {
        const latestBatchId = runs[0]?.batchId ?? null;
        if (!latestBatchId) {
          return [];
        }
        return runs.filter((run) => run.batchId === latestBatchId);
      }),
    );

  const buildRunnableValidationCommands = (capabilityScan: RepositoryCapabilityScanRecord | null) => {
    if (!capabilityScan) {
      return [];
    }

    const seen = new Set<string>();
    const commands: RepositoryCapabilityCommand[] = [];
    for (const command of capabilityScan.discoveredCommands) {
      if (command.kind === "dev") {
        continue;
      }
      const key = `${command.kind}:${command.command}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      commands.push(command);
    }
    return commands;
  };

  const getOrCreateCapabilityScan = (repositoryId: string) =>
    Effect.gen(function* () {
      const existing = yield* readLatestCapabilityScan(repositoryId);
      if (existing) {
        return existing;
      }

      const repository = yield* readRepositoryById(repositoryId);
      if (!repository) {
        return yield* Effect.fail(
          presenceError(`Repository '${repositoryId}' could not be found for capability scan.`),
        );
      }

      return yield* scanRepositoryCapabilitiesInternal(repository);
    });

  const evaluateSupervisorActionInternal = (input: {
    action: SupervisorActionKind;
    ticketId: string;
    attemptId?: string | null | undefined;
  }) =>
    Effect.gen(function* () {
      const ticket = yield* readTicketForPolicy(input.ticketId);
      if (!ticket) {
        return yield* Effect.fail(presenceError(`Ticket '${input.ticketId}' not found.`));
      }

      const attemptContext =
        input.attemptId && input.attemptId.trim().length > 0
          ? yield* readAttemptWorkspaceContext(input.attemptId)
          : null;

      const waivers = yield* readValidationWaiversForTicket(input.ticketId);
      const capabilityScan = yield* getOrCreateCapabilityScan(ticket.repositoryId);
      const latestValidationBatch =
        input.attemptId && input.attemptId.trim().length > 0
          ? yield* latestValidationBatchForAttempt(input.attemptId)
          : [];
      const runnableValidationCommands = buildRunnableValidationCommands(capabilityScan);

      return yield* supervisorPolicy.evaluate({
        action: input.action,
        ticketStatus: ticket.status,
        attemptStatus: attemptContext
          ? Schema.decodeSync(PresenceAttemptStatus)(attemptContext.attemptStatus as never)
          : null,
        attemptBelongsToTicket: attemptContext ? attemptContext.ticketId === input.ticketId : false,
        attemptHasExecutionContext: attemptContext ? hasAttemptExecutionContext(attemptContext) : false,
        checklistComplete: checklistIsComplete(ticket.acceptanceChecklist),
        capabilityScan,
        hasValidationWaiver: waivers.some(
          (waiver) => waiver.attemptId === null || waiver.attemptId === input.attemptId,
        ),
        validationRecorded:
          runnableValidationCommands.length === 0 ? true : latestValidationBatch.length > 0,
        validationPassed:
          runnableValidationCommands.length === 0
            ? true
            : latestValidationBatch.length > 0 &&
              latestValidationBatch.every((run) => run.status === "passed"),
      });
    });

  const ensureAttemptWorkspaceCommitted = (context: AttemptWorkspaceContextRow) =>
    Effect.gen(function* () {
      const worktreePath = context.workspaceWorktreePath?.trim() ?? null;
      if (!worktreePath) {
        return yield* Effect.fail(
          presenceError(`Attempt '${context.attemptId}' does not have an active worktree to merge.`),
        );
      }

      const workspaceDetails = yield* gitCore.statusDetails(worktreePath).pipe(
        Effect.mapError((cause) => presenceError("Failed to inspect the attempt workspace.", cause)),
      );

      if (workspaceDetails.hasWorkingTreeChanges) {
        const prepared = yield* gitCore.prepareCommitContext(worktreePath).pipe(
          Effect.mapError((cause) =>
            presenceError("Failed to stage the attempt workspace before merge.", cause),
          ),
        );
        if (!prepared) {
          return yield* Effect.fail(
            presenceError("The attempt workspace has no staged changes to commit before merge."),
          );
        }

        yield* gitCore
          .commit(
            worktreePath,
            `presence: complete ${context.ticketTitle}`,
            [
              `Attempt: ${context.attemptTitle}`,
              `Ticket: ${context.ticketId}`,
              "Committed automatically during Presence merge approval.",
            ].join("\n"),
          )
          .pipe(
            Effect.mapError((cause) =>
              presenceError("Failed to commit the attempt workspace before merge.", cause),
            ),
          );
      }

      const workspaceHasCommit = yield* hasHeadCommit(worktreePath);
      if (!workspaceHasCommit) {
        return yield* Effect.fail(
          presenceError(
            `Attempt '${context.attemptId}' has no committed work yet. Commit changes in the attempt workspace before merging.`,
          ),
        );
      }
    });

  const mergeAttemptIntoBase = (context: AttemptWorkspaceContextRow) =>
    Effect.gen(function* () {
      const sourceBranch = context.workspaceBranch?.trim() ?? null;
      if (!sourceBranch) {
        return yield* Effect.fail(
          presenceError(`Attempt '${context.attemptId}' does not have a workspace branch to merge.`),
        );
      }

      const baseBranch = yield* readCurrentBranchName(context.workspaceRoot);
      if (!baseBranch) {
        return yield* Effect.fail(
          presenceError(
            `Workspace root '${context.workspaceRoot}' is missing an active base branch for merge.`,
          ),
        );
      }

      if (baseBranch === sourceBranch) {
        return {
          baseBranch,
          sourceBranch,
        };
      }

      const rootHasCommit = yield* hasHeadCommit(context.workspaceRoot);
      if (rootHasCommit) {
        yield* gitCore.execute({
          operation: "Presence.mergeAttemptIntoBase",
          cwd: context.workspaceRoot,
          args: ["merge", "--no-ff", "--no-edit", sourceBranch],
          timeoutMs: 30_000,
        }).pipe(
          Effect.mapError((cause) => presenceError("Failed to merge the accepted attempt.", cause)),
        );
      } else {
        yield* gitCore.execute({
          operation: "Presence.mergeAttemptIntoBase.emptyHead",
          cwd: context.workspaceRoot,
          args: ["reset", "--hard", sourceBranch],
          timeoutMs: 15_000,
        }).pipe(
          Effect.mapError((cause) =>
            presenceError("Failed to materialize the accepted attempt into the empty base branch.", cause),
          ),
        );
      }

      return {
        baseBranch,
        sourceBranch,
      };
    });

  const ensureWorkspacePrepared = (input: {
    attemptId: string;
    preferredBranch?: string | undefined;
    nextStatus: typeof PresenceWorkspaceStatus.Type;
  }) =>
    Effect.gen(function* () {
      const context = yield* readAttemptWorkspaceContext(input.attemptId);
      if (!context) {
        return yield* Effect.fail(presenceError(`Attempt '${input.attemptId}' not found.`));
      }

      const existingPath = context.workspaceWorktreePath?.trim() ?? null;
      const existingBranch = context.workspaceBranch?.trim() ?? null;
      const currentStatus = Schema.decodeSync(PresenceWorkspaceStatus)(context.workspaceStatus as never);

      if (
        existingPath &&
        existingBranch &&
        currentStatus !== "cleaned_up" &&
        currentStatus !== "error"
      ) {
        if (currentStatus !== input.nextStatus) {
          const updatedAt = nowIso();
          yield* sql`
            UPDATE presence_workspaces
            SET status = ${input.nextStatus}, updated_at = ${updatedAt}
            WHERE workspace_id = ${context.workspaceId}
          `;
          return {
            id: WorkspaceId.make(context.workspaceId),
            attemptId: AttemptId.make(context.attemptId),
            status: input.nextStatus,
            branch: existingBranch,
            worktreePath: existingPath,
            createdAt: context.workspaceCreatedAt,
            updatedAt,
          } satisfies WorkspaceRecord;
        }

        return {
          id: WorkspaceId.make(context.workspaceId),
          attemptId: AttemptId.make(context.attemptId),
          status: currentStatus,
          branch: existingBranch,
          worktreePath: existingPath,
          createdAt: context.workspaceCreatedAt,
          updatedAt: context.workspaceUpdatedAt,
        } satisfies WorkspaceRecord;
      }

      const availableBranches = yield* gitCore.listLocalBranchNames(context.workspaceRoot);
      const branchListing = yield* gitCore.listBranches({ cwd: context.workspaceRoot });
      const currentBranch = branchListing.branches.find(
        (branch) => branch.current && !branch.isRemote,
      )?.name;

      if (!currentBranch) {
        return yield* Effect.fail(
          presenceError(
            `Workspace root '${context.workspaceRoot}' is missing an active base branch for attempt '${context.attemptId}'.`,
          ),
        );
      }

      const targetBranch =
        existingBranch ??
        resolveAutoFeatureBranchName(
          availableBranches,
          input.preferredBranch?.trim() || context.ticketTitle,
        );

      const createWorktreeEffect = existingBranch
        ? gitCore.createWorktree({
            cwd: context.workspaceRoot,
            branch: existingBranch,
            path: existingPath,
          })
        : gitCore.createWorktree({
            cwd: context.workspaceRoot,
            branch: currentBranch,
            newBranch: targetBranch,
            path: existingPath,
          });

      const createdWorktreeResult = yield* Effect.result(createWorktreeEffect);
      if (Result.isFailure(createdWorktreeResult)) {
        yield* sql`
          UPDATE presence_workspaces
          SET status = ${"error"}, updated_at = ${nowIso()}
          WHERE workspace_id = ${context.workspaceId}
        `;
        return yield* Effect.fail(createdWorktreeResult.failure);
      }
      const createdWorktree = createdWorktreeResult.success;

      const updatedAt = nowIso();
      yield* sql`
        UPDATE presence_workspaces
        SET
          status = ${input.nextStatus},
          branch = ${createdWorktree.worktree.branch},
          worktree_path = ${createdWorktree.worktree.path},
          updated_at = ${updatedAt}
        WHERE workspace_id = ${context.workspaceId}
      `;

      return {
        id: WorkspaceId.make(context.workspaceId),
        attemptId: AttemptId.make(context.attemptId),
        status: input.nextStatus,
        branch: createdWorktree.worktree.branch,
        worktreePath: createdWorktree.worktree.path,
        createdAt: context.workspaceCreatedAt,
        updatedAt,
      } satisfies WorkspaceRecord;
    });

  const getBoardSnapshotInternal = (boardId: string) =>
    Effect.gen(function* () {
      const repositoryRow = yield* sql<{
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
      `.pipe(Effect.map((rows) => rows[0] ?? null));
      if (!repositoryRow) {
        return yield* Effect.fail(presenceError(`Board '${boardId}' not found.`));
      }

      const boardRow = yield* sql<{
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
      `.pipe(Effect.map((rows) => rows[0] ?? null));
      if (!boardRow) {
        return yield* Effect.fail(presenceError(`Board '${boardId}' is missing its record.`));
      }

      const [
        ticketRows,
        dependencyRows,
        attemptRows,
        workspaceRows,
        supervisorRows,
        workerRows,
        evidenceRows,
        validationRunRows,
        knowledgeRows,
        promotionRows,
        jobRows,
        reviewRows,
        capabilityRows,
        waiverRows,
        goalRows,
      ] =
        yield* Effect.all([
          sql<any>`SELECT
              ticket_id as id, board_id as "boardId", parent_ticket_id as "parentTicketId",
              title, description, status, priority,
              acceptance_checklist_json as "acceptanceChecklist",
              assigned_attempt_id as "assignedAttemptId",
              created_at as "createdAt", updated_at as "updatedAt"
            FROM presence_tickets
            WHERE board_id = ${boardId}
            ORDER BY updated_at DESC, created_at DESC`,
          sql<any>`SELECT
              ticket_id as "ticketId",
              depends_on_ticket_id as "dependsOnTicketId"
            FROM presence_ticket_dependencies
            WHERE ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})`,
          sql<any>`SELECT
              attempt_id as id, ticket_id as "ticketId", workspace_id as "workspaceId",
              title, status, provider, model, thread_id as "threadId", summary, confidence,
              last_worker_handoff_id as "lastWorkerHandoffId",
              created_at as "createdAt", updated_at as "updatedAt"
            FROM presence_attempts
            WHERE ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
            ORDER BY created_at DESC`,
          sql<any>`SELECT
              workspace_id as id, attempt_id as "attemptId", status, branch,
              worktree_path as "worktreePath", created_at as "createdAt", updated_at as "updatedAt"
            FROM presence_workspaces
            WHERE attempt_id IN (
              SELECT attempt_id FROM presence_attempts
              WHERE ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
            )`,
          sql<any>`SELECT
              handoff_id as id, board_id as "boardId", payload_json as payload, created_at as "createdAt"
            FROM presence_handoffs
            WHERE board_id = ${boardId} AND role = 'supervisor'
            ORDER BY created_at DESC
            LIMIT 1`,
          sql<any>`SELECT
              handoff_id as id, attempt_id as "attemptId", payload_json as payload, created_at as "createdAt"
            FROM presence_handoffs
            WHERE attempt_id IN (
              SELECT attempt_id FROM presence_attempts
              WHERE ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
            ) AND role = 'worker'
            ORDER BY created_at DESC`,
          sql<any>`SELECT
              evidence_id as id, attempt_id as "attemptId", title, kind, content, created_at as "createdAt"
            FROM presence_attempt_evidence
            WHERE attempt_id IN (
              SELECT attempt_id FROM presence_attempts
              WHERE ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
            )
            ORDER BY created_at DESC`,
          sql<any>`SELECT
              validation_run_id as id, batch_id as "batchId", attempt_id as "attemptId",
              ticket_id as "ticketId", command_kind as "commandKind", command_text as command,
              status, exit_code as "exitCode", stdout_summary as "stdoutSummary",
              stderr_summary as "stderrSummary", started_at as "startedAt", finished_at as "finishedAt"
            FROM presence_validation_runs
            WHERE attempt_id IN (
              SELECT attempt_id FROM presence_attempts
              WHERE ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
            )
            ORDER BY started_at DESC, validation_run_id DESC`,
          sql<any>`SELECT
              knowledge_page_id as id, board_id as "boardId", family, slug, title,
              compiled_truth as "compiledTruth", timeline, linked_ticket_ids_json as "linkedTicketIds",
              created_at as "createdAt", updated_at as "updatedAt"
            FROM presence_knowledge_pages
            WHERE board_id = ${boardId}
            ORDER BY updated_at DESC`,
          sql<any>`SELECT
              promotion_candidate_id as id, source_ticket_id as "sourceTicketId",
              source_attempt_id as "sourceAttemptId", family, title, slug, compiled_truth as "compiledTruth",
              timeline_entry as "timelineEntry", status, created_at as "createdAt", updated_at as "updatedAt"
            FROM presence_promotion_candidates
            WHERE source_ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
            ORDER BY updated_at DESC`,
          sql<any>`SELECT
              deterministic_job_id as id, board_id as "boardId", title, kind, status, progress,
              output_summary as "outputSummary", error_message as "errorMessage",
              created_at as "createdAt", updated_at as "updatedAt"
            FROM presence_deterministic_jobs
            WHERE board_id = ${boardId}
            ORDER BY updated_at DESC`,
          sql<any>`SELECT
              review_decision_id as id, ticket_id as "ticketId", attempt_id as "attemptId",
              decision, notes, created_at as "createdAt"
            FROM presence_review_decisions
            WHERE ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
            ORDER BY created_at DESC`,
          sql<any>`SELECT
              capability_scan_id as id, repository_id as "repositoryId", board_id as "boardId",
              base_branch as "baseBranch", upstream_ref as "upstreamRef",
              has_remote as "hasRemote", is_clean as "isClean",
              ecosystems_json as ecosystems, markers_json as markers,
              discovered_commands_json as "discoveredCommands",
              has_validation_capability as "hasValidationCapability",
              risk_signals_json as "riskSignals", scanned_at as "scannedAt"
            FROM presence_repository_capability_scans
            WHERE board_id = ${boardId}
            LIMIT 1`,
          sql<any>`SELECT
              validation_waiver_id as id, ticket_id as "ticketId", attempt_id as "attemptId",
              reason, granted_by as "grantedBy", created_at as "createdAt"
            FROM presence_validation_waivers
            WHERE ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
            ORDER BY created_at DESC`,
          sql<any>`SELECT
              goal_intake_id as id, board_id as "boardId", source, raw_goal as "rawGoal",
              summary, created_ticket_ids_json as "createdTicketIds", created_at as "createdAt"
            FROM presence_goal_intakes
            WHERE board_id = ${boardId}
            ORDER BY created_at DESC`,
        ]);

      const attempts = attemptRows.map(mapAttempt);
      const workspaces = workspaceRows.map(mapWorkspace);
      const latestWorkerHandoffByAttemptId = new Map<string, WorkerHandoffRecord>();
      for (const row of workerRows) {
        if (!latestWorkerHandoffByAttemptId.has(row.attemptId)) {
          latestWorkerHandoffByAttemptId.set(row.attemptId, mapWorkerHandoff(row));
        }
      }
      const workspaceByAttemptId = new Map(workspaces.map((workspace) => [workspace.attemptId, workspace]));

      const attemptSummaries: AttemptSummary[] = attempts.map((attempt) => ({
        attempt,
        workspace: workspaceByAttemptId.get(attempt.id) ?? null,
        latestWorkerHandoff: latestWorkerHandoffByAttemptId.get(attempt.id) ?? null,
      }));

      return {
        repository: mapRepository(repositoryRow),
        board: mapBoard(boardRow),
        tickets: ticketRows.map(mapTicket),
        dependencies: dependencyRows.map((row: any) => ({
          ticketId: TicketId.make(row.ticketId),
          dependsOnTicketId: TicketId.make(row.dependsOnTicketId),
        })),
        attempts,
        workspaces,
        attemptSummaries,
        supervisorHandoff: supervisorRows[0] ? mapSupervisorHandoff(supervisorRows[0]) : null,
        evidence: evidenceRows.map(mapEvidence),
        validationRuns: validationRunRows.map(mapValidationRun),
        promotionCandidates: promotionRows.map(mapPromotionCandidate),
        knowledgePages: knowledgeRows.map(mapKnowledgePage),
        jobs: jobRows.map(mapJob),
        reviewDecisions: reviewRows.map(mapReviewDecision),
        capabilityScan: capabilityRows[0] ? mapCapabilityScan(capabilityRows[0]) : null,
        validationWaivers: waiverRows.map(mapValidationWaiver),
        goalIntakes: goalRows.map(mapGoalIntake),
      } satisfies BoardSnapshot;
    });

  const listRepositories: PresenceControlPlaneShape["listRepositories"] = () =>
    sql<any>`
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
      Effect.map((rows) => rows.map(mapRepository)),
      Effect.catch((cause) => Effect.fail(presenceError("Failed to list repositories.", cause))),
    );

  const importRepository: PresenceControlPlaneShape["importRepository"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* readRepositoryByWorkspaceRoot(input.workspaceRoot);
      if (existing) {
        return mapRepository(existing);
      }

      const currentReadModel = yield* orchestrationEngine.getReadModel();
      const existingProject = currentReadModel.projects.find(
        (project) => project.workspaceRoot === input.workspaceRoot,
      );
      const providers = yield* providerRegistry.getProviders;
      const defaultModelSelection =
        existingProject?.defaultModelSelection ?? chooseDefaultModelSelection(providers);
      const projectId =
        existingProject?.id ?? ProjectId.make(`presence_project_${crypto.randomUUID()}`);
      const title = input.title ?? titleFromPath(input.workspaceRoot);
      const createdAt = nowIso();

      if (!existingProject) {
        yield* orchestrationEngine.dispatch({
          type: "project.create",
          commandId: CommandId.make(`presence_project_create_${crypto.randomUUID()}`),
          projectId,
          title,
          workspaceRoot: input.workspaceRoot,
          defaultModelSelection,
          createdAt,
        });
      }

      const repositoryId = makeId(RepositoryId, "repository");
      const boardId = makeId(BoardId, "board");
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO presence_repositories (
              repository_id, board_id, project_id, title, workspace_root,
              default_model_selection_json, created_at, updated_at
            ) VALUES (
              ${repositoryId},
              ${boardId},
              ${projectId},
              ${title},
              ${input.workspaceRoot},
              ${encodeJson(defaultModelSelection)},
              ${createdAt},
              ${createdAt}
            )
          `;
          yield* sql`
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

      return {
        id: repositoryId,
        boardId,
        projectId,
        title,
        workspaceRoot: input.workspaceRoot,
        defaultModelSelection,
        createdAt,
        updatedAt: createdAt,
      };
    }).pipe(Effect.catch((cause) => Effect.fail(presenceError("Failed to import repository.", cause))));

  const getBoardSnapshot: PresenceControlPlaneShape["getBoardSnapshot"] = (input) =>
    getBoardSnapshotInternal(input.boardId).pipe(
      Effect.catch((cause) => Effect.fail(presenceError("Failed to load board snapshot.", cause))),
    );

  const getRepositoryCapabilities: PresenceControlPlaneShape["getRepositoryCapabilities"] = (input) =>
    readLatestCapabilityScan(input.repositoryId).pipe(
      Effect.catch((cause) =>
        Effect.fail(presenceError("Failed to load repository capabilities.", cause)),
      ),
    );

  const scanRepositoryCapabilities: PresenceControlPlaneShape["scanRepositoryCapabilities"] = (input) =>
    Effect.gen(function* () {
      const repository = yield* readRepositoryById(input.repositoryId);
      if (!repository) {
        return yield* Effect.fail(
          presenceError(`Repository '${input.repositoryId}' could not be found for capability scan.`),
        );
      }
      return yield* scanRepositoryCapabilitiesInternal(repository);
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(presenceError("Failed to scan repository capabilities.", cause)),
      ),
    );

  const createTicket: PresenceControlPlaneShape["createTicket"] = (input) =>
    Effect.gen(function* () {
      const createdAt = nowIso();
      const ticketId = makeId(TicketId, "ticket");
      const checklist = input.acceptanceChecklist ?? [
        { id: `check_${crypto.randomUUID()}`, label: "Mechanism understood", checked: false },
        { id: `check_${crypto.randomUUID()}`, label: "Evidence attached", checked: false },
        { id: `check_${crypto.randomUUID()}`, label: "Tests or validation captured", checked: false },
      ];
      yield* sql`
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
          ${encodeJson(checklist)},
          ${null},
          ${createdAt},
          ${createdAt}
        )
      `;
      return {
        id: ticketId,
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
    }).pipe(Effect.catch((cause) => Effect.fail(presenceError("Failed to create ticket.", cause))));

  const updateTicket: PresenceControlPlaneShape["updateTicket"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* sql<any>`
        SELECT
          ticket_id as id, board_id as "boardId", parent_ticket_id as "parentTicketId",
          title, description, status, priority,
          acceptance_checklist_json as "acceptanceChecklist",
          assigned_attempt_id as "assignedAttemptId",
          created_at as "createdAt", updated_at as "updatedAt"
        FROM presence_tickets
        WHERE ticket_id = ${input.ticketId}
      `.pipe(Effect.map((rows) => rows[0] ?? null));
      if (!existing) {
        return yield* Effect.fail(presenceError(`Ticket '${input.ticketId}' not found.`));
      }
      const updatedAt = nowIso();
      const nextChecklist =
        input.acceptanceChecklist ?? decodeJson(existing.acceptanceChecklist, []);
      yield* sql`
        UPDATE presence_tickets
        SET
          title = ${input.title ?? existing.title},
          description = ${input.description ?? existing.description},
          status = ${input.status ?? existing.status},
          priority = ${input.priority ?? existing.priority},
          acceptance_checklist_json = ${encodeJson(nextChecklist)},
          updated_at = ${updatedAt}
        WHERE ticket_id = ${input.ticketId}
      `;
      return mapTicket({
        ...existing,
        title: input.title ?? existing.title,
        description: input.description ?? existing.description,
        status: input.status ?? existing.status,
        priority: input.priority ?? existing.priority,
        acceptanceChecklist: encodeJson(nextChecklist),
        updatedAt,
      });
    }).pipe(Effect.catch((cause) => Effect.fail(presenceError("Failed to update ticket.", cause))));

  const createAttempt: PresenceControlPlaneShape["createAttempt"] = (input) =>
    Effect.gen(function* () {
      const ticket = yield* sql<any>`
        SELECT ticket_id as id, title, board_id as "boardId"
        FROM presence_tickets
        WHERE ticket_id = ${input.ticketId}
      `.pipe(Effect.map((rows) => rows[0] ?? null));
      if (!ticket) {
        return yield* Effect.fail(presenceError(`Ticket '${input.ticketId}' not found.`));
      }

      const createdAt = nowIso();
      const attemptId = makeId(AttemptId, "attempt");
      const workspaceId = makeId(WorkspaceId, "workspace");
      const title = input.title ?? `${ticket.title} Attempt`;
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO presence_attempts (
              attempt_id, ticket_id, workspace_id, title, status, provider, model,
              thread_id, summary, confidence, last_worker_handoff_id, created_at, updated_at
            ) VALUES (
              ${attemptId},
              ${input.ticketId},
              ${workspaceId},
              ${title},
              ${"planned"},
              ${null},
              ${null},
              ${null},
              ${null},
              ${null},
              ${null},
              ${createdAt},
              ${createdAt}
            )
          `;
          yield* sql`
            INSERT INTO presence_workspaces (
              workspace_id, attempt_id, status, branch, worktree_path, created_at, updated_at
            ) VALUES (
              ${workspaceId},
              ${attemptId},
              ${"unprepared"},
              ${null},
              ${null},
              ${createdAt},
              ${createdAt}
            )
          `;
          yield* sql`
            UPDATE presence_tickets
            SET assigned_attempt_id = ${attemptId}, status = ${"in_progress"}, updated_at = ${createdAt}
            WHERE ticket_id = ${input.ticketId}
          `;
        }),
      );

      return {
        id: attemptId,
        ticketId: TicketId.make(input.ticketId),
        workspaceId,
        title,
        status: "planned" as const,
        provider: null,
        model: null,
        threadId: null,
        summary: null,
        confidence: null,
        lastWorkerHandoffId: null,
        createdAt,
        updatedAt: createdAt,
      };
    }).pipe(Effect.catch((cause) => Effect.fail(presenceError("Failed to create attempt.", cause))));

  const prepareWorkspace: PresenceControlPlaneShape["prepareWorkspace"] = (input) =>
    ensureWorkspacePrepared({
      attemptId: input.attemptId,
      preferredBranch: input.branch,
      nextStatus: "ready",
    }).pipe(
      Effect.mapError((cause) => presenceError("Failed to prepare workspace.", cause)),
    );

  const cleanupWorkspace: PresenceControlPlaneShape["cleanupWorkspace"] = (input) =>
    Effect.gen(function* () {
      const context = yield* readAttemptWorkspaceContext(input.attemptId);
      if (!context) {
        return yield* Effect.fail(presenceError(`Attempt '${input.attemptId}' not found.`));
      }

      if (context.workspaceWorktreePath) {
        yield* gitCore.removeWorktree({
          cwd: context.workspaceRoot,
          path: context.workspaceWorktreePath,
          force: input.force,
        });
      }

      if (context.attemptThreadId) {
        yield* syncThreadWorkspaceMetadata({
          threadId: context.attemptThreadId,
          branch: null,
          worktreePath: null,
        });
      }

      const updatedAt = nowIso();
      const nextAttemptStatus =
        context.attemptStatus === "accepted" ||
        context.attemptStatus === "merged" ||
        context.attemptStatus === "rejected"
          ? context.attemptStatus
          : ("interrupted" as const);

      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            UPDATE presence_workspaces
            SET
              status = ${"cleaned_up"},
              worktree_path = ${null},
              updated_at = ${updatedAt}
            WHERE workspace_id = ${context.workspaceId}
          `;
          yield* sql`
            UPDATE presence_attempts
            SET status = ${nextAttemptStatus}, updated_at = ${updatedAt}
            WHERE attempt_id = ${context.attemptId}
          `;
        }),
      );

      return {
        id: WorkspaceId.make(context.workspaceId),
        attemptId: AttemptId.make(context.attemptId),
        status: "cleaned_up" as const,
        branch: context.workspaceBranch,
        worktreePath: null,
        createdAt: context.workspaceCreatedAt,
        updatedAt,
      };
    }).pipe(
      Effect.mapError((cause) => presenceError("Failed to clean up workspace.", cause)),
    );

  const startAttemptSession: PresenceControlPlaneShape["startAttemptSession"] = (input) =>
    Effect.gen(function* () {
      const attemptRow = yield* readAttemptWorkspaceContext(input.attemptId);
      if (!attemptRow) {
        return yield* Effect.fail(presenceError(`Attempt '${input.attemptId}' not found.`));
      }
      if (
        attemptRow.attemptStatus === "accepted" ||
        attemptRow.attemptStatus === "merged" ||
        attemptRow.attemptStatus === "rejected"
      ) {
        return yield* Effect.fail(
          presenceError(
            `Attempt '${input.attemptId}' is ${attemptRow.attemptStatus} and cannot start a new session.`,
          ),
        );
      }
      if (!attemptRow.projectId) {
        return yield* Effect.fail(presenceError("Attempt repository is missing an orchestration project."));
      }

      const startPolicy = yield* evaluateSupervisorActionInternal({
        action: "start_attempt",
        ticketId: attemptRow.ticketId,
        attemptId: input.attemptId,
      });
      if (!startPolicy.allowed) {
        return yield* Effect.fail(presenceError(startPolicy.reasons.join(" ")));
      }

      const workspace = yield* ensureWorkspacePrepared({
        attemptId: input.attemptId,
        preferredBranch: attemptRow.ticketTitle,
        nextStatus: "busy",
      });

      const providers = yield* providerRegistry.getProviders;
      const fallbackSelection =
        chooseDefaultModelSelection(providers) ??
        decodeJson<ModelSelection | null>(attemptRow.defaultModelSelection, null);
      const selection =
        input.provider && input.model
          ? ({ provider: input.provider, model: input.model } as ModelSelection)
          : fallbackSelection;
      if (!selection) {
        return yield* Effect.fail(
          presenceError("No provider/model is available to start an attempt session."),
        );
      }

      const createdAt = nowIso();
      const shouldBootstrapWorker = !attemptRow.attemptThreadId;
      const threadId = attemptRow.attemptThreadId
        ? ThreadId.make(attemptRow.attemptThreadId)
        : makeId(ThreadId, "presence_thread");

      if (attemptRow.attemptThreadId) {
        yield* syncThreadWorkspaceMetadata({
          threadId: attemptRow.attemptThreadId,
          branch: workspace.branch,
          worktreePath: workspace.worktreePath,
        });
      } else {
        yield* orchestrationEngine.dispatch({
          type: "thread.create",
          commandId: CommandId.make(`presence_thread_create_${crypto.randomUUID()}`),
          threadId,
          projectId: ProjectId.make(attemptRow.projectId),
          title: `${attemptRow.ticketTitle} - ${attemptRow.attemptTitle}`,
          modelSelection: selection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: workspace.branch,
          worktreePath: workspace.worktreePath,
          createdAt,
        });
      }

      yield* sql`
        UPDATE presence_attempts
        SET
          thread_id = ${threadId},
          provider = ${selection.provider},
          model = ${selection.model},
          status = ${"in_progress"},
          updated_at = ${createdAt}
        WHERE attempt_id = ${input.attemptId}
      `;

      if (shouldBootstrapWorker) {
        const [latestWorkerHandoff, latestSupervisorHandoff] = yield* Effect.all([
          readLatestWorkerHandoffForAttempt(input.attemptId),
          readLatestSupervisorHandoffForBoard(attemptRow.boardId),
        ]);
        const kickoffMessage = buildAttemptBootstrapPrompt({
          attempt: attemptRow,
          workspace,
          latestWorkerHandoff,
          latestSupervisorHandoff,
        });

        yield* orchestrationEngine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make(`presence_turn_start_${crypto.randomUUID()}`),
          threadId,
          message: {
            messageId: makeId(MessageId, "presence_message"),
            role: "user",
            text: kickoffMessage,
            attachments: [],
          },
          modelSelection: selection,
          titleSeed: attemptRow.ticketTitle,
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt,
        });
      }

      return {
        attemptId: AttemptId.make(input.attemptId),
        threadId,
        provider: selection.provider,
        model: selection.model,
        attachedAt: createdAt,
      };
    }).pipe(
      Effect.mapError((cause) => presenceError("Failed to start attempt session.", cause)),
    );

  const attachThreadToAttempt: PresenceControlPlaneShape["attachThreadToAttempt"] = (input) =>
    Effect.gen(function* () {
      const updatedAt = nowIso();
      yield* sql`
        UPDATE presence_attempts
        SET thread_id = ${input.threadId}, updated_at = ${updatedAt}
        WHERE attempt_id = ${input.attemptId}
      `;
      const context = yield* readAttemptWorkspaceContext(input.attemptId);
      if (context?.workspaceBranch && context.workspaceWorktreePath) {
        yield* syncThreadWorkspaceMetadata({
          threadId: input.threadId,
          branch: context.workspaceBranch,
          worktreePath: context.workspaceWorktreePath,
        });
      }
      const row = yield* sql<any>`
        SELECT
          attempt_id as id, ticket_id as "ticketId", workspace_id as "workspaceId",
          title, status, provider, model, thread_id as "threadId", summary, confidence,
          last_worker_handoff_id as "lastWorkerHandoffId",
          created_at as "createdAt", updated_at as "updatedAt"
        FROM presence_attempts
        WHERE attempt_id = ${input.attemptId}
      `.pipe(Effect.map((rows) => rows[0] ?? null));
      if (!row) {
        return yield* Effect.fail(presenceError(`Attempt '${input.attemptId}' not found.`));
      }
      return mapAttempt(row);
    }).pipe(Effect.catch((cause) => Effect.fail(presenceError("Failed to attach thread.", cause))));

  const saveSupervisorHandoff: PresenceControlPlaneShape["saveSupervisorHandoff"] = (input) =>
    Effect.gen(function* () {
      const handoffId = makeId(HandoffId, "handoff");
      const createdAt = nowIso();
      yield* sql`
        INSERT INTO presence_handoffs (
          handoff_id, board_id, attempt_id, role, payload_json, created_at
        ) VALUES (
          ${handoffId},
          ${input.boardId},
          ${null},
          ${"supervisor"},
          ${encodeJson({
            topPriorities: input.topPriorities,
            activeAttemptIds: input.activeAttemptIds,
            blockedTicketIds: input.blockedTicketIds,
            recentDecisions: input.recentDecisions,
            nextBoardActions: input.nextBoardActions,
            resumeProtocol: DEFAULT_PRESENCE_RESUME_PROTOCOL.supervisorReadOrder,
          })},
          ${createdAt}
        )
      `;
      return {
        id: handoffId,
        boardId: input.boardId,
        topPriorities: input.topPriorities,
        activeAttemptIds: input.activeAttemptIds,
        blockedTicketIds: input.blockedTicketIds,
        recentDecisions: input.recentDecisions,
        nextBoardActions: input.nextBoardActions,
        createdAt,
      };
    }).pipe(
      Effect.catch((cause) => Effect.fail(presenceError("Failed to save supervisor handoff.", cause))),
    );

  const saveWorkerHandoff: PresenceControlPlaneShape["saveWorkerHandoff"] = (input) =>
    Effect.gen(function* () {
      const handoffId = makeId(HandoffId, "handoff");
      const createdAt = nowIso();
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO presence_handoffs (
              handoff_id, board_id, attempt_id, role, payload_json, created_at
            ) VALUES (
              ${handoffId},
              ${null},
              ${input.attemptId},
              ${"worker"},
              ${encodeJson({
                completedWork: input.completedWork,
                currentHypothesis: input.currentHypothesis ?? null,
                changedFiles: input.changedFiles,
                testsRun: input.testsRun,
                blockers: input.blockers,
                nextStep: input.nextStep ?? null,
                confidence: input.confidence ?? null,
                evidenceIds: input.evidenceIds,
                resumeProtocol: DEFAULT_PRESENCE_RESUME_PROTOCOL.workerReadOrder,
              })},
              ${createdAt}
            )
          `;
          yield* sql`
            UPDATE presence_attempts
            SET
              summary = ${input.completedWork[0] ?? null},
              confidence = ${input.confidence ?? null},
              last_worker_handoff_id = ${handoffId},
              updated_at = ${createdAt}
            WHERE attempt_id = ${input.attemptId}
          `;
        }),
      );
      return {
        id: handoffId,
        attemptId: input.attemptId,
        completedWork: input.completedWork,
        currentHypothesis: input.currentHypothesis ?? null,
        changedFiles: input.changedFiles,
        testsRun: input.testsRun,
        blockers: input.blockers,
        nextStep: input.nextStep ?? null,
        confidence: input.confidence ?? null,
        evidenceIds: input.evidenceIds,
        createdAt,
      };
    }).pipe(
      Effect.catch((cause) => Effect.fail(presenceError("Failed to save worker handoff.", cause))),
    );

  const saveAttemptEvidence: PresenceControlPlaneShape["saveAttemptEvidence"] = (input) =>
    Effect.gen(function* () {
      const attemptContext = yield* readAttemptWorkspaceContext(input.attemptId);
      if (!attemptContext) {
        return yield* Effect.fail(presenceError(`Attempt '${input.attemptId}' not found.`));
      }
      const evidenceId = makeId(EvidenceId, "evidence");
      const createdAt = nowIso();
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO presence_attempt_evidence (
              evidence_id, attempt_id, title, kind, content, created_at
            ) VALUES (
              ${evidenceId},
              ${input.attemptId},
              ${input.title},
              ${input.kind},
              ${input.content},
              ${createdAt}
            )
          `;
          yield* markTicketEvidenceChecklist(attemptContext.ticketId);
        }),
      );
      return {
        id: evidenceId,
        attemptId: input.attemptId,
        title: input.title,
        kind: input.kind,
        content: input.content,
        createdAt,
      };
    }).pipe(
      Effect.catch((cause) => Effect.fail(presenceError("Failed to save attempt evidence.", cause))),
    );

  const runAttemptValidation: PresenceControlPlaneShape["runAttemptValidation"] = (input) =>
    Effect.gen(function* () {
      const context = yield* readAttemptWorkspaceContext(input.attemptId);
      if (!context) {
        return yield* Effect.fail(presenceError(`Attempt '${input.attemptId}' not found.`));
      }
      if (!hasAttemptExecutionContext(context)) {
        return yield* Effect.fail(
          presenceError("Validation can only run after the attempt has actually started work."),
        );
      }

      const capabilityScan = yield* getOrCreateCapabilityScan(context.repositoryId);
      const commands = buildRunnableValidationCommands(capabilityScan);
      if (commands.length === 0) {
        return yield* Effect.fail(
          presenceError("No runnable validation command was discovered for this repository."),
        );
      }

      const cwd = context.workspaceWorktreePath?.trim() || context.workspaceRoot;
      const batchId = `validation_batch_${crypto.randomUUID()}`;
      const runs: ValidationRunRecord[] = [];

      for (const discovered of commands) {
        const runId = makeId(ValidationRunId, "validation");
        const startedAt = nowIso();
        yield* sql`
          INSERT INTO presence_validation_runs (
            validation_run_id, batch_id, attempt_id, ticket_id, command_kind, command_text,
            status, exit_code, stdout_summary, stderr_summary, started_at, finished_at
          ) VALUES (
            ${runId},
            ${batchId},
            ${context.attemptId},
            ${context.ticketId},
            ${discovered.kind},
            ${discovered.command},
            ${"running"},
            ${null},
            ${null},
            ${null},
            ${startedAt},
            ${null}
          )
        `;

        const shellInvocation = makeValidationShellInvocation(discovered.command);
        const result = yield* Effect.tryPromise(() =>
          runProcess(shellInvocation.command, shellInvocation.args, {
            cwd,
            timeoutMs: 10 * 60_000,
            allowNonZeroExit: true,
            maxBufferBytes: 256 * 1024,
            outputMode: "truncate",
          }),
        ).pipe(
          Effect.mapError((cause) =>
            presenceError(`Failed to execute validation command '${discovered.command}'.`, cause),
          ),
        );

        const finishedAt = nowIso();
        const status = result.code === 0 && !result.timedOut ? "passed" : "failed";
        const stdoutSummary = summarizeCommandOutput(result.stdout);
        const stderrSummary = summarizeCommandOutput(result.stderr);

        yield* sql`
          UPDATE presence_validation_runs
          SET
            status = ${status},
            exit_code = ${result.code},
            stdout_summary = ${stdoutSummary},
            stderr_summary = ${stderrSummary},
            finished_at = ${finishedAt}
          WHERE validation_run_id = ${runId}
        `;

        const evidenceId = makeId(EvidenceId, "evidence");
        const evidenceContent = [
          `Command: ${discovered.command}`,
          `Kind: ${discovered.kind}`,
          `Status: ${status}`,
          `Exit code: ${result.code ?? "null"}`,
          stdoutSummary ? `Stdout: ${stdoutSummary}` : null,
          stderrSummary ? `Stderr: ${stderrSummary}` : null,
        ]
          .filter((value): value is string => value !== null)
          .join("\n");

        yield* sql`
          INSERT INTO presence_attempt_evidence (
            evidence_id, attempt_id, title, kind, content, created_at
          ) VALUES (
            ${evidenceId},
            ${context.attemptId},
            ${`${discovered.kind} validation: ${discovered.command}`},
            ${"validation"},
            ${evidenceContent},
            ${finishedAt}
          )
        `;

        runs.push({
          id: runId,
          batchId,
          attemptId: AttemptId.make(context.attemptId),
          ticketId: TicketId.make(context.ticketId),
          commandKind: discovered.kind,
          command: discovered.command,
          status,
          exitCode: result.code,
          stdoutSummary,
          stderrSummary,
          startedAt,
          finishedAt,
        });
      }

      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* markTicketEvidenceChecklist(context.ticketId);
          yield* markTicketValidationChecklist(context.ticketId);
        }),
      );

      return runs;
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(presenceError("Failed to run attempt validation.", cause)),
      ),
    );

  const upsertKnowledgePage: PresenceControlPlaneShape["upsertKnowledgePage"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* sql<any>`
        SELECT knowledge_page_id as id, created_at as "createdAt"
        FROM presence_knowledge_pages
        WHERE board_id = ${input.boardId} AND family = ${input.family} AND slug = ${input.slug}
      `.pipe(Effect.map((rows) => rows[0] ?? null));
      const knowledgePageId = existing?.id
        ? KnowledgePageId.make(existing.id)
        : makeId(KnowledgePageId, "knowledge");
      const createdAt = existing?.createdAt ?? nowIso();
      const updatedAt = nowIso();
      yield* sql`
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
          ${encodeJson(input.linkedTicketIds)},
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
      return {
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
    }).pipe(
      Effect.catch((cause) => Effect.fail(presenceError("Failed to upsert knowledge page.", cause))),
    );

  const createPromotionCandidate: PresenceControlPlaneShape["createPromotionCandidate"] = (input) =>
    Effect.gen(function* () {
      const candidateId = makeId(PromotionCandidateId, "promotion");
      const createdAt = nowIso();
      yield* sql`
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
        id: candidateId,
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
      };
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(presenceError("Failed to create promotion candidate.", cause)),
      ),
    );

  const reviewPromotionCandidate: PresenceControlPlaneShape["reviewPromotionCandidate"] = (input) =>
    Effect.gen(function* () {
      const updatedAt = nowIso();
      yield* sql`
        UPDATE presence_promotion_candidates
        SET status = ${input.status}, updated_at = ${updatedAt}
        WHERE promotion_candidate_id = ${input.promotionCandidateId}
      `;
      const row = yield* sql<any>`
        SELECT
          promotion_candidate_id as id, source_ticket_id as "sourceTicketId",
          source_attempt_id as "sourceAttemptId", family, title, slug, compiled_truth as "compiledTruth",
          timeline_entry as "timelineEntry", status, created_at as "createdAt", updated_at as "updatedAt"
        FROM presence_promotion_candidates
        WHERE promotion_candidate_id = ${input.promotionCandidateId}
      `.pipe(Effect.map((rows) => rows[0] ?? null));
      if (!row) {
        return yield* Effect.fail(
          presenceError(`Promotion candidate '${input.promotionCandidateId}' not found.`),
        );
      }
      return mapPromotionCandidate(row);
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(presenceError("Failed to review promotion candidate.", cause)),
      ),
    );

  const createDeterministicJob: PresenceControlPlaneShape["createDeterministicJob"] = (input) =>
    Effect.gen(function* () {
      const jobId = makeId(DeterministicJobId, "job");
      const createdAt = nowIso();
      yield* sql`
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
        Effect.fail(presenceError("Failed to create deterministic job.", cause)),
      ),
    );

  const evaluateSupervisorAction: PresenceControlPlaneShape["evaluateSupervisorAction"] = (input) =>
    evaluateSupervisorActionInternal({
      action: input.action,
      ticketId: input.ticketId,
      attemptId: input.attemptId ?? null,
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(presenceError("Failed to evaluate supervisor action.", cause)),
      ),
    );

  const recordValidationWaiver: PresenceControlPlaneShape["recordValidationWaiver"] = (input) =>
    Effect.gen(function* () {
      const ticket = yield* readTicketForPolicy(input.ticketId);
      if (!ticket) {
        return yield* Effect.fail(presenceError(`Ticket '${input.ticketId}' not found.`));
      }

      if (input.attemptId) {
        const context = yield* readAttemptWorkspaceContext(input.attemptId);
        if (!context || context.ticketId !== input.ticketId) {
          return yield* Effect.fail(
            presenceError("Validation waivers can only be recorded for attempts attached to the selected ticket."),
          );
        }
      }

      const policy = yield* evaluateSupervisorActionInternal({
        action: "record_validation_waiver",
        ticketId: input.ticketId,
        attemptId: input.attemptId ?? null,
      });
      if (!policy.allowed) {
        return yield* Effect.fail(presenceError(policy.reasons.join(" ")));
      }

      const waiverId = makeId(ValidationWaiverId, "waiver");
      const createdAt = nowIso();
      yield* sql`
        INSERT INTO presence_validation_waivers (
          validation_waiver_id, ticket_id, attempt_id, reason, granted_by, created_at
        ) VALUES (
          ${waiverId},
          ${input.ticketId},
          ${input.attemptId ?? null},
          ${input.reason},
          ${input.grantedBy},
          ${createdAt}
        )
      `;

      return {
        id: waiverId,
        ticketId: input.ticketId,
        attemptId: input.attemptId ?? null,
        reason: input.reason,
        grantedBy: input.grantedBy,
        createdAt,
      };
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(presenceError("Failed to record validation waiver.", cause)),
      ),
    );

  const submitGoalIntake: PresenceControlPlaneShape["submitGoalIntake"] = (input) =>
    Effect.gen(function* () {
      const repository = yield* sql<{
        boardId: string;
        repositoryId: string;
      }>`
        SELECT board_id as "boardId", repository_id as "repositoryId"
        FROM presence_boards
        WHERE board_id = ${input.boardId}
      `.pipe(Effect.map((rows) => rows[0] ?? null));
      if (!repository) {
        return yield* Effect.fail(presenceError(`Board '${input.boardId}' not found.`));
      }

      yield* getOrCreateCapabilityScan(repository.repositoryId);

      const normalized = normalizeGoalParts(input.rawGoal);
      const createdAt = nowIso();
      const createdTickets: TicketRecord[] = [];

      return yield* sql.withTransaction(
        Effect.gen(function* () {
          for (const part of normalized.parts) {
            const ticketId = makeId(TicketId, "ticket");
            const title = shortTitle(part, "Supervisor intake");
            const checklist: PresenceAcceptanceChecklistItem[] = [
              { id: `check_${crypto.randomUUID()}`, label: "Mechanism understood", checked: false },
              { id: `check_${crypto.randomUUID()}`, label: "Evidence attached", checked: false },
              { id: `check_${crypto.randomUUID()}`, label: "Validation recorded", checked: false },
            ];

            yield* sql`
              INSERT INTO presence_tickets (
                ticket_id, board_id, parent_ticket_id, title, description, status, priority,
                acceptance_checklist_json, assigned_attempt_id, created_at, updated_at
              ) VALUES (
                ${ticketId},
                ${input.boardId},
                ${null},
                ${title},
                ${part},
                ${"todo"},
                ${input.priorityHint ?? "p2"},
                ${encodeJson(checklist)},
                ${null},
                ${createdAt},
                ${createdAt}
              )
            `;

            createdTickets.push({
              id: ticketId,
              boardId: BoardId.make(input.boardId),
              parentTicketId: null,
              title,
              description: part,
              status: "todo",
              priority: input.priorityHint ?? "p2",
              acceptanceChecklist: checklist,
              assignedAttemptId: null,
              createdAt,
              updatedAt: createdAt,
            });
          }

          const intakeId = makeId(GoalIntakeId, "goal");
          const summary = normalized.decomposed
            ? `Supervisor decomposed the goal into ${createdTickets.length} tickets.`
            : "Supervisor created one ticket from the goal.";

          yield* sql`
            INSERT INTO presence_goal_intakes (
              goal_intake_id, board_id, source, raw_goal, summary, created_ticket_ids_json, created_at
            ) VALUES (
              ${intakeId},
              ${input.boardId},
              ${input.source},
              ${input.rawGoal},
              ${summary},
              ${encodeJson(createdTickets.map((ticket) => ticket.id))},
              ${createdAt}
            )
          `;

          const intake: GoalIntakeRecord = {
            id: intakeId,
            boardId: BoardId.make(input.boardId),
            source: input.source,
            rawGoal: input.rawGoal,
            summary,
            createdTicketIds: createdTickets.map((ticket) => ticket.id),
            createdAt,
          };

          return {
            intake,
            createdTickets,
            decomposed: normalized.decomposed,
          } satisfies GoalIntakeResult;
        }),
      );
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(presenceError("Failed to submit supervisor goal intake.", cause)),
      ),
    );

  const submitReviewDecision: PresenceControlPlaneShape["submitReviewDecision"] = (input) =>
    Effect.gen(function* () {
      const decisionId = makeId(ReviewDecisionId, "review");
      const createdAt = nowIso();
      let mergedContext: AttemptWorkspaceContextRow | null = null;
      let nextTicketStatus: typeof PresenceTicketStatus.Type = "in_review";
      let nextAttemptStatus: typeof PresenceAttemptStatus.Type | null = null;

      if (input.decision === "accept") {
        if (!input.attemptId) {
          return yield* Effect.fail(
            presenceError("Approving a ticket requires a specific attempt."),
          );
        }
        const policy = yield* evaluateSupervisorActionInternal({
          action: "approve_attempt",
          ticketId: input.ticketId,
          attemptId: input.attemptId,
        });
        if (!policy.allowed) {
          return yield* Effect.fail(presenceError(policy.reasons.join(" ")));
        }
        nextTicketStatus = policy.recommendedTicketStatus ?? "ready_to_merge";
        nextAttemptStatus = policy.recommendedAttemptStatus ?? "accepted";
      } else if (input.decision === "merge_approved") {
        if (!input.attemptId) {
          return yield* Effect.fail(
            presenceError("Merge approval requires a specific attempt to merge."),
          );
        }

        const policy = yield* evaluateSupervisorActionInternal({
          action: "merge_attempt",
          ticketId: input.ticketId,
          attemptId: input.attemptId,
        });
        if (!policy.allowed) {
          return yield* Effect.fail(presenceError(policy.reasons.join(" ")));
        }

        const context = yield* readAttemptWorkspaceContext(input.attemptId);
        if (!context) {
          return yield* Effect.fail(presenceError(`Attempt '${input.attemptId}' not found.`));
        }

        yield* ensureAttemptWorkspaceCommitted(context);
        yield* mergeAttemptIntoBase(context);

        if (context.workspaceWorktreePath) {
          yield* gitCore.removeWorktree({
            cwd: context.workspaceRoot,
            path: context.workspaceWorktreePath,
            force: true,
          }).pipe(
            Effect.mapError((cause) =>
              presenceError("Merged the attempt but failed to clean up its worktree.", cause),
            ),
          );
        }

        if (context.attemptThreadId) {
          yield* syncThreadWorkspaceMetadata({
            threadId: context.attemptThreadId,
            branch: null,
            worktreePath: null,
          }).pipe(
            Effect.mapError((cause) =>
              presenceError(
                "Merged the attempt but failed to detach the session from its worktree.",
                cause,
              ),
            ),
          );
        }

        mergedContext = context;
        nextTicketStatus = policy.recommendedTicketStatus ?? "done";
        nextAttemptStatus = policy.recommendedAttemptStatus ?? "merged";
      } else if (input.decision === "request_changes") {
        if (!input.attemptId) {
          return yield* Effect.fail(
            presenceError("Requesting changes requires a specific attempt."),
          );
        }
        const policy = yield* evaluateSupervisorActionInternal({
          action: "request_changes",
          ticketId: input.ticketId,
          attemptId: input.attemptId,
        });
        if (!policy.allowed) {
          return yield* Effect.fail(presenceError(policy.reasons.join(" ")));
        }
        nextTicketStatus = policy.recommendedTicketStatus ?? "in_progress";
        nextAttemptStatus = policy.recommendedAttemptStatus ?? "in_progress";
      } else if (input.decision === "reject") {
        nextTicketStatus = "blocked";
        nextAttemptStatus = "rejected";
      } else if (input.decision === "escalate") {
        nextTicketStatus = "blocked";
      }

      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO presence_review_decisions (
              review_decision_id, ticket_id, attempt_id, decision, notes, created_at
            ) VALUES (
              ${decisionId},
              ${input.ticketId},
              ${input.attemptId ?? null},
              ${input.decision},
              ${input.notes},
              ${createdAt}
            )
          `;
          if (input.attemptId) {
            if (nextAttemptStatus) {
              yield* sql`
                UPDATE presence_attempts
                SET status = ${nextAttemptStatus}, updated_at = ${createdAt}
                WHERE attempt_id = ${input.attemptId}
              `;
            }
          }
          yield* sql`
            UPDATE presence_tickets
            SET status = ${nextTicketStatus}, updated_at = ${createdAt}
            WHERE ticket_id = ${input.ticketId}
          `;

          if (mergedContext) {
            yield* sql`
              UPDATE presence_workspaces
              SET
                status = ${"cleaned_up"},
                worktree_path = ${null},
                updated_at = ${createdAt}
              WHERE workspace_id = ${mergedContext.workspaceId}
            `;
          }
        }),
      );

      return {
        id: decisionId,
        ticketId: input.ticketId,
        attemptId: input.attemptId ?? null,
        decision: input.decision,
        notes: input.notes,
        createdAt,
      };
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(presenceError("Failed to submit review decision.", cause)),
      ),
    );

  return {
    listRepositories,
    importRepository,
    getBoardSnapshot,
    getRepositoryCapabilities,
    scanRepositoryCapabilities,
    createTicket,
    updateTicket,
    createAttempt,
    prepareWorkspace,
    cleanupWorkspace,
    startAttemptSession,
    attachThreadToAttempt,
    saveSupervisorHandoff,
    saveWorkerHandoff,
    saveAttemptEvidence,
    runAttemptValidation,
    upsertKnowledgePage,
    createPromotionCandidate,
    reviewPromotionCandidate,
    createDeterministicJob,
    evaluateSupervisorAction,
    recordValidationWaiver,
    submitGoalIntake,
    submitReviewDecision,
  } satisfies PresenceControlPlaneShape;
});

export const PresenceControlPlaneLive = Layer.effect(
  PresenceControlPlane,
  makePresenceControlPlane,
).pipe(Layer.provideMerge(SupervisorPolicyLive));
