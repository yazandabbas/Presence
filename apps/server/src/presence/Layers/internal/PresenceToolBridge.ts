import {
  type PresenceAgentReport,
  type PresenceMissionEventKind,
  type PresenceMissionEventRecord,
  type PresenceMissionRetryBehavior,
  type PresenceMissionSeverity,
  type ProviderClientToolSpec,
  PresenceFindingDisposition,
  PresenceFindingSeverity,
  PresenceMissionRetryBehavior as PresenceMissionRetryBehaviorSchema,
  PresenceReviewRecommendationKind,
  type ProviderRuntimeEvent,
  ReviewEvidenceItem,
} from "@t3tools/contracts";
import { Schema } from "effect";

import type { PresenceAgentReportInput } from "./PresenceMissionControl.ts";
import {
  describeUnknownError,
  stableHash,
  truncateText,
  uniqueStrings,
  type ParsedPresenceReviewResult,
} from "./PresenceShared.ts";

type ParsedPresenceWorkerHandoffReport = Readonly<{
  completedWork: ReadonlyArray<string>;
  currentHypothesis: string | null;
  testsRun: ReadonlyArray<string>;
  blockers: ReadonlyArray<string>;
  nextStep: string | null;
  openQuestions: ReadonlyArray<string>;
  source: "tool_report";
  updatedAt: string;
}>;

type PresenceToolThreadCorrelation = Readonly<{
  role: "worker" | "review" | "supervisor";
  boardId: string;
  ticketId: string | null;
  attemptId: string | null;
  reviewArtifactId: string | null;
  supervisorRunId: string | null;
}>;

const PresenceToolName = Schema.Literals([
  "presence.report_progress",
  "presence.report_blocker",
  "presence.record_evidence",
  "presence.submit_review_result",
  "presence.request_human_direction",
]);
type PresenceToolName = typeof PresenceToolName.Type;

type PresenceToolCallEnvelope = Readonly<{
  toolName: PresenceToolName;
  input: unknown;
  callId: string | null;
}>;

type PresenceToolBridgeResult =
  | { readonly _tag: "none" }
  | { readonly _tag: "record"; readonly input: PresenceAgentReportInput }
  | { readonly _tag: "malformed"; readonly input: PresenceAgentReportInput };

const ToolProgressInput = Schema.Struct({
  summary: Schema.String,
  details: Schema.optional(Schema.NullOr(Schema.String)),
  evidence: Schema.optional(Schema.Array(ReviewEvidenceItem)),
  blockers: Schema.optional(Schema.Array(Schema.String)),
  nextAction: Schema.optional(Schema.NullOr(Schema.String)),
});
type ToolProgressInput = typeof ToolProgressInput.Type;

const ToolBlockerInput = Schema.Struct({
  summary: Schema.String,
  details: Schema.optional(Schema.NullOr(Schema.String)),
  blockers: Schema.optional(Schema.Array(Schema.String)),
  humanAction: Schema.optional(Schema.NullOr(Schema.String)),
  retryBehavior: Schema.optional(PresenceMissionRetryBehaviorSchema),
  evidence: Schema.optional(Schema.Array(ReviewEvidenceItem)),
});
type ToolBlockerInput = typeof ToolBlockerInput.Type;

const ToolEvidenceInput = Schema.Struct({
  summary: Schema.String,
  details: Schema.optional(Schema.NullOr(Schema.String)),
  evidence: Schema.Array(ReviewEvidenceItem),
  nextAction: Schema.optional(Schema.NullOr(Schema.String)),
});
type ToolEvidenceInput = typeof ToolEvidenceInput.Type;

const ToolReviewFindingInput = Schema.Struct({
  severity: PresenceFindingSeverity,
  disposition: PresenceFindingDisposition,
  summary: Schema.String,
  rationale: Schema.String,
});

const ToolReviewChecklistInput = Schema.Struct({
  label: Schema.String,
  satisfied: Schema.Boolean,
  notes: Schema.String,
});

