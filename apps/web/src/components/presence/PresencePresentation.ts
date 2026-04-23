import {
  type AttemptSummary,
  type BoardSnapshot,
  type FindingRecord,
  type MergeOperationRecord,
  type PresenceTicketStatus,
  type ProjectionHealthRecord,
  type RepositoryCapabilityScanRecord,
  type ReviewArtifactRecord,
  type SupervisorPolicyDecision,
  type TicketRecord,
  type TicketSummaryRecord,
} from "@t3tools/contracts";

export const STATUS_COLUMNS: readonly PresenceTicketStatus[] = [
  "todo",
  "in_progress",
  "in_review",
  "ready_to_merge",
  "blocked",
  "done",
];

export const STATUS_LABELS: Record<PresenceTicketStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  ready_to_merge: "Ready to Merge",
  blocked: "Blocked",
  done: "Done",
};

export const STATUS_HINTS: Record<PresenceTicketStatus, string> = {
  backlog: "Capture work without pulling it into the active loop yet.",
  todo: "Set up the next move and give Presence something actionable.",
  in_progress: "Watch execution, validate progress, and unblock quickly.",
  in_review: "Review the evidence and decide how the ticket should move.",
  ready_to_merge: "Human merge approval is the only gate left.",
  blocked: "Something needs attention before the ticket can advance.",
  done: "Completed work stays visible as durable history.",
};

export type PresenceTicketStageBucket =
  | "Needs setup"
  | "In execution"
  | "Needs review"
  | "Needs human decision"
  | "Blocked"
  | "Done";

export type PresenceTicketStageTone = "neutral" | "info" | "warning" | "success";

export interface PresenceTicketStageViewModel {
  bucket: PresenceTicketStageBucket;
  label: string;
  tone: PresenceTicketStageTone;
  waitingOn: string;
}

export type PresenceTicketPrimaryActionKind =
  | "create_attempt"
  | "start_work"
  | "review_result"
  | "merge"
  | "request_changes"
  | "resolve_blocker"
  | "open_ticket";

export interface PresenceTicketPrimaryActionViewModel {
  kind: PresenceTicketPrimaryActionKind;
  label: string;
  helper: string;
}

export type PresenceTicketCalloutSeverity = "info" | "warning" | "error" | "success";

export interface PresenceTicketCalloutViewModel {
  severity: PresenceTicketCalloutSeverity;
  title: string;
  summary: string;
  retryBehavior: string;
  recommendedAction: string;
  details?: string | null;
}

export interface PresenceLatestEventViewModel {
  label: string;
  title: string;
  timestamp: string;
}

export type PresenceTicketTimelineKind =
  | "attempt_created"
  | "worker_started"
  | "worker_updated"
  | "review_completed"
  | "review_failed"
  | "merge_updated"
  | "follow_up_created"
  | "blocker_resolved";

export interface PresenceTicketTimelineItem {
  id: string;
  kind: PresenceTicketTimelineKind;
  title: string;
  description: string;
  timestamp: string;
  tone: PresenceTicketStageTone;
}

export interface PresenceTicketPresentationOptions {
  primaryAttempt?: AttemptSummary | null;
  ticketSummary?: TicketSummaryRecord | null;
  capabilityScan?: RepositoryCapabilityScanRecord | null;
  ticketProjectionHealth?: ProjectionHealthRecord | null;
  approveDecision?: SupervisorPolicyDecision | null;
  mergeDecision?: SupervisorPolicyDecision | null;
}

export function canReviewAttempt(summary: AttemptSummary): boolean {
  return Boolean(
    summary.attempt.threadId ||
      summary.attempt.provider ||
      summary.attempt.model ||
      summary.latestWorkerHandoff ||
      summary.workspace?.worktreePath ||
      summary.workspace?.branch ||
      summary.workspace?.status === "ready" ||
      summary.workspace?.status === "busy" ||
      summary.workspace?.status === "cleaned_up",
  );
}

export function formatPolicyReasons(decision: SupervisorPolicyDecision | null | undefined): string {
  if (!decision || decision.reasons.length === 0) {
    return "";
  }
  return decision.reasons.join(" ");
}

