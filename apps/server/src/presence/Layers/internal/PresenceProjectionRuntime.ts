import { promises as nodeFs } from "node:fs";
import path from "node:path";

import type {
  AttemptOutcomeRecord,
  AttemptRecord,
  BoardSnapshot,
  FindingRecord,
  KnowledgePageRecord,
  MergeOperationRecord,
  ProjectionHealthRecord,
  PresenceAcceptanceChecklistItem,
  PresenceRpcError,
  ProposedFollowUpRecord,
  ReviewArtifactRecord,
  ReviewDecisionRecord,
  SupervisorHandoffRecord,
  SupervisorRunRecord,
  TicketRecord,
  TicketSummaryRecord,
  ValidationRunRecord,
  WorkerHandoffRecord,
} from "@t3tools/contracts";
import { PresenceMergeOperationStatus } from "@t3tools/contracts";
import { Effect, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql/SqlClient";

import {
  buildSupervisorSystemPrompt,
  formatBulletList,
  formatChecklistMarkdown,
  buildSupervisorPromptSections,
} from "./PresencePrompting.ts";
import {
  addMillisecondsIso,
  buildTicketSummaryRecord,
  conciseProjectionErrorMessage,
  collectAttemptActivityEntries,
  formatOptionalText,
  mergeOperationHasCleanupPending,
  mergeOperationIndicatesFailure,
  projectionErrorPath,
  projectionIsRepairEligible,
  projectionRepairKey,
  projectionRetryDelayMs,
  presenceError,
  reasoningIsStale,
  sanitizeProjectionSegment,
  type BlockerSummary,
  type AttemptActivityEntry,
  type ProjectionHealthStatus,
  type ProjectionScopeType,
} from "./PresenceShared.ts";
import type {
  PresenceThreadReadModel,
  TicketPolicyRow,
} from "./PresenceInternalDeps.ts";

type ProjectionRuntimeDeps = Readonly<{
  sql: SqlClient;
  nowIso: () => string;
  mapProjectionHealth: (row: {
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
  }) => ProjectionHealthRecord;
  getBoardSnapshotInternal: (boardId: string) => Effect.Effect<BoardSnapshot, unknown, never>;
  readTicketForPolicy: (ticketId: string) => Effect.Effect<TicketPolicyRow | null, unknown, never>;
  readThreadFromModel: (
    threadId: string,
  ) => Effect.Effect<(PresenceThreadReadModel & { id: string }) | null, unknown, never>;
  buildBlockerSummaries: (input: {
    validationRuns: ReadonlyArray<ValidationRunRecord>;
    findings: ReadonlyArray<FindingRecord>;
    handoff: WorkerHandoffRecord | null;
  }) => ReadonlyArray<BlockerSummary>;
}>;

const writeProjectionFile = (filePath: string, content: string) =>
  Effect.tryPromise(async () => {
    await nodeFs.mkdir(path.dirname(filePath), { recursive: true });
    await nodeFs.writeFile(filePath, `${content.trimEnd()}\n`, "utf8");
  }).pipe(
    Effect.mapError((cause) =>
      presenceError(`Failed to write Presence projection '${filePath}'.`, cause),
    ),
  );

const makePresenceProjectionRuntime = (deps: ProjectionRuntimeDeps) => {
  const decode = Schema.decodeUnknownSync;
  const buildSupervisorTicketStateLines = (snapshot: BoardSnapshot) =>
    snapshot.ticketSummaries.map((summary) => {
      const ticket = snapshot.tickets.find((candidate) => candidate.id === summary.ticketId);
      const activeHandoff =
        summary.activeAttemptId
          ? snapshot.attemptSummaries.find(
              (attemptSummary) => attemptSummary.attempt.id === summary.activeAttemptId,
            )?.latestWorkerHandoff ?? null
          : null;
      const blockerClasses = deps
        .buildBlockerSummaries({
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
        })
        .map((item) => item.blockerClass);
      const stateLabel =
        summary.hasCleanupPending
          ? "cleanup_pending"
          : summary.hasMergeFailure
            ? "merge_failed"
            : ticket?.status === "ready_to_merge"
              ? "ready_to_merge"
              : ticket?.status === "blocked" &&
                  blockerClasses.some(
                    (value) =>
                      value !== "validation_regression" &&
                      value !== "review_gap" &&
                      value !== "unknown",
                  )
                ? "blocked_env"
                : ticket?.status === "blocked"
                  ? "blocked_retry"
                  : ticket?.status === "in_review"
                    ? "waiting_on_review"
                    : "waiting_on_worker";
      const retryNote =
        activeHandoff && activeHandoff.retryCount >= 3 ? " Do not retry unchanged." : "";
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
      formatBulletList(
        input.blockerSummaries.map((summary) => `${summary.blockerClass}: ${summary.summary}`),
      ),
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
      input.outcome
        ? `Outcome: ${input.outcome.kind} - ${input.outcome.summary}`
        : "Outcome: None recorded.",
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
        input.blockerSummaries.map((summary) => `${summary.blockerClass}: ${summary.summary}`),
      ),
      "",
      "## Repeated Failure Patterns",
      formatBulletList(
        input.blockerSummaries
          .filter((summary) => summary.count > 1)
          .map((summary) => `${summary.summary} (repeated ${summary.count} times)`),
      ),
      "",
      "## Representative Evidence",
      formatBulletList(
        input.blockerSummaries.map(
          (summary) => `${summary.blockerClass}: ${summary.representativeEvidence}`,
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
      input.outcome
        ? `Latest outcome: ${input.outcome.kind} - ${input.outcome.summary}`
        : "Latest outcome: None recorded.",
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
      formatBulletList(entries.map((entry) => `${entry.createdAt} [${entry.kind}] ${entry.summary}`)),
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
        input.reviewArtifacts.map((artifact) =>
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
    id: row.id as MergeOperationRecord["id"],
    ticketId: row.ticketId as MergeOperationRecord["ticketId"],
    attemptId: row.attemptId as MergeOperationRecord["attemptId"],
    status: decode(PresenceMergeOperationStatus)(row.status),
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

  const projectionWorkerId = `presence-projector-${crypto.randomUUID()}`;
  let projectionWorkerRunning = false;

  const readProjectionHealth = (scopeType: ProjectionScopeType, scopeId: string) =>
    deps.sql<{
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
    `.pipe(
      Effect.map(
        (rows: ReadonlyArray<{
          scopeType: string;
          scopeId: string;
          status: string;
          lastAttemptedAt: string | null;
          lastSucceededAt: string | null;
          lastErrorMessage: string | null;
          lastErrorPath: string | null;
          dirtyReason: string | null;
          retryAfter: string | null;
          attemptCount: number;
          desiredVersion: number;
          projectedVersion: number;
          leaseOwner: string | null;
          leaseExpiresAt: string | null;
          updatedAt: string;
        }>) => (rows[0] ? deps.mapProjectionHealth(rows[0]) : null),
      ),
    );

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
    deps.sql`
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
      const updatedAt = deps.nowIso();
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

  const syncBoardProjectionInternal = (boardId: string) =>
    Effect.gen(function* () {
      const snapshot = yield* deps.getBoardSnapshotInternal(boardId);
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
      const snapshot = yield* deps.getBoardSnapshotInternal(boardId);
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
      const ticketContext = yield* deps.readTicketForPolicy(ticketId);
      if (!ticketContext) {
        return yield* Effect.fail(presenceError(`Ticket '${ticketId}' not found.`));
      }
      const snapshot = yield* deps.getBoardSnapshotInternal(ticketContext.boardId);
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
      const activeBlockerSummaries = deps.buildBlockerSummaries({
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
              thread: yield* deps.readThreadFromModel(activeAttemptThreadId),
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
        const thread = attempt.threadId ? yield* deps.readThreadFromModel(attempt.threadId) : null;
        const activityEntries = yield* collectAttemptActivityEntries({
          thread,
          validationRuns: latestValidationRuns,
          reviewArtifacts: attemptReviewArtifacts,
          mergeOperations: attemptMergeOperations,
        });
        const blockerSummaries = deps.buildBlockerSummaries({
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

  const claimProjectionScope = (
    scopeType: ProjectionScopeType,
    scopeId: string,
    options?: { ignoreRetryAfter?: boolean | undefined },
  ) =>
    Effect.gen(function* () {
      const now = deps.nowIso();
      const leaseExpiresAt = addMillisecondsIso(now, 30_000);
      yield* deps.sql`
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
      const now = deps.nowIso();
      const candidate = yield* deps.sql<{
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
      `.pipe(Effect.map((rows: ReadonlyArray<{ scopeType: string; scopeId: string }>) => rows[0] ?? null));
      if (!candidate) {
        return null;
      }
      return yield* claimProjectionScope(candidate.scopeType as ProjectionScopeType, candidate.scopeId);
    });

  const projectClaimedScope = (claimed: ProjectionHealthRecord) =>
    Effect.gen(function* () {
      const attemptedAt = deps.nowIso();
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

  const syncBoardProjectionBestEffort = (
    boardId: string,
    dirtyReason: string,
  ): Effect.Effect<void, unknown, never> =>
    markProjectionDirty({ scopeType: "board", scopeId: boardId, dirtyReason }).pipe(
      Effect.andThen(runProjectionWorker().pipe(Effect.forkDetach, Effect.asVoid)),
    );

  const syncTicketProjectionBestEffort = (
    ticketId: string,
    dirtyReason: string,
  ): Effect.Effect<void, unknown, never> =>
    markProjectionDirty({ scopeType: "ticket", scopeId: ticketId, dirtyReason }).pipe(
      Effect.andThen(runProjectionWorker().pipe(Effect.forkDetach, Effect.asVoid)),
    );

  const syncProjectionStrict = (
    scopeType: ProjectionScopeType,
    scopeId: string,
    dirtyReason: string,
  ): Effect.Effect<void, PresenceRpcError, never> =>
    Effect.gen(function* () {
      yield* markProjectionDirty({ scopeType, scopeId, dirtyReason }).pipe(
        Effect.mapError((cause) =>
          presenceError(
            `Failed to mark projection scope '${projectionRepairKey(scopeType, scopeId)}' as dirty.`,
            cause,
          ),
        ),
      );
      while (true) {
        const health = yield* readProjectionHealth(scopeType, scopeId).pipe(
          Effect.mapError((cause) =>
            presenceError(
              `Failed to read projection scope '${projectionRepairKey(scopeType, scopeId)}'.`,
              cause,
            ),
          ),
        );
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
          const claimed = yield* claimProjectionScope(scopeType, scopeId, { ignoreRetryAfter: true }).pipe(
            Effect.mapError((cause) =>
              presenceError(
                `Failed to claim projection scope '${projectionRepairKey(scopeType, scopeId)}'.`,
                cause,
              ),
            ),
          );
          if (claimed) {
            yield* projectClaimedScope(claimed).pipe(
              Effect.mapError((cause) =>
                presenceError(
                  `Failed to repair projection scope '${projectionRepairKey(scopeType, scopeId)}'.`,
                  cause,
                ),
              ),
            );
            continue;
          }
        }
        if (health.status === "stale" && health.retryAfter && health.retryAfter.localeCompare(deps.nowIso()) > 0) {
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

  return {
    buildAttemptActivityMarkdown,
    buildAttemptBlockersMarkdown,
    buildAttemptDecisionsMarkdown,
    buildAttemptFindingsMarkdown,
    buildAttemptProgressMarkdown,
    buildAttemptReviewMarkdown,
    buildAttemptValidationMarkdown,
    buildBrainIndexMarkdown,
    buildBrainLogMarkdown,
    buildKnowledgePageMarkdown,
    readProjectionHealth,
    runProjectionWorker,
    buildSupervisorHandoffMarkdown,
    buildSupervisorRunMarkdown,
    buildSupervisorTicketStateLines,
    buildTicketCurrentSummaryMarkdown,
    buildTicketMarkdown,
    mapMergeOperation,
    syncBoardProjectionBestEffort,
    syncProjectionStrict,
    syncTicketProjectionBestEffort,
    sanitizeProjectionSegment,
    writeProjectionFile,
  };
};

export { makePresenceProjectionRuntime };