const ToolReviewResultInput = Schema.Struct({
  decision: PresenceReviewRecommendationKind,
  summary: Schema.String,
  details: Schema.optional(Schema.NullOr(Schema.String)),
  checklistAssessment: Schema.optional(Schema.Array(ToolReviewChecklistInput)),
  findings: Schema.optional(Schema.Array(ToolReviewFindingInput)),
  evidence: Schema.optional(Schema.Array(ReviewEvidenceItem)),
  changedFilesReviewed: Schema.optional(Schema.Array(Schema.String)),
  nextAction: Schema.optional(Schema.NullOr(Schema.String)),
});
type ToolReviewResultInput = typeof ToolReviewResultInput.Type;

const TOOL_REVIEW_RESULT_DETAIL_TYPE = "presence_tool_review_result_v1";

const ToolHumanDirectionInput = Schema.Struct({
  summary: Schema.String,
  details: Schema.optional(Schema.NullOr(Schema.String)),
  question: Schema.optional(Schema.NullOr(Schema.String)),
  humanAction: Schema.String,
  evidence: Schema.optional(Schema.Array(ReviewEvidenceItem)),
});
type ToolHumanDirectionInput = typeof ToolHumanDirectionInput.Type;

const stringProperty = (description: string) => ({
  type: "string",
  description,
});

const nullableStringProperty = (description: string) => ({
  anyOf: [{ type: "string" }, { type: "null" }],
  description,
});

const stringArrayProperty = (description: string) => ({
  type: "array",
  items: { type: "string" },
  description,
});

const evidenceArrayProperty = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: true,
  },
  description: "Compact evidence items that support the report.",
};

const objectSchema = (
  properties: Readonly<Record<string, unknown>>,
  required: ReadonlyArray<string>,
) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});

const PRESENCE_PROVIDER_CLIENT_TOOLS = [
  {
    name: "presence.report_progress",
    description:
      "Report concise worker or supervisor progress, including what changed and the next intended move.",
    inputSchema: objectSchema(
      {
        summary: stringProperty("Short human-readable progress summary."),
        details: nullableStringProperty("Optional extra context, kept compact."),
        evidence: evidenceArrayProperty,
        blockers: stringArrayProperty("Known blockers, if any."),
        nextAction: nullableStringProperty("The next concrete action Presence should take."),
      },
      ["summary"],
    ),
  },
  {
    name: "presence.report_blocker",
    description:
      "Report that Presence cannot continue without retry, policy, credentials, or human direction.",
    inputSchema: objectSchema(
      {
        summary: stringProperty("Short blocker summary."),
        details: nullableStringProperty("Why this is blocked."),
        blockers: stringArrayProperty("Specific blockers."),
        humanAction: nullableStringProperty("Recommended human action."),
        retryBehavior: {
          type: "string",
          enum: ["automatic", "manual", "not_retryable", "not_applicable"],
          description: "Whether Presence should retry automatically or wait for a human.",
        },
        evidence: evidenceArrayProperty,
      },
      ["summary"],
    ),
  },
  {
    name: "presence.record_evidence",
    description: "Attach compact evidence discovered while working or reviewing.",
    inputSchema: objectSchema(
      {
        summary: stringProperty("Short evidence summary."),
        details: nullableStringProperty("Optional evidence details."),
        evidence: evidenceArrayProperty,
        nextAction: nullableStringProperty("Recommended next action after this evidence."),
      },
      ["summary", "evidence"],
    ),
  },
  {
    name: "presence.submit_review_result",
    description:
      "Submit the reviewer decision and supporting evidence for a Presence review session.",
    inputSchema: objectSchema(
      {
        decision: {
          type: "string",
          enum: ["accept", "request_changes", "escalate"],
          description: "Reviewer decision.",
        },
        summary: stringProperty("Short review result summary."),
        details: nullableStringProperty("Optional review details."),
        checklistAssessment: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              label: stringProperty("Checklist item label."),
              satisfied: { type: "boolean" },
              notes: stringProperty("Review notes for this item."),
            },
            required: ["label", "satisfied", "notes"],
          },
        },
        findings: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              severity: { type: "string", enum: ["info", "warning", "blocking"] },
              disposition: {
                type: "string",
                enum: ["same_ticket", "followup_child", "blocker", "escalate"],
              },
              summary: stringProperty("Finding summary."),
              rationale: stringProperty("Why this finding matters."),
            },
            required: ["severity", "disposition", "summary", "rationale"],
          },
        },
        evidence: evidenceArrayProperty,
        changedFilesReviewed: stringArrayProperty("Changed files reviewed."),
        nextAction: nullableStringProperty("Recommended next action."),
      },
      ["decision", "summary"],
    ),
  },
  {
    name: "presence.request_human_direction",
    description:
      "Ask the repo owner for a specific decision when Presence cannot safely infer one.",
    inputSchema: objectSchema(
      {
        summary: stringProperty("Short reason for needing human direction."),
        details: nullableStringProperty("Optional additional context."),
        question: nullableStringProperty("The concrete question for the human."),
        humanAction: stringProperty("The recommended action the human should take."),
        evidence: evidenceArrayProperty,
      },
      ["summary", "humanAction"],
    ),
  },
] satisfies ReadonlyArray<ProviderClientToolSpec>;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readString = (
  record: Readonly<Record<string, unknown>>,
  keys: ReadonlyArray<string>,
): string | null => {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return null;
};

