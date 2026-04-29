import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  BoardSnapshot,
  PresenceBoardControllerState,
  PresenceHumanDirectionResult,
  PresenceMissionEventRecord,
  PresenceOperationRecord,
  PresenceSubmitGoalIntakeInput,
  PresenceSubmitHumanDirectionInput,
  RepoBrainEvidenceRecord,
  RepoBrainMemoryRecord,
  RepoBrainPromotionCandidateRecord,
  RepoBrainPromotionReviewRecord,
  RepoBrainProvenanceSource,
  ReviewArtifactRecord,
  SupervisorRunRecord,
  WorkerHandoffRecord,
} from "./presence.ts";

const iso = "2026-04-24T00:00:00.000Z";

const roundtrip = <A>(schema: Schema.Schema<A>, input: unknown): A => {
  const decode = Schema.decodeUnknownSync(schema as never) as (value: unknown) => A;
  const encode = Schema.encodeUnknownSync(schema as never) as (value: A) => unknown;
  const decoded = decode(input);
  return decode(encode(decoded));
};

const expectDecodeFailure = <A>(schema: Schema.Schema<A>, input: unknown) => {
  const decode = Schema.decodeUnknownSync(schema as never) as (value: unknown) => A;
  expect(() => decode(input)).toThrow();
};

const missionEventPayload = {
  id: "mission_event_1",
  boardId: "board_1",
  ticketId: "ticket_1",
  attemptId: "attempt_1",
  reviewArtifactId: null,
  supervisorRunId: null,
  threadId: null,
  kind: "human_direction",
  severity: "info",
  summary: "Retry the review with Codex guidance.",
  detail: "Retry review with Codex and explain any remaining blocker.",
  retryBehavior: "automatic",
  humanAction: null,
  dedupeKey: "human-direction:ticket_1:2026-04-24T00:00:00.000Z",
  report: {
    kind: "supervisor_decision",
    summary: "Retry the review with Codex guidance.",
    details: "Retry review with Codex and explain any remaining blocker.",
    evidence: [],
    blockers: [],
    nextAction: "Resume the supervisor loop with this direction.",
  },
  createdAt: iso,
};

const workerHandoffPayload = {
  id: "handoff_1",
  attemptId: "attempt_1",
  completedWork: ["Added focused schema coverage."],
  currentHypothesis: "Presence contracts need durable compatibility tests.",
  changedFiles: ["packages/contracts/src/presence.test.ts"],
  testsRun: ["bun run test src/presence.test.ts"],
  blockers: [],
  nextStep: "Run focused contract validation.",
  openQuestions: [],
  retryCount: 0,
  reasoningSource: "assistant_block",
  reasoningUpdatedAt: iso,
  confidence: 0.82,
  evidenceIds: ["evidence_1"],
  createdAt: iso,
};

const supervisorRunPayload = {
  id: "supervisor_run_1",
  boardId: "board_1",
  sourceGoalIntakeId: "goal_intake_1",
  scopeTicketIds: ["ticket_1"],
  status: "running",
  stage: "waiting_on_worker",
  currentTicketId: "ticket_1",
  activeThreadIds: ["thread_1"],
  summary: "Supervisor is waiting on worker handoff.",
  createdAt: iso,
  updatedAt: iso,
};

const reviewArtifactPayload = {
  id: "review_artifact_1",
  ticketId: "ticket_1",
  attemptId: "attempt_1",
  reviewerKind: "review_agent",
  decision: "accept",
  summary: "The implementation satisfies the ticket.",
  checklistJson: "[]",
  checklistAssessment: [
    {
      label: "Mechanism understood",
      satisfied: true,
      notes: "The reviewer inspected the changed file.",
    },
  ],
  evidence: [
    {
      summary: "Reviewed the Presence contract test.",
      kind: "file_inspection",
      target: "packages/contracts/src/presence.test.ts",
      outcome: "passed",
      relevant: true,
      details: null,
    },
  ],
  changedFiles: ["packages/contracts/src/presence.test.ts"],
  changedFilesReviewed: ["packages/contracts/src/presence.test.ts"],
  findingIds: [],
  threadId: "thread_2",
  createdAt: iso,
};

