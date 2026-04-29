import {
  type AttemptRecord,
  type FindingRecord,
  type PresenceAcceptanceChecklistItem,
  type ReviewArtifactRecord,
  type SupervisorHandoffRecord,
  type TicketSummaryRecord,
  type WorkerHandoffRecord,
  type WorkspaceRecord,
} from "@t3tools/contracts";

import type { ParsedPresenceReviewResult } from "./PresenceShared.ts";
import {
  PRESENCE_HANDOFF_END,
  PRESENCE_HANDOFF_HEADINGS,
  PRESENCE_HANDOFF_START,
  PRESENCE_REVIEW_RESULT_END,
  PRESENCE_REVIEW_RESULT_START,
  decodeJson,
  uniqueStrings,
} from "./PresenceShared.ts";

type PromptSection = Readonly<{
  title: string;
  lines: ReadonlyArray<string>;
}>;

type AttemptBootstrapPromptInput = Readonly<{
  attempt: {
    ticketAcceptanceChecklist: string | null;
    ticketTitle: string;
    ticketDescription: string;
    workspaceRoot: string;
  };
  workspace: WorkspaceRecord;
  latestWorkerHandoff: WorkerHandoffRecord | null;
  latestSupervisorHandoff: SupervisorHandoffRecord | null;
  repoBrainBriefing: ReadonlyArray<string>;
}>;

type ReviewWorkerPromptInput = Readonly<{
  ticketTitle: string;
  ticketDescription: string;
  acceptanceChecklist: string;
  ticketSummary: TicketSummaryRecord | null;
  attemptId: string;
  attemptStatus: AttemptRecord["status"];
  workerHandoff: WorkerHandoffRecord | null;
  findings: ReadonlyArray<FindingRecord>;
  priorReviewArtifacts: ReadonlyArray<ReviewArtifactRecord>;
  repoRoot: string;
  worktreePath: string | null;
  branch: string | null;
  supervisorNote: string;
  repoBrainBriefing: ReadonlyArray<string>;
}>;

const formatBulletList = (lines: ReadonlyArray<string>) =>
  lines.length > 0 ? lines.map((line) => `- ${line}`).join("\n") : "- None recorded.";

const formatChecklistMarkdown = (items: ReadonlyArray<PresenceAcceptanceChecklistItem>) =>
  items.length > 0
    ? items.map((item) => `- [${item.checked ? "x" : " "}] ${item.label}`).join("\n")
    : "- No explicit task criteria were recorded.";

const WORKER_ROLE_IDENTITY_LINES = [
  "You are Presence's worker for one ticket attempt in one worktree.",
  "Your job is to execute the assigned unit of work, not to re-plan the board or broaden scope on your own.",
  "Stay anchored to the ticket intent, durable mission state, and the files that actually matter for the task.",
] as const;

const WORKER_EXECUTION_LOOP_LINES = [
  "Work in short cycles: inspect the current state, make the next concrete change, test what changed, record the result, then choose the next step.",
  "Look at the repository and the most relevant files before editing so your first change is grounded in the codebase instead of assumption.",
  "Do not claim completion without running relevant validation when feasible and reporting what passed or failed.",
] as const;

const WORKER_HANDOFF_LINES = [
  "Report concise progress, blockers, evidence, and next steps as mission state so Presence can supervise without reading a whole transcript.",
  "Presence tools are the primary reporting channel: use presence.report_progress for progress, presence.record_evidence for checked evidence, presence.report_blocker for real blockers, and presence.request_human_direction only when you cannot safely continue.",
  "Use the [PRESENCE_HANDOFF] block only when the provider does not expose Presence tools in this session.",
  "Send one Presence report after meaningful progress, after a strategy change, after blocker discovery, and before stopping.",
  "If the current path fails repeatedly, stop repeating it unchanged; switch strategy or surface the blocker clearly.",
] as const;

const WORKER_BOUNDARY_LINES = [
  "Do not quietly rewrite the task into a broader initiative.",
  "Do not ignore failing tests, contradictory evidence, or unresolved blockers just to appear finished.",
  "When in doubt, prefer a smaller correct step with good handoff state over a large speculative change.",
] as const;