const normalizeSummary = (value: string): string | null => {
  const summary = truncateText(value, 400);
  return summary.length > 0 ? summary : null;
};

const asPresenceToolName = (value: unknown): PresenceToolName | null => {
  const normalized = stringValue(value);
  if (!normalized) return null;
  return Schema.is(PresenceToolName)(normalized) ? normalized : null;
};

const readNestedRecord = (
  record: Readonly<Record<string, unknown>>,
  keys: ReadonlyArray<string>,
): Readonly<Record<string, unknown>> | null => {
  for (const key of keys) {
    const value = record[key];
    if (isRecord(value)) return value;
  }
  return null;
};

const findToolNameInValue = (value: unknown, depth = 0): PresenceToolName | null => {
  if (depth > 3) return null;
  if (typeof value === "string") return asPresenceToolName(value);
  if (!isRecord(value)) return null;
  const direct = asPresenceToolName(readString(value, ["toolName", "tool", "name", "title"]));
  if (direct) return direct;
  for (const key of ["input", "args", "arguments", "parameters", "state", "payload", "item"]) {
    const nested = value[key];
    const found = findToolNameInValue(nested, depth + 1);
    if (found) return found;
  }
  return null;
};

const findToolInputInRecord = (record: Readonly<Record<string, unknown>>): unknown => {
  const direct = readNestedRecord(record, [
    "input",
    "args",
    "arguments",
    "parameters",
    "toolInput",
  ]);
  if (direct) return direct;
  const state = readNestedRecord(record, ["state"]);
  if (state) {
    const fromState = readNestedRecord(state, ["input", "args", "arguments", "parameters"]);
    if (fromState) return fromState;
  }
  return record;
};

const readCallIdFromValue = (value: unknown): string | null => {
  if (!isRecord(value)) return null;
  const direct = readString(value, [
    "toolUseId",
    "toolUseID",
    "callId",
    "callID",
    "id",
    "requestId",
    "providerRequestId",
  ]);
  if (direct) return direct;
  const state = readNestedRecord(value, ["state"]);
  return state ? readCallIdFromValue(state) : null;
};

const eventCallId = (event: ProviderRuntimeEvent, value: unknown): string | null =>
  readCallIdFromValue(value) ??
  event.providerRefs?.providerRequestId ??
  event.providerRefs?.providerItemId ??
  event.requestId ??
  event.itemId ??
  null;

const eventPayloadCandidates = (event: ProviderRuntimeEvent): ReadonlyArray<unknown> => {
  switch (event.type) {
    case "request.opened":
      return [event.payload.args, event.payload.detail, event.raw?.payload].filter(
        (value) => value !== undefined,
      );
    case "item.completed":
      return [
        event.payload.data,
        event.payload.title,
        event.payload.detail,
        event.raw?.payload,
      ].filter((value) => value !== undefined);
    default:
      return [];
  }
};