const controllerStatePayload = {
  boardId: "board_1",
  mode: "active",
  status: "running",
  summary: "Presence is supervising active work.",
  leaseOwner: "presence-controller",
  leaseExpiresAt: null,
  lastTickAt: iso,
  updatedAt: iso,
};

const repoBrainEvidencePayload = {
  id: "repo_brain_evidence_1",
  repositoryId: "repository_1",
  memoryId: "repo_brain_memory_1",
  role: "supports",
  source: {
    ticketId: "ticket_1",
    attemptId: "attempt_1",
    reviewArtifactId: "review_artifact_1",
    filePath: "packages/contracts/src/presence.ts",
    command: "bun run --filter @t3tools/contracts test -- presence.test.ts",
    test: "presence.test.ts",
    commitSha: "abc123",
  },
  summary: "Review evidence links repo-brain contract memory to schema and tests.",
  confidence: "high",
  observedAt: iso,
  createdAt: iso,
};

const repoBrainMemoryPayload = {
  id: "repo_brain_memory_1",
  repositoryId: "repository_1",
  kind: "workflow",
  status: "accepted",
  title: "Presence contract changes require focused schema tests",
  body: "When Presence contracts change, add schema roundtrip and invalid-value coverage.",
  scope: {
    type: "file",
    target: "packages/contracts/src/presence.ts",
  },
  confidence: "high",
  trustMode: "read_write",
  sourceEvidenceIds: ["repo_brain_evidence_1"],
  invalidationTriggers: [
    {
      kind: "file_changed",
      target: "packages/contracts/src/presence.ts",
      reason: "Contract schema changed after this memory was reviewed.",
    },
    {
      kind: "command_failed",
      target: "bun run --filter @t3tools/contracts test -- presence.test.ts",
      reason: "The focused contract validation failed after this memory was accepted.",
    },
  ],
  createdAt: iso,
  updatedAt: iso,
  reviewedAt: iso,
};

const repoBrainCandidatePayload = {
  id: "promotion_candidate_1",
  repositoryId: "repository_1",
  proposedMemoryId: null,
  predecessorCandidateId: null,
  kind: "lesson",
  status: "candidate",
  title: "Failed attempts should produce lessons, not facts",
  body: "A failed worker attempt can propose a bounded lesson only when it carries attempt evidence.",
  scope: {
    type: "attempt",
    target: "attempt_1",
  },
  confidence: "medium",
  proposedBy: "reviewer",
  sourceEvidenceIds: ["repo_brain_evidence_1"],
  invalidationTriggers: [
    {
      kind: "newer_review",
      target: "review_artifact_1",
      reason: "A newer review contradicted the candidate.",
    },
  ],
  createdAt: iso,
  updatedAt: iso,
  reviewedAt: null,
};

const repoBrainReviewPayload = {
  id: "repo_brain_review_1",
  candidateId: "promotion_candidate_1",
  resultingMemoryId: "repo_brain_memory_1",
  action: "edit_accept",
  reviewerKind: "human",
  reviewer: "maintainer",
  reason: "Edited the claim to keep the lesson narrowly scoped.",
  finalTitle: "Failed attempts should produce lessons, not facts",
  finalBody: "Failed attempts can produce bounded lessons, but not current implementation facts.",
  finalScope: {
    type: "attempt",
    target: "attempt_1",
  },
  finalConfidence: "medium",
  finalInvalidationTriggers: [
    {
      kind: "newer_attempt",
      target: "attempt_1",
      reason: "A newer attempt superseded the lesson.",
    },
  ],
  createdAt: iso,
};

const operationLedgerPayload = {
  id: "presence_operation_1",
  parentOperationId: "presence_operation_parent",
  boardId: "board_1",
  ticketId: "ticket_1",
  attemptId: "attempt_1",
  reviewArtifactId: "review_artifact_1",
  supervisorRunId: "supervisor_run_1",
  threadId: "thread_1",
  kind: "review_run",
  phase: "finish",
  status: "completed",
  dedupeKey: "review-artifact:review_artifact_1",
  summary: "Review completed with structured evidence.",
  details: {
    reviewerKind: "review_agent",
    changedFiles: ["apps/server/src/presence/Layers/internal/PresenceStore.ts"],
  },
  counters: [
    { name: "changedFiles", value: 1 },
    { name: "findings", value: 0 },
  ],
  error: null,
  startedAt: iso,
  completedAt: iso,
  durationMs: 2000,
  createdAt: iso,
  updatedAt: iso,
};