const REVIEW_ROLE_IDENTITY_LINES = [
  "You are Presence's review worker for one ticket attempt.",
  "Your job is to validate the attempt agentically against ticket intent, acceptance criteria, code, and findings.",
  "You do not merge code and you do not broaden scope; you produce a grounded recommendation for the supervisor.",
] as const;

const REVIEW_INPUT_LINES = [
  "Use the ticket intent, current ticket summary, worker handoff, changed files, and open findings as the primary review inputs.",
  "Inspect the changed files first and expand outward only when the code or evidence requires it.",
  "Run or inspect whatever narrow checks are relevant to the ticket; do not wait for a separate deterministic validation phase.",
] as const;

const REVIEW_DECISION_LINES = [
  "Return exactly one recommendation: accept, request_changes, or escalate.",
  "Accept only when concrete reviewer validation evidence supports completion against the ticket intent and recorded task criteria.",
  "Every evidence item must include kind, target, outcome, relevant, summary, and details. Use kind=file_inspection, diff_review, command, runtime_behavior, or reasoning; use outcome=passed, failed, not_applicable, or inconclusive.",
  "A pure reasoning-only accept is not valid. If you did not inspect files, review diffs, run a command, or verify runtime behavior, request_changes or escalate instead.",
  "Think of the review result as a typed Presence report: short conclusion first, concrete evidence second, blocker or next action only when needed.",
  "Presence tools are the primary review channel: use presence.submit_review_result for the final decision report when the tool is available.",
  "Emit exactly one [PRESENCE_REVIEW_RESULT] fallback block only when the provider does not expose Presence tools in this session; its body must be valid JSON with decision, summary, checklistAssessment, findings, evidence, and changedFilesReviewed.",
  "Do not edit code, do not write Presence state directly, and do not return free-form review prose instead of the typed report or fallback block.",
] as const;

const SUPERVISOR_ROLE_IDENTITY_LINES = [
  "You are Presence's supervisor for a bounded board run.",
  "You own board-level coordination, prioritization, attempt lifecycle decisions, review sequencing, and ticket state transitions.",
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
  "Resume in this order: mission briefing, recent mission events, board snapshot, latest supervisor handoff, active ticket summaries, relevant durable knowledge, then choose the next orchestration step.",
  "Do not trust stale context over current saved state; if the two disagree, saved state wins until fresh evidence changes it.",
] as const;

const SUPERVISOR_EXECUTOR_LINES = [
  "Workers execute one ticket attempt at a time: they inspect, edit, test, and update attempt-local handoff state.",
  "Review workers validate one attempt at a time and recommend accept, request_changes, or escalate.",
  "Reviewer validation is the quality gate; Presence does not run a separate deterministic validation phase.",
] as const;

const SUPERVISOR_WORKFLOW_LINES = [
  "Move tickets through a disciplined cycle of execution, reviewer validation, review decision, and human-gated merge.",
  "Prefer one active attempt per ticket and avoid duplicate in-flight work.",
  "Ordinary request-changes iteration should continue on the same attempt and thread unless there is a real reason to branch.",
  "A ticket becomes ready_to_merge only after acceptance and remains human-gated for the final merge.",
] as const;

const SUPERVISOR_TICKET_STATE_LINES = [
  "Use ticket states deliberately: todo means unstarted, in_progress means active execution, in_review means waiting on evaluation, ready_to_merge means accepted and human-gated, blocked means progress requires a new decision or outside intervention.",
  "Do not leave tickets oscillating without explanation; if a ticket moves backward or stalls, capture why in the handoff state.",
] as const;