const extractPresenceToolCall = (event: ProviderRuntimeEvent): PresenceToolCallEnvelope | null => {
  for (const candidate of eventPayloadCandidates(event)) {
    const toolName = findToolNameInValue(candidate);
    if (!toolName) continue;
    const input = isRecord(candidate) ? findToolInputInRecord(candidate) : {};
    return {
      toolName,
      input,
      callId: eventCallId(event, candidate),
    };
  }
  return null;
};

const decodeProgressInput = Schema.decodeUnknownSync(ToolProgressInput);
const decodeBlockerInput = Schema.decodeUnknownSync(ToolBlockerInput);
const decodeEvidenceInput = Schema.decodeUnknownSync(ToolEvidenceInput);
const decodeReviewResultInput = Schema.decodeUnknownSync(ToolReviewResultInput);
const decodeHumanDirectionInput = Schema.decodeUnknownSync(ToolHumanDirectionInput);

const compactStrings = (values: ReadonlyArray<string> | undefined): ReadonlyArray<string> =>
  uniqueStrings((values ?? []).map((value) => value.trim()).filter(Boolean));

const evidenceOrEmpty = (
  evidence: ReadonlyArray<typeof ReviewEvidenceItem.Type> | undefined,
): PresenceAgentReport["evidence"] => evidence ?? [];

const toolCallIdentity = (call: PresenceToolCallEnvelope): string =>
  call.callId ?? `payload-${stableHash(call.input)}`;

const makeDedupeKey = (
  event: ProviderRuntimeEvent,
  correlation: PresenceToolThreadCorrelation,
  call: PresenceToolCallEnvelope,
) =>
  `presence-tool:${correlation.boardId}:${event.threadId}:${call.toolName}:${toolCallIdentity(
    call,
  )}`;

const makeReportInput = (input: {
  event: ProviderRuntimeEvent;
  correlation: PresenceToolThreadCorrelation;
  kind: PresenceMissionEventKind;
  severity: PresenceMissionSeverity;
  summary: string;
  detail?: string | null;
  retryBehavior: PresenceMissionRetryBehavior;
  humanAction?: string | null;
  dedupeKey: string;
  report: PresenceAgentReport;
}): PresenceAgentReportInput => ({
  boardId: input.correlation.boardId,
  ticketId: input.correlation.ticketId,
  attemptId: input.correlation.attemptId,
  reviewArtifactId: input.correlation.reviewArtifactId,
  supervisorRunId: input.correlation.supervisorRunId,
  threadId: input.event.threadId,
  kind: input.kind,
  severity: input.severity,
  summary: input.summary,
  detail: input.detail ?? null,
  retryBehavior: input.retryBehavior,
  humanAction: input.humanAction ?? null,
  dedupeKey: input.dedupeKey,
  report: input.report,
  createdAt: input.event.createdAt,
});

const reportFromProgress = (
  input: ToolProgressInput,
  event: ProviderRuntimeEvent,
  correlation: PresenceToolThreadCorrelation,
  call: PresenceToolCallEnvelope,
): PresenceAgentReportInput | null => {
  const summary = normalizeSummary(input.summary);
  if (!summary) return null;
  const blockers = compactStrings(input.blockers);
  return makeReportInput({
    event,
    correlation,
    kind: blockers.length > 0 ? "human_blocker" : "worker_handoff",
    severity: blockers.length > 0 ? "warning" : "info",
    summary,
    detail: input.details ?? input.nextAction ?? null,
    retryBehavior: blockers.length > 0 ? "manual" : "not_applicable",
    humanAction:
      blockers.length > 0 ? "Review the worker blocker and decide the next direction." : null,
    dedupeKey: makeDedupeKey(event, correlation, call),
    report: {
      kind: blockers.length > 0 ? "blocker" : "worker_progress",
      summary,
      details: input.details ?? null,
      evidence: evidenceOrEmpty(input.evidence),
      blockers,
      nextAction: input.nextAction ?? null,
    },
  });
};