const boardSnapshotPayload = {
  repository: {
    id: "repository_1",
    boardId: "board_1",
    projectId: "project_1",
    title: "Presence",
    workspaceRoot: "C:/Projects/scrum-agent/relay-deck/Presence",
    defaultModelSelection: { provider: "codex", model: "gpt-5.4" },
    createdAt: iso,
    updatedAt: iso,
  },
  board: {
    id: "board_1",
    repositoryId: "repository_1",
    title: "Presence",
    sprintFocus: "Reliability first.",
    topPrioritySummary: "Harden continuity contracts.",
    createdAt: iso,
    updatedAt: iso,
  },
  tickets: [
    {
      id: "ticket_1",
      boardId: "board_1",
      parentTicketId: null,
      title: "Add Presence schema roundtrip tests",
      description: "Cover compatibility for public Presence payloads.",
      status: "in_progress",
      priority: "p1",
      acceptanceChecklist: [{ id: "check_1", label: "Contracts covered", checked: true }],
      assignedAttemptId: "attempt_1",
      createdAt: iso,
      updatedAt: iso,
    },
  ],
  dependencies: [],
  attempts: [
    {
      id: "attempt_1",
      ticketId: "ticket_1",
      workspaceId: "workspace_1",
      title: "Contract test attempt",
      status: "in_progress",
      provider: "codex",
      model: "gpt-5.4",
      threadId: "thread_1",
      summary: "Adding schema tests.",
      confidence: 0.82,
      lastWorkerHandoffId: "handoff_1",
      createdAt: iso,
      updatedAt: iso,
    },
  ],
  workspaces: [
    {
      id: "workspace_1",
      attemptId: "attempt_1",
      status: "ready",
      branch: "presence-contract-tests",
      worktreePath: "C:/tmp/presence-contract-tests",
      createdAt: iso,
      updatedAt: iso,
    },
  ],
  attemptSummaries: [
    {
      attempt: {
        id: "attempt_1",
        ticketId: "ticket_1",
        workspaceId: "workspace_1",
        title: "Contract test attempt",
        status: "in_progress",
        provider: "codex",
        model: "gpt-5.4",
        threadId: "thread_1",
        summary: "Adding schema tests.",
        confidence: 0.82,
        lastWorkerHandoffId: "handoff_1",
        createdAt: iso,
        updatedAt: iso,
      },
      workspace: {
        id: "workspace_1",
        attemptId: "attempt_1",
        status: "ready",
        branch: "presence-contract-tests",
        worktreePath: "C:/tmp/presence-contract-tests",
        createdAt: iso,
        updatedAt: iso,
      },
      latestWorkerHandoff: workerHandoffPayload,
    },
  ],
  supervisorHandoff: null,
  evidence: [
    {
      id: "evidence_1",
      attemptId: "attempt_1",
      title: "Presence contract tests inspected",
      kind: "file_inspection",
      content: "presence.test.ts",
      createdAt: iso,
    },
  ],
  promotionCandidates: [],
  knowledgePages: [],
  jobs: [],
  findings: [],
  reviewArtifacts: [reviewArtifactPayload],
  mergeOperations: [],
  proposedFollowUps: [],
  ticketSummaries: [
    {
      ticketId: "ticket_1",
      currentMechanism: "Presence contract payloads are decoded at RPC boundaries.",
      triedAcrossAttempts: ["Added focused tests."],
      failedWhy: [],
      openFindings: [],
      nextStep: "Run validation.",
      activeAttemptId: "attempt_1",
      blocked: false,
      escalated: false,
      hasFollowUpProposal: false,
      hasMergeFailure: false,
      hasCleanupPending: false,
    },
  ],
  attemptOutcomes: [],
  reviewDecisions: [],
  supervisorRuns: [supervisorRunPayload],
  boardProjectionHealth: null,
  ticketProjectionHealth: [],
  hasStaleProjections: false,
  capabilityScan: null,
  goalIntakes: [
    {
      id: "goal_intake_1",
      boardId: "board_1",
      source: "human_goal",
      rawGoal: "Harden Presence contracts.",
      summary: "Harden Presence contracts.",
      createdTicketIds: ["ticket_1"],
      status: "planned",
      plannedAt: iso,
      blockedAt: null,
      lastError: null,
      createdAt: iso,
      updatedAt: iso,
    },
  ],
  missionBriefing: {
    boardId: "board_1",
    summary: "Presence is actively moving one ticket.",
    activeTicketIds: ["ticket_1"],
    blockedTicketIds: [],
    humanActionTicketIds: [],
    latestEventId: "mission_event_1",
    latestEventSummary: "Retry the review with Codex guidance.",
    latestEventAt: iso,
    updatedAt: iso,
  },
  ticketBriefings: [
    {
      ticketId: "ticket_1",
      stage: "In progress",
      statusLine: "Worker is active.",
      waitingOn: "Worker handoff.",
      latestEventId: "mission_event_1",
      latestEventSummary: "Retry the review with Codex guidance.",
      latestEventAt: iso,
      needsHuman: false,
      humanAction: null,
      retryBehavior: "not_applicable",
      updatedAt: iso,
    },
  ],
  missionEvents: [missionEventPayload],
  controllerState: controllerStatePayload,
  operationLedger: [operationLedgerPayload],
};