export function deriveTicketStage(
  board: BoardSnapshot,
  ticket: TicketRecord,
  options: PresenceTicketPresentationOptions = {},
): PresenceTicketStageViewModel {
  const summary = options.ticketSummary ?? readTicketSummary(board, ticket.id);
  const attempt = options.primaryAttempt ?? readPrimaryAttempt(board, ticket.id);
  const latestReview = readLatestReviewArtifact(board, ticket.id);
  const latestMerge = readLatestMergeOperation(board, ticket.id);
  const blockingFinding = readOpenFindings(board, ticket.id).find(
    (finding) => finding.severity === "blocking",
  );

  if (summary?.hasMergeFailure || latestMerge?.status === "failed") {
    return {
      bucket: "Blocked",
      label: "Merge failed",
      tone: "warning",
      waitingOn: "Human merge recovery is required.",
    };
  }

  if (ticket.status === "done" || attempt?.attempt.status === "merged") {
    return {
      bucket: "Done",
      label: "Done",
      tone: "success",
      waitingOn: "No human action needed.",
    };
  }

  if (ticket.status === "blocked") {
    if (latestReview?.decision === "escalate") {
      return {
        bucket: "Blocked",
        label: "Blocked by review",
        tone: "warning",
        waitingOn: "A reviewer escalated this ticket.",
      };
    }
    if (blockingFinding) {
      return {
        bucket: "Blocked",
        label: "Blocked by findings",
        tone: "warning",
        waitingOn: "A blocking finding still needs resolution.",
      };
    }
    return {
      bucket: "Blocked",
      label: "Blocked",
      tone: "warning",
      waitingOn: "Presence needs a human decision before it can continue.",
    };
  }

  if (ticket.status === "ready_to_merge") {
    return {
      bucket: "Needs human decision",
      label: "Ready to merge",
      tone: "success",
      waitingOn: "Human merge approval is next.",
    };
  }

  if (ticket.status === "in_review") {
    if (latestReview?.decision === "request_changes") {
      return {
        bucket: "Needs human decision",
        label: "Changes requested",
        tone: "warning",
        waitingOn: "The ticket needs another worker pass.",
      };
    }
    if (latestReview?.decision === "accept") {
      return {
        bucket: "Needs human decision",
        label: "Review accepted",
        tone: "success",
        waitingOn: "Merge approval is the remaining step.",
      };
    }
    return {
      bucket: "Needs review",
      label: attempt?.attempt.status === "in_review" ? "Waiting on review" : "Needs review",
      tone: "info",
      waitingOn: "Presence is waiting for review evidence or a human decision.",
    };
  }

  if (!attempt) {
    return {
      bucket: "Needs setup",
      label: "No active attempt",
      tone: "neutral",
      waitingOn: "Create an attempt to start execution.",
    };
  }

  if (!attempt.attempt.threadId) {
    return {
      bucket: "Needs setup",
      label: "Waiting on worker",
      tone: "neutral",
      waitingOn: "A worker session has not started yet.",
    };
  }

  return {
    bucket: "In execution",
    label: "Waiting on worker",
    tone: "info",
    waitingOn: "Presence is actively coordinating execution on this ticket.",
  };
}

export function deriveTicketPrimaryAction(
  board: BoardSnapshot,
  ticket: TicketRecord,
  selectedAttempt: AttemptSummary | null,
  _capabilityScan: RepositoryCapabilityScanRecord | null | undefined,
): PresenceTicketPrimaryActionViewModel {
  const latestReview = readLatestReviewArtifact(board, ticket.id);
  const latestMerge = readLatestMergeOperation(board, ticket.id);

  if (!selectedAttempt) {
    return {
      kind: "create_attempt",
      label: "Create attempt",
      helper: "Set up a worker path for this ticket.",
    };
  }

  if (!selectedAttempt.attempt.threadId) {
    return {
      kind: "start_work",
      label: "Start work",
      helper: "Launch the worker session and begin execution.",
    };
  }

  if (ticket.status === "ready_to_merge") {
    return {
      kind: "merge",
      label: "Merge",
      helper: "Human merge approval is the next step.",
    };
  }

  if (ticket.status === "in_review") {
    return {
      kind: "review_result",
      label: "Review result",
      helper: "Use the review evidence to accept or request changes.",
    };
  }

  if (ticket.status === "blocked") {
    if (latestReview?.decision === "request_changes") {
      return {
        kind: "request_changes",
        label: "Request changes",
        helper: "Send the ticket back into execution with clearer direction.",
      };
    }
    if (latestMerge?.status === "failed") {
      return {
        kind: "resolve_blocker",
        label: "Resolve blocker",
        helper: "Use the ticket evidence below to unblock the next move.",
      };
    }
    return {
      kind: "resolve_blocker",
      label: "Resolve blocker",
      helper: "Review the blocker and choose the next action.",
    };
  }

  return {
    kind: "open_ticket",
    label: "Open ticket",
    helper: "Inspect the current evidence and decide the next move.",
  };
}