const reportFromBlocker = (
  input: ToolBlockerInput,
  event: ProviderRuntimeEvent,
  correlation: PresenceToolThreadCorrelation,
  call: PresenceToolCallEnvelope,
): PresenceAgentReportInput | null => {
  const summary = normalizeSummary(input.summary);
  if (!summary) return null;
  const blockers = compactStrings(input.blockers);
  const humanAction =
    input.humanAction ?? "Review the reported blocker and decide the next direction.";
  return makeReportInput({
    event,
    correlation,
    kind: "human_blocker",
    severity: "warning",
    summary,
    detail: input.details ?? (blockers.length > 0 ? blockers.join("\n") : null),
    retryBehavior: input.retryBehavior ?? "manual",
    humanAction,
    dedupeKey: makeDedupeKey(event, correlation, call),
    report: {
      kind: "blocker",
      summary,
      details: input.details ?? null,
      evidence: evidenceOrEmpty(input.evidence),
      blockers: blockers.length > 0 ? blockers : [summary],
      nextAction: humanAction,
    },
  });
};

const reportFromEvidence = (
  input: ToolEvidenceInput,
  event: ProviderRuntimeEvent,
  correlation: PresenceToolThreadCorrelation,
  call: PresenceToolCallEnvelope,
): PresenceAgentReportInput | null => {
  const summary = normalizeSummary(input.summary);
  if (!summary) return null;
  return makeReportInput({
    event,
    correlation,
    kind: "tool_completed",
    severity: "info",
    summary,
    detail: input.details ?? null,
    retryBehavior: "not_applicable",
    dedupeKey: makeDedupeKey(event, correlation, call),
    report: {
      kind: "evidence",
      summary,
      details: input.details ?? null,
      evidence: input.evidence,
      blockers: [],
      nextAction: input.nextAction ?? null,
    },
  });
};

const reviewDetails = (input: ToolReviewResultInput): string | null => {
  const findingSummaries = (input.findings ?? []).map((finding) => finding.summary);
  const changedFiles = compactStrings(input.changedFilesReviewed);
  const lines = [
    input.details ?? null,
    findingSummaries.length > 0 ? `Findings: ${findingSummaries.join("; ")}` : null,
    changedFiles.length > 0 ? `Changed files reviewed: ${changedFiles.join(", ")}` : null,
  ].filter((value): value is string => Boolean(value));
  return lines.length > 0 ? lines.join("\n") : null;
};

const encodeToolReviewResultDetail = (input: ToolReviewResultInput): string =>
  JSON.stringify({
    type: TOOL_REVIEW_RESULT_DETAIL_TYPE,
    decision: input.decision,
    summary: input.summary,
    details: input.details ?? null,
    checklistAssessment: input.checklistAssessment ?? [],
    findings: input.findings ?? [],
    evidence: input.evidence ?? [],
    changedFilesReviewed: input.changedFilesReviewed ?? [],
    nextAction: input.nextAction ?? null,
  });

const parseToolReviewResultDetail = (detail: string | null): ToolReviewResultInput | null => {
  if (!detail) return null;
  try {
    const parsed: unknown = JSON.parse(detail);
    if (!isRecord(parsed) || parsed.type !== TOOL_REVIEW_RESULT_DETAIL_TYPE) return null;
    return decodeReviewResultInput(parsed);
  } catch {
    return null;
  }
};

const reportFromReviewResult = (
  input: ToolReviewResultInput,
  event: ProviderRuntimeEvent,
  correlation: PresenceToolThreadCorrelation,
  call: PresenceToolCallEnvelope,
): PresenceAgentReportInput | null => {
  const summary = normalizeSummary(input.summary);
  if (!summary) return null;
  return makeReportInput({
    event,
    correlation,
    kind: "review_result",
    severity: input.decision === "accept" ? "success" : "warning",
    summary,
    detail: encodeToolReviewResultDetail(input),
    retryBehavior: "not_applicable",
    dedupeKey: makeDedupeKey(event, correlation, call),
    report: {
      kind: "reviewer_decision",
      summary,
      details: reviewDetails(input),
      decision: input.decision,
      evidence: evidenceOrEmpty(input.evidence),
      blockers: (input.findings ?? [])
        .filter((finding) => finding.severity === "blocking")
        .map((finding) => finding.summary),
      nextAction: input.nextAction ?? null,
    },
  });
};