const SUPERVISOR_RETRY_POLICY_LINES = [
  "Treat provider authentication, account, permission, or repeated runtime failures as human blockers instead of retrying them blindly.",
  "Before queuing a continuation or restart, check whether Presence already recorded the same action in mission events.",
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
  [title, ...sections.map((section) => formatPromptSection(section.title, section.lines))].join(
    "\n\n",
  );

const buildWorkerSystemPrompt = () =>
  buildRolePrompt("Presence worker role", buildWorkerPromptSections());

const buildReviewWorkerSystemPrompt = () =>
  buildRolePrompt("Presence review worker role", buildReviewWorkerPromptSections());

const buildSupervisorSystemPrompt = () =>
  buildRolePrompt("Presence supervisor role", buildSupervisorPromptSections());

const buildRelevantSupervisorNotes = (handoff: SupervisorHandoffRecord | null) =>
  handoff
    ? uniqueStrings(
        [handoff.recentDecisions.at(-1) ?? null, handoff.nextBoardActions.at(0) ?? null].filter(
          (value): value is string => Boolean(value),
        ),
      ).slice(0, 2)
    : [];

const buildAttemptBootstrapPrompt = (input: AttemptBootstrapPromptInput) => {
  const acceptanceChecklist = decodeJson<Array<{ label: string; checked: boolean }>>(
    input.attempt.ticketAcceptanceChecklist,
    [],
  );
  const checklistLines =
    acceptanceChecklist.length > 0
      ? acceptanceChecklist
          .map((item) => `- [${item.checked ? "x" : " "}] ${item.label}`)
          .join("\n")
      : "- No explicit task criteria were recorded.";

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
    "Task criteria:",
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
    "Relevant durable repo brain:",
    input.repoBrainBriefing.length > 0
      ? [
          "These reviewed memory items are advisory context with citations. Current saved ticket and attempt state still wins if there is a conflict.",
          formatBulletList(input.repoBrainBriefing),
        ].join("\n")
      : "- No briefing-safe repo-brain memory was found for this assignment.",
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
      "changed files and reviewer validation notes",
    ]),
    "",
    "Presence reporting:",
    "Use Presence tools as the primary report transport: presence.report_progress for progress, presence.record_evidence for validation/evidence, presence.report_blocker for real blockers, and presence.request_human_direction only when you cannot safely continue.",
    "Use this fallback block once for the same report only when tools are not available in this session:",
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
    "Before stopping again, report the updated state through Presence tools when available.",
    "Use this fallback handoff block only when tools are not available in this session:",
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

const buildReviewWorkerPrompt = (input: ReviewWorkerPromptInput) =>
  [
    `Review this ticket attempt: "${input.ticketTitle}".`,
    `Description: ${input.ticketDescription || "No description provided."}`,
    `Attempt id: ${input.attemptId}`,
    `Attempt status: ${input.attemptStatus}`,
    `Supervisor note: ${input.supervisorNote}`,
    "",
    "Task criteria:",
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
    "Reviewer validation instruction:",
    "Validate the attempt yourself. Inspect the changed files, run or reason through relevant checks, and record concrete evidence items with kind, target, outcome, relevance, summary, and details.",
    "",
    "Open findings:",
    formatBulletList(
      input.findings
        .filter((finding) => finding.status === "open")
        .map(
          (finding) =>
            `${finding.severity}: ${finding.summary}${finding.attemptId === input.attemptId ? "" : " (ticket-wide)"}`,
        ),
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
    "Relevant durable repo brain:",
    input.repoBrainBriefing.length > 0
      ? [
          "These reviewed memory items are advisory context with citations. The review must still validate this attempt directly.",
          formatBulletList(input.repoBrainBriefing),
        ].join("\n")
      : "- No briefing-safe repo-brain memory was found for this review.",
    "",
    "Submit exactly one final review report.",
    "Use presence.submit_review_result when available. Use this fallback block only when tools are not available in this session, and do not substitute free-form prose:",
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
              rationale:
                "Tie the finding to actual evidence, code, or missing acceptance coverage.",
            },
          ],
          evidence: [
            {
              kind: "file_inspection",
              target: "apps/example/file.ts",
              outcome: "failed",
              relevant: true,
              summary:
                "List the concrete file, command, diff, or runtime evidence that supports the review.",
              details: "Explain what was inspected and why it does or does not satisfy the ticket.",
            },
          ],
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

export {
  buildAttemptBootstrapPrompt,
  buildReviewWorkerPrompt,
  buildSupervisorPromptSections,
  buildReviewWorkerSystemPrompt,
  buildSupervisorSystemPrompt,
  buildWorkerContinuationPrompt,
  buildWorkerSystemPrompt,
  formatBulletList,
  formatChecklistMarkdown,
  reviewResultSupportsMechanismChecklist,
};

export type { AttemptBootstrapPromptInput, ReviewWorkerPromptInput };