describe("Presence human direction contracts", () => {
  it("decodes human direction input with auto-continue enabled by default", () => {
    const parsed = Schema.decodeUnknownSync(PresenceSubmitHumanDirectionInput)({
      boardId: "board_1",
      ticketId: "ticket_1",
      directionKind: "retry_review_with_codex",
      instructions: "Retry review with Codex and explain any remaining blocker.",
    });

    expect(parsed.autoContinue).toBe(true);
    expect(parsed.directionKind).toBe("retry_review_with_codex");
  });

  it("accepts human_direction mission events", () => {
    const parsed = roundtrip(PresenceMissionEventRecord, missionEventPayload);

    expect(parsed.kind).toBe("human_direction");
    expect(parsed.report?.kind).toBe("supervisor_decision");
  });

  it("decodes human direction results without a supervisor run", () => {
    const parsed = Schema.decodeUnknownSync(PresenceHumanDirectionResult)({
      missionEvent: missionEventPayload,
      supervisorRun: null,
    });

    expect(parsed.missionEvent.kind).toBe("human_direction");
    expect(parsed.supervisorRun).toBeNull();
  });
});

describe("Presence schema roundtrips", () => {
  it("roundtrips goal intake input defaults", () => {
    const parsed = roundtrip(PresenceSubmitGoalIntakeInput, {
      boardId: "board_1",
      rawGoal: "Turn this goal into the next safe Presence tickets.",
    });

    expect(parsed.source).toBe("human_goal");
    expect(parsed.planNow).toBeUndefined();
  });

  it("roundtrips core continuity records", () => {
    expect(roundtrip(WorkerHandoffRecord, workerHandoffPayload).evidenceIds).toEqual([
      "evidence_1",
    ]);
    expect(
      roundtrip(WorkerHandoffRecord, {
        ...workerHandoffPayload,
        reasoningSource: "tool_report",
      }).reasoningSource,
    ).toBe("tool_report");
    expect(roundtrip(SupervisorRunRecord, supervisorRunPayload).activeThreadIds).toEqual([
      "thread_1",
    ]);
    expect(roundtrip(ReviewArtifactRecord, reviewArtifactPayload).evidence[0]?.kind).toBe(
      "file_inspection",
    );
    expect(roundtrip(PresenceBoardControllerState, controllerStatePayload).status).toBe("running");
  });

  it("roundtrips a board snapshot with mission and controller state", () => {
    const parsed = roundtrip(BoardSnapshot, boardSnapshotPayload);

    expect(parsed.repository.id).toBe("repository_1");
    expect(parsed.tickets[0]?.acceptanceChecklist[0]?.checked).toBe(true);
    expect(parsed.attemptSummaries[0]?.latestWorkerHandoff?.id).toBe("handoff_1");
    expect(parsed.reviewArtifacts[0]?.evidence[0]?.outcome).toBe("passed");
    expect(parsed.supervisorRuns[0]?.stage).toBe("waiting_on_worker");
    expect(parsed.missionEvents[0]?.dedupeKey).toContain("human-direction");
    expect(parsed.controllerState?.leaseOwner).toBe("presence-controller");
    expect(parsed.operationLedger[0]?.kind).toBe("review_run");
  });

  it("keeps old board snapshots compatible when mission/controller fields are omitted", () => {
    const {
      missionBriefing,
      ticketBriefings,
      missionEvents,
      controllerState,
      operationLedger,
      ...legacySnapshot
    } = boardSnapshotPayload;
    void missionBriefing;
    void ticketBriefings;
    void missionEvents;
    void controllerState;
    void operationLedger;

    const parsed = Schema.decodeUnknownSync(BoardSnapshot)(legacySnapshot);

    expect(parsed.missionBriefing).toBeNull();
    expect(parsed.ticketBriefings).toEqual([]);
    expect(parsed.missionEvents).toEqual([]);
    expect(parsed.controllerState).toBeNull();
    expect(parsed.operationLedger).toEqual([]);
  });

  it("keeps compact mission reports compatible when optional report fields are omitted", () => {
    const parsed = Schema.decodeUnknownSync(PresenceMissionEventRecord)({
      ...missionEventPayload,
      report: {
        kind: "evidence",
        summary: "Captured compact evidence.",
      },
    });

    expect(parsed.report?.details).toBeNull();
    expect(parsed.report?.evidence).toEqual([]);
    expect(parsed.report?.blockers).toEqual([]);
    expect(parsed.report?.nextAction).toBeNull();
  });

  it("rejects invalid public enum values", () => {
    expectDecodeFailure(PresenceSubmitGoalIntakeInput, {
      boardId: "board_1",
      rawGoal: "Ship Presence.",
      source: "cron",
    });
    expectDecodeFailure(PresenceMissionEventRecord, {
      ...missionEventPayload,
      kind: "jarvis_magic",
    });
    expectDecodeFailure(PresenceBoardControllerState, {
      ...controllerStatePayload,
      status: "thinking_deeply",
    });
  });
});