const parsedReviewResultFromToolMissionEvent = (
  event: PresenceMissionEventRecord,
): ParsedPresenceReviewResult | null => {
  if (event.kind !== "review_result" || event.report?.kind !== "reviewer_decision") {
    return null;
  }
  const parsed = parseToolReviewResultDetail(event.detail);
  if (!parsed) return null;
  return {
    decision: parsed.decision,
    summary: parsed.summary,
    checklistAssessment: parsed.checklistAssessment ?? [],
    findings: parsed.findings ?? [],
    evidence: parsed.evidence ?? [],
    changedFilesReviewed: uniqueStrings(parsed.changedFilesReviewed ?? []),
    updatedAt: event.createdAt,
  };
};

const latestToolReviewResultForThread = (
  events: ReadonlyArray<PresenceMissionEventRecord>,
  reviewThreadId: string,
): ParsedPresenceReviewResult | null => {
  for (const event of events) {
    if (event.threadId !== reviewThreadId) continue;
    const parsed = parsedReviewResultFromToolMissionEvent(event);
    if (parsed) return parsed;
  }
  return null;
};

const commandEvidenceTargets = (report: PresenceAgentReport): ReadonlyArray<string> =>
  uniqueStrings(
    report.evidence
      .filter((evidence) => evidence.kind === "command")
      .map((evidence) => evidence.target ?? evidence.summary)
      .filter((value): value is string => Boolean(value?.trim())),
  );

const parsedWorkerHandoffFromToolMissionEvent = (
  event: PresenceMissionEventRecord,
): ParsedPresenceWorkerHandoffReport | null => {
  const report = event.report;
  if (!report) return null;
  if (!event.dedupeKey.startsWith("presence-tool:")) return null;
  if (event.kind === "worker_handoff" && report.kind === "worker_progress") {
    return {
      completedWork: [report.summary],
      currentHypothesis: report.details ?? null,
      testsRun: commandEvidenceTargets(report),
      blockers: report.blockers,
      nextStep: report.nextAction,
      openQuestions: [],
      source: "tool_report",
      updatedAt: event.createdAt,
    };
  }
  if (event.kind === "human_blocker" && report.kind === "blocker") {
    return {
      completedWork: [],
      currentHypothesis: report.details ?? null,
      testsRun: commandEvidenceTargets(report),
      blockers: report.blockers.length > 0 ? report.blockers : [report.summary],
      nextStep: event.humanAction ?? report.nextAction,
      openQuestions: report.nextAction ? [report.nextAction] : [],
      source: "tool_report",
      updatedAt: event.createdAt,
    };
  }
  return null;
};

const latestToolWorkerHandoffForThread = (
  events: ReadonlyArray<PresenceMissionEventRecord>,
  input: { threadId: string; attemptId: string },
): ParsedPresenceWorkerHandoffReport | null => {
  let latest: ParsedPresenceWorkerHandoffReport | null = null;
  for (const event of events) {
    if (event.threadId !== input.threadId || event.attemptId !== input.attemptId) continue;
    const parsed = parsedWorkerHandoffFromToolMissionEvent(event);
    if (!parsed) continue;
    if (!latest || parsed.updatedAt.localeCompare(latest.updatedAt) > 0) {
      latest = parsed;
    }
  }
  return latest;
};

