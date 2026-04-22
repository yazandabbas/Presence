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
  FindingId,
  GoalIntakeId,
  GoalIntakeSource,
  type GoalIntakeRecord,
  type GoalIntakeResult,
  HandoffId,
  type KnowledgePageRecord,
  KnowledgePageId,
  MessageId,
  MergeOperationId,
  type ModelSelection,
  PresenceAttachThreadInput,
  PresenceCleanupWorkspaceInput,
  PresenceCreateFollowUpProposalInput,
  PresenceCreateAttemptInput,
  PresenceCreateDeterministicJobInput,
  PresenceCreatePromotionCandidateInput,
  PresenceCancelSupervisorRunInput,
  PresenceDismissFindingInput,
  PresenceEvaluateSupervisorActionInput,
  PresenceGetRepositoryCapabilitiesInput,
  PresenceMaterializeFollowUpInput,
  PresencePrepareWorkspaceInput,
  PresenceProjectionHealthStatus,
  PresenceRecordValidationWaiverInput,
  PresenceResolveFindingInput,
  PresenceRunAttemptValidationInput,
  type PresenceAcceptanceChecklistItem,
  PresenceCreateTicketInput,
  PresenceGetBoardSnapshotInput,
  PresenceImportRepositoryInput,
  PresenceListRepositoriesInput,
  PresenceMergeOperationStatus,
  PresenceScanRepositoryCapabilitiesInput,
  PresencePromotionStatus,
  PresenceReviewDecisionKind,
  PresenceReviewRecommendationKind,
  PresenceReviewPromotionCandidateInput,
  PresenceRpcError,
  PresenceSubmitGoalIntakeInput,
  PresenceStartSupervisorRunInput,
  PresenceSaveAttemptEvidenceInput,
  PresenceSaveSupervisorHandoffInput,
  PresenceSaveWorkerHandoffInput,
  PresenceStartAttemptSessionInput,
  PresenceAttemptStatus,
  PresenceAttemptOutcomeKind,
  PresenceFindingDisposition,
  PresenceFindingSeverity,
  PresenceFindingSource,
  PresenceFindingStatus,
  PresenceFollowUpProposalKind,
  PresenceJobStatus,
  PresenceKnowledgeFamily,
  PresenceReviewerKind,
  PresenceProjectionScopeType,
  PresenceSupervisorRunStage,
  PresenceSupervisorRunStatus,
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
  ProposedFollowUpId,
  type PromotionCandidateRecord,
  PromotionCandidateId,
  ProjectId,
  RepositoryId,
  type RepositorySummary,
  ReviewDecisionId,
  ReviewArtifactId,
  type ReviewChecklistAssessmentItem,
  type ReviewEvidenceItem,
  SupervisorRunId,
  type AttemptOutcomeRecord,
  type FindingRecord,
  type MergeOperationRecord,
  type ProposedFollowUpRecord,
  type ProjectionHealthRecord,
  type ReviewArtifactRecord,
  type ReviewDecisionRecord,
  type SupervisorPolicyDecision,
  type SupervisorActionKind,
  type SupervisorHandoffRecord,
  type SupervisorRunRecord,
  type TicketSummaryRecord,
  ThreadId,
  TicketId,
  TrimmedNonEmptyString,
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

function addMillisecondsIso(baseIso: string, milliseconds: number): string {
  return new Date(new Date(baseIso).getTime() + milliseconds).toISOString();
}

function projectionRepairKey(scopeType: ProjectionScopeType, scopeId: string): string {
  return `${scopeType}:${scopeId}`;
}

function projectionRetryDelayMs(attemptCount: number): number {
  if (attemptCount <= 1) return 0;
  return Math.min(5 * 60_000, 5_000 * 2 ** Math.max(0, attemptCount - 2));
}

function conciseProjectionErrorMessage(cause: unknown): string {
  const message =
    typeof cause === "object" && cause !== null && "message" in cause
      ? String((cause as { message?: unknown }).message ?? "")
      : String(cause ?? "");
  return message.replace(/\s+/g, " ").trim().slice(0, 300) || "Projection sync failed.";
}

function projectionErrorPath(cause: unknown): string | null {
  const message =
    typeof cause === "object" && cause !== null && "message" in cause
      ? String((cause as { message?: unknown }).message ?? "")
      : "";
  const match = message.match(/Presence projection '([^']+)'/);
  return match?.[1] ?? null;
}

function projectionIsRepairEligible(
  health: Pick<
    ProjectionHealthRecord,
    "status" | "retryAfter" | "desiredVersion" | "projectedVersion" | "leaseExpiresAt"
  > | null,
  now = nowIso(),
): boolean {
  if (!health || health.status !== "stale") return false;
  if (health.projectedVersion >= health.desiredVersion) return false;
  if (health.leaseExpiresAt && health.leaseExpiresAt.localeCompare(now) > 0) return false;
  return !health.retryAfter || health.retryAfter.localeCompare(now) <= 0;
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

function isMechanismChecklistItem(item: PresenceAcceptanceChecklistItem): boolean {
  return /mechanism understood/i.test(item.label);
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
  return new PresenceRpcError({
    message: formatPresenceErrorMessage(message, cause),
    ...(cause !== undefined ? { cause } : {}),
  });
}

function isPresenceRpcError(cause: unknown): cause is PresenceRpcError {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "name" in cause &&
    (cause as { name?: unknown }).name === "PresenceRpcError"
  );
}

function extractPresenceErrorDetail(cause: unknown, depth = 0): string | null {
  if (depth > 4 || cause === undefined || cause === null) {
    return null;
  }
  if (isPresenceRpcError(cause)) {
    return cause.message.trim();
  }
  if (cause instanceof Error) {
    const message = cause.message.trim();
    if (message.length > 0) {
      return message;
    }
    return "cause" in cause ? extractPresenceErrorDetail(cause.cause, depth + 1) : null;
  }
  if (typeof cause === "string") {
    const message = cause.trim();
    return message.length > 0 ? message : null;
  }
  if (typeof cause === "object") {
    if ("message" in cause && typeof cause.message === "string") {
      const message = cause.message.trim();
      if (message.length > 0) {
        return message;
      }
    }
    if ("cause" in cause) {
      return extractPresenceErrorDetail(cause.cause, depth + 1);
    }
  }
  return null;
}