export function deriveTicketReasonLine(
  board: BoardSnapshot,
  ticket: TicketRecord,
  options: PresenceTicketPresentationOptions = {},
): string {
  const summary = options.ticketSummary ?? readTicketSummary(board, ticket.id);
  const attempt = options.primaryAttempt ?? readPrimaryAttempt(board, ticket.id);
  const latestReview = readLatestReviewArtifact(board, ticket.id);
  const latestMerge = readLatestMergeOperation(board, ticket.id);
  const blockingFinding = readOpenFindings(board, ticket.id).find(
    (finding) => finding.severity === "blocking",
  );
  const latestRun = board.supervisorRuns[0];

  if (latestMerge?.status === "failed") {
    return latestMerge.errorSummary ?? "The last merge attempt failed and needs a human fix.";
  }
  if (ticket.status === "ready_to_merge") {
    return "Review accepted. Human merge approval is the next step.";
  }
  if (ticket.status === "done") {
    return summary?.nextStep ?? "This ticket is complete.";
  }
  if (!attempt) {
    return latestRun?.status === "running" && latestRun.currentTicketId === ticket.id
      ? "The supervisor is actively deciding how to start this ticket."
      : "No attempt has been started yet.";
  }
  if (!attempt.attempt.threadId) {
    return "An attempt exists, but the worker session has not started.";
  }
  if (latestReview?.summary) {
    return latestReview.summary;
  }
  if (blockingFinding) {
    return blockingFinding.summary;
  }
  if (summary?.nextStep) {
    return summary.nextStep;
  }
  if (attempt.latestWorkerHandoff?.nextStep) {
    return attempt.latestWorkerHandoff.nextStep;
  }
  return "Presence is waiting for the next meaningful update on this ticket.";
}

export function deriveLatestMeaningfulEvent(
  board: BoardSnapshot,
  ticket: TicketRecord,
): PresenceLatestEventViewModel | null {
  const [latest] = buildTicketTimeline(board, ticket);
  if (!latest) {
    return null;
  }
  return {
    label: latest.title,
    title: latest.description,
    timestamp: latest.timestamp,
  };
}