const reportFromHumanDirection = (
  input: ToolHumanDirectionInput,
  event: ProviderRuntimeEvent,
  correlation: PresenceToolThreadCorrelation,
  call: PresenceToolCallEnvelope,
): PresenceAgentReportInput | null => {
  const summary = normalizeSummary(input.summary);
  if (!summary) return null;
  return makeReportInput({
    event,
    correlation,
    kind: "user_input_requested",
    severity: "warning",
    summary,
    detail: input.details ?? input.question ?? null,
    retryBehavior: "manual",
    humanAction: input.humanAction,
    dedupeKey: makeDedupeKey(event, correlation, call),
    report: {
      kind: "blocker",
      summary,
      details: input.details ?? input.question ?? null,
      evidence: evidenceOrEmpty(input.evidence),
      blockers: [summary],
      nextAction: input.humanAction,
    },
  });
};

const malformedReportInput = (input: {
  event: ProviderRuntimeEvent;
  correlation: PresenceToolThreadCorrelation;
  toolName: PresenceToolName;
  callId: string | null;
  reason: string;
}): PresenceAgentReportInput =>
  makeReportInput({
    event: input.event,
    correlation: input.correlation,
    kind: input.toolName === "presence.submit_review_result" ? "review_failed" : "runtime_warning",
    severity: input.toolName === "presence.submit_review_result" ? "error" : "warning",
    summary: "Presence tool report was malformed.",
    detail: truncateText(input.reason, 1_000),
    retryBehavior: "manual",
    humanAction: "Ask the agent to resend a valid Presence report or inspect the thread.",
    dedupeKey: `presence-tool-malformed:${input.correlation.boardId}:${
      input.event.threadId
    }:${input.toolName}:${input.callId ?? `reason-${stableHash(input.reason)}`}`,
    report: {
      kind: "blocker",
      summary: "Presence tool report was malformed.",
      details: truncateText(input.reason, 1_000),
      evidence: [],
      blockers: [truncateText(input.reason, 500)],
      nextAction: "Ask the agent to resend a valid Presence report or inspect the thread.",
    },
  });

const reportInputFromToolCall = (
  event: ProviderRuntimeEvent,
  correlation: PresenceToolThreadCorrelation,
  call: PresenceToolCallEnvelope,
): PresenceToolBridgeResult => {
  try {
    const input =
      call.toolName === "presence.report_progress"
        ? reportFromProgress(decodeProgressInput(call.input), event, correlation, call)
        : call.toolName === "presence.report_blocker"
          ? reportFromBlocker(decodeBlockerInput(call.input), event, correlation, call)
          : call.toolName === "presence.record_evidence"
            ? reportFromEvidence(decodeEvidenceInput(call.input), event, correlation, call)
            : call.toolName === "presence.submit_review_result"
              ? reportFromReviewResult(
                  decodeReviewResultInput(call.input),
                  event,
                  correlation,
                  call,
                )
              : reportFromHumanDirection(
                  decodeHumanDirectionInput(call.input),
                  event,
                  correlation,
                  call,
                );
    return input
      ? { _tag: "record", input }
      : {
          _tag: "malformed",
          input: malformedReportInput({
            event,
            correlation,
            toolName: call.toolName,
            callId: call.callId,
            reason: "The Presence tool payload did not include a non-empty summary.",
          }),
        };
  } catch (error) {
    return {
      _tag: "malformed",
      input: malformedReportInput({
        event,
        correlation,
        toolName: call.toolName,
        callId: call.callId,
        reason: describeUnknownError(error),
      }),
    };
  }
};

const buildPresenceToolBridgeReport = (
  event: ProviderRuntimeEvent,
  correlation: PresenceToolThreadCorrelation,
): PresenceToolBridgeResult => {
  const call = extractPresenceToolCall(event);
  if (!call) return { _tag: "none" };
  return reportInputFromToolCall(event, correlation, call);
};

export {
  buildPresenceToolBridgeReport,
  extractPresenceToolCall,
  latestToolReviewResultForThread,
  latestToolWorkerHandoffForThread,
  parsedReviewResultFromToolMissionEvent,
  parsedWorkerHandoffFromToolMissionEvent,
  PRESENCE_PROVIDER_CLIENT_TOOLS,
};
export type {
  ParsedPresenceWorkerHandoffReport,
  PresenceToolBridgeResult,
  PresenceToolName,
  PresenceToolThreadCorrelation,
};