function formatPresenceErrorMessage(message: string, cause?: unknown): string {
  const detail = extractPresenceErrorDetail(cause);
  if (!detail) {
    return message;
  }
  if (detail === message || message.includes(detail)) {
    return message;
  }
  if (detail.includes(message)) {
    return detail;
  }
  const normalizedMessage = /[.!?]$/.test(message) ? message : `${message}.`;
  return `${normalizedMessage} ${detail}`;
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

function isModelSelectionAvailable(
  providers: ReadonlyArray<{
    provider: string;
    enabled: boolean;
    installed: boolean;
    status: string;
    models: ReadonlyArray<{ slug: string }>;
  }>,
  selection: ModelSelection | null | undefined,
): selection is ModelSelection {
  if (!selection) return false;
  const provider = providers.find((candidate) => candidate.provider === selection.provider);
  if (!provider) return false;
  if (!provider.enabled || !provider.installed || provider.status === "error") return false;
  return provider.models.some((model) => model.slug === selection.model);
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

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isSqliteUniqueConstraintError(error: unknown): boolean {
  return /SQLITE_CONSTRAINT|UNIQUE constraint failed|constraint failed/i.test(
    describeUnknownError(error),
  );
}

type WorkerReasoningSource = WorkerHandoffRecord["reasoningSource"];
type ProjectionScopeType = ProjectionHealthRecord["scopeType"];
type ProjectionHealthStatus = ProjectionHealthRecord["status"];

type ParsedPresenceHandoffBlock = Readonly<{
  completedWork: ReadonlyArray<string>;
  currentHypothesis: string | null;
  nextStep: string | null;
  openQuestions: ReadonlyArray<string>;
  updatedAt: string;
  source: "assistant_block";
}>;

type ParsedPresenceReviewFinding = Readonly<{
  severity: FindingRecord["severity"];
  disposition: FindingRecord["disposition"];
  summary: string;
  rationale: string;
}>;

type ParsedPresenceReviewResult = Readonly<{
  decision: PresenceReviewRecommendationKind;
  summary: string;
  checklistAssessment: ReadonlyArray<ReviewChecklistAssessmentItem>;
  findings: ReadonlyArray<ParsedPresenceReviewFinding>;
  evidence: ReadonlyArray<ReviewEvidenceItem>;
  changedFilesReviewed: ReadonlyArray<string>;
  updatedAt: string;
}>;

function mergeOperationIsNonTerminal(status: MergeOperationRecord["status"]): boolean {
  return status === "pending_git" || status === "git_applied" || status === "cleanup_pending";
}

function mergeOperationIndicatesFailure(status: MergeOperationRecord["status"]): boolean {
  return status === "failed";
}

function mergeOperationHasCleanupPending(status: MergeOperationRecord["status"]): boolean {
  return status === "cleanup_pending";
}

type AttemptBlockerClass =
  | "missing_tooling"
  | "system_dependency"
  | "disk_space"
  | "validation_regression"
  | "review_gap"
  | "unknown";

type BlockerSummary = Readonly<{
  blockerClass: AttemptBlockerClass;
  normalizedSignature: string;
  summary: string;
  representativeEvidence: string;
  count: number;
  latestAt: string | null;
}>;

type AttemptActivityEntry = Readonly<{
  createdAt: string;
  kind: string;
  summary: string;
}>;

// TODO(presence): Replace this text-block protocol with a real structured handoff
// channel or tool call once the runtime can carry persistent role prompts plus
// machine-readable worker updates separately from free-form assistant prose.
const PRESENCE_HANDOFF_START = "[PRESENCE_HANDOFF]";
const PRESENCE_HANDOFF_END = "[/PRESENCE_HANDOFF]";
const PRESENCE_HANDOFF_HEADINGS = {
  completedWork: "Completed work:",
  currentHypothesis: "Current hypothesis:",
  nextStep: "Next step:",
  openQuestions: "Open questions:",
} as const;

// TODO(presence): Replace this structured assistant-message review result with a
// dedicated review-result transport once the runtime can carry machine-readable
// supervisor/review exchanges without embedding JSON in assistant prose.
const PRESENCE_REVIEW_RESULT_START = "[PRESENCE_REVIEW_RESULT]";
const PRESENCE_REVIEW_RESULT_END = "[/PRESENCE_REVIEW_RESULT]";
const REVIEW_THREAD_TIMEOUT_MS = 5 * 60 * 1000;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, max = 160): string {
  const normalized = collapseWhitespace(value);
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function normalizeBlockerSignature(value: string): string {
  return collapseWhitespace(value)
    .toLowerCase()
    .replace(/[0-9a-f]{7,}/g, "<hash>")
    .replace(/\b\d+\b/g, "<n>");
}

function parseBulletLines(lines: ReadonlyArray<string>): string[] | null {
  const nonEmpty = lines.map((line) => line.trim()).filter(Boolean);
  if (nonEmpty.length === 0) return [];
  if (nonEmpty.some((line) => !line.startsWith("- "))) {
    return null;
  }
  return nonEmpty.map((line) => line.slice(2).trim()).filter(Boolean);
}

function parseParagraphLines(lines: ReadonlyArray<string>): string | null {
  const normalized = lines.map((line) => line.trim()).filter(Boolean).join(" ").trim();
  if (!normalized || /^none$/i.test(normalized)) return null;
  return normalized;
}

function parsePresenceHandoffBlock(
  text: string,
  updatedAt: string,
): ParsedPresenceHandoffBlock | null {
  const match = [...text.matchAll(/\[PRESENCE_HANDOFF\][\s\S]*?\[\/PRESENCE_HANDOFF\]/g)].at(-1);
  if (!match) return null;
  const block = match[0].replace(/\r\n/g, "\n").trim();
  const lines = block.split("\n");
  if (lines[0] !== PRESENCE_HANDOFF_START || lines.at(-1) !== PRESENCE_HANDOFF_END) {
    return null;
  }
  const body = lines.slice(1, -1);
  const completedIndex = body.indexOf(PRESENCE_HANDOFF_HEADINGS.completedWork);
  const hypothesisIndex = body.indexOf(PRESENCE_HANDOFF_HEADINGS.currentHypothesis);
  const nextStepIndex = body.indexOf(PRESENCE_HANDOFF_HEADINGS.nextStep);
  const openQuestionsIndex = body.indexOf(PRESENCE_HANDOFF_HEADINGS.openQuestions);
  if (
    completedIndex !== 0 ||
    hypothesisIndex <= completedIndex ||
    nextStepIndex <= hypothesisIndex ||
    openQuestionsIndex <= nextStepIndex
  ) {
    return null;
  }

  const completedWork = parseBulletLines(body.slice(completedIndex + 1, hypothesisIndex));
  const currentHypothesis = parseParagraphLines(body.slice(hypothesisIndex + 1, nextStepIndex));
  const nextStep = parseParagraphLines(body.slice(nextStepIndex + 1, openQuestionsIndex));
  const openQuestions = parseBulletLines(body.slice(openQuestionsIndex + 1));
  if (completedWork === null || openQuestions === null) {
    return null;
  }

  return {
    completedWork,
    currentHypothesis,
    nextStep,
    openQuestions,
    updatedAt,
    source: "assistant_block",
  };
}

const PresenceReviewResultPayloadSchema = Schema.Struct({
  decision: PresenceReviewRecommendationKind,
  summary: TrimmedNonEmptyString,
  checklistAssessment: Schema.Array(
    Schema.Struct({
      label: TrimmedNonEmptyString,
      satisfied: Schema.Boolean,
      notes: Schema.String,
    }),
  ),
  findings: Schema.Array(
    Schema.Struct({
      severity: PresenceFindingSeverity,
      disposition: PresenceFindingDisposition,
      summary: TrimmedNonEmptyString,
      rationale: Schema.String,
    }),
  ),
  evidence: Schema.Array(
    Schema.Struct({
      summary: TrimmedNonEmptyString,
    }),
  ),
  changedFilesReviewed: Schema.Array(TrimmedNonEmptyString),
});

function parsePresenceReviewResultBlock(
  text: string,
  updatedAt: string,
): ParsedPresenceReviewResult | null {
  const match = [
    ...text.matchAll(/\[PRESENCE_REVIEW_RESULT\][\s\S]*?\[\/PRESENCE_REVIEW_RESULT\]/g),
  ].at(-1);
  if (!match) return null;
  const block = match[0].replace(/\r\n/g, "\n").trim();
  const lines = block.split("\n");
  if (lines[0] !== PRESENCE_REVIEW_RESULT_START || lines.at(-1) !== PRESENCE_REVIEW_RESULT_END) {
    return null;
  }
  const body = lines.slice(1, -1).join("\n").trim();
  if (!body) return null;
  try {
    const parsed = Schema.decodeSync(PresenceReviewResultPayloadSchema)(JSON.parse(body));
    return {
      decision: parsed.decision,
      summary: parsed.summary,
      checklistAssessment: parsed.checklistAssessment,
      findings: parsed.findings,
      evidence: parsed.evidence,
      changedFilesReviewed: uniqueStrings(parsed.changedFilesReviewed),
      updatedAt,
    };
  } catch {
    return null;
  }
}

function classifyBlockerText(rawText: string): Omit<BlockerSummary, "count" | "latestAt"> {
  const text = collapseWhitespace(rawText);
  const signature = normalizeBlockerSignature(text);
  if (!text) {
    return {
      blockerClass: "unknown",
      normalizedSignature: "unknown",
      summary: "Unknown blocker",
      representativeEvidence: "No representative evidence recorded.",
    };
  }

  if (/\bpnpm\b.*(?:not found|is not recognized)|command not found|is not recognized as an internal or external command/i.test(text)) {
    return {
      blockerClass: "missing_tooling",
      normalizedSignature: signature,
      summary: "Environment blocker: required tooling is unavailable on PATH.",
      representativeEvidence: truncateText(text),
    };
  }

  if (/database or disk is full|os error 112|no space left on device|insufficient disk space|disk full/i.test(text)) {
    return {
      blockerClass: "disk_space",
      normalizedSignature: signature,
      summary: "Environment blocker: insufficient disk space is preventing progress.",
      representativeEvidence: truncateText(text),
    };
  }

  if (/libsqlite3-sys|bindgen|libclang|clang|cmake|msbuild|build tools|linker|custom build command failed|failed to run custom build command/i.test(text)) {
    return {
      blockerClass: "system_dependency",
      normalizedSignature: signature,
      summary: "Environment blocker: a required system dependency or toolchain component is missing.",
      representativeEvidence: truncateText(text),
    };
  }

  if (/review requested changes|request changes|review gap/i.test(text)) {
    return {
      blockerClass: "review_gap",
      normalizedSignature: signature,
      summary: "Review blocker: the attempt needs another worker pass before approval.",
      representativeEvidence: truncateText(text),
    };
  }

  if (/validation|test|lint|build|failed/i.test(text)) {
    return {
      blockerClass: "validation_regression",
      normalizedSignature: signature,
      summary: "Validation blocker: the latest checks are still failing.",
      representativeEvidence: truncateText(text),
    };
  }

  return {
    blockerClass: "unknown",
    normalizedSignature: signature,
    summary: "Unknown blocker",
    representativeEvidence: truncateText(text),
  };
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
      resumeProtocol: [...DEFAULT_PRESENCE_RESUME_PROTOCOL.supervisorReadOrder],
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
    status: Schema.decodeSync(PresenceSupervisorRunStatus)(row.status as never),
    stage: Schema.decodeSync(PresenceSupervisorRunStage)(row.stage as never),
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
    scopeType: Schema.decodeSync(PresenceProjectionScopeType)(row.scopeType as never),
    scopeId: row.scopeId,
    status: Schema.decodeSync(PresenceProjectionHealthStatus)(row.status as never),
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
    commandKind: Schema.decodeSync(RepositoryCommandKind)(row.commandKind as never),
    command: row.command,
    status: Schema.decodeSync(Schema.Literals(["running", "passed", "failed"]))(row.status as never),
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
    source: Schema.decodeSync(PresenceFindingSource)(row.source as never),
    severity: Schema.decodeSync(PresenceFindingSeverity)(row.severity as never),
    disposition: Schema.decodeSync(PresenceFindingDisposition)(row.disposition as never),
    status: Schema.decodeSync(PresenceFindingStatus)(row.status as never),
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
    reviewerKind: Schema.decodeSync(PresenceReviewerKind)(row.reviewerKind as never),
    decision: row.decision
      ? Schema.decodeSync(PresenceReviewRecommendationKind)(row.decision as never)
      : null,
    summary: row.summary,
    checklistJson: row.checklistJson,
    checklistAssessment: decodeJson<ReviewChecklistAssessmentItem[]>(
      row.checklistAssessmentJson,
      [],
    ),
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
    kind: Schema.decodeSync(PresenceFollowUpProposalKind)(row.kind as never),
    title: row.title,
    description: row.description,
    priority: Schema.decodeSync(PresenceTicketPriority)(row.priority as never),
    status: Schema.decodeSync(PresenceFindingStatus)(row.status as never),
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
    kind: Schema.decodeSync(PresenceAttemptOutcomeKind)(row.kind as never),
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

  const readSupervisorRunById = (runId: string) =>
    sql<{
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
    `.pipe(Effect.map((rows) => rows[0] ? mapSupervisorRun(rows[0]) : null));

  const readLatestSupervisorRunForBoard = (boardId: string) =>
    sql<{
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
    `.pipe(Effect.map((rows) => rows[0] ? mapSupervisorRun(rows[0]) : null));

  const projectionWorkerId = `presence-projector-${crypto.randomUUID()}`;
  let projectionWorkerRunning = false;

  const readProjectionHealth = (scopeType: ProjectionScopeType, scopeId: string) =>
    sql<{
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
    }>`
      SELECT
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
      WHERE scope_type = ${scopeType} AND scope_id = ${scopeId}
      LIMIT 1
    `.pipe(Effect.map((rows) => (rows[0] ? mapProjectionHealth(rows[0]) : null)));

  const persistProjectionHealth = (input: {
    scopeType: ProjectionScopeType;
    scopeId: string;
    status: ProjectionHealthStatus;
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
  }) =>
    sql`
      INSERT INTO presence_projection_health (
        scope_type,
        scope_id,
        status,
        desired_version,
        projected_version,
        lease_owner,
        lease_expires_at,
        last_attempted_at,
        last_succeeded_at,
        last_error_message,
        last_error_path,
        dirty_reason,
        retry_after,
        attempt_count,
        updated_at
      ) VALUES (
        ${input.scopeType},
        ${input.scopeId},
        ${input.status},
        ${Math.max(0, input.desiredVersion)},
        ${Math.max(0, input.projectedVersion)},
        ${input.leaseOwner},
        ${input.leaseExpiresAt},
        ${input.lastAttemptedAt},
        ${input.lastSucceededAt},
        ${input.lastErrorMessage},
        ${input.lastErrorPath},
        ${input.dirtyReason},
        ${input.retryAfter},
        ${Math.max(0, input.attemptCount)},
        ${input.updatedAt}
      )
      ON CONFLICT(scope_type, scope_id) DO UPDATE SET
        status = excluded.status,
        desired_version = excluded.desired_version,
        projected_version = excluded.projected_version,
        lease_owner = excluded.lease_owner,
        lease_expires_at = excluded.lease_expires_at,
        last_attempted_at = excluded.last_attempted_at,
        last_succeeded_at = excluded.last_succeeded_at,
        last_error_message = excluded.last_error_message,
        last_error_path = excluded.last_error_path,
        dirty_reason = excluded.dirty_reason,
        retry_after = excluded.retry_after,
        attempt_count = excluded.attempt_count,
        updated_at = excluded.updated_at
    `.pipe(Effect.asVoid);

  const markProjectionDirty = (input: {
    scopeType: ProjectionScopeType;
    scopeId: string;
    dirtyReason: string;
  }) =>
    Effect.gen(function* () {
      const existing = yield* readProjectionHealth(input.scopeType, input.scopeId);
      const updatedAt = nowIso();
      const nextDesiredVersion = (existing?.desiredVersion ?? 0) + 1;
      yield* persistProjectionHealth({
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        status: existing?.status === "repairing" ? "repairing" : "stale",
        desiredVersion: nextDesiredVersion,
        projectedVersion: existing?.projectedVersion ?? 0,
        leaseOwner: existing?.leaseOwner ?? null,
        leaseExpiresAt: existing?.leaseExpiresAt ?? null,
        lastAttemptedAt: existing?.lastAttemptedAt ?? null,
        lastSucceededAt: existing?.lastSucceededAt ?? null,
        lastErrorMessage: existing?.lastErrorMessage ?? null,
        lastErrorPath: existing?.lastErrorPath ?? null,
        dirtyReason: input.dirtyReason,
        retryAfter: existing?.status === "repairing" ? existing.retryAfter : null,
        attemptCount: existing?.attemptCount ?? 0,
        updatedAt,
      });
      return nextDesiredVersion;
    });

  const claimProjectionScope = (
    scopeType: ProjectionScopeType,
    scopeId: string,
    options?: { ignoreRetryAfter?: boolean | undefined },
  ) =>
    Effect.gen(function* () {
      const now = nowIso();
      const leaseExpiresAt = addMillisecondsIso(now, 30_000);
      yield* sql`
        UPDATE presence_projection_health
        SET
          status = ${"repairing"},
          lease_owner = ${projectionWorkerId},
          lease_expires_at = ${leaseExpiresAt},
          last_attempted_at = ${now},
          retry_after = ${null},
          updated_at = ${now}
        WHERE
          scope_type = ${scopeType}
          AND scope_id = ${scopeId}
          AND desired_version > projected_version
          AND (${options?.ignoreRetryAfter ? 1 : 0} = 1 OR retry_after IS NULL OR retry_after <= ${now})
          AND (lease_expires_at IS NULL OR lease_expires_at <= ${now})
      `;
      const claimed = yield* readProjectionHealth(scopeType, scopeId);
      if (!claimed || claimed.leaseOwner !== projectionWorkerId) {
        return null;
      }
      return claimed;
    });

  const claimNextProjectionScope = () =>
    Effect.gen(function* () {
      const now = nowIso();
      const candidate = yield* sql<{
        scopeType: string;
        scopeId: string;
      }>`
        SELECT
          scope_type as "scopeType",
          scope_id as "scopeId"
        FROM presence_projection_health
        WHERE
          desired_version > projected_version
          AND (retry_after IS NULL OR retry_after <= ${now})
          AND (lease_expires_at IS NULL OR lease_expires_at <= ${now})
        ORDER BY
          CASE scope_type WHEN 'board' THEN 0 ELSE 1 END,
          updated_at ASC
        LIMIT 1
      `.pipe(Effect.map((rows) => rows[0] ?? null));
      if (!candidate) {
        return null;
      }
      return yield* claimProjectionScope(candidate.scopeType as ProjectionScopeType, candidate.scopeId);
    });

  const projectClaimedScope = (claimed: ProjectionHealthRecord) =>
    Effect.gen(function* () {
      const attemptedAt = nowIso();
      const syncEffect =
        claimed.scopeType === "board"
          ? syncBoardProjectionInternal(claimed.scopeId).pipe(
              Effect.andThen(syncBrainProjectionInternal(claimed.scopeId)),
            )
          : syncTicketProjectionInternal(claimed.scopeId);
      const exit = yield* Effect.exit(syncEffect);
      if (exit._tag === "Success") {
        const latest = yield* readProjectionHealth(claimed.scopeType, claimed.scopeId);
        const projectedVersion = Math.max(claimed.desiredVersion, latest?.projectedVersion ?? 0);
        const desiredVersion = latest?.desiredVersion ?? claimed.desiredVersion;
        yield* persistProjectionHealth({
          scopeType: claimed.scopeType,
          scopeId: claimed.scopeId,
          status: projectedVersion >= desiredVersion ? "healthy" : "stale",
          desiredVersion,
          projectedVersion,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastAttemptedAt: attemptedAt,
          lastSucceededAt: attemptedAt,
          lastErrorMessage: null,
          lastErrorPath: null,
          dirtyReason: latest?.dirtyReason ?? claimed.dirtyReason ?? null,
          retryAfter: null,
          attemptCount: 0,
          updatedAt: attemptedAt,
        });
        return;
      }

      const latest = yield* readProjectionHealth(claimed.scopeType, claimed.scopeId);
      const attemptCount = Math.max(0, latest?.attemptCount ?? claimed.attemptCount) + 1;
      yield* persistProjectionHealth({
        scopeType: claimed.scopeType,
        scopeId: claimed.scopeId,
        status: "stale",
        desiredVersion: latest?.desiredVersion ?? claimed.desiredVersion,
        projectedVersion: latest?.projectedVersion ?? claimed.projectedVersion,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastAttemptedAt: attemptedAt,
        lastSucceededAt: latest?.lastSucceededAt ?? claimed.lastSucceededAt,
        lastErrorMessage: conciseProjectionErrorMessage(exit.cause),
        lastErrorPath: projectionErrorPath(exit.cause),
        dirtyReason: latest?.dirtyReason ?? claimed.dirtyReason ?? null,
        retryAfter: addMillisecondsIso(attemptedAt, projectionRetryDelayMs(attemptCount)),
        attemptCount,
        updatedAt: attemptedAt,
      });
    });

  const runProjectionWorker = () =>
    Effect.gen(function* () {
      if (projectionWorkerRunning) {
        return;
      }
      projectionWorkerRunning = true;
      const loop = (): Effect.Effect<void, never, never> =>
        Effect.gen(function* () {
          const claimed = yield* claimNextProjectionScope();
          if (!claimed) {
            return;
          }
          yield* projectClaimedScope(claimed);
          yield* loop();
        }).pipe(Effect.orDie);
      yield* loop().pipe(
        Effect.ensuring(
          Effect.sync(() => {
            projectionWorkerRunning = false;
          }),
        ),
      );
    });

  const syncBoardProjectionBestEffort = (boardId: string, dirtyReason: string) =>
    markProjectionDirty({ scopeType: "board", scopeId: boardId, dirtyReason }).pipe(
      Effect.andThen(runProjectionWorker().pipe(Effect.forkDetach, Effect.asVoid)),
    );

  const syncTicketProjectionBestEffort = (ticketId: string, dirtyReason: string) =>
    markProjectionDirty({ scopeType: "ticket", scopeId: ticketId, dirtyReason }).pipe(
      Effect.andThen(runProjectionWorker().pipe(Effect.forkDetach, Effect.asVoid)),
    );

  const syncProjectionStrict = (
    scopeType: ProjectionScopeType,
    scopeId: string,
    dirtyReason: string,
  ) =>
    Effect.gen(function* () {
      yield* markProjectionDirty({ scopeType, scopeId, dirtyReason });
      while (true) {
        const health = yield* readProjectionHealth(scopeType, scopeId);
        if (!health) {
          return yield* Effect.fail(
            presenceError(`Projection scope '${projectionRepairKey(scopeType, scopeId)}' is missing.`),
          );
        }
        if (health.projectedVersion >= health.desiredVersion && health.status === "healthy") {
          return;
        }
        const claimable = projectionIsRepairEligible(health);
        if (claimable) {
          const claimed = yield* claimProjectionScope(scopeType, scopeId, { ignoreRetryAfter: true });
          if (claimed) {
            yield* projectClaimedScope(claimed);
            continue;
          }
        }
        if (health.status === "stale" && health.retryAfter && health.retryAfter.localeCompare(nowIso()) > 0) {
          return yield* Effect.fail(
            presenceError(
              health.lastErrorMessage ??
                `Failed to sync ${scopeType === "board" ? "board" : "ticket"} projection.`,
            ),
          );
        }
        yield* Effect.sleep(100);
      }
    });

  const persistSupervisorRun = (input: {
    runId: string;
    boardId: string;
    sourceGoalIntakeId: string | null;
    scopeTicketIds: ReadonlyArray<string>;
    status: PresenceSupervisorRunStatus;
    stage: PresenceSupervisorRunStage;
    currentTicketId: string | null;
    activeThreadIds: ReadonlyArray<string>;
    summary: string;
    createdAt?: string;
  }) =>
    Effect.gen(function* () {
      const now = nowIso();
      yield* sql`
        INSERT INTO presence_supervisor_runs (
          supervisor_run_id, board_id, source_goal_intake_id, scope_ticket_ids_json, status, stage,
          current_ticket_id, active_thread_ids_json, summary, created_at, updated_at
        ) VALUES (
          ${input.runId},
          ${input.boardId},
          ${input.sourceGoalIntakeId},
          ${encodeJson(input.scopeTicketIds)},
          ${input.status},
          ${input.stage},
          ${input.currentTicketId},
          ${encodeJson(input.activeThreadIds)},
          ${input.summary},
          ${input.createdAt ?? now},
          ${now}
        )
        ON CONFLICT(supervisor_run_id) DO UPDATE SET
          source_goal_intake_id = excluded.source_goal_intake_id,
          scope_ticket_ids_json = excluded.scope_ticket_ids_json,
          status = excluded.status,
          stage = excluded.stage,
          current_ticket_id = excluded.current_ticket_id,
          active_thread_ids_json = excluded.active_thread_ids_json,
          summary = excluded.summary,
          updated_at = excluded.updated_at
      `;
      const row = yield* readSupervisorRunById(input.runId);
      if (!row) {
        return yield* Effect.fail(presenceError(`Supervisor run '${input.runId}' could not be loaded.`));
      }
      yield* syncBoardProjectionBestEffort(input.boardId, "Supervisor run updated.");
      return row;
    });

  const readThreadFromModel = (threadId: string) =>
    orchestrationEngine.getReadModel().pipe(
      Effect.map((readModel) => readModel.threads.find((thread) => thread.id === ThreadId.make(threadId)) ?? null),
    );

  const waitForClaimedThreadAvailability = (input: {
    attemptId: string;
    threadId: string;
    maxChecks?: number;
  }) =>
    Effect.gen(function* () {
      const maxChecks = input.maxChecks ?? 20;
      for (let attempt = 0; attempt < maxChecks; attempt += 1) {
        const thread = yield* readThreadFromModel(input.threadId);
        if (thread) {
          return true;
        }
        const latestAttempt = yield* readAttemptWorkspaceContext(input.attemptId);
        if (!latestAttempt || latestAttempt.attemptThreadId !== input.threadId) {
          return false;
        }
        yield* Effect.sleep(50);
      }
      return false;
    });

  const waitForWorkspacePreparation = (input: {
    attemptId: string;
    branch: string;
    maxChecks?: number;
  }) =>
    Effect.gen(function* () {
      const maxChecks = input.maxChecks ?? 30;
      for (let attempt = 0; attempt < maxChecks; attempt += 1) {
        const latestWorkspace = yield* readAttemptWorkspaceContext(input.attemptId);
        if (!latestWorkspace) {
          return null;
        }
        const worktreePath = latestWorkspace.workspaceWorktreePath?.trim() ?? null;
        const branch = latestWorkspace.workspaceBranch?.trim() ?? null;
        if (worktreePath && branch === input.branch) {
          return {
            id: WorkspaceId.make(latestWorkspace.workspaceId),
            attemptId: AttemptId.make(latestWorkspace.attemptId),
            status: Schema.decodeSync(PresenceWorkspaceStatus)(latestWorkspace.workspaceStatus as never),
            branch,
            worktreePath,
            createdAt: latestWorkspace.workspaceCreatedAt,
            updatedAt: latestWorkspace.workspaceUpdatedAt,
          } satisfies WorkspaceRecord;
        }
        if (!branch || branch !== input.branch) {
          return null;
        }
        yield* Effect.sleep(50);
      }
      return null;
    });

  const isThreadSettled = (thread: {
    latestTurn: { state: "running" | "interrupted" | "completed" | "error" } | null;
  } | null) =>
    Boolean(thread?.latestTurn && thread.latestTurn.state !== "running");

  const readChangedFilesForWorkspace = (workspacePath: string | null) =>
    workspacePath
      ? gitCore.statusDetailsLocal(workspacePath).pipe(
          Effect.map((status) =>
            uniqueStrings(status.workingTree?.files?.map((file: { path: string }) => file.path) ?? []),
          ),
          Effect.catch(() => Effect.succeed([] as string[])),
        )
      : Effect.succeed([] as string[]);

  const readLatestAssistantReasoningFromThread = (thread: {
    messages: ReadonlyArray<{
      role: string;
      text: string;
      createdAt: string;
      updatedAt: string;
    }>;
  } | null) =>
    Effect.sync(() => {
      const assistantMessages = [...(thread?.messages ?? [])]
        .filter((message) => message.role === "assistant")
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      for (const message of assistantMessages) {
        const parsed = parsePresenceHandoffBlock(message.text, message.updatedAt ?? message.createdAt);
        if (parsed) {
          return parsed;
        }
      }
      return null;
    });

  const readLatestReviewResultFromThread = (thread: {
    messages: ReadonlyArray<{
      role: string;
      text: string;
      createdAt: string;
      updatedAt: string;
    }>;
  } | null) =>
    Effect.sync(() => {
      const assistantMessages = [...(thread?.messages ?? [])]
        .filter((message) => message.role === "assistant")
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      for (const message of assistantMessages) {
        const parsed = parsePresenceReviewResultBlock(message.text, message.updatedAt ?? message.createdAt);
        if (parsed) {
          return parsed;
        }
      }
      return null;
    });

  const collectAttemptActivityEntries = (input: {
    thread: {
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
    } | null;
    validationRuns: ReadonlyArray<ValidationRunRecord>;
    reviewArtifacts: ReadonlyArray<ReviewArtifactRecord>;
    mergeOperations: ReadonlyArray<MergeOperationRecord>;
  }) =>
    Effect.sync(() => {
      const entries: AttemptActivityEntry[] = [];
      for (const message of input.thread?.messages ?? []) {
        if (message.role !== "assistant") continue;
        const parsed = parsePresenceHandoffBlock(message.text, message.updatedAt ?? message.createdAt);
        const summary = parsed
          ? "Updated structured handoff reasoning."
          : truncateText(message.text);
        if (!summary) continue;
        entries.push({
          createdAt: message.updatedAt ?? message.createdAt,
          kind: "assistant",
          summary,
        });
      }
      for (const activity of input.thread?.activities ?? []) {
        entries.push({
          createdAt: activity.createdAt,
          kind: activity.kind,
          summary: truncateText(activity.summary),
        });
      }
      for (const run of input.validationRuns) {
        entries.push({
          createdAt: run.finishedAt ?? run.startedAt,
          kind: "validation",
          summary: truncateText(
            `${run.commandKind}: ${run.command} -> ${run.status}${run.exitCode !== null ? ` (${run.exitCode})` : ""}`,
          ),
        });
      }
      for (const artifact of input.reviewArtifacts) {
        entries.push({
          createdAt: artifact.createdAt,
          kind: "review",
          summary: truncateText(`${artifact.reviewerKind}: ${artifact.summary}`),
        });
      }
      for (const operation of input.mergeOperations) {
        entries.push({
          createdAt: operation.updatedAt,
          kind: "merge",
          summary: truncateText(
            `${operation.status}: ${operation.sourceBranch} -> ${operation.baseBranch}${operation.errorSummary ? ` (${operation.errorSummary})` : ""}`,
          ),
        });
      }
      return entries
        .filter((entry) => entry.summary.length > 0)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .slice(-40);
    });

  const buildBlockerSummaries = (input: {
    validationRuns: ReadonlyArray<ValidationRunRecord>;
    findings: ReadonlyArray<FindingRecord>;
    handoff: WorkerHandoffRecord | null;
  }): ReadonlyArray<BlockerSummary> => {
    const grouped = new Map<string, BlockerSummary>();
    const register = (rawText: string, createdAt: string | null) => {
      const classified = classifyBlockerText(rawText);
      const key = `${classified.blockerClass}::${classified.normalizedSignature}`;
      const existing = grouped.get(key);
      if (existing) {
        grouped.set(key, {
          ...existing,
          count: existing.count + 1,
          latestAt:
            existing.latestAt && createdAt
              ? (existing.latestAt.localeCompare(createdAt) >= 0 ? existing.latestAt : createdAt)
              : existing.latestAt ?? createdAt,
        });
        return;
      }
      grouped.set(key, {
        ...classified,
        count: 1,
        latestAt: createdAt,
      });
    };

    for (const run of input.validationRuns.filter((candidate) => candidate.status === "failed")) {
      register(
        [run.stderrSummary, run.stdoutSummary, `${run.commandKind}: ${run.command}`]
          .filter((value): value is string => Boolean(value))
          .join(" "),
        run.finishedAt ?? run.startedAt,
      );
    }
    for (const finding of input.findings.filter((candidate) => candidate.status === "open")) {
      register(`${finding.summary} ${finding.rationale}`, finding.updatedAt);
    }
    for (const blocker of input.handoff?.blockers ?? []) {
      register(blocker, input.handoff?.createdAt ?? null);
    }

    return [...grouped.values()].sort((left, right) =>
      (right.latestAt ?? "").localeCompare(left.latestAt ?? ""),
    );
  };

  const formatBulletList = (items: ReadonlyArray<string>) =>
    items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None recorded.";

  const sanitizeProjectionSegment = (value: string, fallback: string) => {
    const normalized = value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "");
    return normalized.length > 0 ? normalized : fallback;
  };

  const formatChecklistMarkdown = (items: ReadonlyArray<PresenceAcceptanceChecklistItem>) =>
    items.length > 0
      ? items.map((item) => `- [${item.checked ? "x" : " "}] ${item.label}`).join("\n")
      : "- None recorded.";

  const formatOptionalText = (value: string | null | undefined, fallback = "None recorded.") =>
    value?.trim().length ? value.trim() : fallback;

  const reasoningIsStale = (
    handoff: WorkerHandoffRecord | null,
    latestEvidenceAt: string | null,
  ) =>
    Boolean(
      handoff?.reasoningUpdatedAt &&
        latestEvidenceAt &&
        latestEvidenceAt.localeCompare(handoff.reasoningUpdatedAt) > 0,
    );

  const buildTicketSummaryRecord = (input: {
    ticket: TicketRecord;
    attempts: ReadonlyArray<AttemptRecord>;
    latestWorkerHandoffByAttemptId: ReadonlyMap<string, WorkerHandoffRecord>;
    findings: ReadonlyArray<FindingRecord>;
    followUps: ReadonlyArray<ProposedFollowUpRecord>;
    attemptOutcomes: ReadonlyArray<AttemptOutcomeRecord>;
    mergeOperations: ReadonlyArray<MergeOperationRecord>;
  }): TicketSummaryRecord => {
    const activeAttempt =
      input.attempts.find((attempt) => attempt.id === input.ticket.assignedAttemptId) ??
      input.attempts.find((attempt) =>
        ["planned", "in_progress", "in_review", "accepted"].includes(attempt.status),
      ) ??
      null;
    const handoffs = input.attempts
      .map((attempt) => input.latestWorkerHandoffByAttemptId.get(attempt.id))
      .filter((value): value is WorkerHandoffRecord => value !== undefined);
    const activeHandoff = activeAttempt
      ? input.latestWorkerHandoffByAttemptId.get(activeAttempt.id) ?? null
      : null;
    const openFindings = input.findings.filter((finding) => finding.status === "open");
    const blockedByFindings = openFindings.some((finding) => finding.severity === "blocking");
    const escalatedByFindings = openFindings.some(
      (finding) => finding.disposition === "escalate" || finding.disposition === "blocker",
    );
    const latestMergeOperation =
      [...input.mergeOperations].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ??
      null;

    return {
      ticketId: input.ticket.id,
      currentMechanism:
        activeHandoff?.currentHypothesis ??
        handoffs.map((handoff) => handoff.currentHypothesis).find((value) => Boolean(value)) ??
        null,
      triedAcrossAttempts: uniqueStrings([
        ...handoffs.flatMap((handoff) => handoff.completedWork),
        ...handoffs
          .filter((handoff) => handoff.changedFiles.length > 0)
          .map((handoff) => `Touched files: ${handoff.changedFiles.join(", ")}`),
      ]),
      failedWhy: uniqueStrings(
        [
          ...input.attemptOutcomes
            .filter((outcome) => outcome.kind !== "merged" && outcome.kind !== "superseded")
            .map((outcome) => `${outcome.kind}: ${outcome.summary}`),
          ...(activeHandoff?.blockers ?? []),
        ],
      ),
      openFindings: uniqueStrings(openFindings.map((finding) => finding.summary)),
      nextStep:
        activeHandoff?.nextStep ??
        (activeHandoff?.blockers[0]
          ? "Address the active blocker before retrying the same path."
          : null) ??
        handoffs.map((handoff) => handoff.nextStep).find((value) => Boolean(value)) ??
        null,
      activeAttemptId: activeAttempt?.id ?? null,
      blocked: input.ticket.status === "blocked" || blockedByFindings || escalatedByFindings,
      escalated: input.ticket.status === "blocked" || escalatedByFindings,
      hasFollowUpProposal: input.followUps.some((proposal) => proposal.status === "open"),
      hasMergeFailure: Boolean(
        latestMergeOperation && mergeOperationIndicatesFailure(latestMergeOperation.status),
      ),
      hasCleanupPending: Boolean(
        latestMergeOperation && mergeOperationHasCleanupPending(latestMergeOperation.status),
      ),
    };
  };

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
    status: Schema.decodeSync(PresenceMergeOperationStatus)(row.status as never),
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

  const writeProjectionFile = (filePath: string, content: string) =>
    Effect.tryPromise(async () => {
      await nodeFs.mkdir(path.dirname(filePath), { recursive: true });
      await nodeFs.writeFile(filePath, `${content.trimEnd()}\n`, "utf8");
    }).pipe(
      Effect.mapError((cause) => presenceError(`Failed to write Presence projection '${filePath}'.`, cause)),
    );

  const buildSupervisorTicketStateLines = (snapshot: BoardSnapshot) =>
    snapshot.ticketSummaries.map((summary) => {
      const ticket = snapshot.tickets.find((candidate) => candidate.id === summary.ticketId);
      const activeHandoff =
        summary.activeAttemptId
          ? snapshot.attemptSummaries.find(
              (attemptSummary) => attemptSummary.attempt.id === summary.activeAttemptId,
            )?.latestWorkerHandoff ?? null
          : null;
      const blockerClasses = buildBlockerSummaries({
        validationRuns: snapshot.validationRuns.filter(
          (run) => run.attemptId === summary.activeAttemptId,
        ),
        findings: snapshot.findings.filter(
          (finding) =>
            finding.ticketId === summary.ticketId &&
            (summary.activeAttemptId === null ||
              finding.attemptId === null ||
              finding.attemptId === summary.activeAttemptId),
        ),
        handoff: activeHandoff,
      }).map((item) => item.blockerClass);
      const stateLabel =
        summary.hasCleanupPending
          ? "cleanup_pending"
          : summary.hasMergeFailure
            ? "merge_failed"
            : ticket?.status === "ready_to_merge"
          ? "ready_to_merge"
          : ticket?.status === "blocked" && blockerClasses.some((value) => value !== "validation_regression" && value !== "review_gap" && value !== "unknown")
            ? "blocked_env"
            : ticket?.status === "blocked"
              ? "blocked_retry"
              : ticket?.status === "in_review"
                ? "waiting_on_review"
                : "waiting_on_worker";
      const retryNote =
        activeHandoff && activeHandoff.retryCount >= 3
          ? " Do not retry unchanged."
          : "";
      return `${stateLabel}: ${ticket?.title ?? summary.ticketId}${retryNote}`;
    });

  const buildSupervisorHandoffMarkdown = (
    handoff: SupervisorHandoffRecord | null,
    snapshot?: BoardSnapshot,
    run?: SupervisorRunRecord | null,
  ) =>
    handoff
      ? [
          "# Supervisor Handoff",
          "",
          `Updated: ${handoff.createdAt}`,
          `Current run: ${handoff.currentRunId ?? "None"}`,
          `Stage: ${handoff.stage ?? "None"}`,
          "",
          "## Top Priorities",
          formatBulletList(handoff.topPriorities),
          "",
          "## Active Attempts",
          formatBulletList(handoff.activeAttemptIds),
          "",
          "## Active Ticket States",
          formatBulletList(snapshot ? buildSupervisorTicketStateLines(snapshot) : []),
          "",
          "## Blocked Tickets",
          formatBulletList(handoff.blockedTicketIds),
          "",
          "## Recent Decisions",
          formatBulletList(handoff.recentDecisions),
          "",
          "## Next Board Actions",
          formatBulletList(handoff.nextBoardActions),
          "",
          "## Resume-First Action",
          formatOptionalText(run?.currentTicketId ? `Resume ${run.currentTicketId} first.` : null),
          "",
          "## Operating Contract",
          ...buildSupervisorPromptSections().flatMap((section) => [
            `### ${section.title}`,
            formatBulletList(section.lines),
            "",
          ]),
          "## Resume Protocol",
          formatBulletList(handoff.resumeProtocol),
        ].join("\n")
      : "# Supervisor Handoff\n\nNo supervisor handoff has been recorded yet.";

  const buildSupervisorRunMarkdown = (run: SupervisorRunRecord | null) =>
    run
      ? [
          "# Supervisor Run",
          "",
          `Run ID: ${run.id}`,
          `Status: ${run.status}`,
          `Stage: ${run.stage}`,
          `Current ticket: ${run.currentTicketId ?? "None"}`,
          "",
          "## Scope",
          formatBulletList(run.scopeTicketIds),
          "",
          "## Active Threads",
          formatBulletList(run.activeThreadIds),
          "",
          "## Summary",
          run.summary,
        ].join("\n")
      : "# Supervisor Run\n\nNo supervisor run is active.";

  const buildTicketMarkdown = (ticket: TicketRecord) =>
    [
      `# Ticket: ${ticket.title}`,
      "",
      `Ticket ID: ${ticket.id}`,
      `Status: ${ticket.status}`,
      `Priority: ${ticket.priority}`,
      `Assigned attempt: ${ticket.assignedAttemptId ?? "None"}`,
      ticket.parentTicketId ? `Parent ticket: ${ticket.parentTicketId}` : null,
      "",
      "## Description",
      ticket.description || "No description provided.",
      "",
      "## Acceptance Checklist",
      formatChecklistMarkdown(ticket.acceptanceChecklist),
    ]
      .filter((value): value is string => value !== null)
      .join("\n");

  const buildTicketCurrentSummaryMarkdown = (input: {
    summary: TicketSummaryRecord;
    findings: ReadonlyArray<FindingRecord>;
    followUps: ReadonlyArray<ProposedFollowUpRecord>;
    blockerSummaries: ReadonlyArray<BlockerSummary>;
    latestActivity: AttemptActivityEntry | null;
    mergeOperation: MergeOperationRecord | null;
  }) =>
    [
      "# Current Summary",
      "",
      `Active attempt: ${input.summary.activeAttemptId ?? "None"}`,
      `Blocked: ${input.summary.blocked ? "yes" : "no"}`,
      `Escalated: ${input.summary.escalated ? "yes" : "no"}`,
      `Follow-up proposal pending: ${input.summary.hasFollowUpProposal ? "yes" : "no"}`,
      "",
      "## Current Mechanism",
      formatOptionalText(input.summary.currentMechanism),
      "",
      "## Tried Across Attempts",
      formatBulletList(input.summary.triedAcrossAttempts),
      "",
      "## Failed Why",
      formatBulletList(input.summary.failedWhy),
      "",
      "## Open Findings",
      formatBulletList(input.summary.openFindings),
      "",
      "## Next Step",
      formatOptionalText(input.summary.nextStep),
      "",
      "## Active Runtime Signal",
      formatOptionalText(input.latestActivity?.summary ?? null),
      "",
      "## Merge State",
      input.mergeOperation
        ? [
            `Status: ${input.mergeOperation.status}`,
            `Base branch: ${input.mergeOperation.baseBranch}`,
            `Source branch: ${input.mergeOperation.sourceBranch}`,
            input.mergeOperation.errorSummary
              ? `Last error: ${input.mergeOperation.errorSummary}`
              : null,
          ]
            .filter((value): value is string => value !== null)
            .join("\n")
        : input.summary.hasCleanupPending
          ? "Merged with cleanup pending."
          : input.summary.hasMergeFailure
            ? "Merge failed and needs attention before the ticket can be completed."
            : input.summary.blocked
              ? "No merge operation is active."
              : "Ready to merge or no merge has been attempted yet.",
      "",
      "## Current Blocker Classes",
      formatBulletList(input.blockerSummaries.map((summary) => `${summary.blockerClass}: ${summary.summary}`)),
      "",
      "## Follow-Up Proposals",
      formatBulletList(
        input.followUps.map(
          (proposal) =>
            `${proposal.kind} (${proposal.status}) - ${proposal.title}${proposal.createdTicketId ? ` -> ${proposal.createdTicketId}` : ""}`,
        ),
      ),
      "",
      "## Blocking Findings Detail",
      formatBulletList(
        input.findings
          .filter((finding) => finding.status === "open" && finding.severity === "blocking")
          .map((finding) => `${finding.summary}: ${finding.rationale}`),
      ),
    ].join("\n");

  const buildAttemptProgressMarkdown = (input: {
    attempt: AttemptRecord;
    handoff: WorkerHandoffRecord | null;
    outcome: AttemptOutcomeRecord | null;
    latestActivityAt: string | null;
    latestEvidenceAt: string | null;
  }) =>
    [
      `# Attempt Progress: ${input.attempt.title}`,
      "",
      `Attempt ID: ${input.attempt.id}`,
      `Status: ${input.attempt.status}`,
      `Thread: ${input.attempt.threadId ?? "None"}`,
      `Confidence: ${input.attempt.confidence ?? "None"}`,
      `Retry count: ${input.handoff?.retryCount ?? 0}`,
      `Last activity: ${input.latestActivityAt ?? "None recorded."}`,
      `Reasoning source: ${input.handoff?.reasoningSource ?? "None recorded."}`,
      `Reasoning updated: ${input.handoff?.reasoningUpdatedAt ?? "None recorded."}`,
      input.outcome ? `Outcome: ${input.outcome.kind} - ${input.outcome.summary}` : "Outcome: None recorded.",
      "",
      "## Completed This Session",
      formatBulletList(input.handoff?.completedWork ?? []),
      "",
      "## Current Hypothesis",
      formatOptionalText(
        input.handoff?.currentHypothesis
          ? reasoningIsStale(input.handoff, input.latestEvidenceAt)
            ? `${input.handoff.currentHypothesis} (last confirmed before the latest blocker or validation updates)`
            : input.handoff.currentHypothesis
          : null,
      ),
      "",
      "## Next Step",
      formatOptionalText(
        input.handoff?.nextStep
          ? reasoningIsStale(input.handoff, input.latestEvidenceAt)
            ? `${input.handoff.nextStep} (last confirmed before the latest blocker or validation updates)`
            : input.handoff.nextStep
          : null,
      ),
      "",
      "## Open Questions",
      formatBulletList(input.handoff?.openQuestions ?? []),
      "",
      "## Changed Files",
      formatBulletList(input.handoff?.changedFiles ?? []),
      "",
      "## Tests Run",
      formatBulletList(input.handoff?.testsRun ?? []),
      "",
      "## Evidence IDs",
      formatBulletList((input.handoff?.evidenceIds ?? []).map((value) => String(value))),
    ].join("\n");

  const buildAttemptBlockersMarkdown = (input: {
    blockerSummaries: ReadonlyArray<BlockerSummary>;
    findings: ReadonlyArray<FindingRecord>;
  }) =>
    [
      "# Attempt Blockers",
      "",
      "## Current Blocker Classes",
      formatBulletList(
        input.blockerSummaries.map(
          (summary) => `${summary.blockerClass}: ${summary.summary}`,
        ),
      ),
      "",
      "## Repeated Failure Patterns",
      formatBulletList(
        input.blockerSummaries
          .filter((summary) => summary.count > 1)
          .map(
            (summary) =>
              `${summary.summary} (repeated ${summary.count} times)`,
          ),
      ),
      "",
      "## Representative Evidence",
      formatBulletList(
        input.blockerSummaries.map(
          (summary) =>
            `${summary.blockerClass}: ${summary.representativeEvidence}`,
        ),
      ),
      "",
      "## Open Blocking Findings",
      formatBulletList(
        input.findings
          .filter((finding) => finding.status === "open" && finding.severity === "blocking")
          .map((finding) => `${finding.summary}: ${finding.rationale}`),
      ),
    ].join("\n");

  const buildAttemptDecisionsMarkdown = (input: {
    reviewDecisions: ReadonlyArray<ReviewDecisionRecord>;
    outcome: AttemptOutcomeRecord | null;
  }) =>
    [
      "# Attempt Decisions",
      "",
      input.outcome ? `Latest outcome: ${input.outcome.kind} - ${input.outcome.summary}` : "Latest outcome: None recorded.",
      "",
      "## Review Decisions",
      formatBulletList(
        input.reviewDecisions.map(
          (decision) =>
            `${decision.createdAt} - ${decision.decision}${decision.notes ? `: ${decision.notes}` : ""}`,
        ),
      ),
    ].join("\n");

  const buildAttemptActivityMarkdown = (entries: ReadonlyArray<AttemptActivityEntry>) =>
    [
      "# Attempt Activity",
      "",
      formatBulletList(
        entries.map(
          (entry) => `${entry.createdAt} [${entry.kind}] ${entry.summary}`,
        ),
      ),
    ].join("\n");

  const buildAttemptFindingsMarkdown = (findings: ReadonlyArray<FindingRecord>) =>
    [
      "# Attempt Findings",
      "",
      formatBulletList(
        findings.map(
          (finding) =>
            `[${finding.status}] ${finding.severity} / ${finding.disposition} / ${finding.source} - ${finding.summary}: ${finding.rationale}`,
        ),
      ),
    ].join("\n");

  const buildAttemptValidationMarkdown = (runs: ReadonlyArray<ValidationRunRecord>) =>
    [
      "# Attempt Validation",
      "",
      formatBulletList(
        runs.map(
          (run) =>
            `${run.commandKind} / ${run.status} / ${run.command}${run.exitCode !== null ? ` (exit ${run.exitCode})` : ""}`,
        ),
      ),
    ].join("\n");

  const buildAttemptReviewMarkdown = (input: {
    reviewArtifacts: ReadonlyArray<ReviewArtifactRecord>;
    reviewDecisions: ReadonlyArray<ReviewDecisionRecord>;
    mergeOperations: ReadonlyArray<MergeOperationRecord>;
  }) =>
    [
      "# Attempt Review",
      "",
      "## Review Artifacts",
      formatBulletList(
        input.reviewArtifacts.map(
          (artifact) =>
            [
              `${artifact.createdAt} - ${artifact.reviewerKind}${artifact.decision ? ` -> ${artifact.decision}` : ""}: ${artifact.summary}`,
              artifact.checklistAssessment.length > 0
                ? ` checklist: ${artifact.checklistAssessment.map((item) => `${item.label}=${item.satisfied ? "yes" : "no"}`).join(", ")}`
                : "",
              artifact.evidence.length > 0
                ? ` evidence: ${artifact.evidence.map((item) => item.summary).join(" | ")}`
                : "",
              artifact.findingIds.length > 0 ? ` findings: ${artifact.findingIds.join(", ")}` : "",
            ]
              .join("")
              .trim(),
        ),
      ),
      "",
      "## Review Decisions",
      formatBulletList(
        input.reviewDecisions.map(
          (decision) =>
            `${decision.createdAt} - ${decision.decision}${decision.notes ? `: ${decision.notes}` : ""}`,
        ),
      ),
      "",
      "## Merge Operations",
      formatBulletList(
        input.mergeOperations.map(
          (operation) =>
            `${operation.updatedAt} - ${operation.status} (${operation.sourceBranch} -> ${operation.baseBranch})${operation.errorSummary ? `: ${operation.errorSummary}` : ""}`,
        ),
      ),
    ].join("\n");

  const buildBrainIndexMarkdown = (pages: ReadonlyArray<KnowledgePageRecord>) =>
    [
      "# Presence Brain Index",
      "",
      formatBulletList(
        pages.map((page) => `${page.family}/${page.slug} - ${page.title} (updated ${page.updatedAt})`),
      ),
    ].join("\n");

  const buildBrainLogMarkdown = (pages: ReadonlyArray<KnowledgePageRecord>) =>
    [
      "# Presence Brain Log",
      "",
      formatBulletList(
        pages
          .slice()
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          .map((page) => `${page.updatedAt} - ${page.title} (${page.family}/${page.slug})`),
      ),
    ].join("\n");

  const buildKnowledgePageMarkdown = (page: KnowledgePageRecord) =>
    [
      `# ${page.title}`,
      "",
      `Family: ${page.family}`,
      `Slug: ${page.slug}`,
      `Updated: ${page.updatedAt}`,
      "",
      "## Compiled Truth",
      page.compiledTruth || "No compiled truth recorded.",
      "",
      "## Timeline",
      page.timeline || "No timeline recorded.",
    ].join("\n");

  type PromptSection = Readonly<{
    title: string;
    lines: ReadonlyArray<string>;
  }>;

  const WORKER_ROLE_IDENTITY_LINES = [
    "You are Presence's worker for one ticket attempt in one worktree.",
    "Your job is to execute the assigned unit of work, not to re-plan the board or broaden scope on your own.",
    "Stay anchored to the ticket, the acceptance checklist, and the files that actually matter for the task.",
  ] as const;

  const WORKER_EXECUTION_LOOP_LINES = [
    "Work in short cycles: inspect the current state, make the next concrete change, test what changed, record the result, then choose the next step.",
    "Look at the repository and the most relevant files before editing so your first change is grounded in the codebase instead of assumption.",
    "Do not claim completion without running relevant validation when feasible and reporting what passed or failed.",
  ] as const;

  const WORKER_HANDOFF_LINES = [
    "Anything required for continuation must be written into the structured worker handoff while you work, not only at the end.",
    "Emit a [PRESENCE_HANDOFF] block after meaningful progress, after a strategy change, after blocker discovery, and before stopping.",
    "Inside that block, update Completed work, Current hypothesis, Next step, and Open questions using the exact required headings.",
    "If the current path fails repeatedly, stop repeating it unchanged; switch strategy or surface the blocker clearly.",
  ] as const;

  const WORKER_BOUNDARY_LINES = [
    "Do not quietly rewrite the task into a broader initiative.",
    "Do not ignore failing tests, contradictory evidence, or unresolved blockers just to appear finished.",
    "When in doubt, prefer a smaller correct step with good handoff state over a large speculative change.",
  ] as const;

  const REVIEW_ROLE_IDENTITY_LINES = [
    "You are Presence's review worker for one ticket attempt.",
    "Your job is to judge the attempt against ticket intent, acceptance criteria, findings, and validation evidence.",
    "You do not merge code and you do not broaden scope; you produce a grounded recommendation for the supervisor.",
  ] as const;

const REVIEW_INPUT_LINES = [
  "Use the ticket intent, current ticket summary, worker handoff, validation batch, and open findings as the primary review inputs.",
  "Inspect the changed files first and expand outward only when the code or evidence requires it.",
  "Prefer existing validation evidence, and run only narrow targeted checks when the packet and code still leave a concrete uncertainty.",
] as const;

const REVIEW_DECISION_LINES = [
  "Return exactly one recommendation: accept, request_changes, or escalate.",
  "Accept only when the evidence supports completion against the ticket and acceptance checklist.",
  "Emit exactly one [PRESENCE_REVIEW_RESULT] block whose body is valid JSON with decision, summary, checklistAssessment, findings, evidence, and changedFilesReviewed.",
  "Do not edit code, do not write Presence state directly, and do not return free-form review prose instead of the required structured result block.",
] as const;

  const SUPERVISOR_ROLE_IDENTITY_LINES = [
    "You are Presence's supervisor for a bounded board run.",
    "You own board-level coordination, prioritization, attempt lifecycle decisions, validation and review sequencing, and ticket state transitions.",
    "You do not do final merge approval, you do not casually broaden ticket scope, and you do not auto-materialize follow-up tickets that still require human confirmation.",
  ] as const;

  const SUPERVISOR_MEMORY_MODEL_LINES = [
    "Use board state for current coordination.",
    "Use supervisor handoff for orchestration continuity across resumptions.",
    "Use ticket summaries for the current state of each unit of work across attempts.",
    "Use attempt handoffs for worker execution continuity.",
    "Use findings as unresolved facts, review concerns, and blocking issues.",
    "Use the brain/wiki only for reviewed durable knowledge, not transient scratch state.",
  ] as const;

  const SUPERVISOR_READ_ORDER_LINES = [
    "Resume in this order: board snapshot, latest supervisor handoff, active ticket summaries, relevant durable knowledge, then choose the next orchestration step.",
    "Do not trust stale context over current saved state; if the two disagree, saved state wins until fresh evidence changes it.",
  ] as const;

  const SUPERVISOR_EXECUTOR_LINES = [
    "Workers execute one ticket attempt at a time: they inspect, edit, test, and update attempt-local handoff state.",
    "Review workers assess one attempt at a time and recommend accept, request_changes, or escalate.",
    "Deterministic validation produces evidence and findings, but it does not decide policy on its own.",
  ] as const;

  const SUPERVISOR_WORKFLOW_LINES = [
    "Move tickets through a disciplined cycle of execution, validation, review, and decision-making.",
    "Prefer one active attempt per ticket and avoid duplicate in-flight work.",
    "Ordinary request-changes iteration should continue on the same attempt and thread unless there is a real reason to branch.",
    "A ticket becomes ready_to_merge only after acceptance and remains human-gated for the final merge.",
  ] as const;

  const SUPERVISOR_TICKET_STATE_LINES = [
    "Use ticket states deliberately: todo means unstarted, in_progress means active execution, in_review means waiting on evaluation, ready_to_merge means accepted and human-gated, blocked means progress requires a new decision or outside intervention.",
    "Do not leave tickets oscillating without explanation; if a ticket moves backward or stalls, capture why in the handoff state.",
  ] as const;

  const SUPERVISOR_RETRY_POLICY_LINES = [
    "After repeated materially similar failures, stop ordinary retry and choose a different approach, a fresh attempt, a follow-up proposal, or escalation.",
    "Do not keep re-running the same failing path just because the system remains capable of trying again.",
    "If progress stalls for too long without a meaningful state change, treat that as a coordination problem and escalate or re-scope.",
  ] as const;

  const SUPERVISOR_KNOWLEDGE_BOUNDARY_LINES = [
    "Keep transient execution state in tickets and attempts, not in the durable brain pages.",
    "Promote only reviewed stable conclusions into durable knowledge, usually as promotion candidates first.",
    "Do not let speculative ticket notes become organizational truth.",
  ] as const;

  const SUPERVISOR_HANDOFF_LINES = [
    "Before yielding, write anything required for continuation into supervisor or worker handoff state.",
    "Do not rely on one long context window for continuity; resume from saved state instead.",
    "Keep the board legible: workers own attempt-local execution memory, while the supervisor owns board-level coordination memory.",
  ] as const;

  const SUPERVISOR_STOP_CONDITION_LINES = [
    "Stop the run when every scoped ticket is stable: ready_to_merge, done, or blocked.",
    "If the run hits its budget or can no longer make justified progress, fail or cancel it explicitly with a clear summary instead of silently stalling.",
  ] as const;

  const buildWorkerPromptSections = (): ReadonlyArray<PromptSection> =>
    [
      {
        title: "Role",
        lines: WORKER_ROLE_IDENTITY_LINES,
      },
      {
        title: "Execution loop",
        lines: WORKER_EXECUTION_LOOP_LINES,
      },
      {
        title: "Handoff discipline",
        lines: WORKER_HANDOFF_LINES,
      },
      {
        title: "Boundaries",
        lines: WORKER_BOUNDARY_LINES,
      },
    ] as const;

  const buildReviewWorkerPromptSections = (): ReadonlyArray<PromptSection> =>
    [
      {
        title: "Role",
        lines: REVIEW_ROLE_IDENTITY_LINES,
      },
      {
        title: "Inputs and evidence",
        lines: REVIEW_INPUT_LINES,
      },
      {
        title: "Decision output",
        lines: REVIEW_DECISION_LINES,
      },
    ] as const;

  const buildSupervisorPromptSections = (): ReadonlyArray<PromptSection> =>
    [
      {
        title: "Role",
        lines: SUPERVISOR_ROLE_IDENTITY_LINES,
      },
      {
        title: "Memory model",
        lines: SUPERVISOR_MEMORY_MODEL_LINES,
      },
      {
        title: "Read order",
        lines: SUPERVISOR_READ_ORDER_LINES,
      },
      {
        title: "Available executors",
        lines: SUPERVISOR_EXECUTOR_LINES,
      },
      {
        title: "Workflow",
        lines: SUPERVISOR_WORKFLOW_LINES,
      },
      {
        title: "Ticket lifecycle",
        lines: SUPERVISOR_TICKET_STATE_LINES,
      },
      {
        title: "Retry and escalation",
        lines: SUPERVISOR_RETRY_POLICY_LINES,
      },
      {
        title: "Knowledge boundaries",
        lines: SUPERVISOR_KNOWLEDGE_BOUNDARY_LINES,
      },
      {
        title: "Handoff discipline",
        lines: SUPERVISOR_HANDOFF_LINES,
      },
      {
        title: "Stop conditions",
        lines: SUPERVISOR_STOP_CONDITION_LINES,
      },
    ] as const;

  const formatPromptSection = (title: string, lines: ReadonlyArray<string>) =>
    `${title}:\n${formatBulletList(lines)}`;

  const buildRolePrompt = (title: string, sections: ReadonlyArray<PromptSection>) =>
    [
      title,
      ...sections.map((section) => formatPromptSection(section.title, section.lines)),
    ].join("\n\n");

  const buildWorkerSystemPrompt = () =>
    buildRolePrompt("Presence worker role", buildWorkerPromptSections());

  const buildReviewWorkerSystemPrompt = () =>
    buildRolePrompt(
      "Presence review worker role",
      buildReviewWorkerPromptSections(),
    );

  const buildSupervisorSystemPrompt = () =>
    buildRolePrompt("Presence supervisor role", buildSupervisorPromptSections());

  const buildRelevantSupervisorNotes = (handoff: SupervisorHandoffRecord | null) =>
    handoff
      ? uniqueStrings(
          [
            handoff.recentDecisions.at(-1) ?? null,
            handoff.nextBoardActions.at(0) ?? null,
          ].filter((value): value is string => Boolean(value)),
        ).slice(0, 2)
      : [];

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
          `Open questions:\n${formatBulletList(input.latestWorkerHandoff.openQuestions)}`,
          `Retry count:\n${input.latestWorkerHandoff.retryCount}`,
          `Next step:\n${input.latestWorkerHandoff.nextStep ?? "None recorded."}`,
        ].join("\n\n")
      : "Latest worker handoff:\n- None yet. This is the first active session for the attempt.";

    const supervisorNotes = buildRelevantSupervisorNotes(input.latestSupervisorHandoff);

    return [
      "Current assignment:",
      `Title: ${input.attempt.ticketTitle}`,
      `Description: ${input.attempt.ticketDescription || "No additional description provided."}`,
      "",
      "Definition of done:",
      checklistLines,
      "",
      "Workspace context:",
      `- Repository root: ${input.attempt.workspaceRoot}`,
      `- Worktree path: ${input.workspace.worktreePath ?? "Unavailable"}`,
      `- Branch: ${input.workspace.branch ?? "Unavailable"}`,
      "",
      supervisorNotes.length > 0
        ? `Relevant supervisor notes:\n${formatBulletList(supervisorNotes)}`
        : "Relevant supervisor notes:\n- None recorded.",
      "",
      workerHandoffSection,
      "",
      "Resume order for this assignment:",
      formatBulletList([
        "ticket",
        "ticket current summary",
        "attempt progress",
        "attempt decisions",
        "attempt blockers",
        "attempt findings",
        "changed files and validation output",
      ]),
      "",
      "When you have a meaningful update, emit this exact block inside an assistant message:",
      [
        PRESENCE_HANDOFF_START,
        PRESENCE_HANDOFF_HEADINGS.completedWork,
        "- ...",
        PRESENCE_HANDOFF_HEADINGS.currentHypothesis,
        "None",
        PRESENCE_HANDOFF_HEADINGS.nextStep,
        "None",
        PRESENCE_HANDOFF_HEADINGS.openQuestions,
        "- ...",
        PRESENCE_HANDOFF_END,
      ].join("\n"),
      "",
      "Start by understanding the problem, inspecting the most relevant files, and making the next concrete step in this workspace.",
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

  const readDirtyPaths = (cwd: string) =>
    gitCore.execute({
      operation: "Presence.readDirtyPaths",
      cwd,
      args: ["status", "--porcelain", "--untracked-files=all"],
      allowNonZeroExit: true,
      timeoutMs: 5_000,
      maxOutputBytes: 16_384,
    }).pipe(
      Effect.map((result) =>
        result.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => line.slice(3).split(" -> ").at(-1)?.trim() ?? "")
          .filter(Boolean),
      ),
      Effect.mapError((cause) => presenceError("Failed to inspect repository dirtiness.", cause)),
    );

  const isPresenceProjectionPath = (value: string) => {
    const normalized = value.replace(/\\/g, "/");
    return normalized === ".presence" || normalized.startsWith(".presence/");
  };

  const normalizeIdList = (values: ReadonlyArray<string>) =>
    [...new Set(values)].sort((left, right) => left.localeCompare(right));

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

  const readRefHeadSha = (cwd: string, ref: string) =>
    gitCore.execute({
      operation: "Presence.readRefHeadSha",
      cwd,
      args: ["rev-parse", "--verify", ref],
      allowNonZeroExit: true,
      timeoutMs: 5_000,
      maxOutputBytes: 4_096,
    }).pipe(
      Effect.map((result) => {
        const value = result.stdout.trim();
        return result.code === 0 && value.length > 0 ? value : null;
      }),
      Effect.mapError((cause) => presenceError(`Failed to read git ref '${ref}'.`, cause)),
    );

  const isMergeInProgress = (cwd: string) =>
    gitCore.execute({
      operation: "Presence.isMergeInProgress",
      cwd,
      args: ["rev-parse", "--verify", "MERGE_HEAD"],
      allowNonZeroExit: true,
      timeoutMs: 5_000,
      maxOutputBytes: 4_096,
    }).pipe(
      Effect.map((result) => result.code === 0),
      Effect.mapError((cause) => presenceError("Failed to inspect merge state.", cause)),
    );

  const isBranchMergedIntoBase = (cwd: string, sourceBranch: string, baseBranch: string) =>
    gitCore.execute({
      operation: "Presence.isBranchMergedIntoBase",
      cwd,
      args: ["merge-base", "--is-ancestor", sourceBranch, baseBranch],
      allowNonZeroExit: true,
      timeoutMs: 5_000,
      maxOutputBytes: 4_096,
    }).pipe(
      Effect.map((result) => result.code === 0),
      Effect.mapError((cause) => presenceError("Failed to inspect merge ancestry.", cause)),
    );

  const hasAttemptExecutionContext = (context: AttemptWorkspaceContextRow) =>
    Boolean(
      context.attemptThreadId ||
        context.attemptLastWorkerHandoffId ||
        context.workspaceStatus === "busy",
    );

  const checklistIsComplete = (checklistJson: string) => {
    const items = decodeJson<PresenceAcceptanceChecklistItem[]>(checklistJson, []);
    return items.length > 0 && items.every((item) => item.checked);
  };

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

  const markTicketMechanismChecklist = (ticketId: string) =>
    updateTicketChecklist(ticketId, (items) =>
      items.map((item) => (isMechanismChecklistItem(item) ? { ...item, checked: true } : item)),
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

  const readValidationRunsForBatch = (batchId: string) =>
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
      WHERE batch_id = ${batchId}
      ORDER BY started_at DESC, validation_run_id DESC
    `.pipe(Effect.map((rows) => rows.map(mapValidationRun)));

  const readRunningValidationBatchIdForAttempt = (attemptId: string) =>
    sql<{ batchId: string }>`
      SELECT validation_batch_id as "batchId"
      FROM presence_validation_batches
      WHERE attempt_id = ${attemptId} AND status = 'running'
      ORDER BY updated_at DESC, validation_batch_id DESC
      LIMIT 1
    `.pipe(Effect.map((rows) => rows[0]?.batchId ?? null));

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

  const readFindingsForTicket = (ticketId: string) =>
    sql<{
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
    `.pipe(Effect.map((rows) => rows.map(mapFinding)));

  const readReviewArtifactsForTicket = (ticketId: string) =>
    sql<{
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
    `.pipe(Effect.map((rows) => rows.map(mapReviewArtifact)));

  const readFollowUpProposalsForTicket = (ticketId: string) =>
    sql<{
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
    `.pipe(Effect.map((rows) => rows.map(mapProposedFollowUp)));

  const readAttemptOutcomesForTicket = (ticketId: string) =>
    sql<{
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
    `.pipe(Effect.map((rows) => rows.map(mapAttemptOutcome)));

  const readOpenBlockingFindingsForTicket = (input: {
    ticketId: string;
    attemptId?: string | null | undefined;
  }) =>
    readFindingsForTicket(input.ticketId).pipe(
      Effect.map((findings) =>
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

  const repeatedFailureKindForTicket = (outcomes: ReadonlyArray<AttemptOutcomeRecord>) => {
    const relevantKinds = new Set<typeof PresenceAttemptOutcomeKind.Type>([
      "failed_validation",
      "wrong_mechanism",
      "blocked_by_env",
      "rejected_review",
    ]);
    const counts = new Map<typeof PresenceAttemptOutcomeKind.Type, number>();
    for (const outcome of outcomes) {
      if (!relevantKinds.has(outcome.kind)) continue;
      counts.set(outcome.kind, (counts.get(outcome.kind) ?? 0) + 1);
    }
    for (const [kind, count] of counts) {
      if (count >= 2) {
        return kind;
      }
    }
    return null;
  };

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
      const existing = yield* sql<{
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
      `.pipe(Effect.map((rows) => rows[0] ?? null));
      const updatedAt = nowIso();
      const evidenceIds = uniqueStrings([...(input.evidenceIds ?? [])]);
      if (existing) {
        yield* sql`
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

      const findingId = makeId(FindingId, "finding");
      yield* sql`
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

  const updateFindingStatus = (
    findingId: string,
    status: typeof PresenceFindingStatus.Type,
  ) =>
    Effect.gen(function* () {
      const updatedAt = nowIso();
      yield* sql`
        UPDATE presence_findings
        SET status = ${status}, updated_at = ${updatedAt}
        WHERE finding_id = ${findingId}
      `;
      const row = yield* sql<{
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
      `.pipe(Effect.map((rows) => rows[0] ?? null));
      if (!row) {
        return yield* Effect.fail(presenceError(`Finding '${findingId}' not found.`));
      }
      return mapFinding(row);
    });

  const resolveOpenFindings = (input: {
    ticketId: string;
    attemptId?: string | null | undefined;
    source?: typeof PresenceFindingSource.Type | undefined;
  }) =>
    Effect.gen(function* () {
      const findings = yield* readFindingsForTicket(input.ticketId);
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
      const artifactId = makeId(ReviewArtifactId, "review_artifact");
      const createdAt = nowIso();
      yield* sql`
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
          ${input.threadId ?? null},
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
        threadId: input.threadId ? ThreadId.make(input.threadId) : null,
        createdAt,
      } satisfies ReviewArtifactRecord;
    });

  const materializeReviewFindings = (input: {
    ticketId: string;
    attemptId?: string | null | undefined;
    findings: ReadonlyArray<ParsedPresenceReviewFinding>;
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

  const writeAttemptOutcome = (input: {
    attemptId: string;
    kind: PresenceAttemptOutcomeKind;
    summary: string;
  }) =>
    Effect.gen(function* () {
      const existing = yield* sql<{ createdAt: string }>`
        SELECT created_at as "createdAt"
        FROM presence_attempt_outcomes
        WHERE attempt_id = ${input.attemptId}
      `.pipe(Effect.map((rows) => rows[0] ?? null));
      const updatedAt = nowIso();
      yield* sql`
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
      const findings = yield* readFindingsForTicket(input.ticketId);
      const attemptOutcomes = yield* readAttemptOutcomesForTicket(input.ticketId);
      const capabilityScan = yield* getOrCreateCapabilityScan(ticket.repositoryId);
      const latestValidationBatch =
        input.attemptId && input.attemptId.trim().length > 0
          ? yield* latestValidationBatchForAttempt(input.attemptId)
          : [];
      const runnableValidationCommands = buildRunnableValidationCommands(capabilityScan);
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
        unresolvedBlockingFindings,
        retryBlocked,
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

  const readMergePreflightState = (context: AttemptWorkspaceContextRow) =>
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
      const expectedBaseBranch = (yield* readLatestCapabilityScan(context.repositoryId))?.baseBranch ?? null;
      if (expectedBaseBranch && baseBranch !== expectedBaseBranch) {
        return yield* Effect.fail(
          presenceError(
            `Presence expected to merge into '${expectedBaseBranch}', but '${baseBranch}' is currently checked out in the base workspace.`,
          ),
        );
      }

      const rootHasCommit = yield* hasHeadCommit(context.workspaceRoot);
      if (rootHasCommit) {
        const dirtyPaths = (yield* readDirtyPaths(context.workspaceRoot)).filter(
          (candidate) => !isPresenceProjectionPath(candidate),
        );
        if (dirtyPaths.length > 0) {
          return yield* Effect.fail(
            presenceError(
              `The base workspace must be clean before merge approval. Dirty paths: ${dirtyPaths.join(", ")}.`,
            ),
          );
        }
      }

      const [baseHeadBefore, sourceHeadSha] = yield* Effect.all([
        readRefHeadSha(context.workspaceRoot, baseBranch),
        readRefHeadSha(context.workspaceRoot, sourceBranch),
      ]);

      return {
        baseBranch,
        sourceBranch,
        baseHeadBefore,
        sourceHeadSha,
      } as const;
    });

  const tryAbortBaseMerge = (cwd: string) =>
    Effect.gen(function* () {
      const mergeRunning = yield* isMergeInProgress(cwd);
      if (!mergeRunning) {
        return false;
      }
      yield* gitCore.execute({
        operation: "Presence.abortMergeAttemptIntoBase",
        cwd,
        args: ["merge", "--abort"],
        allowNonZeroExit: false,
        timeoutMs: 15_000,
      }).pipe(
        Effect.mapError((cause) => presenceError("Failed to abort the in-progress merge.", cause)),
      );
      return true;
    });

  const mergeAttemptIntoBase = (
    context: AttemptWorkspaceContextRow,
    preflight: {
      baseBranch: string;
      sourceBranch: string;
      baseHeadBefore: string | null;
      sourceHeadSha: string | null;
    },
  ) =>
    Effect.gen(function* () {
      if (preflight.baseBranch === preflight.sourceBranch) {
        const head = yield* readRefHeadSha(context.workspaceRoot, preflight.baseBranch);
        return {
          ok: true as const,
          baseBranch: preflight.baseBranch,
          sourceBranch: preflight.sourceBranch,
          baseHeadBefore: preflight.baseHeadBefore,
          sourceHeadSha: preflight.sourceHeadSha,
          baseHeadAfter: head,
          mergeCommitSha: head,
          gitAbortAttempted: false,
          repositoryLeftMidMerge: false,
          errorSummary: null,
        };
      }

      const rootHasCommit = yield* hasHeadCommit(context.workspaceRoot);
      if (rootHasCommit) {
        const mergeResult = yield* gitCore.execute({
          operation: "Presence.mergeAttemptIntoBase",
          cwd: context.workspaceRoot,
          args: ["merge", "--no-ff", "--no-edit", preflight.sourceBranch],
          allowNonZeroExit: true,
          timeoutMs: 30_000,
        }).pipe(
          Effect.mapError((cause) => presenceError("Failed to merge the accepted attempt.", cause)),
        );
        if (mergeResult.code !== 0) {
          const abortOutcome = yield* Effect.exit(tryAbortBaseMerge(context.workspaceRoot));
          const gitAbortAttempted = abortOutcome._tag === "Success" ? abortOutcome.value : true;
          const repositoryLeftMidMerge = yield* isMergeInProgress(context.workspaceRoot);
          const stderrSummary = summarizeCommandOutput(mergeResult.stderr);
          const stdoutSummary = summarizeCommandOutput(mergeResult.stdout);
          const errorSummaryParts = [
            "Failed to merge the accepted attempt into the base branch.",
            stderrSummary,
            stdoutSummary,
            abortOutcome._tag === "Failure"
              ? "Presence also failed to abort the in-progress merge automatically."
              : repositoryLeftMidMerge
                ? "Git still reports an in-progress merge in the base workspace."
                : null,
          ].filter((value): value is string => Boolean(value));
          return {
            ok: false as const,
            baseBranch: preflight.baseBranch,
            sourceBranch: preflight.sourceBranch,
            baseHeadBefore: preflight.baseHeadBefore,
            sourceHeadSha: preflight.sourceHeadSha,
            baseHeadAfter: yield* readRefHeadSha(context.workspaceRoot, preflight.baseBranch),
            mergeCommitSha: null,
            gitAbortAttempted,
            repositoryLeftMidMerge:
              repositoryLeftMidMerge || abortOutcome._tag === "Failure",
            errorSummary: errorSummaryParts.join(" "),
          };
        }
      } else {
        const resetResult = yield* gitCore.execute({
          operation: "Presence.mergeAttemptIntoBase.emptyHead",
          cwd: context.workspaceRoot,
          args: ["reset", "--hard", preflight.sourceBranch],
          allowNonZeroExit: true,
          timeoutMs: 15_000,
        }).pipe(
          Effect.mapError((cause) =>
            presenceError("Failed to materialize the accepted attempt into the empty base branch.", cause),
          ),
        );
        if (resetResult.code !== 0) {
          const stderrSummary = summarizeCommandOutput(resetResult.stderr);
          const stdoutSummary = summarizeCommandOutput(resetResult.stdout);
          return {
            ok: false as const,
            baseBranch: preflight.baseBranch,
            sourceBranch: preflight.sourceBranch,
            baseHeadBefore: preflight.baseHeadBefore,
            sourceHeadSha: preflight.sourceHeadSha,
            baseHeadAfter: yield* readRefHeadSha(context.workspaceRoot, preflight.baseBranch),
            mergeCommitSha: null,
            gitAbortAttempted: false,
            repositoryLeftMidMerge: false,
            errorSummary: [
              "Failed to materialize the accepted attempt into the empty base branch.",
              stderrSummary,
              stdoutSummary,
            ]
              .filter((value): value is string => Boolean(value))
              .join(" "),
          };
        }
      }

      const baseHeadAfter = yield* readRefHeadSha(context.workspaceRoot, preflight.baseBranch);
      return {
        ok: true as const,
        baseBranch: preflight.baseBranch,
        sourceBranch: preflight.sourceBranch,
        baseHeadBefore: preflight.baseHeadBefore,
        sourceHeadSha: preflight.sourceHeadSha,
        baseHeadAfter,
        mergeCommitSha: baseHeadAfter,
        gitAbortAttempted: false,
        repositoryLeftMidMerge: false,
        errorSummary: null,
      };
    });

  const resolveOpenMergeFailureFindings = (ticketId: string, attemptId: string) =>
    Effect.gen(function* () {
      const findings = yield* readFindingsForTicket(ticketId);
      for (const finding of findings) {
        if (
          finding.status === "open" &&
          finding.attemptId === attemptId &&
          finding.source === "supervisor" &&
          /^Merge approval failed/i.test(finding.summary)
        ) {
          yield* updateFindingStatus(finding.id, "resolved");
        }
      }
    });

  const cleanupMergedAttemptResources = (input: {
    context: AttemptWorkspaceContextRow;
    operation: MergeOperationRecord;
  }) =>
    Effect.gen(function* () {
      const updatedAt = nowIso();
      let cleanupWorktreeDone =
        input.operation.cleanupWorktreeDone || !input.context.workspaceWorktreePath;
      let cleanupThreadDone =
        input.operation.cleanupThreadDone || !input.context.attemptThreadId;
      const cleanupErrors: string[] = [];

      if (!cleanupWorktreeDone && input.context.workspaceWorktreePath) {
        const removeOutcome = yield* Effect.exit(
          gitCore.removeWorktree({
            cwd: input.context.workspaceRoot,
            path: input.context.workspaceWorktreePath,
            force: true,
          }),
        );
        if (removeOutcome._tag === "Success") {
          cleanupWorktreeDone = true;
          yield* sql`
            UPDATE presence_workspaces
            SET
              status = ${"cleaned_up"},
              worktree_path = ${null},
              updated_at = ${updatedAt}
            WHERE workspace_id = ${input.context.workspaceId}
          `;
        } else {
          cleanupErrors.push("Presence could not remove the merged attempt worktree yet.");
        }
      } else if (cleanupWorktreeDone) {
        yield* sql`
          UPDATE presence_workspaces
          SET
            status = ${"cleaned_up"},
            worktree_path = ${null},
            updated_at = ${updatedAt}
          WHERE workspace_id = ${input.context.workspaceId}
        `;
      }

      if (!cleanupThreadDone && input.context.attemptThreadId) {
        const threadOutcome = yield* Effect.exit(
          syncThreadWorkspaceMetadata({
            threadId: input.context.attemptThreadId,
            branch: null,
            worktreePath: null,
          }),
        );
        if (threadOutcome._tag === "Success") {
          cleanupThreadDone = true;
        } else {
          cleanupErrors.push("Presence could not detach the worker session from its merged worktree yet.");
        }
      }

      const nextStatus =
        cleanupWorktreeDone && cleanupThreadDone ? "finalized" : "cleanup_pending";
      const updatedOperation = yield* persistMergeOperation({
        id: input.operation.id,
        ticketId: input.operation.ticketId,
        attemptId: input.operation.attemptId,
        status: nextStatus,
        baseBranch: input.operation.baseBranch,
        sourceBranch: input.operation.sourceBranch,
        sourceHeadSha: input.operation.sourceHeadSha,
        baseHeadBefore: input.operation.baseHeadBefore,
        baseHeadAfter: input.operation.baseHeadAfter,
        mergeCommitSha: input.operation.mergeCommitSha,
        errorSummary: cleanupErrors.length > 0 ? cleanupErrors.join(" ") : null,
        gitAbortAttempted: input.operation.gitAbortAttempted,
        cleanupWorktreeDone,
        cleanupThreadDone,
        createdAt: input.operation.createdAt,
      });

      return {
        operation: updatedOperation,
        cleanupPending: nextStatus === "cleanup_pending",
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

      if (!existingPath && existingBranch && currentStatus === input.nextStatus) {
        const preparedWorkspace = yield* waitForWorkspacePreparation({
          attemptId: input.attemptId,
          branch: existingBranch,
        });
        if (preparedWorkspace) {
          return preparedWorkspace.status === input.nextStatus
            ? preparedWorkspace
            : yield* Effect.gen(function* () {
                const updatedAt = nowIso();
                yield* sql`
                  UPDATE presence_workspaces
                  SET status = ${input.nextStatus}, updated_at = ${updatedAt}
                  WHERE workspace_id = ${context.workspaceId}
                `;
                return {
                  ...preparedWorkspace,
                  status: input.nextStatus,
                  updatedAt,
                } satisfies WorkspaceRecord;
              });
        }
      }

      let ownsPreparation = true;
      if (!existingPath && !existingBranch) {
        const claimUpdatedAt = nowIso();
        yield* sql`
          UPDATE presence_workspaces
          SET
            status = ${input.nextStatus},
            branch = ${targetBranch},
            updated_at = ${claimUpdatedAt}
          WHERE
            workspace_id = ${context.workspaceId} AND
            worktree_path IS NULL AND
            branch IS NULL
        `;
        const claimedContext = yield* readAttemptWorkspaceContext(input.attemptId);
        const claimedPath = claimedContext?.workspaceWorktreePath?.trim() ?? null;
        const claimedBranch = claimedContext?.workspaceBranch?.trim() ?? null;
        if (!claimedContext) {
          return yield* Effect.fail(presenceError(`Attempt '${input.attemptId}' not found.`));
        }
        if (claimedPath && claimedBranch === targetBranch) {
          return {
            id: WorkspaceId.make(claimedContext.workspaceId),
            attemptId: AttemptId.make(claimedContext.attemptId),
            status: Schema.decodeSync(PresenceWorkspaceStatus)(claimedContext.workspaceStatus as never),
            branch: claimedBranch,
            worktreePath: claimedPath,
            createdAt: claimedContext.workspaceCreatedAt,
            updatedAt: claimedContext.workspaceUpdatedAt,
          } satisfies WorkspaceRecord;
        }
        ownsPreparation =
          claimedBranch === targetBranch && claimedContext.workspaceUpdatedAt === claimUpdatedAt;
        if (!ownsPreparation) {
          const preparedWorkspace = yield* waitForWorkspacePreparation({
            attemptId: input.attemptId,
            branch: targetBranch,
          });
          if (preparedWorkspace) {
            return preparedWorkspace.status === input.nextStatus
              ? preparedWorkspace
              : yield* Effect.gen(function* () {
                  const updatedAt = nowIso();
                  yield* sql`
                    UPDATE presence_workspaces
                    SET status = ${input.nextStatus}, updated_at = ${updatedAt}
                    WHERE workspace_id = ${claimedContext.workspaceId}
                  `;
                  return {
                    ...preparedWorkspace,
                    status: input.nextStatus,
                    updatedAt,
                  } satisfies WorkspaceRecord;
                });
          }
          return yield* Effect.fail(
            presenceError(
              `Workspace preparation for attempt '${input.attemptId}' is already in progress. Try again once it settles.`,
            ),
          );
        }
      }

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
          SET
            status = ${"error"},
            branch = ${null},
            worktree_path = ${null},
            updated_at = ${nowIso()}
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
        findingRows,
        reviewArtifactRows,
        mergeOperationRows,
        followUpRows,
        attemptOutcomeRows,
        supervisorRunRows,
        boardProjectionHealthRow,
        ticketProjectionHealthRows,
      ] = yield* Effect.all([
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
        sql<any>`SELECT
            finding_id as id, ticket_id as "ticketId", attempt_id as "attemptId",
            source, severity, disposition, status, summary, rationale,
            evidence_ids_json as "evidenceIds", validation_batch_id as "validationBatchId",
            created_at as "createdAt", updated_at as "updatedAt"
          FROM presence_findings
          WHERE ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
          ORDER BY updated_at DESC, created_at DESC`,
        sql<any>`SELECT
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
        sql<any>`SELECT
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
        sql<any>`SELECT
            proposed_follow_up_id as id, parent_ticket_id as "parentTicketId",
            originating_attempt_id as "originatingAttemptId", kind, title, description,
            priority, status, finding_ids_json as "findingIdsJson",
            requires_human_confirmation as "requiresHumanConfirmation",
            created_ticket_id as "createdTicketId", created_at as "createdAt", updated_at as "updatedAt"
          FROM presence_follow_up_proposals
          WHERE parent_ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
          ORDER BY updated_at DESC, created_at DESC`,
        sql<any>`SELECT
            o.attempt_id as "attemptId", o.kind, o.summary,
            o.created_at as "createdAt", o.updated_at as "updatedAt"
          FROM presence_attempt_outcomes o
          INNER JOIN presence_attempts a ON a.attempt_id = o.attempt_id
          WHERE a.ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
          ORDER BY o.updated_at DESC, o.created_at DESC`,
        sql<any>`SELECT
            supervisor_run_id as id, board_id as "boardId",
            source_goal_intake_id as "sourceGoalIntakeId",
            scope_ticket_ids_json as "scopeTicketIdsJson",
            status, stage, current_ticket_id as "currentTicketId",
            active_thread_ids_json as "activeThreadIdsJson",
            summary, created_at as "createdAt", updated_at as "updatedAt"
          FROM presence_supervisor_runs
          WHERE board_id = ${boardId}
          ORDER BY updated_at DESC, created_at DESC`,
        sql<any>`SELECT
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
        sql<any>`SELECT
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
      ]);

      const attempts = attemptRows.map(mapAttempt);
      const workspaces = workspaceRows.map(mapWorkspace);
      const findings = findingRows.map(mapFinding);
      const reviewArtifacts = reviewArtifactRows.map(mapReviewArtifact);
      const mergeOperations = mergeOperationRows.map(mapMergeOperation);
      const proposedFollowUps = followUpRows.map(mapProposedFollowUp);
      const attemptOutcomes = attemptOutcomeRows.map(mapAttemptOutcome);
      const supervisorRuns = supervisorRunRows.map(mapSupervisorRun);
      const boardProjectionHealth = boardProjectionHealthRow[0]
        ? mapProjectionHealth(boardProjectionHealthRow[0])
        : null;
      const ticketProjectionHealth = ticketProjectionHealthRows.map(mapProjectionHealth);
      const latestWorkerHandoffByAttemptId = new Map<string, WorkerHandoffRecord>();
      for (const row of workerRows) {
        if (!latestWorkerHandoffByAttemptId.has(row.attemptId)) {
          latestWorkerHandoffByAttemptId.set(row.attemptId, mapWorkerHandoff(row));
        }
      }
      const workspaceByAttemptId = new Map(workspaces.map((workspace) => [workspace.attemptId, workspace]));

      const mappedValidationRuns = validationRunRows.map(mapValidationRun);
      const attemptSummaries: AttemptSummary[] = yield* Effect.forEach(attempts, (attempt) =>
        Effect.gen(function* () {
          const workspace = workspaceByAttemptId.get(attempt.id) ?? null;
          const persistedHandoff = latestWorkerHandoffByAttemptId.get(attempt.id) ?? null;
          const thread = attempt.threadId ? yield* readThreadFromModel(attempt.threadId) : null;
          const liveHandoff =
            thread && (attempt.status === "in_progress" || attempt.status === "in_review")
              ? yield* buildWorkerHandoffCandidate({
                  attemptId: attempt.id,
                  attemptTitle: attempt.title,
                  attemptStatus: attempt.status,
                  previousHandoff: persistedHandoff,
                  thread,
                  changedFiles: persistedHandoff?.changedFiles ?? [],
                  validationRuns: mappedValidationRuns.filter((run) => run.attemptId === attempt.id),
                  findings: findings.filter(
                    (finding) =>
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
                  createdAt: persistedHandoff?.createdAt ?? nowIso(),
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
      const tickets = ticketRows.map(mapTicket);
      const ticketSummaries = tickets.map((ticket) =>
        buildTicketSummaryRecord({
          ticket,
          attempts: attempts.filter((attempt) => attempt.ticketId === ticket.id),
          latestWorkerHandoffByAttemptId: effectiveWorkerHandoffByAttemptId,
          findings: findings.filter((finding) => finding.ticketId === ticket.id),
          followUps: proposedFollowUps.filter((proposal) => proposal.parentTicketId === ticket.id),
          attemptOutcomes: attemptOutcomes.filter((outcome) =>
            attempts.some((attempt) => attempt.id === outcome.attemptId && attempt.ticketId === ticket.id),
          ),
          mergeOperations: mergeOperations.filter((operation) => operation.ticketId === ticket.id),
        }),
      );

      return {
        repository: mapRepository(repositoryRow),
        board: mapBoard(boardRow),
        tickets,
        dependencies: dependencyRows.map((row: any) => ({
          ticketId: TicketId.make(row.ticketId),
          dependsOnTicketId: TicketId.make(row.dependsOnTicketId),
        })),
        attempts,
        workspaces,
        attemptSummaries,
        supervisorHandoff: supervisorRows[0] ? mapSupervisorHandoff(supervisorRows[0]) : null,
        evidence: evidenceRows.map(mapEvidence),
        validationRuns: mappedValidationRuns,
        findings,
        reviewArtifacts,
        mergeOperations,
        proposedFollowUps,
        ticketSummaries,
        attemptOutcomes,
        promotionCandidates: promotionRows.map(mapPromotionCandidate),
        knowledgePages: knowledgeRows.map(mapKnowledgePage),
        jobs: jobRows.map(mapJob),
        reviewDecisions: reviewRows.map(mapReviewDecision),
        supervisorRuns,
        boardProjectionHealth,
        ticketProjectionHealth,
        hasStaleProjections:
          (boardProjectionHealth !== null &&
            (boardProjectionHealth.status !== "healthy" ||
              boardProjectionHealth.projectedVersion < boardProjectionHealth.desiredVersion)) ||
          ticketProjectionHealth.some(
            (health) =>
              health.status !== "healthy" || health.projectedVersion < health.desiredVersion,
          ),
        capabilityScan: capabilityRows[0] ? mapCapabilityScan(capabilityRows[0]) : null,
        validationWaivers: waiverRows.map(mapValidationWaiver),
        goalIntakes: goalRows.map(mapGoalIntake),
      } satisfies BoardSnapshot;
    });

  const readMergeOperationById = (mergeOperationId: string) =>
    sql<{
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
    `.pipe(Effect.map((rows) => (rows[0] ? mapMergeOperation(rows[0]) : null)));

  const readLatestMergeOperationForAttempt = (attemptId: string) =>
    sql<{
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
    `.pipe(Effect.map((rows) => (rows[0] ? mapMergeOperation(rows[0]) : null)));

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
      const updatedAt = nowIso();
      yield* sql`
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
      const operation = yield* readMergeOperationById(input.id);
      if (!operation) {
        return yield* Effect.fail(
          presenceError(`Merge operation '${input.id}' could not be reloaded after persistence.`),
        );
      }
      return operation;
    });

  const readLatestMergeApprovedDecisionForAttempt = (attemptId: string) =>
    sql<{
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
    `.pipe(Effect.map((rows) => (rows[0] ? mapReviewDecision(rows[0]) : null)));

  const syncBoardProjectionInternal = (boardId: string) =>
    Effect.gen(function* () {
      const snapshot = yield* getBoardSnapshotInternal(boardId);
      const boardRoot = path.join(snapshot.repository.workspaceRoot, ".presence", "board");
      yield* writeProjectionFile(
        path.join(boardRoot, "supervisor_handoff.md"),
        buildSupervisorHandoffMarkdown(snapshot.supervisorHandoff, snapshot, snapshot.supervisorRuns[0] ?? null),
      );
      yield* writeProjectionFile(
        path.join(boardRoot, "supervisor_run.md"),
        buildSupervisorRunMarkdown(snapshot.supervisorRuns[0] ?? null),
      );
      yield* writeProjectionFile(
        path.join(boardRoot, "supervisor_prompt.md"),
        buildSupervisorSystemPrompt(),
      );
    });

  const syncBrainProjectionInternal = (boardId: string) =>
    Effect.gen(function* () {
      const snapshot = yield* getBoardSnapshotInternal(boardId);
      const brainRoot = path.join(snapshot.repository.workspaceRoot, ".presence", "brain");
      yield* writeProjectionFile(path.join(brainRoot, "index.md"), buildBrainIndexMarkdown(snapshot.knowledgePages));
      yield* writeProjectionFile(path.join(brainRoot, "log.md"), buildBrainLogMarkdown(snapshot.knowledgePages));
      for (const page of snapshot.knowledgePages) {
        yield* writeProjectionFile(
          path.join(brainRoot, page.family, `${sanitizeProjectionSegment(page.slug, "page")}.md`),
          buildKnowledgePageMarkdown(page),
        );
      }
    });

  const syncTicketProjectionInternal = (ticketId: string) =>
    Effect.gen(function* () {
      const ticketContext = yield* readTicketForPolicy(ticketId);
      if (!ticketContext) {
        return yield* Effect.fail(presenceError(`Ticket '${ticketId}' not found.`));
      }
      const snapshot = yield* getBoardSnapshotInternal(ticketContext.boardId);
      const ticket = snapshot.tickets.find((candidate) => candidate.id === ticketId);
      if (!ticket) {
        return yield* Effect.fail(presenceError(`Ticket '${ticketId}' not found in board snapshot.`));
      }
      const summary =
        snapshot.ticketSummaries.find((candidate) => candidate.ticketId === ticketId) ??
        buildTicketSummaryRecord({
          ticket,
          attempts: snapshot.attempts.filter((attempt) => attempt.ticketId === ticketId),
          latestWorkerHandoffByAttemptId: new Map(
            snapshot.attemptSummaries
              .filter((summaryItem) => summaryItem.attempt.ticketId === ticketId)
              .flatMap((summaryItem) =>
                summaryItem.latestWorkerHandoff
                  ? [[summaryItem.attempt.id, summaryItem.latestWorkerHandoff] as const]
                  : [],
              ),
          ),
          findings: snapshot.findings.filter((finding) => finding.ticketId === ticketId),
          followUps: snapshot.proposedFollowUps.filter((proposal) => proposal.parentTicketId === ticketId),
          attemptOutcomes: snapshot.attemptOutcomes.filter((outcome) =>
            snapshot.attempts.some(
              (attempt) => attempt.id === outcome.attemptId && attempt.ticketId === ticketId,
            ),
          ),
          mergeOperations: snapshot.mergeOperations.filter((operation) => operation.ticketId === ticketId),
        });

      const ticketRoot = path.join(
        snapshot.repository.workspaceRoot,
        ".presence",
        "tickets",
        sanitizeProjectionSegment(ticket.id, "ticket"),
      );
      const activeAttemptThreadId =
        summary.activeAttemptId
          ? snapshot.attempts.find((attempt) => attempt.id === summary.activeAttemptId)?.threadId ?? null
          : null;
      const activeHandoff =
        summary.activeAttemptId
          ? snapshot.attemptSummaries.find(
              (summaryItem) => summaryItem.attempt.id === summary.activeAttemptId,
            )?.latestWorkerHandoff ?? null
          : null;
      const activeBlockerSummaries = buildBlockerSummaries({
        validationRuns: snapshot.validationRuns.filter(
          (runItem) => runItem.attemptId === summary.activeAttemptId,
        ),
        findings: snapshot.findings.filter(
          (finding) =>
            finding.ticketId === ticketId &&
            (summary.activeAttemptId === null ||
              finding.attemptId === null ||
              finding.attemptId === summary.activeAttemptId),
        ),
        handoff: activeHandoff,
      });
      const latestTicketMergeOperation =
        [...snapshot.mergeOperations.filter((operation) => operation.ticketId === ticketId)].sort((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt),
        )[0] ?? null;
      const latestActiveActivity = activeAttemptThreadId
        ? (
            yield* collectAttemptActivityEntries({
              thread: yield* readThreadFromModel(activeAttemptThreadId),
              validationRuns: snapshot.validationRuns.filter(
                (runItem) => runItem.attemptId === summary.activeAttemptId,
              ),
              reviewArtifacts: snapshot.reviewArtifacts.filter(
                (artifact) => artifact.attemptId === summary.activeAttemptId,
              ),
              mergeOperations: snapshot.mergeOperations.filter(
                (operation) => operation.attemptId === summary.activeAttemptId,
              ),
            })
          ).at(-1) ?? null
        : null;
      yield* writeProjectionFile(path.join(ticketRoot, "ticket.md"), buildTicketMarkdown(ticket));
      yield* writeProjectionFile(
        path.join(ticketRoot, "current_summary.md"),
        buildTicketCurrentSummaryMarkdown({
          summary,
          findings: snapshot.findings.filter((finding) => finding.ticketId === ticketId),
          followUps: snapshot.proposedFollowUps.filter((proposal) => proposal.parentTicketId === ticketId),
          blockerSummaries: activeBlockerSummaries,
          latestActivity: latestActiveActivity,
          mergeOperation: latestTicketMergeOperation,
        }),
      );

      for (const attempt of snapshot.attempts.filter((candidate) => candidate.ticketId === ticketId)) {
        const attemptRoot = path.join(
          ticketRoot,
          "attempts",
          sanitizeProjectionSegment(attempt.id, "attempt"),
        );
        const latestWorkerHandoff =
          snapshot.attemptSummaries.find((summaryItem) => summaryItem.attempt.id === attempt.id)
            ?.latestWorkerHandoff ?? null;
        const attemptFindings = snapshot.findings.filter((finding) => finding.attemptId === attempt.id);
        const attemptReviewArtifacts = snapshot.reviewArtifacts.filter(
          (artifact) => artifact.attemptId === attempt.id,
        );
        const attemptReviewDecisions = snapshot.reviewDecisions.filter(
          (decision) => decision.attemptId === attempt.id,
        );
        const attemptOutcome =
          snapshot.attemptOutcomes.find((outcome) => outcome.attemptId === attempt.id) ?? null;
        const attemptMergeOperations = snapshot.mergeOperations.filter(
          (operation) => operation.attemptId === attempt.id,
        );
        const latestValidationBatchId =
          snapshot.validationRuns.find((run) => run.attemptId === attempt.id)?.batchId ?? null;
        const latestValidationRuns = latestValidationBatchId
          ? snapshot.validationRuns.filter(
              (run) => run.attemptId === attempt.id && run.batchId === latestValidationBatchId,
            )
          : [];
        const thread = attempt.threadId ? yield* readThreadFromModel(attempt.threadId) : null;
        const activityEntries = yield* collectAttemptActivityEntries({
          thread,
          validationRuns: latestValidationRuns,
          reviewArtifacts: attemptReviewArtifacts,
          mergeOperations: attemptMergeOperations,
        });
        const blockerSummaries = buildBlockerSummaries({
          validationRuns: snapshot.validationRuns.filter((run) => run.attemptId === attempt.id),
          findings: attemptFindings,
          handoff: latestWorkerHandoff,
        });
        const latestEvidenceAt = [
          ...snapshot.validationRuns
            .filter((run) => run.attemptId === attempt.id)
            .map((run) => run.finishedAt ?? run.startedAt),
          ...attemptFindings.map((finding) => finding.updatedAt),
          ...attemptReviewArtifacts.map((artifact) => artifact.createdAt),
        ]
          .filter((value): value is string => Boolean(value))
          .sort()
          .at(-1) ?? null;

        yield* writeProjectionFile(
          path.join(attemptRoot, "progress.md"),
          buildAttemptProgressMarkdown({
            attempt,
            handoff: latestWorkerHandoff,
            outcome: attemptOutcome,
            latestActivityAt: activityEntries.at(-1)?.createdAt ?? null,
            latestEvidenceAt,
          }),
        );
        yield* writeProjectionFile(
          path.join(attemptRoot, "blockers.md"),
          buildAttemptBlockersMarkdown({
            blockerSummaries,
            findings: attemptFindings,
          }),
        );
        yield* writeProjectionFile(
          path.join(attemptRoot, "decisions.md"),
          buildAttemptDecisionsMarkdown({
            reviewDecisions: attemptReviewDecisions,
            outcome: attemptOutcome,
          }),
        );
        yield* writeProjectionFile(
          path.join(attemptRoot, "findings.md"),
          buildAttemptFindingsMarkdown(attemptFindings),
        );
        yield* writeProjectionFile(
          path.join(attemptRoot, "validation.md"),
          buildAttemptValidationMarkdown(latestValidationRuns),
        );
        yield* writeProjectionFile(
          path.join(attemptRoot, "review.md"),
          buildAttemptReviewMarkdown({
            reviewArtifacts: attemptReviewArtifacts,
            reviewDecisions: attemptReviewDecisions,
            mergeOperations: attemptMergeOperations,
          }),
        );
        yield* writeProjectionFile(
          path.join(attemptRoot, "activity.md"),
          buildAttemptActivityMarkdown(activityEntries),
        );
      }
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
      yield* syncBoardProjectionBestEffort(boardId, "Repository imported.");

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
    Effect.gen(function* () {
      const snapshot = yield* getBoardSnapshotInternal(input.boardId);
      if (snapshot.boardProjectionHealth && projectionIsRepairEligible(snapshot.boardProjectionHealth)) {
        yield* runProjectionWorker().pipe(Effect.forkDetach, Effect.asVoid);
      }
      for (const health of snapshot.ticketProjectionHealth) {
        if (projectionIsRepairEligible(health)) {
          yield* runProjectionWorker().pipe(Effect.forkDetach, Effect.asVoid);
          break;
        }
      }
      return snapshot;
    }).pipe(Effect.catch((cause) => Effect.fail(presenceError("Failed to load board snapshot.", cause))));

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
      const ticketRecord = {
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
      yield* syncTicketProjectionBestEffort(ticketId, "Ticket created.");
      return ticketRecord;
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
      const ticketRecord = mapTicket({
        ...existing,
        title: input.title ?? existing.title,
        description: input.description ?? existing.description,
        status: input.status ?? existing.status,
        priority: input.priority ?? existing.priority,
        acceptanceChecklist: encodeJson(nextChecklist),
        updatedAt,
      });
      yield* syncTicketProjectionBestEffort(input.ticketId, "Ticket updated.");
      return ticketRecord;
    }).pipe(Effect.catch((cause) => Effect.fail(presenceError("Failed to update ticket.", cause))));

  const createAttempt: PresenceControlPlaneShape["createAttempt"] = (input) =>
    Effect.gen(function* () {
      const ticket = yield* sql<any>`
        SELECT ticket_id as id, title, board_id as "boardId", status
        FROM presence_tickets
        WHERE ticket_id = ${input.ticketId}
      `.pipe(Effect.map((rows) => rows[0] ?? null));
      if (!ticket) {
        return yield* Effect.fail(presenceError(`Ticket '${input.ticketId}' not found.`));
      }
      if (ticket.status === "blocked" || ticket.status === "done" || ticket.status === "ready_to_merge") {
        return yield* Effect.fail(
          presenceError(`Ticket '${input.ticketId}' is ${ticket.status} and cannot accept a new attempt.`),
        );
      }
      const existingActiveAttempt = yield* sql<{ id: string }>`
        SELECT attempt_id as id
        FROM presence_attempts
        WHERE
          ticket_id = ${input.ticketId} AND
          status IN ('planned', 'in_progress', 'in_review')
        ORDER BY created_at DESC
        LIMIT 1
      `.pipe(Effect.map((rows) => rows[0] ?? null));
      if (existingActiveAttempt) {
        return yield* Effect.fail(
          presenceError(
            `Ticket '${input.ticketId}' already has an active attempt ('${existingActiveAttempt.id}'). Reuse or resolve it before creating another one.`,
          ),
        );
      }
      const priorOutcomes = yield* readAttemptOutcomesForTicket(input.ticketId);
      const repeatedFailureKind = repeatedFailureKindForTicket(priorOutcomes);
      if (repeatedFailureKind) {
        yield* createOrUpdateFinding({
          ticketId: input.ticketId,
          source: "supervisor",
          severity: "blocking",
          disposition: "escalate",
          summary: `Repeated ${repeatedFailureKind} attempts require escalation before another retry.`,
          rationale:
            "Presence detected repeated similar failed attempts on this ticket and blocked another ordinary retry.",
        });
        yield* sql`
          UPDATE presence_tickets
          SET status = ${"blocked"}, updated_at = ${nowIso()}
          WHERE ticket_id = ${input.ticketId}
        `;
        yield* syncTicketProjectionBestEffort(input.ticketId, "Attempt creation blocked by repeated failures.");
        return yield* Effect.fail(
          presenceError(
            `Ticket '${input.ticketId}' has repeated ${repeatedFailureKind} outcomes. Escalate or create follow-up work before another retry attempt.`,
          ),
        );
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

      const attemptRecord = {
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
      yield* syncTicketProjectionBestEffort(input.ticketId, "Attempt created.");
      return attemptRecord;
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(
          isPresenceRpcError(cause)
            ? cause
            : isSqliteUniqueConstraintError(cause)
              ? presenceError(
                  `Ticket '${input.ticketId}' already has an active attempt. Reuse or resolve it before creating another one.`,
                  cause,
                )
              : presenceError("Failed to create attempt.", cause),
        ),
      ),
    );

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
      if (nextAttemptStatus === "interrupted") {
        yield* writeAttemptOutcome({
          attemptId: context.attemptId,
          kind: "abandoned",
          summary: "The workspace was cleaned up before the attempt merged.",
        });
      }
      yield* syncTicketProjectionBestEffort(context.ticketId, "Workspace cleaned up.");

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
      const savedRepositorySelection = decodeJson<ModelSelection | null>(
        attemptRow.defaultModelSelection,
        null,
      );
      const existingAttemptSelection =
        attemptRow.attemptProvider && attemptRow.attemptModel
          ? ({ provider: attemptRow.attemptProvider, model: attemptRow.attemptModel } as ModelSelection)
          : null;
      const selection =
        input.provider && input.model
          ? ({ provider: input.provider, model: input.model } as ModelSelection)
          : isModelSelectionAvailable(providers, existingAttemptSelection)
            ? existingAttemptSelection
            : isModelSelectionAvailable(providers, savedRepositorySelection)
              ? savedRepositorySelection
              : chooseDefaultModelSelection(providers);
      if (!selection) {
        return yield* Effect.fail(
          presenceError("No provider/model is available to start an attempt session."),
        );
      }

      const createdAt = nowIso();
      const claimedThreadId = attemptRow.attemptThreadId
        ? attemptRow.attemptThreadId
        : makeId(ThreadId, "presence_thread");
      let shouldBootstrapWorker = false;
      let threadId = ThreadId.make(claimedThreadId);
      let shouldSyncExistingThreadMetadata = Boolean(attemptRow.attemptThreadId);

      if (!attemptRow.attemptThreadId) {
        yield* sql`
          UPDATE presence_attempts
          SET
            thread_id = ${claimedThreadId},
            provider = ${selection.provider},
            model = ${selection.model},
            status = ${"in_progress"},
            updated_at = ${createdAt}
          WHERE attempt_id = ${input.attemptId} AND thread_id IS NULL
        `;
        const claimedAttempt = yield* readAttemptWorkspaceContext(input.attemptId);
        if (!claimedAttempt?.attemptThreadId) {
          return yield* Effect.fail(
            presenceError(`Attempt '${input.attemptId}' could not claim a worker thread.`),
          );
        }
        threadId = ThreadId.make(claimedAttempt.attemptThreadId);
        shouldBootstrapWorker = claimedAttempt.attemptThreadId === claimedThreadId;
        shouldSyncExistingThreadMetadata = false;
      } else {
        yield* sql`
          UPDATE presence_attempts
          SET
            provider = ${selection.provider},
            model = ${selection.model},
            status = ${"in_progress"},
            updated_at = ${createdAt}
          WHERE attempt_id = ${input.attemptId}
        `;
      }

      if (shouldSyncExistingThreadMetadata) {
        yield* syncThreadWorkspaceMetadata({
          threadId: attemptRow.attemptThreadId!,
          branch: workspace.branch,
          worktreePath: workspace.worktreePath,
        });
      }
      yield* sql`
        UPDATE presence_repositories
        SET
          default_model_selection_json = ${encodeJson(selection)},
          updated_at = ${createdAt}
        WHERE repository_id = ${attemptRow.repositoryId}
      `;

      if (shouldBootstrapWorker) {
        yield* orchestrationEngine.dispatch({
          type: "thread.create",
          commandId: CommandId.make(`presence_thread_create_${crypto.randomUUID()}`),
          threadId,
          projectId: ProjectId.make(attemptRow.projectId),
          title: `${attemptRow.ticketTitle} - ${attemptRow.attemptTitle}`,
          systemPrompt: buildWorkerSystemPrompt(),
          modelSelection: selection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: workspace.branch,
          worktreePath: workspace.worktreePath,
          createdAt,
        }).pipe(
          Effect.catch((cause) =>
            Effect.gen(function* () {
              yield* sql`
                UPDATE presence_attempts
                SET
                  thread_id = ${null},
                  status = ${"planned"},
                  updated_at = ${nowIso()}
                WHERE attempt_id = ${input.attemptId} AND thread_id = ${claimedThreadId}
              `.pipe(Effect.catch(() => Effect.void));
              return yield* Effect.fail(
                presenceError("Failed to create the worker thread for this attempt.", cause),
              );
            }),
          ),
        );

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
      } else if (!shouldSyncExistingThreadMetadata) {
        const threadReady = yield* waitForClaimedThreadAvailability({
          attemptId: input.attemptId,
          threadId: threadId.toString(),
        });
        if (!threadReady) {
          return yield* Effect.fail(
            presenceError(
              `Attempt '${input.attemptId}' is already starting a worker session in another caller. Try again once that startup settles.`,
            ),
          );
        }
      }
      yield* syncTicketProjectionBestEffort(attemptRow.ticketId, "Attempt session started.");

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
      yield* syncTicketProjectionBestEffort(row.ticketId, "Thread attached to attempt.");
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
      yield* syncBoardProjectionBestEffort(input.boardId, "Supervisor handoff saved.");
      return handoffRecord;
    }).pipe(
      Effect.catch((cause) => Effect.fail(presenceError("Failed to save supervisor handoff.", cause))),
    );

  const saveWorkerHandoff: PresenceControlPlaneShape["saveWorkerHandoff"] = (input) =>
    Effect.gen(function* () {
      const handoffId = makeId(HandoffId, "handoff");
      const createdAt = nowIso();
      const reasoningSource = input.reasoningSource ?? "manual_override";
      const reasoningUpdatedAt = input.reasoningUpdatedAt ?? createdAt;
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
                openQuestions: input.openQuestions ?? [],
                retryCount: input.retryCount ?? 0,
                reasoningSource,
                reasoningUpdatedAt,
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
      const handoffRecord = {
        id: handoffId,
        attemptId: input.attemptId,
        completedWork: input.completedWork,
        currentHypothesis: input.currentHypothesis ?? null,
        changedFiles: input.changedFiles,
        testsRun: input.testsRun,
        blockers: input.blockers,
        nextStep: input.nextStep ?? null,
        openQuestions: input.openQuestions ?? [],
        retryCount: input.retryCount ?? 0,
        reasoningSource,
        reasoningUpdatedAt,
        confidence: input.confidence ?? null,
        evidenceIds: input.evidenceIds,
        createdAt,
      };
      const attemptContext = yield* readAttemptWorkspaceContext(input.attemptId);
      if (attemptContext) {
        yield* syncTicketProjectionBestEffort(attemptContext.ticketId, "Worker handoff saved.");
      }
      return handoffRecord;
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
      const evidenceRecord = {
        id: evidenceId,
        attemptId: input.attemptId,
        title: input.title,
        kind: input.kind,
        content: input.content,
        createdAt,
      };
      yield* syncTicketProjectionBestEffort(attemptContext.ticketId, "Attempt evidence saved.");
      return evidenceRecord;
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

      const existingRunningBatchId = yield* readRunningValidationBatchIdForAttempt(context.attemptId);
      if (existingRunningBatchId) {
        return yield* readValidationRunsForBatch(existingRunningBatchId);
      }

      const cwd = context.workspaceWorktreePath?.trim() || context.workspaceRoot;
      const batchId = `validation_batch_${crypto.randomUUID()}`;
      const initializedRuns = commands.map((discovered) => {
        const runId = makeId(ValidationRunId, "validation");
        const startedAt = nowIso();
        return {
          id: runId,
          batchId,
          attemptId: AttemptId.make(context.attemptId),
          ticketId: TicketId.make(context.ticketId),
          commandKind: discovered.kind,
          command: discovered.command,
          status: "running" as const,
          exitCode: null,
          stdoutSummary: null,
          stderrSummary: null,
          startedAt,
          finishedAt: null,
        };
      });
      const claimedBatch = yield* sql.withTransaction(
        Effect.gen(function* () {
          const createdAt = nowIso();
          yield* sql`
            INSERT INTO presence_validation_batches (
              validation_batch_id, attempt_id, ticket_id, status, created_at, updated_at, completed_at
            ) VALUES (
              ${batchId},
              ${context.attemptId},
              ${context.ticketId},
              ${"running"},
              ${createdAt},
              ${createdAt},
              ${null}
            )
          `;
          for (const run of initializedRuns) {
            yield* sql`
              INSERT INTO presence_validation_runs (
                validation_run_id, batch_id, attempt_id, ticket_id, command_kind, command_text,
                status, exit_code, stdout_summary, stderr_summary, started_at, finished_at
              ) VALUES (
                ${run.id},
                ${batchId},
                ${context.attemptId},
                ${context.ticketId},
                ${run.commandKind},
                ${run.command},
                ${"running"},
                ${null},
                ${null},
                ${null},
                ${run.startedAt},
                ${null}
              )
            `;
          }
          return true as const;
        }),
      ).pipe(
        Effect.catch((cause) =>
          isSqliteUniqueConstraintError(cause) ? Effect.succeed(false as const) : Effect.fail(cause),
        ),
      );
      if (!claimedBatch) {
        const runningBatchId = yield* readRunningValidationBatchIdForAttempt(context.attemptId);
        if (runningBatchId) {
          return yield* readValidationRunsForBatch(runningBatchId);
        }
        return yield* Effect.fail(
          presenceError("Validation is already being started for this attempt. Try again in a moment."),
        );
      }

      const runs: ValidationRunRecord[] = [];
      const validationEvidenceIds: string[] = [];

      for (const initializedRun of initializedRuns) {
        const discovered = {
          kind: initializedRun.commandKind,
          command: initializedRun.command,
        };
        const shellInvocation = makeValidationShellInvocation(discovered.command);
        const execution = yield* Effect.tryPromise(() =>
          runProcess(shellInvocation.command, shellInvocation.args, {
            cwd,
            timeoutMs: 10 * 60_000,
            allowNonZeroExit: true,
            maxBufferBytes: 256 * 1024,
            outputMode: "truncate",
          }),
        ).pipe(
          Effect.map((result) => ({ kind: "success", result } as const)),
          Effect.catch((cause) => Effect.succeed({ kind: "failure", cause } as const)),
        );

        const finishedAt = nowIso();
        const status =
          execution.kind === "success" && execution.result.code === 0 && !execution.result.timedOut
            ? "passed"
            : "failed";
        const exitCode = execution.kind === "success" ? execution.result.code : null;
        const stdoutSummary =
          execution.kind === "success" ? summarizeCommandOutput(execution.result.stdout) : null;
        const stderrSummary =
          execution.kind === "success"
            ? summarizeCommandOutput(execution.result.stderr)
            : summarizeCommandOutput(describeUnknownError(execution.cause));

        yield* sql`
          UPDATE presence_validation_runs
          SET
            status = ${status},
            exit_code = ${exitCode},
            stdout_summary = ${stdoutSummary},
            stderr_summary = ${stderrSummary},
            finished_at = ${finishedAt}
          WHERE validation_run_id = ${initializedRun.id}
        `;

        const evidenceId = makeId(EvidenceId, "evidence");
        const evidenceContent = [
          `Command: ${discovered.command}`,
          `Kind: ${discovered.kind}`,
          `Status: ${status}`,
          `Exit code: ${exitCode ?? "null"}`,
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
        validationEvidenceIds.push(evidenceId);

        runs.push({
          id: initializedRun.id,
          batchId,
          attemptId: AttemptId.make(context.attemptId),
          ticketId: TicketId.make(context.ticketId),
          commandKind: discovered.kind,
          command: discovered.command,
          status,
          exitCode,
          stdoutSummary,
          stderrSummary,
          startedAt: initializedRun.startedAt,
          finishedAt,
        });
      }
      const failedRuns = runs.filter((run) => run.status === "failed");
      const batchCompletedAt = nowIso();
      yield* sql`
        UPDATE presence_validation_batches
        SET
          status = ${failedRuns.length > 0 ? "failed" : "passed"},
          updated_at = ${batchCompletedAt},
          completed_at = ${batchCompletedAt}
        WHERE validation_batch_id = ${batchId}
      `;

      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* markTicketEvidenceChecklist(context.ticketId);
          yield* markTicketValidationChecklist(context.ticketId);
        }),
      );
      if (failedRuns.length > 0) {
        yield* createOrUpdateFinding({
          ticketId: context.ticketId,
          attemptId: context.attemptId,
          source: "validation",
          severity: "blocking",
          disposition: "same_ticket",
          summary: `Validation failed for ${failedRuns.length} command${failedRuns.length === 1 ? "" : "s"} in batch ${batchId}.`,
          rationale: failedRuns
            .map(
              (run) =>
                `${run.commandKind}: ${run.command}${run.stderrSummary ? ` -> ${run.stderrSummary}` : ""}`,
            )
            .join(" | "),
          evidenceIds: validationEvidenceIds,
          validationBatchId: batchId,
        });
        yield* writeAttemptOutcome({
          attemptId: context.attemptId,
          kind: "failed_validation",
          summary: `Validation batch ${batchId} failed for ${failedRuns.length} command${failedRuns.length === 1 ? "" : "s"}.`,
        });
      }
      if (failedRuns.length === 0) {
        const findings = yield* readFindingsForTicket(context.ticketId);
        for (const finding of findings.filter(
          (finding) =>
            finding.attemptId === context.attemptId &&
            finding.source === "validation" &&
            finding.status === "open",
        )) {
          yield* updateFindingStatus(finding.id, "resolved");
        }
      }
      yield* syncTicketProjectionBestEffort(context.ticketId, "Validation batch recorded.");

      return runs;
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(presenceError("Failed to run attempt validation.", cause)),
      ),
    );

  const resolveFinding: PresenceControlPlaneShape["resolveFinding"] = (input) =>
    Effect.gen(function* () {
      const finding = yield* updateFindingStatus(input.findingId, "resolved");
      yield* syncTicketProjectionBestEffort(finding.ticketId, "Finding resolved.");
      return finding;
    }).pipe(
      Effect.catch((cause) => Effect.fail(presenceError("Failed to resolve finding.", cause))),
    );

  const dismissFinding: PresenceControlPlaneShape["dismissFinding"] = (input) =>
    Effect.gen(function* () {
      const finding = yield* updateFindingStatus(input.findingId, "dismissed");
      yield* syncTicketProjectionBestEffort(finding.ticketId, "Finding dismissed.");
      return finding;
    }).pipe(
      Effect.catch((cause) => Effect.fail(presenceError("Failed to dismiss finding.", cause))),
    );

  const createFollowUpProposal: PresenceControlPlaneShape["createFollowUpProposal"] = (input) =>
    Effect.gen(function* () {
      const ticket = yield* sql<{
        id: string;
      }>`
        SELECT ticket_id as id
        FROM presence_tickets
        WHERE ticket_id = ${input.parentTicketId}
      `.pipe(Effect.map((rows) => rows[0] ?? null));
      if (!ticket) {
        return yield* Effect.fail(presenceError(`Ticket '${input.parentTicketId}' not found.`));
      }
      const proposalId = makeId(ProposedFollowUpId, "follow_up");
      const createdAt = nowIso();
      yield* sql`
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
          ${encodeJson(input.findingIds)},
          ${1},
          ${null},
          ${createdAt},
          ${createdAt}
        )
      `;
      const proposal = {
        id: proposalId,
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
      yield* syncTicketProjectionBestEffort(input.parentTicketId, "Follow-up proposal created.");
      return proposal;
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(presenceError("Failed to create follow-up proposal.", cause)),
      ),
    );

  const materializeFollowUp: PresenceControlPlaneShape["materializeFollowUp"] = (input) =>
    Effect.gen(function* () {
      const proposal = yield* sql<{
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
        WHERE proposed_follow_up_id = ${input.proposalId}
      `.pipe(Effect.map((rows) => rows[0] ?? null));
      if (!proposal) {
        return yield* Effect.fail(presenceError(`Follow-up proposal '${input.proposalId}' not found.`));
      }
      if (proposal.kind === "request_changes") {
        return yield* Effect.fail(
          presenceError("Request-changes follow-up proposals do not materialize into child tickets."),
        );
      }
      if (proposal.createdTicketId) {
        const existing = yield* sql<any>`
          SELECT
            ticket_id as id, board_id as "boardId", parent_ticket_id as "parentTicketId",
            title, description, status, priority,
            acceptance_checklist_json as "acceptanceChecklist",
            assigned_attempt_id as "assignedAttemptId",
            created_at as "createdAt", updated_at as "updatedAt"
          FROM presence_tickets
          WHERE ticket_id = ${proposal.createdTicketId}
        `.pipe(Effect.map((rows) => rows[0] ?? null));
        if (!existing) {
          return yield* Effect.fail(
            presenceError(`Follow-up proposal '${input.proposalId}' points to a missing ticket.`),
          );
        }
        return mapTicket(existing);
      }
      const parentTicket = yield* sql<{
        id: string;
        boardId: string;
      }>`
        SELECT ticket_id as id, board_id as "boardId"
        FROM presence_tickets
        WHERE ticket_id = ${proposal.parentTicketId}
      `.pipe(Effect.map((rows) => rows[0] ?? null));
      if (!parentTicket) {
        return yield* Effect.fail(
          presenceError(`Parent ticket '${proposal.parentTicketId}' could not be loaded.`),
        );
      }
      const ticketId = makeId(TicketId, "ticket");
      const createdAt = nowIso();
      const checklist: PresenceAcceptanceChecklistItem[] = [
        { id: `check_${crypto.randomUUID()}`, label: "Mechanism understood", checked: false },
        { id: `check_${crypto.randomUUID()}`, label: "Evidence attached", checked: false },
        { id: `check_${crypto.randomUUID()}`, label: "Tests or validation captured", checked: false },
      ];
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
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
              ${encodeJson(checklist)},
              ${null},
              ${createdAt},
              ${createdAt}
            )
          `;
          yield* sql`
            UPDATE presence_follow_up_proposals
            SET
              status = ${"resolved"},
              created_ticket_id = ${ticketId},
              updated_at = ${createdAt}
            WHERE proposed_follow_up_id = ${input.proposalId}
          `;
        }),
      );
      yield* syncTicketProjectionBestEffort(
        proposal.parentTicketId,
        "Follow-up proposal materialized on parent ticket.",
      );
      yield* syncTicketProjectionBestEffort(ticketId, "Follow-up ticket materialized.");
      return {
        id: ticketId,
        boardId: BoardId.make(parentTicket.boardId),
        parentTicketId: TicketId.make(proposal.parentTicketId),
        title: proposal.title,
        description: proposal.description,
        status: proposal.kind === "blocker_ticket" ? "blocked" : "todo",
        priority: Schema.decodeSync(PresenceTicketPriority)(proposal.priority as never),
        acceptanceChecklist: checklist,
        assignedAttemptId: null,
        createdAt,
        updatedAt: createdAt,
      } satisfies TicketRecord;
    }).pipe(
      Effect.catch((cause) => Effect.fail(presenceError("Failed to materialize follow-up.", cause))),
    );

  const syncTicketProjection: PresenceControlPlaneShape["syncTicketProjection"] = (input) =>
    syncProjectionStrict("ticket", input.ticketId, "Manual ticket projection sync requested.").pipe(
      Effect.catch((cause) =>
        Effect.fail(presenceError("Failed to sync ticket projection.", cause)),
      ),
    );

  const syncBrainProjection: PresenceControlPlaneShape["syncBrainProjection"] = (input) =>
    syncProjectionStrict("board", input.boardId, "Manual board projection sync requested.").pipe(
      Effect.catch((cause) =>
        Effect.fail(presenceError("Failed to sync brain projection.", cause)),
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
      yield* syncBoardProjectionBestEffort(input.boardId, "Knowledge page upserted.");
      return knowledgePage;
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

      const waiverRecord = {
        id: waiverId,
        ticketId: input.ticketId,
        attemptId: input.attemptId ?? null,
        reason: input.reason,
        grantedBy: input.grantedBy,
        createdAt,
      };
      yield* sql`
        UPDATE presence_findings
        SET status = ${"resolved"}, updated_at = ${createdAt}
        WHERE ticket_id = ${input.ticketId}
          AND status = ${"open"}
          AND severity = ${"blocking"}
          AND (
            (
              source = ${"supervisor"}
              AND (
                rationale LIKE ${"%validation waiver%"}
                OR rationale LIKE ${"%No runnable validation command was discovered%"}
              )
            )
            OR source = ${"validation"}
          )
          AND (
            ${input.attemptId ?? null} IS NULL
            OR attempt_id IS NULL
            OR attempt_id = ${input.attemptId ?? null}
          )
      `;
      yield* syncTicketProjectionBestEffort(input.ticketId, "Validation waiver recorded.");
      return waiverRecord;
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

      const result = yield* sql.withTransaction(
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
      for (const ticket of result.createdTickets) {
        yield* syncTicketProjectionBestEffort(ticket.id, "Goal intake updated ticket projections.");
      }
      return result;
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(presenceError("Failed to submit supervisor goal intake.", cause)),
      ),
    );

  const handleMergeApprovedDecision = (input: {
    ticketId: string;
    attemptId: string;
    notes: string;
    reviewerKind: "human" | "policy" | "review_agent";
    ticketForReview: {
      id: string;
      boardId: string;
      repositoryId: string;
      status: typeof PresenceTicketStatus.Type;
      acceptanceChecklist: string;
    };
    latestWorkerHandoff: WorkerHandoffRecord | null;
  }) =>
    Effect.gen(function* () {
      const existingDecision = yield* readLatestMergeApprovedDecisionForAttempt(input.attemptId);
      const context = yield* readAttemptWorkspaceContext(input.attemptId);
      if (!context) {
        return yield* Effect.fail(presenceError(`Attempt '${input.attemptId}' not found.`));
      }

      let mergeOperation = yield* readLatestMergeOperationForAttempt(input.attemptId);
      if (
        mergeOperation?.status === "finalized" &&
        Schema.decodeSync(PresenceAttemptStatus)(context.attemptStatus as never) === "merged" &&
        input.ticketForReview.status === "done"
      ) {
        if (existingDecision) {
          return existingDecision;
        }
        return {
          id: makeId(ReviewDecisionId, "review"),
          ticketId: TicketId.make(input.ticketId),
          attemptId: AttemptId.make(input.attemptId),
          decision: "merge_approved",
          notes: input.notes,
          createdAt: mergeOperation.updatedAt,
        } satisfies ReviewDecisionRecord;
      }

      if (mergeOperation?.status === "cleanup_pending") {
        const cleanupResult = yield* cleanupMergedAttemptResources({
          context,
          operation: mergeOperation,
        });
        yield* syncTicketProjectionBestEffort(
          input.ticketId,
          cleanupResult.cleanupPending
            ? "Merged attempt still has cleanup pending."
            : "Merged attempt cleanup completed.",
        );
        if (existingDecision) {
          return existingDecision;
        }
        return yield* Effect.fail(
          presenceError(
            "Presence recovered merge cleanup state, but the original merge approval decision record is missing.",
          ),
        );
      }

      const policy = yield* evaluateSupervisorActionInternal({
        action: "merge_attempt",
        ticketId: input.ticketId,
        attemptId: input.attemptId,
      });
      if (!policy.allowed) {
        const blockedFinding = yield* createOrUpdateFinding({
          ticketId: input.ticketId,
          attemptId: input.attemptId,
          source: "supervisor",
          severity: "blocking",
          disposition: "same_ticket",
          summary: "Merge blocked by supervisor policy.",
          rationale: policy.reasons.join(" "),
        });
        yield* createReviewArtifact({
          ticketId: input.ticketId,
          attemptId: input.attemptId,
          reviewerKind: "policy",
          decision: null,
          summary: "Merge was blocked by supervisor policy.",
          checklistJson: input.ticketForReview.acceptanceChecklist,
          checklistAssessment: [],
          evidence: [],
          changedFiles: input.latestWorkerHandoff?.changedFiles ?? [],
          changedFilesReviewed: [],
          findingIds: [blockedFinding.id],
        });
        yield* syncTicketProjectionBestEffort(input.ticketId, "Merge approval blocked by policy.");
        return yield* Effect.fail(presenceError(policy.reasons.join(" ")));
      }

      if (!mergeOperation || !mergeOperationIsNonTerminal(mergeOperation.status)) {
        const preflight = yield* readMergePreflightState(context);
        mergeOperation = yield* persistMergeOperation({
          id: makeId(MergeOperationId, "merge_operation"),
          ticketId: input.ticketId,
          attemptId: input.attemptId,
          status: "pending_git",
          baseBranch: preflight.baseBranch,
          sourceBranch: preflight.sourceBranch,
          sourceHeadSha: preflight.sourceHeadSha,
          baseHeadBefore: preflight.baseHeadBefore,
        });
      }

      if (mergeOperation.status === "pending_git") {
        yield* ensureAttemptWorkspaceCommitted(context);
        const preflight = yield* readMergePreflightState(context);
        mergeOperation = yield* persistMergeOperation({
          id: mergeOperation.id,
          ticketId: mergeOperation.ticketId,
          attemptId: mergeOperation.attemptId,
          status: "pending_git",
          baseBranch: preflight.baseBranch,
          sourceBranch: preflight.sourceBranch,
          sourceHeadSha: preflight.sourceHeadSha,
          baseHeadBefore: preflight.baseHeadBefore,
          baseHeadAfter: mergeOperation.baseHeadAfter,
          mergeCommitSha: mergeOperation.mergeCommitSha,
          errorSummary: null,
          gitAbortAttempted: mergeOperation.gitAbortAttempted,
          cleanupWorktreeDone: mergeOperation.cleanupWorktreeDone,
          cleanupThreadDone: mergeOperation.cleanupThreadDone,
          createdAt: mergeOperation.createdAt,
        });
        const alreadyMerged =
          mergeOperation.baseBranch === mergeOperation.sourceBranch
            ? true
            : yield* isBranchMergedIntoBase(
                context.workspaceRoot,
                mergeOperation.sourceBranch,
                mergeOperation.baseBranch,
              );
        if (alreadyMerged) {
          const baseHeadAfter = yield* readRefHeadSha(context.workspaceRoot, mergeOperation.baseBranch);
          mergeOperation = yield* persistMergeOperation({
            id: mergeOperation.id,
            ticketId: mergeOperation.ticketId,
            attemptId: mergeOperation.attemptId,
            status: "git_applied",
            baseBranch: mergeOperation.baseBranch,
            sourceBranch: mergeOperation.sourceBranch,
            sourceHeadSha: mergeOperation.sourceHeadSha,
            baseHeadBefore: mergeOperation.baseHeadBefore,
            baseHeadAfter,
            mergeCommitSha: baseHeadAfter,
            errorSummary: null,
            gitAbortAttempted: mergeOperation.gitAbortAttempted,
            cleanupWorktreeDone: mergeOperation.cleanupWorktreeDone,
            cleanupThreadDone: mergeOperation.cleanupThreadDone,
            createdAt: mergeOperation.createdAt,
          });
        } else {
          const mergeResult = yield* mergeAttemptIntoBase(context, preflight);
          if (!mergeResult.ok) {
            mergeOperation = yield* persistMergeOperation({
              id: mergeOperation.id,
              ticketId: mergeOperation.ticketId,
              attemptId: mergeOperation.attemptId,
              status: "failed",
              baseBranch: mergeOperation.baseBranch,
              sourceBranch: mergeOperation.sourceBranch,
              sourceHeadSha: mergeOperation.sourceHeadSha,
              baseHeadBefore: mergeResult.baseHeadBefore,
              baseHeadAfter: mergeResult.baseHeadAfter,
              mergeCommitSha: mergeResult.mergeCommitSha,
              errorSummary: mergeResult.errorSummary,
              gitAbortAttempted: mergeResult.gitAbortAttempted,
              cleanupWorktreeDone: mergeOperation.cleanupWorktreeDone,
              cleanupThreadDone: mergeOperation.cleanupThreadDone,
              createdAt: mergeOperation.createdAt,
            });
            const mergeFailureFinding = yield* createOrUpdateFinding({
              ticketId: input.ticketId,
              attemptId: input.attemptId,
              source: "supervisor",
              severity: "blocking",
              disposition: mergeResult.repositoryLeftMidMerge ? "escalate" : "same_ticket",
              summary: "Merge approval failed for this accepted attempt.",
              rationale: mergeResult.errorSummary,
            });
            if (mergeResult.repositoryLeftMidMerge) {
              yield* sql`
                UPDATE presence_tickets
                SET status = ${"blocked"}, updated_at = ${nowIso()}
                WHERE ticket_id = ${input.ticketId}
              `;
            }
            yield* createReviewArtifact({
              ticketId: input.ticketId,
              attemptId: input.attemptId,
              reviewerKind: input.reviewerKind,
              decision: null,
              summary: mergeResult.errorSummary,
              checklistJson: input.ticketForReview.acceptanceChecklist,
              checklistAssessment: [],
              evidence: [],
              changedFiles: input.latestWorkerHandoff?.changedFiles ?? [],
              changedFilesReviewed: [],
              findingIds: [mergeFailureFinding.id],
            });
            yield* syncTicketProjectionBestEffort(input.ticketId, "Merge approval failed.");
            return yield* Effect.fail(presenceError(mergeResult.errorSummary));
          }

          mergeOperation = yield* persistMergeOperation({
            id: mergeOperation.id,
            ticketId: mergeOperation.ticketId,
            attemptId: mergeOperation.attemptId,
            status: "git_applied",
            baseBranch: mergeResult.baseBranch,
            sourceBranch: mergeResult.sourceBranch,
            sourceHeadSha: mergeResult.sourceHeadSha,
            baseHeadBefore: mergeResult.baseHeadBefore,
            baseHeadAfter: mergeResult.baseHeadAfter,
            mergeCommitSha: mergeResult.mergeCommitSha,
            errorSummary: null,
            gitAbortAttempted: false,
            cleanupWorktreeDone: false,
            cleanupThreadDone: false,
            createdAt: mergeOperation.createdAt,
          });
        }
      }

      if (mergeOperation.status !== "git_applied") {
        return yield* Effect.fail(
          presenceError(
            `Presence expected merge operation '${mergeOperation.id}' to be in git_applied state before finalization.`,
          ),
        );
      }

      const decisionId = makeId(ReviewDecisionId, "review");
      const createdAt = nowIso();
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO presence_review_decisions (
              review_decision_id, ticket_id, attempt_id, decision, notes, created_at
            ) VALUES (
              ${decisionId},
              ${input.ticketId},
              ${input.attemptId},
              ${"merge_approved"},
              ${input.notes},
              ${createdAt}
            )
          `;
          yield* sql`
            UPDATE presence_attempts
            SET status = ${"merged"}, updated_at = ${createdAt}
            WHERE attempt_id = ${input.attemptId}
          `;
          yield* sql`
            UPDATE presence_tickets
            SET status = ${policy.recommendedTicketStatus ?? "done"}, updated_at = ${createdAt}
            WHERE ticket_id = ${input.ticketId}
          `;
          yield* sql`
            UPDATE presence_merge_operations
            SET
              status = ${"finalized"},
              error_summary = ${null},
              updated_at = ${createdAt}
            WHERE merge_operation_id = ${mergeOperation.id}
          `;
          yield* writeAttemptOutcome({
            attemptId: input.attemptId,
            kind: "merged",
            summary: "The approved attempt was merged into the base branch.",
          });
          yield* resolveOpenMergeFailureFindings(input.ticketId, input.attemptId);
          yield* createReviewArtifact({
            ticketId: input.ticketId,
            attemptId: input.attemptId,
            reviewerKind: input.reviewerKind,
            decision: null,
            summary: input.notes.trim() || "Merge approval completed.",
            checklistJson: input.ticketForReview.acceptanceChecklist,
            checklistAssessment: [],
            evidence: [],
            changedFiles: input.latestWorkerHandoff?.changedFiles ?? [],
            changedFilesReviewed: [],
            findingIds: [],
          });
        }),
      );

      const finalizedOperation = yield* readMergeOperationById(mergeOperation.id);
      if (!finalizedOperation) {
        return yield* Effect.fail(
          presenceError(`Merge operation '${mergeOperation.id}' could not be reloaded after finalization.`),
        );
      }
      const cleanupResult = yield* cleanupMergedAttemptResources({
        context,
        operation: finalizedOperation,
      });
      yield* syncTicketProjectionBestEffort(
        input.ticketId,
        cleanupResult.cleanupPending
          ? "Merge finalized with cleanup still pending."
          : "Merge finalized and cleanup completed.",
      );

      return {
        id: ReviewDecisionId.make(decisionId),
        ticketId: TicketId.make(input.ticketId),
        attemptId: AttemptId.make(input.attemptId),
        decision: "merge_approved",
        notes: input.notes,
        createdAt,
      } satisfies ReviewDecisionRecord;
    });

  const applyReviewDecisionInternal = (input: {
    ticketId: string;
    attemptId?: string | null;
    decision: PresenceReviewDecisionKind;
    notes: string;
    reviewerKind: "human" | "policy" | "review_agent";
    reviewThreadId?: string | null;
    reviewFindings?: ReadonlyArray<ParsedPresenceReviewFinding> | undefined;
    reviewChecklistAssessment?: ReadonlyArray<ReviewChecklistAssessmentItem> | undefined;
    reviewEvidence?: ReadonlyArray<ReviewEvidenceItem> | undefined;
    changedFilesReviewed?: ReadonlyArray<string> | undefined;
    mechanismChecklistSupported?: boolean | undefined;
  }) =>
    Effect.gen(function* () {
      const decisionId = makeId(ReviewDecisionId, "review");
      const createdAt = nowIso();
      const ticketForReview = yield* readTicketForPolicy(input.ticketId);
      if (!ticketForReview) {
        return yield* Effect.fail(presenceError(`Ticket '${input.ticketId}' not found.`));
      }
      const latestWorkerHandoff =
        input.attemptId && input.attemptId.trim().length > 0
          ? yield* readLatestWorkerHandoffForAttempt(input.attemptId)
          : null;
      const reviewFindingIds: string[] = [];
      let nextTicketStatus: typeof PresenceTicketStatus.Type = "in_review";
      let nextAttemptStatus: typeof PresenceAttemptStatus.Type | null = null;
      const reviewFindings = [...(input.reviewFindings ?? [])];

      if (input.decision === "accept" && reviewFindings.some((finding) => finding.severity === "blocking")) {
        return yield* Effect.fail(
          presenceError("Accepted review results cannot include blocking review findings."),
        );
      }

      if (input.decision === "merge_approved") {
        if (!input.attemptId) {
          return yield* Effect.fail(
            presenceError("Merge approval requires a specific attempt to merge."),
          );
        }
        return yield* handleMergeApprovedDecision({
          ticketId: input.ticketId,
          attemptId: input.attemptId,
          notes: input.notes,
          reviewerKind: input.reviewerKind,
          ticketForReview,
          latestWorkerHandoff,
        });
      }

      if (input.decision === "accept") {
        if (!input.attemptId) {
          return yield* Effect.fail(
            presenceError("Approving a ticket requires a specific attempt."),
          );
        }
        yield* resolveOpenFindings({
          ticketId: input.ticketId,
          attemptId: input.attemptId,
          source: "review",
        });
        const policy = yield* evaluateSupervisorActionInternal({
          action: "approve_attempt",
          ticketId: input.ticketId,
          attemptId: input.attemptId,
        });
        if (!policy.allowed) {
          const blockedFinding = yield* createOrUpdateFinding({
            ticketId: input.ticketId,
            attemptId: input.attemptId,
            source: "supervisor",
            severity: "blocking",
            disposition: "same_ticket",
            summary: "Approval blocked by supervisor policy.",
            rationale: policy.reasons.join(" "),
          });
          yield* createReviewArtifact({
            ticketId: input.ticketId,
            attemptId: input.attemptId,
            reviewerKind: "policy",
            decision: null,
            summary: "Approval was blocked by supervisor policy.",
            checklistJson: ticketForReview.acceptanceChecklist,
            checklistAssessment: [],
            evidence: [],
            changedFiles: latestWorkerHandoff?.changedFiles ?? [],
            changedFilesReviewed: [],
            findingIds: [blockedFinding.id],
          });
          yield* syncTicketProjectionBestEffort(input.ticketId, "Review policy blocked acceptance.");
          return yield* Effect.fail(presenceError(policy.reasons.join(" ")));
        }
        const acceptedReviewFindings = yield* materializeReviewFindings({
          ticketId: input.ticketId,
          attemptId: input.attemptId,
          findings: reviewFindings,
        });
        reviewFindingIds.push(...acceptedReviewFindings.map((finding) => finding.id));
        nextTicketStatus = policy.recommendedTicketStatus ?? "ready_to_merge";
        nextAttemptStatus = policy.recommendedAttemptStatus ?? "accepted";
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
        if (reviewFindings.length > 0) {
          const materialized = yield* materializeReviewFindings({
            ticketId: input.ticketId,
            attemptId: input.attemptId,
            findings: reviewFindings,
          });
          reviewFindingIds.push(...materialized.map((finding) => finding.id));
        } else {
          const finding = yield* createOrUpdateFinding({
            ticketId: input.ticketId,
            attemptId: input.attemptId,
            source: "review",
            severity: "blocking",
            disposition: "same_ticket",
            summary: input.notes.trim() || "Review requested changes before approval.",
            rationale: "A reviewer requested more work on this attempt before approval.",
          });
          reviewFindingIds.push(finding.id);
        }
      } else if (input.decision === "reject") {
        nextTicketStatus = "blocked";
        nextAttemptStatus = "rejected";
        if (reviewFindings.length > 0) {
          const materialized = yield* materializeReviewFindings({
            ticketId: input.ticketId,
            attemptId: input.attemptId,
            findings: reviewFindings,
          });
          reviewFindingIds.push(...materialized.map((finding) => finding.id));
        } else {
          const finding = yield* createOrUpdateFinding({
            ticketId: input.ticketId,
            attemptId: input.attemptId,
            source: "review",
            severity: "blocking",
            disposition: "escalate",
            summary: input.notes.trim() || "The attempt was rejected during review.",
            rationale: "Review rejected this attempt and escalated the ticket for intervention.",
          });
          reviewFindingIds.push(finding.id);
        }
      } else if (input.decision === "escalate") {
        nextTicketStatus = "blocked";
        if (reviewFindings.length > 0) {
          const materialized = yield* materializeReviewFindings({
            ticketId: input.ticketId,
            attemptId: input.attemptId,
            findings: reviewFindings,
          });
          reviewFindingIds.push(...materialized.map((finding) => finding.id));
        } else {
          const finding = yield* createOrUpdateFinding({
            ticketId: input.ticketId,
            attemptId: input.attemptId,
            source: "review",
            severity: "blocking",
            disposition: "escalate",
            summary: input.notes.trim() || "The ticket was escalated during review.",
            rationale: "Review escalated this work instead of approving or retrying it directly.",
          });
          reviewFindingIds.push(finding.id);
        }
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
        }),
      );
      if (input.attemptId && nextAttemptStatus === "merged") {
        yield* writeAttemptOutcome({
          attemptId: input.attemptId,
          kind: "merged",
          summary: "The attempt was accepted and merged into the base branch.",
        });
      } else if (
        input.attemptId &&
        input.decision === "accept" &&
        input.mechanismChecklistSupported === true &&
        latestWorkerHandoff?.currentHypothesis &&
        latestWorkerHandoff.changedFiles.length > 0
      ) {
        yield* markTicketMechanismChecklist(input.ticketId);
      } else if (input.attemptId && input.decision === "request_changes") {
        yield* writeAttemptOutcome({
          attemptId: input.attemptId,
          kind: "wrong_mechanism",
          summary: input.notes.trim() || "Review requested a materially different fix.",
        });
      } else if (input.attemptId && input.decision === "reject") {
        yield* writeAttemptOutcome({
          attemptId: input.attemptId,
          kind: "rejected_review",
          summary: input.notes.trim() || "The attempt was rejected during review.",
        });
      }

      yield* createReviewArtifact({
        ticketId: input.ticketId,
        attemptId: input.attemptId ?? null,
        reviewerKind: input.reviewerKind,
        decision:
          input.decision === "accept" ||
          input.decision === "request_changes" ||
          input.decision === "escalate"
            ? input.decision
            : null,
        summary: input.notes.trim() || `Review decision recorded: ${input.decision}.`,
        checklistJson: ticketForReview.acceptanceChecklist,
        checklistAssessment: [...(input.reviewChecklistAssessment ?? [])],
        evidence: [...(input.reviewEvidence ?? [])],
        changedFiles: latestWorkerHandoff?.changedFiles ?? [],
        changedFilesReviewed: [...(input.changedFilesReviewed ?? [])],
        findingIds: reviewFindingIds,
        threadId: input.reviewThreadId ?? null,
      });
      yield* syncTicketProjectionBestEffort(input.ticketId, "Review decision recorded.");

      return {
        id: ReviewDecisionId.make(decisionId),
        ticketId: TicketId.make(input.ticketId),
        attemptId: input.attemptId ? AttemptId.make(input.attemptId) : null,
        decision: input.decision,
        notes: input.notes,
        createdAt,
      } satisfies ReviewDecisionRecord;
    });

  const submitReviewDecision: PresenceControlPlaneShape["submitReviewDecision"] = (input) =>
    applyReviewDecisionInternal({
      ticketId: input.ticketId,
      attemptId: input.attemptId ?? null,
      decision: input.decision,
      notes: input.notes,
      reviewerKind: "human",
      reviewThreadId: null,
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(presenceError("Failed to submit review decision.", cause)),
      ),
    );

  const getLatestValidationBatch = (runs: ReadonlyArray<ValidationRunRecord>) => {
    const batchId = runs[0]?.batchId ?? null;
    if (!batchId) {
      return [] as ValidationRunRecord[];
    }
    return runs.filter((run) => run.batchId === batchId);
  };

  const isValidationBatchPassing = (runs: ReadonlyArray<ValidationRunRecord>) =>
    runs.length > 0 && runs.every((run) => run.status === "passed");

  const buildWorkerContinuationPrompt = (input: {
    ticketTitle: string;
    reason: string;
    handoff: WorkerHandoffRecord | null;
  }) =>
    [
      `Continue this assignment: "${input.ticketTitle}".`,
      input.reason,
      "",
      "Resume from the saved state before taking a new action.",
      `Completed work:\n${formatBulletList(input.handoff?.completedWork ?? [])}`,
      `Current hypothesis:\n${input.handoff?.currentHypothesis ?? "None recorded."}`,
      `Blockers:\n${formatBulletList(input.handoff?.blockers ?? [])}`,
      `Open questions:\n${formatBulletList(input.handoff?.openQuestions ?? [])}`,
      `Next step:\n${input.handoff?.nextStep ?? "Inspect the latest findings and continue."}`,
      "",
      // TODO(presence): Keep this v1 instruction path only until the worker can
      // send structured handoff updates over a dedicated channel instead of
      // embedding them inside assistant messages.
      "Before stopping again, emit an updated structured handoff block with completed work, current hypothesis, next step, and open questions.",
      [
        PRESENCE_HANDOFF_START,
        PRESENCE_HANDOFF_HEADINGS.completedWork,
        "- ...",
        PRESENCE_HANDOFF_HEADINGS.currentHypothesis,
        "None",
        PRESENCE_HANDOFF_HEADINGS.nextStep,
        "None",
        PRESENCE_HANDOFF_HEADINGS.openQuestions,
        "- ...",
        PRESENCE_HANDOFF_END,
      ].join("\n"),
    ].join("\n");

  const buildReviewWorkerPrompt = (input: {
    ticketTitle: string;
    ticketDescription: string;
    acceptanceChecklist: string;
    ticketSummary: TicketSummaryRecord | null;
    attemptId: string;
    attemptStatus: AttemptRecord["status"];
    workerHandoff: WorkerHandoffRecord | null;
    validationRuns: ReadonlyArray<ValidationRunRecord>;
    findings: ReadonlyArray<FindingRecord>;
    priorReviewArtifacts: ReadonlyArray<ReviewArtifactRecord>;
    repoRoot: string;
    worktreePath: string | null;
    branch: string | null;
    supervisorNote: string;
  }) =>
    [
      `Review this ticket attempt: "${input.ticketTitle}".`,
      `Description: ${input.ticketDescription || "No description provided."}`,
      `Attempt id: ${input.attemptId}`,
      `Attempt status: ${input.attemptStatus}`,
      `Supervisor note: ${input.supervisorNote}`,
      "",
      "Acceptance checklist:",
      formatChecklistMarkdown(
        decodeJson<PresenceAcceptanceChecklistItem[]>(input.acceptanceChecklist, []),
      ),
      "",
      "Current ticket summary:",
      input.ticketSummary
        ? [
            `Current mechanism: ${input.ticketSummary.currentMechanism ?? "None recorded."}`,
            `Tried across attempts:\n${formatBulletList(input.ticketSummary.triedAcrossAttempts)}`,
            `Failed why:\n${formatBulletList(input.ticketSummary.failedWhy)}`,
            `Open findings:\n${formatBulletList(input.ticketSummary.openFindings)}`,
            `Next step: ${input.ticketSummary.nextStep ?? "None recorded."}`,
          ].join("\n")
        : "No ticket summary recorded.",
      "",
      "Worker handoff:",
      `Completed work:\n${formatBulletList(input.workerHandoff?.completedWork ?? [])}`,
      `Current hypothesis:\n${input.workerHandoff?.currentHypothesis ?? "None recorded."}`,
      `Changed files:\n${formatBulletList(input.workerHandoff?.changedFiles ?? [])}`,
      `Tests run:\n${formatBulletList(input.workerHandoff?.testsRun ?? [])}`,
      `Open questions:\n${formatBulletList(input.workerHandoff?.openQuestions ?? [])}`,
      "",
      "Review workspace:",
      `Repository root: ${input.repoRoot}`,
      `Worktree path: ${input.worktreePath ?? "None available."}`,
      `Branch: ${input.branch ?? "None recorded."}`,
      "",
      "Changed files to inspect first:",
      formatBulletList(input.workerHandoff?.changedFiles ?? []),
      "",
      "Latest validation batch:",
      formatBulletList(
        input.validationRuns.map(
          (run) => `${run.commandKind}: ${run.command} -> ${run.status}${run.exitCode !== null ? ` (${run.exitCode})` : ""}`,
        ),
      ),
      "",
      "Open findings:",
      formatBulletList(
        input.findings
          .filter((finding) => finding.status === "open")
          .map((finding) => `${finding.severity}: ${finding.summary}${finding.attemptId === input.attemptId ? "" : " (ticket-wide)"}`),
      ),
      "",
      "Prior review artifacts for this attempt:",
      formatBulletList(
        input.priorReviewArtifacts.map(
          (artifact) =>
            `${artifact.createdAt}: ${artifact.reviewerKind}${artifact.decision ? ` -> ${artifact.decision}` : ""} - ${artifact.summary}`,
        ),
      ),
      "",
      "Return exactly one structured review result block and no substitute prose format:",
      [
        PRESENCE_REVIEW_RESULT_START,
        JSON.stringify(
          {
            decision: "request_changes",
            summary: "Explain the grounded review conclusion in one short paragraph.",
            checklistAssessment: [
              {
                label: "Mechanism understood",
                satisfied: false,
                notes: "State whether this checklist item is satisfied and why.",
              },
            ],
            findings: [
              {
                severity: "blocking",
                disposition: "same_ticket",
                summary: "Describe one concrete review finding.",
                rationale: "Tie the finding to actual evidence, code, or missing acceptance coverage.",
              },
            ],
            evidence: [{ summary: "List the file, command, or validation signal that supports the review." }],
            changedFilesReviewed: input.workerHandoff?.changedFiles ?? [],
          },
          null,
          2,
        ),
        PRESENCE_REVIEW_RESULT_END,
      ].join("\n"),
    ].join("\n");

  const reviewResultSupportsMechanismChecklist = (
    result: ParsedPresenceReviewResult,
    handoff: WorkerHandoffRecord | null,
  ) =>
    Boolean(
      handoff?.currentHypothesis &&
        handoff.changedFiles.length > 0 &&
        result.checklistAssessment.some(
          (item) => item.label.trim().toLowerCase() === "mechanism understood" && item.satisfied,
        ),
    );

  const startReviewSession = (input: {
    attempt: AttemptWorkspaceContextRow;
    ticketSummary: TicketSummaryRecord | null;
    workerHandoff: WorkerHandoffRecord | null;
    validationRuns: ReadonlyArray<ValidationRunRecord>;
    findings: ReadonlyArray<FindingRecord>;
    priorReviewArtifacts: ReadonlyArray<ReviewArtifactRecord>;
    supervisorNote: string;
  }) =>
    Effect.gen(function* () {
      if (!input.attempt.projectId) {
        return yield* Effect.fail(
          presenceError("Cannot start a review session without a project context."),
        );
      }
      const selection = yield* resolveModelSelectionForAttempt(input.attempt);
      const reviewThreadId = makeId(ThreadId, "presence_review_thread");
      yield* orchestrationEngine.dispatch({
        type: "thread.create",
        commandId: CommandId.make(`presence_review_thread_create_${crypto.randomUUID()}`),
        threadId: reviewThreadId,
        projectId: ProjectId.make(input.attempt.projectId),
        title: `${input.attempt.ticketTitle} - review`,
        systemPrompt: buildReviewWorkerSystemPrompt(),
        modelSelection: selection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: input.attempt.workspaceBranch,
        worktreePath: input.attempt.workspaceWorktreePath,
        createdAt: nowIso(),
      });
      yield* queueTurnStart({
        threadId: reviewThreadId,
        titleSeed: `${input.attempt.ticketTitle} review`,
        selection,
        text: buildReviewWorkerPrompt({
          ticketTitle: input.attempt.ticketTitle,
          ticketDescription: input.attempt.ticketDescription,
          acceptanceChecklist: input.attempt.ticketAcceptanceChecklist,
          ticketSummary: input.ticketSummary,
          attemptId: input.attempt.attemptId,
          attemptStatus: Schema.decodeSync(PresenceAttemptStatus)(input.attempt.attemptStatus as never),
          workerHandoff: input.workerHandoff,
          validationRuns: input.validationRuns,
          findings: input.findings,
          priorReviewArtifacts: input.priorReviewArtifacts,
          repoRoot: input.attempt.workspaceRoot,
          worktreePath: input.attempt.workspaceWorktreePath,
          branch: input.attempt.workspaceBranch,
          supervisorNote: input.supervisorNote,
        }),
      });
      return reviewThreadId;
    });

  const blockTicketForReviewFailure = (input: {
    ticketId: string;
    attemptId: string;
    reviewThreadId: string | null;
    summary: string;
    rationale: string;
  }) =>
    Effect.gen(function* () {
      const ticket = yield* readTicketForPolicy(input.ticketId);
      if (!ticket) {
        return yield* Effect.fail(presenceError(`Ticket '${input.ticketId}' not found.`));
      }
      const latestWorkerHandoff = yield* readLatestWorkerHandoffForAttempt(input.attemptId);
      const finding = yield* createOrUpdateFinding({
        ticketId: input.ticketId,
        attemptId: input.attemptId,
        source: "supervisor",
        severity: "blocking",
        disposition: "escalate",
        summary: input.summary,
        rationale: input.rationale,
      });
      yield* sql`
        UPDATE presence_tickets
        SET status = ${"blocked"}, updated_at = ${nowIso()}
        WHERE ticket_id = ${input.ticketId}
      `;
      yield* createReviewArtifact({
        ticketId: input.ticketId,
        attemptId: input.attemptId,
        reviewerKind: "review_agent",
        decision: null,
        summary: input.summary,
        checklistJson: ticket.acceptanceChecklist,
        checklistAssessment: [],
        evidence: [{ summary: input.rationale }],
        changedFiles: latestWorkerHandoff?.changedFiles ?? [],
        changedFilesReviewed: [],
        findingIds: [finding.id],
        threadId: input.reviewThreadId,
      });
      yield* syncTicketProjectionBestEffort(input.ticketId, "Review output failed or was malformed.");
      return finding;
    });

  const resolveModelSelectionForAttempt = (context: AttemptWorkspaceContextRow) =>
    Effect.gen(function* () {
      if (context.attemptProvider && context.attemptModel) {
        return {
          provider: Schema.decodeSync(ProviderKind)(context.attemptProvider as never),
          model: context.attemptModel,
        } as ModelSelection;
      }
      const providers = yield* providerRegistry.getProviders;
      const savedRepositorySelection = decodeJson<ModelSelection | null>(
        context.defaultModelSelection,
        null,
      );
      const selection = isModelSelectionAvailable(providers, savedRepositorySelection)
        ? savedRepositorySelection
        : chooseDefaultModelSelection(providers);
      if (!selection) {
        return yield* Effect.fail(
          presenceError("No provider/model is available for the supervisor runtime."),
        );
      }
      return selection;
    });

  const queueTurnStart = (input: {
    threadId: string;
    titleSeed: string;
    selection: ModelSelection;
    text: string;
  }) =>
    orchestrationEngine.dispatch({
      type: "thread.turn.start",
      commandId: CommandId.make(`presence_turn_start_${crypto.randomUUID()}`),
      threadId: ThreadId.make(input.threadId),
      message: {
        messageId: makeId(MessageId, "presence_message"),
        role: "user",
        text: input.text,
        attachments: [],
      },
      modelSelection: input.selection,
      titleSeed: input.titleSeed,
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: nowIso(),
    });

  const workerHandoffMateriallyChanged = (
    previous: WorkerHandoffRecord | null,
    next: Omit<WorkerHandoffRecord, "id" | "attemptId" | "createdAt">,
  ) =>
    !previous ||
    JSON.stringify({
      completedWork: previous.completedWork,
      currentHypothesis: previous.currentHypothesis,
      changedFiles: previous.changedFiles,
      testsRun: previous.testsRun,
      blockers: previous.blockers,
      nextStep: previous.nextStep,
      openQuestions: previous.openQuestions,
      retryCount: previous.retryCount,
      reasoningSource: previous.reasoningSource,
      reasoningUpdatedAt: previous.reasoningUpdatedAt,
      confidence: previous.confidence,
      evidenceIds: previous.evidenceIds,
    }) !==
      JSON.stringify({
        completedWork: next.completedWork,
        currentHypothesis: next.currentHypothesis,
        changedFiles: next.changedFiles,
        testsRun: next.testsRun,
        blockers: next.blockers,
        nextStep: next.nextStep,
        openQuestions: next.openQuestions,
        retryCount: next.retryCount,
        reasoningSource: next.reasoningSource,
        reasoningUpdatedAt: next.reasoningUpdatedAt,
        confidence: next.confidence,
        evidenceIds: next.evidenceIds,
      });

  const buildWorkerHandoffCandidate = (input: {
    attemptId: string;
    attemptTitle: string;
    attemptStatus: string;
    previousHandoff: WorkerHandoffRecord | null;
    thread: {
      latestTurn: {
        turnId: string;
        state: "running" | "interrupted" | "completed" | "error";
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
    } | null;
    changedFiles: ReadonlyArray<string>;
    validationRuns: ReadonlyArray<ValidationRunRecord>;
    findings: ReadonlyArray<FindingRecord>;
  }) =>
    Effect.gen(function* () {
      const latestAssistantReasoning = yield* readLatestAssistantReasoningFromThread(input.thread);
      const previousReasoningUpdatedAt = input.previousHandoff?.reasoningUpdatedAt ?? null;
      const useAssistantReasoning =
        latestAssistantReasoning &&
        (!previousReasoningUpdatedAt ||
          latestAssistantReasoning.updatedAt.localeCompare(previousReasoningUpdatedAt) >= 0);

      const reasoningCompletedWork = useAssistantReasoning
        ? latestAssistantReasoning.completedWork
        : (input.previousHandoff?.completedWork ?? []);
      const reasoningCurrentHypothesis = useAssistantReasoning
        ? latestAssistantReasoning.currentHypothesis
        : (input.previousHandoff?.currentHypothesis ?? null);
      const reasoningNextStep = useAssistantReasoning
        ? latestAssistantReasoning.nextStep
        : (input.previousHandoff?.nextStep ?? null);
      const reasoningOpenQuestions = useAssistantReasoning
        ? latestAssistantReasoning.openQuestions
        : (input.previousHandoff?.openQuestions ?? []);
      const reasoningSource = useAssistantReasoning
        ? latestAssistantReasoning.source
        : (input.previousHandoff?.reasoningSource ?? null);
      const reasoningUpdatedAt = useAssistantReasoning
        ? latestAssistantReasoning.updatedAt
        : (input.previousHandoff?.reasoningUpdatedAt ?? null);

      const latestCheckpoint =
        input.thread?.checkpoints.find(
          (checkpoint) => checkpoint.turnId === input.thread?.latestTurn?.turnId,
        ) ??
        input.thread?.checkpoints.at(-1) ??
        null;
      const effectiveChangedFiles = uniqueStrings([
        ...input.changedFiles,
        ...(latestCheckpoint?.files.map((file) => file.path) ?? []),
      ]);
      const testsRun = uniqueStrings([
        ...(input.previousHandoff?.testsRun ?? []),
        ...input.validationRuns.map((run) => run.command),
      ]);
      const blockerSummaries = buildBlockerSummaries({
        validationRuns: input.validationRuns,
        findings: input.findings,
        handoff: input.previousHandoff,
      });
      const blockers = uniqueStrings([
        ...blockerSummaries.map((summary) =>
          summary.count > 1 ? `${summary.summary} (repeated ${summary.count} times)` : summary.summary,
        ),
        ...(input.thread?.latestTurn?.state === "error" || input.thread?.latestTurn?.state === "interrupted"
          ? [`Worker thread settled with state ${input.thread.latestTurn.state}.`]
          : []),
      ]);
      const nextStep =
        reasoningNextStep ??
        (input.thread?.latestTurn?.state === "completed"
          ? "Run validation, review the result, and continue only if new findings require it."
          : input.thread?.latestTurn?.state === "error" || input.thread?.latestTurn?.state === "interrupted"
            ? "Address the interruption or error before resuming the same attempt."
            : blockers[0]
              ? "Address the active blocker before continuing the same path."
              : "Continue the current attempt and keep the handoff state warm while working.");

      return {
        completedWork: reasoningCompletedWork,
        currentHypothesis: reasoningCurrentHypothesis,
        changedFiles: effectiveChangedFiles,
        testsRun,
        blockers,
        nextStep,
        openQuestions: reasoningOpenQuestions,
        retryCount: input.previousHandoff?.retryCount ?? 0,
        reasoningSource,
        reasoningUpdatedAt,
        confidence:
          input.previousHandoff?.confidence ??
          (input.attemptStatus === "in_progress" ? 0.68 : 0.72),
        evidenceIds: input.previousHandoff?.evidenceIds ?? [],
      } satisfies Omit<WorkerHandoffRecord, "id" | "attemptId" | "createdAt">;
    });

  const synthesizeWorkerHandoffFromThread = (
    attemptId: string,
    options?: {
      allowRunning?: boolean | undefined;
    },
  ) =>
    Effect.gen(function* () {
      const context = yield* readAttemptWorkspaceContext(attemptId);
      if (!context?.attemptThreadId) {
        return null;
      }
      const [thread, previousHandoff, changedFiles, validationRuns, findings] = yield* Effect.all([
        readThreadFromModel(context.attemptThreadId),
        readLatestWorkerHandoffForAttempt(attemptId),
        readChangedFilesForWorkspace(context.workspaceWorktreePath),
        readValidationRunsForAttempt(attemptId),
        readFindingsForTicket(context.ticketId),
      ]);
      if (!options?.allowRunning && !isThreadSettled(thread)) {
        return previousHandoff;
      }
      const nextHandoff = yield* buildWorkerHandoffCandidate({
        attemptId,
        attemptTitle: context.attemptTitle,
        attemptStatus: context.attemptStatus,
        previousHandoff,
        thread,
        changedFiles,
        validationRuns,
        findings: findings.filter((finding) => finding.attemptId === null || finding.attemptId === attemptId),
      });

      if (!workerHandoffMateriallyChanged(previousHandoff, nextHandoff)) {
        return previousHandoff;
      }

      return yield* saveWorkerHandoff({
        attemptId: AttemptId.make(attemptId),
        completedWork: nextHandoff.completedWork,
        currentHypothesis: nextHandoff.currentHypothesis,
        changedFiles: nextHandoff.changedFiles,
        testsRun: nextHandoff.testsRun,
        blockers: nextHandoff.blockers,
        nextStep: nextHandoff.nextStep,
        openQuestions: nextHandoff.openQuestions,
        retryCount: nextHandoff.retryCount,
        reasoningSource: nextHandoff.reasoningSource,
        reasoningUpdatedAt: nextHandoff.reasoningUpdatedAt,
        confidence: nextHandoff.confidence,
        evidenceIds: nextHandoff.evidenceIds,
      });
    });

  const ensurePromotionCandidateForAcceptedAttempt = (input: {
    boardId: string;
    ticketId: string;
    attemptId: string;
    workerHandoff: WorkerHandoffRecord | null;
    findings: ReadonlyArray<FindingRecord>;
  }) =>
    Effect.gen(function* () {
      const existing = yield* sql<{ id: string }>`
        SELECT promotion_candidate_id as id
        FROM presence_promotion_candidates
        WHERE source_ticket_id = ${input.ticketId}
          AND source_attempt_id = ${input.attemptId}
        LIMIT 1
      `.pipe(Effect.map((rows) => rows[0] ?? null));
      if (existing) {
        return;
      }
      const boardSnapshot = yield* getBoardSnapshotInternal(input.boardId);
      const ticket = boardSnapshot.tickets.find((candidate) => candidate.id === input.ticketId) ?? null;
      if (!ticket) {
        return;
      }
      const compiledTruth = uniqueStrings([
        ...(input.workerHandoff?.completedWork ?? []),
        ...(input.findings
          .filter((finding) => finding.status !== "dismissed")
          .map((finding) => finding.summary)),
      ]).join("\n");
      const timelineEntry = `${nowIso()} - Accepted supervisor review for ${ticket.title}.`;
      yield* createPromotionCandidate({
        sourceTicketId: input.ticketId as never,
        sourceAttemptId: input.attemptId as never,
        family: "bug-patterns",
        title: `${ticket.title} review insight`,
        slug: `${sanitizeProjectionSegment(ticket.title, "ticket")}-${input.attemptId.slice(-8)}`,
        compiledTruth: compiledTruth || "Accepted work should be promoted only after review confirms the mechanism and evidence.",
        timelineEntry,
      });
      yield* syncBoardProjectionBestEffort(
        input.boardId,
        "Accepted attempt promotion candidate updated brain projections.",
      );
    });

  const executeSupervisorRun = (runId: string) =>
    Effect.gen(function* () {
      const startedAt = Date.now();
      let steps = 0;
      while (steps < 200 && Date.now() - startedAt < 30 * 60_000) {
        steps += 1;
        const run = yield* readSupervisorRunById(runId);
        if (!run) {
          return;
        }
        if (run.status === "cancelled") {
          return;
        }

        const snapshot = yield* getBoardSnapshotInternal(run.boardId);
        if (snapshot.boardProjectionHealth && projectionIsRepairEligible(snapshot.boardProjectionHealth)) {
          yield* runProjectionWorker().pipe(Effect.forkDetach, Effect.asVoid);
        }
        for (const health of snapshot.ticketProjectionHealth.filter((health) =>
          run.scopeTicketIds.some((ticketId) => ticketId === health.scopeId),
        )) {
          if (projectionIsRepairEligible(health)) {
            yield* runProjectionWorker().pipe(Effect.forkDetach, Effect.asVoid);
            break;
          }
        }
        const scopedTickets = snapshot.tickets.filter((ticket) =>
          run.scopeTicketIds.some((scopeTicketId) => scopeTicketId === ticket.id),
        );
        const stable = scopedTickets.every((ticket) =>
          ticket.status === "ready_to_merge" || ticket.status === "done" || ticket.status === "blocked",
        );
        const activeAttemptIds = snapshot.attempts
          .filter((attempt) =>
            scopedTickets.some((ticket) => ticket.id === attempt.ticketId) &&
            attempt.status !== "accepted" &&
            attempt.status !== "merged" &&
            attempt.status !== "rejected",
          )
          .map((attempt) => attempt.id);
        const blockedTicketIds = scopedTickets
          .filter((ticket) => ticket.status === "blocked")
          .map((ticket) => ticket.id);

        if (stable) {
          yield* saveSupervisorHandoff({
            boardId: run.boardId,
            topPriorities: scopedTickets.map((ticket) => ticket.title).slice(0, 3),
            activeAttemptIds: activeAttemptIds as never,
            blockedTicketIds: blockedTicketIds as never,
            recentDecisions: ["Supervisor run reached a stable state."],
            nextBoardActions: ["Wait for human merge approval or new goals."],
            currentRunId: run.id,
            stage: "stable",
          });
          yield* persistSupervisorRun({
            runId,
            boardId: run.boardId,
            sourceGoalIntakeId: run.sourceGoalIntakeId,
            scopeTicketIds: run.scopeTicketIds,
            status: "completed",
            stage: "stable",
            currentTicketId: null,
            activeThreadIds: [],
            summary: "Scoped tickets reached ready-to-merge, done, or blocked.",
            createdAt: run.createdAt,
          });
          return;
        }

        const actionableTickets = scopedTickets.filter(
          (ticket) => ticket.status === "todo" || ticket.status === "in_progress" || ticket.status === "in_review",
        );

        yield* saveSupervisorHandoff({
          boardId: run.boardId,
          topPriorities: actionableTickets.map((ticket) => ticket.title).slice(0, 3),
          activeAttemptIds: activeAttemptIds as never,
          blockedTicketIds: blockedTicketIds as never,
          recentDecisions: [`Supervisor loop step ${steps} is evaluating scoped tickets.`],
          nextBoardActions: ["Create attempts, run validation, then review."],
          currentRunId: run.id,
          stage: run.stage,
        });

        let progressed = false;

        for (const ticket of actionableTickets.slice(0, 2)) {
          const attemptsForTicket = snapshot.attempts
            .filter((attempt) => attempt.ticketId === ticket.id)
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
          let activeAttempt =
            attemptsForTicket.find((attempt) =>
              attempt.status === "in_progress" || attempt.status === "in_review" || attempt.status === "planned",
            ) ?? null;

          if (!activeAttempt) {
            activeAttempt = yield* createAttempt({ ticketId: ticket.id });
            yield* persistSupervisorRun({
              runId,
              boardId: run.boardId,
              sourceGoalIntakeId: run.sourceGoalIntakeId,
              scopeTicketIds: run.scopeTicketIds,
              status: "running",
              stage: "waiting_on_worker",
              currentTicketId: ticket.id,
              activeThreadIds: [],
              summary: `Created attempt ${activeAttempt.id} for ${ticket.title}.`,
              createdAt: run.createdAt,
            });
            progressed = true;
          }

          const attemptContext = yield* readAttemptWorkspaceContext(activeAttempt.id);
          if (!attemptContext) {
            continue;
          }

          if (!attemptContext.attemptThreadId) {
            const session = yield* startAttemptSession({ attemptId: activeAttempt.id });
            yield* persistSupervisorRun({
              runId,
              boardId: run.boardId,
              sourceGoalIntakeId: run.sourceGoalIntakeId,
              scopeTicketIds: run.scopeTicketIds,
              status: "running",
              stage: "waiting_on_worker",
              currentTicketId: ticket.id,
              activeThreadIds: [session.threadId],
              summary: `Started worker session for ${ticket.title}.`,
              createdAt: run.createdAt,
            });
            progressed = true;
            continue;
          }

          const thread = yield* readThreadFromModel(attemptContext.attemptThreadId);
          if (!isThreadSettled(thread) && thread?.latestTurn) {
            yield* synthesizeWorkerHandoffFromThread(activeAttempt.id, { allowRunning: true });
            yield* syncTicketProjectionBestEffort(
              ticket.id,
              "Supervisor runtime updated ticket state while creating or reusing an attempt.",
            );
            yield* persistSupervisorRun({
              runId,
              boardId: run.boardId,
              sourceGoalIntakeId: run.sourceGoalIntakeId,
              scopeTicketIds: run.scopeTicketIds,
              status: "running",
              stage: "waiting_on_worker",
              currentTicketId: ticket.id,
              activeThreadIds: [attemptContext.attemptThreadId],
              summary: `Waiting for the active worker turn on ${ticket.title} to settle.`,
              createdAt: run.createdAt,
            });
            continue;
          }

          const synthesizedHandoff = yield* synthesizeWorkerHandoffFromThread(activeAttempt.id);
          const latestWorkerHandoff =
            synthesizedHandoff ??
            (yield* readLatestWorkerHandoffForAttempt(activeAttempt.id));

          if (!latestWorkerHandoff) {
            if (!isThreadSettled(thread)) {
              yield* persistSupervisorRun({
                runId,
                boardId: run.boardId,
                sourceGoalIntakeId: run.sourceGoalIntakeId,
                scopeTicketIds: run.scopeTicketIds,
                status: "running",
                stage: "waiting_on_worker",
                currentTicketId: ticket.id,
                activeThreadIds: [attemptContext.attemptThreadId],
                summary: `Waiting for worker output on ${ticket.title}.`,
                createdAt: run.createdAt,
              });
              continue;
            }
          }

          const validationRuns = yield* readValidationRunsForAttempt(activeAttempt.id);
          const latestValidationBatch = getLatestValidationBatch(validationRuns);
          if (!isValidationBatchPassing(latestValidationBatch)) {
            const runs = yield* runAttemptValidation({ attemptId: activeAttempt.id });
            const batch = getLatestValidationBatch(runs);
            progressed = true;
            if (!isValidationBatchPassing(batch)) {
              const retryCount = (latestWorkerHandoff?.retryCount ?? 0) + 1;
              const updatedHandoff = yield* saveWorkerHandoff({
                attemptId: activeAttempt.id,
                completedWork:
                  latestWorkerHandoff?.completedWork ?? ["Validation exposed a failure that needs another worker pass."],
                currentHypothesis: latestWorkerHandoff?.currentHypothesis ?? null,
                changedFiles: latestWorkerHandoff?.changedFiles ?? [],
                testsRun: uniqueStrings([
                  ...(latestWorkerHandoff?.testsRun ?? []),
                  ...batch.map((run) => run.command),
                ]),
                blockers:
                  retryCount >= 3
                    ? uniqueStrings([
                        ...(latestWorkerHandoff?.blockers ?? []),
                        "Repeated similar validation failures reached the retry threshold.",
                      ])
                    : latestWorkerHandoff?.blockers ?? [],
                nextStep:
                  retryCount >= 3
                    ? "Escalate or propose follow-up work before another ordinary retry."
                    : "Address the failed validation commands and continue the same attempt.",
                openQuestions: latestWorkerHandoff?.openQuestions ?? [],
                retryCount,
                reasoningSource: latestWorkerHandoff?.reasoningSource ?? null,
                reasoningUpdatedAt: latestWorkerHandoff?.reasoningUpdatedAt ?? null,
                confidence: latestWorkerHandoff?.confidence ?? 0.62,
                evidenceIds: latestWorkerHandoff?.evidenceIds ?? [],
              });

              if (retryCount >= 3) {
                yield* createOrUpdateFinding({
                  ticketId: ticket.id,
                  attemptId: activeAttempt.id,
                  source: "supervisor",
                  severity: "blocking",
                  disposition: "escalate",
                  summary: "Supervisor blocked another ordinary retry after repeated similar failures.",
                  rationale:
                    "GLM-style loop breaking triggered after three materially similar failed validation/review cycles.",
                });
                yield* sql`
                  UPDATE presence_tickets
                  SET status = ${"blocked"}, updated_at = ${nowIso()}
                  WHERE ticket_id = ${ticket.id}
                `;
                yield* persistSupervisorRun({
                  runId,
                  boardId: run.boardId,
                  sourceGoalIntakeId: run.sourceGoalIntakeId,
                  scopeTicketIds: run.scopeTicketIds,
                  status: "running",
                  stage: "stable",
                  currentTicketId: ticket.id,
                  activeThreadIds: [],
                  summary: `Blocked ${ticket.title} after repeated similar failures.`,
                  createdAt: run.createdAt,
                });
                continue;
              }

              const selection = yield* resolveModelSelectionForAttempt(attemptContext);
              yield* queueTurnStart({
                threadId: attemptContext.attemptThreadId,
                titleSeed: attemptContext.ticketTitle,
                selection,
                text: buildWorkerContinuationPrompt({
                  ticketTitle: attemptContext.ticketTitle,
                  reason: `Validation failed for this attempt. Retry count is now ${updatedHandoff.retryCount}. Fix the failure without repeating the same approach blindly.`,
                  handoff: updatedHandoff,
                }),
              });
              yield* persistSupervisorRun({
                runId,
                boardId: run.boardId,
                sourceGoalIntakeId: run.sourceGoalIntakeId,
                scopeTicketIds: run.scopeTicketIds,
                status: "running",
                stage: "waiting_on_worker",
                currentTicketId: ticket.id,
                activeThreadIds: [attemptContext.attemptThreadId],
                summary: `Validation failed for ${ticket.title}; worker continuation queued.`,
                createdAt: run.createdAt,
              });
              continue;
            }
          }

          const ticketSnapshot = yield* getBoardSnapshotInternal(run.boardId);
          const openFindings = ticketSnapshot.findings.filter(
            (finding) =>
              finding.ticketId === ticket.id &&
              finding.status === "open" &&
              (finding.attemptId === null || finding.attemptId === activeAttempt.id),
          );
          const latestBatch = getLatestValidationBatch(
            ticketSnapshot.validationRuns.filter((runItem) => runItem.attemptId === activeAttempt.id),
          );
          const ticketSummary =
            ticketSnapshot.ticketSummaries.find((summary) => summary.ticketId === ticket.id) ?? null;
          const priorReviewArtifacts = ticketSnapshot.reviewArtifacts.filter(
            (artifact) => artifact.attemptId === activeAttempt.id,
          );

          let reviewThreadId: string | null =
            run.stage === "waiting_on_review" && run.currentTicketId === ticket.id
              ? (run.activeThreadIds[0] ?? null)
              : null;

          if (!reviewThreadId) {
            const startedReviewThreadId = yield* startReviewSession({
              attempt: attemptContext,
              ticketSummary,
              workerHandoff: latestWorkerHandoff,
              validationRuns: latestBatch,
              findings: openFindings,
              priorReviewArtifacts,
              supervisorNote: "Review this attempt after validation recorded a passing batch.",
            });
            reviewThreadId = startedReviewThreadId;
            yield* persistSupervisorRun({
              runId,
              boardId: run.boardId,
              sourceGoalIntakeId: run.sourceGoalIntakeId,
              scopeTicketIds: run.scopeTicketIds,
              status: "running",
              stage: "waiting_on_review",
              currentTicketId: ticket.id,
              activeThreadIds: [startedReviewThreadId],
              summary: `Started review for ${ticket.title}.`,
              createdAt: run.createdAt,
            });
            progressed = true;
            continue;
          }

          const reviewThread = yield* readThreadFromModel(reviewThreadId);
          if (!reviewThread) {
            const restartedReviewThreadId = yield* startReviewSession({
              attempt: attemptContext,
              ticketSummary,
              workerHandoff: latestWorkerHandoff,
              validationRuns: latestBatch,
              findings: openFindings,
              priorReviewArtifacts,
              supervisorNote: "Restart review for this attempt because the previous review thread is unavailable.",
            });
            reviewThreadId = restartedReviewThreadId;
            yield* persistSupervisorRun({
              runId,
              boardId: run.boardId,
              sourceGoalIntakeId: run.sourceGoalIntakeId,
              scopeTicketIds: run.scopeTicketIds,
              status: "running",
              stage: "waiting_on_review",
              currentTicketId: ticket.id,
              activeThreadIds: [restartedReviewThreadId],
              summary: `Restarted review for ${ticket.title}.`,
              createdAt: run.createdAt,
            });
            progressed = true;
            continue;
          }
          if (
            reviewThread?.latestTurn?.state === "running" &&
            reviewThread.latestTurn.requestedAt &&
            addMillisecondsIso(reviewThread.latestTurn.requestedAt, REVIEW_THREAD_TIMEOUT_MS).localeCompare(
              nowIso(),
            ) <= 0
          ) {
            yield* blockTicketForReviewFailure({
              ticketId: ticket.id,
              attemptId: activeAttempt.id,
              reviewThreadId,
              summary: "Review worker timed out before producing a valid result.",
              rationale:
                "The review thread exceeded the review timeout without settling on a machine-readable review result.",
            });
            yield* persistSupervisorRun({
              runId,
              boardId: run.boardId,
              sourceGoalIntakeId: run.sourceGoalIntakeId,
              scopeTicketIds: run.scopeTicketIds,
              status: "running",
              stage: "stable",
              currentTicketId: ticket.id,
              activeThreadIds: [],
              summary: `Blocked ${ticket.title} because the review worker timed out.`,
              createdAt: run.createdAt,
            });
            progressed = true;
            continue;
          }

          if (!isThreadSettled(reviewThread)) {
            yield* persistSupervisorRun({
              runId,
              boardId: run.boardId,
              sourceGoalIntakeId: run.sourceGoalIntakeId,
              scopeTicketIds: run.scopeTicketIds,
              status: "running",
              stage: "waiting_on_review",
              currentTicketId: ticket.id,
              activeThreadIds: [reviewThreadId],
              summary: `Waiting for the review worker on ${ticket.title} to settle.`,
              createdAt: run.createdAt,
            });
            continue;
          }

          const parsedReviewResult = yield* readLatestReviewResultFromThread(reviewThread);
          if (
            parsedReviewResult?.decision === "accept" &&
            parsedReviewResult.findings.some((finding) => finding.severity === "blocking")
          ) {
            yield* blockTicketForReviewFailure({
              ticketId: ticket.id,
              attemptId: activeAttempt.id,
              reviewThreadId,
              summary: "Review worker returned an inconsistent accept result.",
              rationale:
                "The review result recommended accept while also reporting blocking findings, so the supervisor refused to apply it.",
            });
            yield* persistSupervisorRun({
              runId,
              boardId: run.boardId,
              sourceGoalIntakeId: run.sourceGoalIntakeId,
              scopeTicketIds: run.scopeTicketIds,
              status: "running",
              stage: "stable",
              currentTicketId: ticket.id,
              activeThreadIds: [],
              summary: `Blocked ${ticket.title} because the review result was internally inconsistent.`,
              createdAt: run.createdAt,
            });
            progressed = true;
            continue;
          }
          if (
            reviewThread?.latestTurn?.state === "error" ||
            reviewThread?.latestTurn?.state === "interrupted" ||
            !parsedReviewResult
          ) {
            yield* blockTicketForReviewFailure({
              ticketId: ticket.id,
              attemptId: activeAttempt.id,
              reviewThreadId,
              summary: !parsedReviewResult
                ? "Review worker did not produce a valid structured review result."
                : `Review worker settled with state ${reviewThread?.latestTurn?.state}.`,
              rationale: !parsedReviewResult
                ? "The review thread settled without a valid [PRESENCE_REVIEW_RESULT] block, so the supervisor cannot apply an honest agentic review decision."
                : "The review thread failed before producing a valid structured review result.",
            });
            yield* persistSupervisorRun({
              runId,
              boardId: run.boardId,
              sourceGoalIntakeId: run.sourceGoalIntakeId,
              scopeTicketIds: run.scopeTicketIds,
              status: "running",
              stage: "stable",
              currentTicketId: ticket.id,
              activeThreadIds: [],
              summary: `Blocked ${ticket.title} because the review output was missing or invalid.`,
              createdAt: run.createdAt,
            });
            progressed = true;
            continue;
          }

          const reviewResult = yield* applyReviewDecisionInternal({
            ticketId: ticket.id,
            attemptId: activeAttempt.id,
            decision: parsedReviewResult.decision,
            notes: parsedReviewResult.summary,
            reviewerKind: "review_agent",
            reviewThreadId,
            reviewFindings: parsedReviewResult.findings,
            reviewChecklistAssessment: parsedReviewResult.checklistAssessment,
            reviewEvidence: parsedReviewResult.evidence,
            changedFilesReviewed: parsedReviewResult.changedFilesReviewed,
            mechanismChecklistSupported: reviewResultSupportsMechanismChecklist(
              parsedReviewResult,
              latestWorkerHandoff,
            ),
          });
          progressed = true;

          if (reviewResult.decision === "accept") {
            yield* ensurePromotionCandidateForAcceptedAttempt({
              boardId: run.boardId,
              ticketId: ticket.id,
              attemptId: activeAttempt.id,
              workerHandoff: latestWorkerHandoff,
              findings: openFindings,
            });
            yield* persistSupervisorRun({
              runId,
              boardId: run.boardId,
              sourceGoalIntakeId: run.sourceGoalIntakeId,
              scopeTicketIds: run.scopeTicketIds,
              status: "running",
              stage: "apply_review",
              currentTicketId: ticket.id,
              activeThreadIds: [],
              summary: `Review accepted ${ticket.title}; ticket is ready to merge.`,
              createdAt: run.createdAt,
            });
          } else if (reviewResult.decision === "request_changes") {
            const refreshedHandoff = yield* readLatestWorkerHandoffForAttempt(activeAttempt.id);
            const retryCount = (refreshedHandoff?.retryCount ?? 0) + 1;
            yield* saveWorkerHandoff({
              attemptId: activeAttempt.id,
              completedWork:
                refreshedHandoff?.completedWork ?? ["Review requested another worker iteration."],
              currentHypothesis: refreshedHandoff?.currentHypothesis ?? null,
              changedFiles: refreshedHandoff?.changedFiles ?? [],
              testsRun: refreshedHandoff?.testsRun ?? [],
              blockers: refreshedHandoff?.blockers ?? [],
              nextStep: "Address the review feedback on the same attempt before asking for approval again.",
              openQuestions: refreshedHandoff?.openQuestions ?? [],
              retryCount,
              reasoningSource: refreshedHandoff?.reasoningSource ?? null,
              reasoningUpdatedAt: refreshedHandoff?.reasoningUpdatedAt ?? null,
              confidence: refreshedHandoff?.confidence ?? 0.64,
              evidenceIds: refreshedHandoff?.evidenceIds ?? [],
            });
            if (retryCount >= 3) {
              yield* sql`
                UPDATE presence_tickets
                SET status = ${"blocked"}, updated_at = ${nowIso()}
                WHERE ticket_id = ${ticket.id}
              `;
            } else {
              const selection = yield* resolveModelSelectionForAttempt(attemptContext);
              yield* queueTurnStart({
                threadId: attemptContext.attemptThreadId,
                titleSeed: attemptContext.ticketTitle,
                selection,
                text: buildWorkerContinuationPrompt({
                  ticketTitle: attemptContext.ticketTitle,
                  reason: `Review requested changes on the same attempt. Address the feedback and continue. Review summary: ${parsedReviewResult.summary}`,
                  handoff: refreshedHandoff ?? latestWorkerHandoff,
                }),
              });
            }
            yield* persistSupervisorRun({
              runId,
              boardId: run.boardId,
              sourceGoalIntakeId: run.sourceGoalIntakeId,
              scopeTicketIds: run.scopeTicketIds,
              status: "running",
              stage: retryCount >= 3 ? "stable" : "waiting_on_worker",
              currentTicketId: ticket.id,
              activeThreadIds: retryCount >= 3 ? [] : [attemptContext.attemptThreadId],
              summary:
                retryCount >= 3
                  ? `Blocked ${ticket.title} after repeated review-driven retries.`
                  : `Review requested changes for ${ticket.title}; worker continuation queued.`,
              createdAt: run.createdAt,
            });
          } else {
            yield* persistSupervisorRun({
              runId,
              boardId: run.boardId,
              sourceGoalIntakeId: run.sourceGoalIntakeId,
              scopeTicketIds: run.scopeTicketIds,
              status: "running",
              stage: "stable",
              currentTicketId: ticket.id,
              activeThreadIds: [],
              summary: `Escalated ${ticket.title} after review.`,
              createdAt: run.createdAt,
            });
          }
        }

        if (!progressed) {
          yield* persistSupervisorRun({
            runId,
            boardId: run.boardId,
            sourceGoalIntakeId: run.sourceGoalIntakeId,
            scopeTicketIds: run.scopeTicketIds,
            status: "running",
            stage: "waiting_on_worker",
            currentTicketId: actionableTickets[0]?.id ?? null,
            activeThreadIds: snapshot.attempts
              .filter((attempt) =>
                actionableTickets.some((ticket) => ticket.id === attempt.ticketId) && Boolean(attempt.threadId),
              )
              .map((attempt) => attempt.threadId!)
              .slice(0, 2),
            summary: "Supervisor is waiting for worker progress before the next validation/review pass.",
            createdAt: run.createdAt,
          });
          for (const activeAttempt of snapshot.attempts.filter((attempt) =>
            actionableTickets.some((ticket) => ticket.id === attempt.ticketId) && Boolean(attempt.threadId),
          )) {
            yield* synthesizeWorkerHandoffFromThread(activeAttempt.id, { allowRunning: true });
            yield* syncTicketProjectionBestEffort(
              activeAttempt.ticketId,
              "Supervisor runtime refreshed active attempt projections while waiting on work.",
            );
          }
          yield* Effect.sleep(5000);
        }
      }

      const finalRun = yield* readSupervisorRunById(runId);
      if (!finalRun || finalRun.status === "cancelled" || finalRun.status === "completed") {
        return;
      }
      yield* persistSupervisorRun({
        runId,
        boardId: finalRun.boardId,
        sourceGoalIntakeId: finalRun.sourceGoalIntakeId,
        scopeTicketIds: finalRun.scopeTicketIds,
        status: "failed",
        stage: finalRun.stage,
        currentTicketId: finalRun.currentTicketId,
        activeThreadIds: finalRun.activeThreadIds,
        summary: "Supervisor runtime hit the configured step or time budget before reaching a stable state.",
        createdAt: finalRun.createdAt,
      });
    }).pipe(
      Effect.catch((cause) =>
        Effect.gen(function* () {
          const run = yield* readSupervisorRunById(runId);
          if (!run || run.status === "cancelled" || run.status === "completed") {
            return;
          }
          yield* persistSupervisorRun({
            runId,
            boardId: run.boardId,
            sourceGoalIntakeId: run.sourceGoalIntakeId,
            scopeTicketIds: run.scopeTicketIds,
            status: "failed",
            stage: run.stage,
            currentTicketId: run.currentTicketId,
            activeThreadIds: run.activeThreadIds,
            summary:
              cause instanceof Error ? cause.message : "Supervisor runtime failed unexpectedly.",
            createdAt: run.createdAt,
          });
        }),
      ),
    );

  const startSupervisorRun: PresenceControlPlaneShape["startSupervisorRun"] = (input) =>
    Effect.gen(function* () {
      const snapshot = yield* getBoardSnapshotInternal(input.boardId);
      const boardTicketIds = new Set(snapshot.tickets.map((ticket) => ticket.id));
      if (
        input.ticketIds &&
        input.ticketIds.some((ticketId) => !boardTicketIds.has(ticketId))
      ) {
        return yield* Effect.fail(
          presenceError("Supervisor runs can only scope tickets that belong to the selected board."),
        );
      }
      const scopeTicketIds =
        input.ticketIds && input.ticketIds.length > 0
          ? input.ticketIds
          : input.goalIntakeId
            ? snapshot.goalIntakes.find((intake) => intake.id === input.goalIntakeId)?.createdTicketIds ?? []
            : snapshot.tickets
                .filter(
                  (ticket) =>
                    ticket.status === "todo" ||
                    ticket.status === "in_progress" ||
                    ticket.status === "in_review",
                )
                .map((ticket) => ticket.id);
      if (scopeTicketIds.length === 0) {
        return yield* Effect.fail(
          presenceError("No actionable tickets were available for the supervisor run."),
        );
      }
      const normalizedScopeTicketIds = normalizeIdList(scopeTicketIds);
      const existingRun = yield* readLatestSupervisorRunForBoard(input.boardId);
      if (existingRun && existingRun.status === "running") {
        const requestedGoalIntakeId = input.goalIntakeId ?? null;
        const existingScope = normalizeIdList(existingRun.scopeTicketIds);
        if (
          existingRun.sourceGoalIntakeId !== requestedGoalIntakeId ||
          JSON.stringify(existingScope) !== JSON.stringify(normalizedScopeTicketIds)
        ) {
          return yield* Effect.fail(
            presenceError(
              "A supervisor run is already active for this board with a different scope. Cancel it before starting another one.",
            ),
          );
        }
        return existingRun;
      }

      const createdAt = nowIso();
      const runId = makeId(SupervisorRunId, "supervisor_run");
      const run = yield* persistSupervisorRun({
        runId,
        boardId: input.boardId,
        sourceGoalIntakeId: input.goalIntakeId ?? null,
        scopeTicketIds: normalizedScopeTicketIds,
        status: "running",
        stage: "plan",
        currentTicketId: null,
        activeThreadIds: [],
        summary: "Supervisor runtime started and is planning the scoped tickets.",
        createdAt,
      }).pipe(
        Effect.catch((cause) =>
          isSqliteUniqueConstraintError(cause)
            ? Effect.gen(function* () {
                const runningRun = yield* readLatestSupervisorRunForBoard(input.boardId);
                const requestedGoalIntakeId = input.goalIntakeId ?? null;
                const runningScope = normalizeIdList(runningRun?.scopeTicketIds ?? []);
                if (
                  runningRun?.status === "running" &&
                  runningRun.sourceGoalIntakeId === requestedGoalIntakeId &&
                  JSON.stringify(runningScope) === JSON.stringify(normalizedScopeTicketIds)
                ) {
                  return runningRun;
                }
                return yield* Effect.fail(
                  presenceError(
                    "A supervisor run is already active for this board with a different scope. Cancel it before starting another one.",
                    cause,
                  ),
                );
              })
            : Effect.fail(cause),
        ),
      );
      yield* saveSupervisorHandoff({
        boardId: input.boardId,
        topPriorities: snapshot.tickets
          .filter((ticket) =>
            normalizedScopeTicketIds.some((scopeTicketId) => scopeTicketId === ticket.id),
          )
          .map((ticket) => ticket.title)
          .slice(0, 3),
        activeAttemptIds: [],
        blockedTicketIds: snapshot.tickets
          .filter((ticket) => ticket.status === "blocked")
          .map((ticket) => ticket.id),
        recentDecisions: ["Started a supervisor runtime using the GLM-style handoff loop."],
        nextBoardActions: ["Work -> test -> log -> advance across the scoped tickets."],
        currentRunId: run.id,
        stage: "plan",
      });
      yield* executeSupervisorRun(run.id).pipe(Effect.ignore, Effect.forkDetach);
      return run;
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(presenceError("Failed to start the supervisor runtime.", cause)),
      ),
    );

  const cancelSupervisorRun: PresenceControlPlaneShape["cancelSupervisorRun"] = (input) =>
    Effect.gen(function* () {
      const run = yield* readSupervisorRunById(input.runId);
      if (!run) {
        return yield* Effect.fail(presenceError(`Supervisor run '${input.runId}' not found.`));
      }
      return yield* persistSupervisorRun({
        runId: run.id,
        boardId: run.boardId,
        sourceGoalIntakeId: run.sourceGoalIntakeId,
        scopeTicketIds: run.scopeTicketIds,
        status: "cancelled",
        stage: run.stage,
        currentTicketId: run.currentTicketId,
        activeThreadIds: [],
        summary: "Supervisor runtime was cancelled.",
        createdAt: run.createdAt,
      });
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(presenceError("Failed to cancel the supervisor runtime.", cause)),
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
    resolveFinding,
    dismissFinding,
    createFollowUpProposal,
    materializeFollowUp,
    syncTicketProjection,
    syncBrainProjection,
    upsertKnowledgePage,
    createPromotionCandidate,
    reviewPromotionCandidate,
    createDeterministicJob,
    evaluateSupervisorAction,
    recordValidationWaiver,
    submitGoalIntake,
    startSupervisorRun,
    cancelSupervisorRun,
    submitReviewDecision,
  } satisfies PresenceControlPlaneShape;
});

export const PresenceControlPlaneLive = Layer.effect(
  PresenceControlPlane,
  makePresenceControlPlane,
).pipe(Layer.provideMerge(SupervisorPolicyLive));