export function deriveTicketCallout(
  board: BoardSnapshot,
  ticket: TicketRecord,
  options: PresenceTicketPresentationOptions = {},
): PresenceTicketCalloutViewModel | null {
  const attempt = options.primaryAttempt ?? readPrimaryAttempt(board, ticket.id);
  const projectionHealth =
    options.ticketProjectionHealth ??
    board.ticketProjectionHealth.find((candidate) => candidate.scopeId === ticket.id) ??
    null;
  const capabilityScan = options.capabilityScan ?? board.capabilityScan;
  const latestMerge = readLatestMergeOperation(board, ticket.id);
  const latestReview = readLatestReviewArtifact(board, ticket.id);
  const approvalReason = formatPolicyReasons(options.approveDecision ?? null);
  const mergeReason = formatPolicyReasons(options.mergeDecision ?? null);

  if (projectionHealth && projectionHealth.status !== "healthy") {
    return {
      severity: "warning",
      title: "Projection needs attention",
      summary: "Presence is retrying ticket projection and the file view may lag behind the live state.",
      retryBehavior: "Presence will retry projection automatically.",
      recommendedAction: "Keep working unless this warning stays visible.",
      details: projectionHealth.lastErrorMessage,
    };
  }

  if (!capabilityScan) {
    return {
      severity: "info",
      title: "Capability scan missing",
      summary: "Presence has not inspected the repository shape yet.",
      retryBehavior: "A capability rescan refreshes repository discovery.",
      recommendedAction: "Rescan the repo if Presence seems to be missing context.",
    };
  }

  if (latestMerge?.status === "failed") {
    return {
      severity: "error",
      title: "Merge failed",
      summary: latestMerge.errorSummary ?? "The last merge operation failed before Presence could finish.",
      retryBehavior: "Presence will not retry merge automatically.",
      recommendedAction: "Inspect the merge issue, then merge again when ready.",
      details: latestMerge.errorSummary,
    };
  }

  if (ticket.status === "in_review" && attempt?.attempt.status === "in_review" && !latestReview) {
    return {
      severity: "info",
      title: "Review is waiting on evidence",
      summary: "Presence has moved this attempt into review, but no structured review result has landed yet.",
      retryBehavior: "Presence can restart review when the supervisor loop runs again.",
      recommendedAction: "Wait for the reviewer or restart review if it appears stalled.",
    };
  }

  if (ticket.status === "in_progress" && attempt?.attempt.threadId && !attempt.latestWorkerHandoff) {
    return {
      severity: "info",
      title: "Worker session may need attention",
      summary: "The worker session exists, but Presence has not captured a fresh handoff yet.",
      retryBehavior: "Presence can recover worker startup automatically on the next supervisor pass.",
      recommendedAction: "Open the worker session if execution looks stalled.",
    };
  }

  if (mergeReason) {
    return {
      severity: "warning",
      title: "Merge is policy-blocked",
      summary: mergeReason,
      retryBehavior: "Presence will not override merge policy automatically.",
      recommendedAction: "Resolve the merge gate before approving the merge.",
      details: mergeReason,
    };
  }

  if (approvalReason) {
    return {
      severity: "warning",
      title: "Approval is policy-blocked",
      summary: approvalReason,
      retryBehavior: "Presence will not override approval policy automatically.",
      recommendedAction: "Resolve the policy issue or record a waiver if allowed.",
      details: approvalReason,
    };
  }

  return null;
}

export function buildTicketTimeline(
  board: BoardSnapshot,
  ticket: TicketRecord,
): readonly PresenceTicketTimelineItem[] {
  const items: PresenceTicketTimelineItem[] = [];
  const attempts = board.attemptSummaries.filter((summary) => summary.attempt.ticketId === ticket.id);

  for (const attempt of attempts) {
    items.push({
      id: `attempt-${attempt.attempt.id}`,
      kind: "attempt_created",
      title: "Attempt created",
      description: attempt.attempt.title,
      timestamp: attempt.attempt.createdAt,
      tone: "neutral",
    });

    if (attempt.attempt.threadId) {
      items.push({
        id: `worker-start-${attempt.attempt.id}`,
        kind: "worker_started",
        title: attempt.latestWorkerHandoff ? "Worker session restarted" : "Worker session started",
        description:
          attempt.attempt.provider && attempt.attempt.model
            ? `${attempt.attempt.provider} · ${attempt.attempt.model}`
            : "Worker session attached to the attempt.",
        timestamp: attempt.attempt.updatedAt,
        tone: "info",
      });
    }

    if (attempt.latestWorkerHandoff) {
      items.push({
        id: `handoff-${attempt.latestWorkerHandoff.id}`,
        kind: "worker_updated",
        title: "Worker handoff recorded",
        description:
          attempt.latestWorkerHandoff.nextStep ??
          attempt.latestWorkerHandoff.completedWork[0] ??
          "Presence captured an updated worker handoff.",
        timestamp: attempt.latestWorkerHandoff.createdAt,
        tone: "info",
      });
    }
  }

  for (const artifact of board.reviewArtifacts.filter((candidate) => candidate.ticketId === ticket.id)) {
    items.push({
      id: `review-${artifact.id}`,
      kind: artifact.decision === "escalate" ? "review_failed" : "review_completed",
      title:
        artifact.decision === "request_changes"
          ? "Review requested changes"
          : artifact.decision === "accept"
            ? "Review accepted"
            : artifact.decision === "escalate"
              ? "Review escalated"
              : "Review recorded",
      description: artifact.summary,
      timestamp: artifact.createdAt,
      tone:
        artifact.decision === "accept"
          ? "success"
          : artifact.decision === "request_changes" || artifact.decision === "escalate"
            ? "warning"
            : "info",
    });
  }

  for (const merge of board.mergeOperations.filter((candidate) => candidate.ticketId === ticket.id)) {
    items.push({
      id: `merge-${merge.id}`,
      kind: "merge_updated",
      title: deriveMergeTitle(merge),
      description: merge.errorSummary ?? `${merge.baseBranch} ← ${merge.sourceBranch}`,
      timestamp: merge.updatedAt,
      tone: merge.status === "failed" ? "warning" : merge.status === "finalized" ? "success" : "info",
    });
  }

  for (const followUp of board.proposedFollowUps.filter(
    (candidate) => candidate.parentTicketId === ticket.id,
  )) {
    items.push({
      id: `follow-up-${followUp.id}`,
      kind: "follow_up_created",
      title: "Follow-up proposed",
      description: followUp.title,
      timestamp: followUp.createdAt,
      tone: "neutral",
    });
  }

  for (const finding of board.findings.filter((candidate) => candidate.ticketId === ticket.id)) {
    if (finding.status === "open") continue;
    items.push({
      id: `finding-${finding.id}`,
      kind: "blocker_resolved",
      title: finding.status === "resolved" ? "Finding resolved" : "Finding dismissed",
      description: finding.summary,
      timestamp: finding.updatedAt,
      tone: "success",
    });
  }

  return items.sort((left, right) => {
    const byTime = compareDateStrings(right.timestamp, left.timestamp);
    if (byTime !== 0) {
      return byTime;
    }
    return timelinePriority(right.kind) - timelinePriority(left.kind);
  });
}

