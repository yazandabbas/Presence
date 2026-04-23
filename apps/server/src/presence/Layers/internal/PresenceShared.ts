import { promises as nodeFs } from "node:fs";

import {
  type AttemptOutcomeRecord,
  type AttemptRecord,
  type FindingRecord,
  type MergeOperationRecord,
  type ModelSelection,
  PresenceAttemptOutcomeKind,
  PresenceFindingDisposition,
  PresenceFindingSeverity,
  PresenceReviewRecommendationKind,
  PresenceRpcError,
  type PresenceAcceptanceChecklistItem,
  type ProjectionHealthRecord,
  type ProposedFollowUpRecord,
  type ReviewArtifactRecord,
  type ReviewChecklistAssessmentItem,
  type ReviewEvidenceItem,
  ReviewEvidenceKind,
  ReviewEvidenceOutcome,
  type TicketRecord,
  type TicketSummaryRecord,
  TrimmedNonEmptyString,
  type WorkerHandoffRecord,
} from "@t3tools/contracts";
import { Effect, Schema } from "effect";

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

type ProjectionScopeType = ProjectionHealthRecord["scopeType"];

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

function collectAttemptActivityEntries(input: {
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
  reviewArtifacts: ReadonlyArray<ReviewArtifactRecord>;
  mergeOperations: ReadonlyArray<MergeOperationRecord>;
}) {
  return Effect.sync(() => {
    const entries: AttemptActivityEntry[] = [];
    for (const message of input.thread?.messages ?? []) {
      if (message.role !== "assistant") continue;
      const parsed = parsePresenceHandoffBlock(message.text, message.updatedAt ?? message.createdAt);
      const summary = parsed ? "Updated structured handoff reasoning." : truncateText(message.text);
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
          `${operation.status}: ${operation.sourceBranch} -> ${operation.baseBranch}${
            operation.errorSummary ? ` (${operation.errorSummary})` : ""
          }`,
        ),
      });
    }
    return entries
      .filter((entry) => entry.summary.length > 0)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(-40);
  });
}

function sanitizeProjectionSegment(value: string, fallback: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  return normalized.length > 0 ? normalized : fallback;
}

function formatOptionalText(value: string | null | undefined, fallback = "None recorded.") {
  return value?.trim().length ? value.trim() : fallback;
}

function reasoningIsStale(
  handoff: WorkerHandoffRecord | null,
  latestEvidenceAt: string | null,
) {
  return Boolean(
    handoff?.reasoningUpdatedAt &&
      latestEvidenceAt &&
      latestEvidenceAt.localeCompare(handoff.reasoningUpdatedAt) > 0,
  );
}

function buildTicketSummaryRecord(input: {
  ticket: TicketRecord;
  attempts: ReadonlyArray<AttemptRecord>;
  latestWorkerHandoffByAttemptId: ReadonlyMap<string, WorkerHandoffRecord>;
  findings: ReadonlyArray<FindingRecord>;
  followUps: ReadonlyArray<ProposedFollowUpRecord>;
  attemptOutcomes: ReadonlyArray<AttemptOutcomeRecord>;
  mergeOperations: ReadonlyArray<MergeOperationRecord>;
}): TicketSummaryRecord {
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
    failedWhy: uniqueStrings([
      ...input.attemptOutcomes
        .filter((outcome) => outcome.kind !== "merged" && outcome.kind !== "superseded")
        .map((outcome) => `${outcome.kind}: ${outcome.summary}`),
      ...(activeHandoff?.blockers ?? []),
    ]),
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
}

function isThreadSettled(thread: {
  latestTurn: { state: "running" | "interrupted" | "completed" | "error" } | null;
} | null): boolean {
  return Boolean(thread?.latestTurn && thread.latestTurn.state !== "running");
}