describe("Presence repo-brain memory contracts", () => {
  it("roundtrips repo-brain evidence, memory, candidate, and review records", () => {
    const evidence = roundtrip(RepoBrainEvidenceRecord, repoBrainEvidencePayload);
    const memory = roundtrip(RepoBrainMemoryRecord, repoBrainMemoryPayload);
    const candidate = roundtrip(RepoBrainPromotionCandidateRecord, repoBrainCandidatePayload);
    const review = roundtrip(RepoBrainPromotionReviewRecord, repoBrainReviewPayload);

    expect(evidence.source.ticketId).toBe("ticket_1");
    expect(evidence.source.attemptId).toBe("attempt_1");
    expect(evidence.source.reviewArtifactId).toBe("review_artifact_1");
    expect(evidence.source.filePath).toBe("packages/contracts/src/presence.ts");
    expect(evidence.source.command).toContain("@t3tools/contracts");
    expect(evidence.source.test).toBe("presence.test.ts");
    expect(evidence.source.commitSha).toBe("abc123");
    expect(memory.kind).toBe("workflow");
    expect(memory.status).toBe("accepted");
    expect(memory.confidence).toBe("high");
    expect(memory.trustMode).toBe("read_write");
    expect(memory.invalidationTriggers.map((trigger) => trigger.kind)).toEqual([
      "file_changed",
      "command_failed",
    ]);
    expect(candidate.status).toBe("candidate");
    expect(candidate.proposedBy).toBe("reviewer");
    expect(review.action).toBe("edit_accept");
    expect(review.finalInvalidationTriggers[0]?.kind).toBe("newer_attempt");
  });

  it("represents rejected, stale, disputed, and historical memory states", () => {
    expect(
      roundtrip(RepoBrainMemoryRecord, {
        ...repoBrainMemoryPayload,
        id: "repo_brain_memory_rejected",
        status: "rejected",
      }).status,
    ).toBe("rejected");
    expect(
      roundtrip(RepoBrainMemoryRecord, {
        ...repoBrainMemoryPayload,
        id: "repo_brain_memory_stale",
        status: "stale",
      }).status,
    ).toBe("stale");
    expect(
      roundtrip(RepoBrainMemoryRecord, {
        ...repoBrainMemoryPayload,
        id: "repo_brain_memory_disputed",
        status: "disputed",
      }).status,
    ).toBe("disputed");
    expect(
      roundtrip(RepoBrainMemoryRecord, {
        ...repoBrainMemoryPayload,
        id: "repo_brain_memory_historical",
        status: "historical",
      }).status,
    ).toBe("historical");
  });

  it("requires at least one durable provenance source reference", () => {
    expect(
      Schema.decodeUnknownSync(RepoBrainProvenanceSource)({
        filePath: "packages/contracts/src/presence.ts",
      }).filePath,
    ).toBe("packages/contracts/src/presence.ts");

    expectDecodeFailure(RepoBrainProvenanceSource, {});
    expectDecodeFailure(RepoBrainEvidenceRecord, {
      ...repoBrainEvidencePayload,
      source: {},
    });
  });

  it("rejects invalid repo-brain enum values", () => {
    expectDecodeFailure(RepoBrainMemoryRecord, {
      ...repoBrainMemoryPayload,
      kind: "preference",
    });
    expectDecodeFailure(RepoBrainMemoryRecord, {
      ...repoBrainMemoryPayload,
      status: "auto_promoted",
    });
    expectDecodeFailure(RepoBrainMemoryRecord, {
      ...repoBrainMemoryPayload,
      confidence: "certain",
    });
    expectDecodeFailure(RepoBrainMemoryRecord, {
      ...repoBrainMemoryPayload,
      trustMode: "yolo",
    });
    expectDecodeFailure(RepoBrainMemoryRecord, {
      ...repoBrainMemoryPayload,
      scope: { type: "workspace", target: "apps/server" },
    });
    expectDecodeFailure(RepoBrainMemoryRecord, {
      ...repoBrainMemoryPayload,
      invalidationTriggers: [
        {
          kind: "vibes_changed",
          target: "packages/contracts/src/presence.ts",
          reason: "Invalid trigger.",
        },
      ],
    });
    expectDecodeFailure(RepoBrainEvidenceRecord, {
      ...repoBrainEvidencePayload,
      role: "proves",
    });
  });
});