function deriveMergeTitle(merge: MergeOperationRecord): string {
  switch (merge.status) {
    case "pending_git":
      return "Merge queued";
    case "git_applied":
      return "Merge applied in git";
    case "finalized":
      return "Merge finalized";
    case "cleanup_pending":
      return "Merged with cleanup pending";
    case "failed":
      return "Merge failed";
  }
}

function readTicketSummary(board: BoardSnapshot, ticketId: string): TicketSummaryRecord | null {
  return board.ticketSummaries.find((candidate) => candidate.ticketId === ticketId) ?? null;
}

function readPrimaryAttempt(board: BoardSnapshot, ticketId: string): AttemptSummary | null {
  const attempts = board.attemptSummaries.filter((candidate) => candidate.attempt.ticketId === ticketId);
  return attempts.find(canReviewAttempt) ?? attempts[0] ?? null;
}

function readLatestReviewArtifact(board: BoardSnapshot, ticketId: string): ReviewArtifactRecord | null {
  return board.reviewArtifacts
    .filter((candidate) => candidate.ticketId === ticketId)
    .sort((left, right) => compareDateStrings(right.createdAt, left.createdAt))[0] ?? null;
}

function readLatestMergeOperation(board: BoardSnapshot, ticketId: string): MergeOperationRecord | null {
  return board.mergeOperations
    .filter((candidate) => candidate.ticketId === ticketId)
    .sort((left, right) => compareDateStrings(right.updatedAt, left.updatedAt))[0] ?? null;
}

function readOpenFindings(board: BoardSnapshot, ticketId: string): readonly FindingRecord[] {
  return board.findings.filter(
    (candidate) => candidate.ticketId === ticketId && candidate.status === "open",
  );
}

function compareDateStrings(left: string | null | undefined, right: string | null | undefined): number {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return Date.parse(left) - Date.parse(right);
}

function timelinePriority(kind: PresenceTicketTimelineKind): number {
  switch (kind) {
    case "worker_updated":
      return 7;
    case "review_completed":
    case "review_failed":
      return 6;
    case "merge_updated":
      return 4;
    case "worker_started":
      return 3;
    case "follow_up_created":
      return 2;
    case "blocker_resolved":
      return 1;
    case "attempt_created":
      return 0;
  }
}