function readLatestAssistantReasoningFromThread(thread: {
  messages: ReadonlyArray<{
    role: string;
    text: string;
    createdAt: string;
    updatedAt: string;
  }>;
} | null) {
  return Effect.sync(() => {
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
}

function readLatestReviewResultFromThread(thread: {
  messages: ReadonlyArray<{
    role: string;
    text: string;
    createdAt: string;
    updatedAt: string;
  }>;
} | null) {
  return Effect.sync(() => {
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
}

function buildBlockerSummaries(input: {
  findings: ReadonlyArray<FindingRecord>;
  handoff: WorkerHandoffRecord | null;
}): ReadonlyArray<BlockerSummary> {
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

  for (const finding of input.findings.filter((candidate) => candidate.status === "open")) {
    register(`${finding.summary} ${finding.rationale}`, finding.updatedAt);
  }
  for (const blocker of input.handoff?.blockers ?? []) {
    register(blocker, input.handoff?.createdAt ?? null);
  }

  return [...grouped.values()].sort((left, right) =>
    (right.latestAt ?? "").localeCompare(left.latestAt ?? ""),
  );
}

function normalizeIdList(values: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function hasAttemptExecutionContext(context: {
  attemptThreadId: string | null;
  attemptLastWorkerHandoffId: string | null;
  workspaceStatus: string;
}): boolean {
  return Boolean(
    context.attemptThreadId ||
      context.attemptLastWorkerHandoffId ||
      context.workspaceStatus === "busy",
  );
}

function checklistIsComplete(checklistJson: string): boolean {
  const items = decodeJson<PresenceAcceptanceChecklistItem[]>(checklistJson, []);
  return items.length > 0 && items.every((item) => item.checked);
}

function repeatedFailureKindForTicket(outcomes: ReadonlyArray<AttemptOutcomeRecord>) {
  const relevantKinds = new Set<typeof PresenceAttemptOutcomeKind.Type>([
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
}

function isEvidenceChecklistItem(item: PresenceAcceptanceChecklistItem): boolean {
  return /evidence attached/i.test(item.label);
}

function isMechanismChecklistItem(item: PresenceAcceptanceChecklistItem): boolean {
  return /mechanism understood/i.test(item.label);
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

function makeId<T extends { make: (value: string) => unknown }>(
  schema: T,
  prefix: string,
): ReturnType<T["make"]> {
  return schema.make(`${prefix}_${crypto.randomUUID()}`) as ReturnType<T["make"]>;
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
    auth?: { status?: string } | null;
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
        candidate.status === "ready" &&
        candidate.auth?.status !== "unauthenticated" &&
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
    auth?: { status?: string } | null;
    models: ReadonlyArray<{ slug: string }>;
  }>,
  selection: ModelSelection | null | undefined,
): selection is ModelSelection {
  if (!selection) return false;
  const provider = providers.find((candidate) => candidate.provider === selection.provider);
  if (!provider) return false;
  if (
    !provider.enabled ||
    !provider.installed ||
    provider.status !== "ready" ||
    provider.auth?.status === "unauthenticated"
  ) {
    return false;
  }
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
      kind: ReviewEvidenceKind.pipe(Schema.withDecodingDefault(Effect.succeed("reasoning"))),
      target: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
      outcome: ReviewEvidenceOutcome.pipe(Schema.withDecodingDefault(Effect.succeed("inconclusive"))),
      relevant: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
      details: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
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

function reviewResultHasValidationEvidence(
  result: ParsedPresenceReviewResult,
  handoff: WorkerHandoffRecord | null,
): boolean {
  const hasConcreteRelevantEvidence = result.evidence.some(
    (item) =>
      item.relevant &&
      item.kind !== "reasoning" &&
      (item.outcome === "passed" || item.outcome === "not_applicable"),
  );
  const changedFiles = handoff?.changedFiles ?? [];
  const reviewedChangedFiles =
    changedFiles.length === 0 ||
    result.changedFilesReviewed.length > 0 ||
    result.evidence.some((item) => item.kind === "diff_review" || item.kind === "file_inspection");
  const checklistWasAssessed =
    result.checklistAssessment.length > 0 &&
    result.checklistAssessment.every((item) => item.satisfied);
  return hasConcreteRelevantEvidence && reviewedChangedFiles && checklistWasAssessed;
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

export {
  REVIEW_THREAD_TIMEOUT_MS,
  PRESENCE_HANDOFF_END,
  PRESENCE_HANDOFF_HEADINGS,
  PRESENCE_HANDOFF_START,
  PRESENCE_REVIEW_RESULT_END,
  PRESENCE_REVIEW_RESULT_START,
  addMillisecondsIso,
  buildBlockerSummaries,
  buildTicketSummaryRecord,
  chooseDefaultModelSelection,
  classifyBlockerText,
  checklistIsComplete,
  collapseWhitespace,
  conciseProjectionErrorMessage,
  collectAttemptActivityEntries,
  decodeJson,
  describeUnknownError,
  encodeJson,
  extractPresenceErrorDetail,
  formatOptionalText,
  formatPresenceErrorMessage,
  hasAttemptExecutionContext,
  isEvidenceChecklistItem,
  isThreadSettled,
  isMechanismChecklistItem,
  isModelSelectionAvailable,
  isPresenceRpcError,
  isSqliteUniqueConstraintError,
  makeId,
  mergeOperationHasCleanupPending,
  mergeOperationIndicatesFailure,
  mergeOperationIsNonTerminal,
  normalizeBlockerSignature,
  normalizeGoalParts,
  normalizeIdList,
  nowIso,
  parsePresenceHandoffBlock,
  parsePresenceReviewResultBlock,
  presenceError,
  projectionErrorPath,
  projectionIsRepairEligible,
  projectionRepairKey,
  projectionRetryDelayMs,
  readLatestAssistantReasoningFromThread,
  readLatestReviewResultFromThread,
  reviewResultHasValidationEvidence,
  readTextFileIfPresent,
  repeatedFailureKindForTicket,
  reasoningIsStale,
  sanitizeProjectionSegment,
  shortTitle,
  summarizeCommandOutput,
  titleFromPath,
  truncateText,
  uniqueStrings,
};

export type {
  AttemptActivityEntry,
  AttemptBlockerClass,
  BlockerSummary,
  ParsedPresenceHandoffBlock,
  ParsedPresenceReviewFinding,
  ParsedPresenceReviewResult,
  ProjectionHealthStatus,
  ProjectionScopeType,
  WorkerReasoningSource,
};