describe("Presence operation ledger contracts", () => {
  it("roundtrips structured operation records with correlation and counters", () => {
    const operation = roundtrip(PresenceOperationRecord, operationLedgerPayload);

    expect(operation.id).toBe("presence_operation_1");
    expect(operation.parentOperationId).toBe("presence_operation_parent");
    expect(operation.kind).toBe("review_run");
    expect(operation.phase).toBe("finish");
    expect(operation.status).toBe("completed");
    expect(operation.details).toMatchObject({
      reviewerKind: "review_agent",
    });
    expect(operation.counters).toEqual([
      { name: "changedFiles", value: 1 },
      { name: "findings", value: 0 },
    ]);
  });

  it("records failed operations with structured display-safe errors", () => {
    const operation = roundtrip(PresenceOperationRecord, {
      ...operationLedgerPayload,
      id: "presence_operation_failed",
      parentOperationId: null,
      kind: "provider_runtime_observation",
      phase: "observe",
      status: "failed",
      error: {
        code: "runtime_error",
        message: "Provider runtime disconnected.",
        detail: "The WebSocket stream closed before completion.",
      },
    });

    expect(operation.error?.code).toBe("runtime_error");
    expect(operation.error?.message).toBe("Provider runtime disconnected.");
  });

  it("rejects unknown operation kinds and statuses", () => {
    expectDecodeFailure(PresenceOperationRecord, {
      ...operationLedgerPayload,
      kind: "mega_agent_vibes",
    });
    expectDecodeFailure(PresenceOperationRecord, {
      ...operationLedgerPayload,
      status: "confused",
    });
  });
});
